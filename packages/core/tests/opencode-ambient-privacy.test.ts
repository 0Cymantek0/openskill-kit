import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { applyAmbientLabelReview, compileBehaviorLayer, initAdaptiveProject, readAmbientLabelLedger, runLearningPlan, runRawLocalLearning, type PreferenceGraph, type PreferenceNode } from "../src/index.js";
import { readEvents } from "../src/events/store.js";

// These are the fake sensitive values ambient telemetry must never store verbatim.
const SECRET_COMMAND = "GITHUB_TOKEN=abc123 npm test";
const SECRET_PATH = "/Users/alice/work/customer-acme/private.ts";
const SECRET_URL = "https://example.com/private?token=abc";
const SECRET_INLINE = "sk-SECRET";

describe("OpenCode ambient telemetry privacy", () => {
  it("source bundle plugin emits privacy-safe trace context before compilation", async () => {
    const root = await tempProject();
    const previousTrace = process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE;
    const previousSession = process.env.OSK_SESSION_ID;
    const previousEpisode = process.env.OSK_EPISODE_ID;
    const previousTraceId = process.env.OSK_TRACE_ID;
    process.env.OSK_SESSION_ID = "osk_session_source_bundle";
    process.env.OSK_EPISODE_ID = "osk_episode_source_bundle";
    process.env.OSK_TRACE_ID = "osk_trace_source_bundle";
    delete process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE;
    try {
      const pluginPath = path.resolve("packages", "agent-plugin-bundle", "opencode", "plugins", "openskillkit.ts");
      const imported = await import(`${pathToFileURL(pluginPath).href}?case=${Date.now()}-source`);
      const hooks = await imported.OpenSkillKitPlugin({
        worktree: root,
        client: { app: { log: async () => ({}) } }
      });

      await hooks.event({ event: { type: "session.created", sessionID: "raw-opencode-session" } });
      await hooks["tool.execute.after"](
        { tool: "bash", command: SECRET_COMMAND, path: SECRET_PATH, sessionID: "raw-opencode-session" },
        { status: "success", output: SECRET_URL }
      );
    } finally {
      restoreEnv("OPENSKILLKIT_AMBIENT_TRACE_MODE", previousTrace);
      restoreEnv("OSK_SESSION_ID", previousSession);
      restoreEnv("OSK_EPISODE_ID", previousEpisode);
      restoreEnv("OSK_TRACE_ID", previousTraceId);
    }

    const ambient = await readFile(path.join(root, ".openskill-kit", "ambient", "opencode-events.jsonl"), "utf8");
    const records = ambient.trim().split("\n").map((line) => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.eventType)).toEqual(["session-start", "post-tool-use"]);
    expect(records.every((record) => record.traceContext.schemaVersion === "openskill-kit.learn-v2.trace-context.v1")).toBe(true);
    expect(records.every((record) => record.traceContext.oskSessionId === "osk_session_source_bundle")).toBe(true);
    expect(records.every((record) => record.traceContext.oskEpisodeId === "osk_episode_source_bundle")).toBe(true);
    expect(records.every((record) => record.traceContext.oskTraceId === "osk_trace_source_bundle")).toBe(true);
    expect(records.every((record) => record.traceContext.source === "env")).toBe(true);
    expect(records.every((record) => record.traceContext.projectRootHash?.startsWith("sha256:"))).toBe(true);
    expect(records.every((record) => !("projectRoot" in record.traceContext))).toBe(true);
    expect(records[0]!.traceContext.opencodeSessionId).toBe(records[1]!.traceContext.opencodeSessionId);
    expect(records[0]!.traceContext.opencodeSessionId).toMatch(/^opencode_session_/);
    for (const secret of [root, SECRET_COMMAND, SECRET_PATH, SECRET_URL, "raw-opencode-session"]) {
      expect(ambient).not.toContain(secret);
    }
  });

  it("safe mode projects commands/paths into derived fields and never stores raw secrets", async () => {
    const root = await tempProject();
    await compileBehaviorLayer(root, { targets: ["plugin"] });
    const pluginPath = path.join(root, ".openskill-kit", "compiled", "plugin", "opencode", "plugins", "openskillkit.ts");
    // Default is safe; ensure no eval env leaks across tests in this shared process.
    const previousTrace = process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE;
    delete process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE;
    const imported = await import(`${pathToFileURL(pluginPath).href}?case=${Date.now()}-safe`);
    const hooks = await imported.OpenSkillKitPlugin({
      worktree: root,
      client: { app: { log: async () => ({}) } }
    });

    await hooks["tool.execute.after"](
      { tool: "bash", command: SECRET_COMMAND, path: SECRET_PATH, rawPrompt: SECRET_INLINE },
      { status: "success", output: SECRET_URL }
    );

    const ambient = await readFile(path.join(root, ".openskill-kit", "ambient", "opencode-events.jsonl"), "utf8");
    const record = JSON.parse(ambient.trim().split("\n").pop()!);

    // The record is privacy-safe by default.
    expect(record.traceMode).toBe("safe");
    expect(record.containsRawFields).toBe(false);
    expect(record.traceContext.schemaVersion).toBe("openskill-kit.learn-v2.trace-context.v1");
    expect(record.traceContext.oskSessionId).toMatch(/^osk_session_/);
    expect(record.traceContext.oskEpisodeId).toMatch(/^osk_episode_/);
    expect(record.traceContext.oskTraceId).toMatch(/^osk_trace_/);
    expect(record.traceContext.opencodeSessionId).toMatch(/^opencode_session_/);
    expect(record.traceContext.projectRootHash).toMatch(/^sha256:/);
    expect(record.traceContext).not.toHaveProperty("projectRoot");

    // Derived command metadata is present and useful for learning.
    expect(record.metadata["input.commandKind"]).toBe("package-manager");
    expect(record.metadata["input.commandHash"]).toMatch(/^sha256:/);
    // 31 chars: bucketed "short".
    expect(record.metadata["input.commandLengthBucket"]).toBe("short");
    // A TOKEN=value shape is flagged without recording the value itself.
    expect(record.metadata["input.commandRiskFlags"]).toEqual(expect.arrayContaining(["assignment-like"]));
    expect(Array.isArray(record.metadata["input.commandRiskFlags"])).toBe(true);

    // Derived path metadata is present and useful for learning.
    expect(record.metadata["input.pathKind"]).toBe("absolute");
    expect(record.metadata["input.pathHash"]).toMatch(/^sha256:/);
    expect(record.metadata["input.pathExtension"]).toBe(".ts");
    expect(record.metadata["input.pathDepth"]).toBeGreaterThan(2);
    expect(record.metadata["input.pathRiskFlags"]).toEqual(expect.arrayContaining(["home-path", "sensitive-name"]));

    // Safe primitives survive.
    expect(record.metadata["input.tool"]).toBe("bash");
    expect(record.metadata["output.status"]).toBe("success");

    // None of the raw sensitive strings ever land in ambient JSON.
    for (const secret of [SECRET_COMMAND, SECRET_PATH, SECRET_URL, SECRET_INLINE, "abc123", "customer-acme", "alice"]) {
      expect(ambient).not.toContain(secret);
    }
  });

  it("eval mode preserves richer local-only traces, clearly labeled and written to a separate file", async () => {
    const root = await tempProject();
    await compileBehaviorLayer(root, { targets: ["plugin"] });
    const pluginPath = path.join(root, ".openskill-kit", "compiled", "plugin", "opencode", "plugins", "openskillkit.ts");

    // Eval mode is opt-in via an environment variable; default is safe.
    const previous = process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE;
    process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE = "eval";
    try {
      const imported = await import(`${pathToFileURL(pluginPath).href}?case=${Date.now()}-eval`);
      const hooks = await imported.OpenSkillKitPlugin({
        worktree: root,
        client: { app: { log: async () => ({}) } }
      });

      await hooks["tool.execute.after"](
        { tool: "bash", command: SECRET_COMMAND, path: SECRET_PATH },
        { status: "success", output: SECRET_URL }
      );
    } finally {
      if (previous === undefined) delete process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE;
      else process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE = previous;
    }

    const ambient = await readFile(path.join(root, ".openskill-kit", "ambient", "opencode-events.jsonl"), "utf8");
    const ambientRecord = JSON.parse(ambient.trim().split("\n").pop()!);

    // The normal ambient file still carries safe derived metadata only.
    expect(ambientRecord.traceMode).toBe("eval");
    expect(ambientRecord.containsRawFields).toBe(false);
    expect(ambientRecord.metadata["input.commandHash"]).toMatch(/^sha256:/);

    const evalFile = path.join(root, ".openskill-kit", "evals", "traces", "opencode-events.raw.jsonl");
    await stat(evalFile);
    const evalText = await readFile(evalFile, "utf8");
    const evalRecord = JSON.parse(evalText.trim().split("\n").pop()!);

    // Eval traces are clearly labeled as local-evaluation-only and segregated from learning.
    expect(evalRecord.schemaVersion).toBe("openskill-kit.opencode-ambient-event-eval.v1");
    expect(evalRecord.traceMode).toBe("eval");
    expect(evalRecord.containsRawFields).toBe(true);
    expect(evalRecord.intendedUse).toBe("local-evaluation-only");
    expect(evalRecord.rawInput.command).toBe(SECRET_COMMAND);
    expect(evalRecord.rawInput.path).toBe(SECRET_PATH);

    // The richer traces live in the separate eval file, not the normal ambient file.
    expect(ambient).not.toContain(SECRET_COMMAND);
    expect(ambient).not.toContain(SECRET_PATH);
    expect(evalText).toContain(SECRET_COMMAND);
  });

  it("learn preview and apply understand generated safe derived telemetry", async () => {
    const root = await tempProject();
    await compileBehaviorLayer(root, { targets: ["plugin"] });
    const pluginPath = path.join(root, ".openskill-kit", "compiled", "plugin", "opencode", "plugins", "openskillkit.ts");
    const previousTrace = process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE;
    delete process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE;
    try {
      const imported = await import(`${pathToFileURL(pluginPath).href}?case=${Date.now()}-learn`);
      const hooks = await imported.OpenSkillKitPlugin({
        worktree: root,
        client: { app: { log: async () => ({}) } }
      });
      await hooks["tool.execute.after"]({ tool: "bash", command: "npm test", path: "src/parser.ts" }, { status: "success" });
      await hooks["tool.execute.after"]({ tool: "bash", command: "npm test", path: "src/parser.ts" }, { status: "success" });
    } finally {
      if (previousTrace === undefined) delete process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE;
      else process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE = previousTrace;
    }

    const preview = await runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: ["opencode-ambient"],
      previewOnly: true,
      now: new Date("2026-06-28T00:10:00.000Z")
    });
    expect(preview.preview!.eventsRead).toBe(2);
    expect(preview.preview!.recordsRead).toBe(2);
    expect(preview.preview!.recordsSkipped).toBeUndefined();
    expect(preview.digest.eventsAppended).toBe(0);
    expect(preview.preview!.candidateBehavior.some((item) => item.statement.includes("package-manager command pattern"))).toBe(true);
    expect(preview.preview!.labelCandidates.some((item) => item.kind === "command" && item.evidenceCount === 2)).toBe(true);
    expect(preview.preview!.labelCandidates.some((item) => item.kind === "path" && item.evidenceCount === 2)).toBe(true);
    expect(await readEvents(root)).toHaveLength(0);

    const applied = await runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: ["opencode-ambient"],
      previewOnly: false,
      now: new Date("2026-06-28T00:11:00.000Z")
    });
    expect(applied.digest.eventsAppended).toBe(2);
    expect(applied.safeMetadata.opencode!.labelCandidates.some((item) => item.kind === "command")).toBe(true);
    expect(applied.digest.signalsExtracted).toBeGreaterThan(0);
    const stored = JSON.stringify(await readEvents(root));
    expect(stored).toContain("opencode-derived:package-manager:sha256:");
    const appliedEvents = await readEvents(root);
    expect(appliedEvents.every((event) => event.sessionId.startsWith("osk_session_"))).toBe(true);
    expect(appliedEvents.every((event) => event.normalized.oskTraceId && event.normalized.oskEpisodeId && event.normalized.opencodeSessionId)).toBe(true);
    expect(appliedEvents.every((event) => event.normalized.traceContext?.schemaVersion === "openskill-kit.learn-v2.trace-context.v1")).toBe(true);
    expect(stored).not.toContain("npm test");

    const commandLedger = await readAmbientLabelLedger(root, "command");
    const candidate = commandLedger.labels.find((label) => label.status === "candidate")!;
    expect(candidate.hash).toMatch(/^sha256:/);
    expect(JSON.stringify(commandLedger)).not.toContain("npm test");

    let compiled = await compileBehaviorLayer(root, { targets: ["project-rules"] });
    let commandPolicy = await readFile(compiled.policyArtifactPaths.find((item) => item.endsWith("command-policy.md"))!, "utf8");
    expect(commandPolicy).not.toContain("npm test");

    await applyAmbientLabelReview(root, { approveCommand: [{ hash: candidate.hash, label: "npm test" }] });
    compiled = await compileBehaviorLayer(root, { targets: ["project-rules"] });
    commandPolicy = await readFile(compiled.policyArtifactPaths.find((item) => item.endsWith("command-policy.md"))!, "utf8");
    expect(commandPolicy).toContain("npm test");

    const pathLedger = await readAmbientLabelLedger(root, "path");
    const pathCandidate = pathLedger.labels.find((label) => label.status === "candidate")!;
    await applyAmbientLabelReview(root, { rejectPath: [pathCandidate.hash] });
    compiled = await compileBehaviorLayer(root, { targets: ["project-rules"] });
    const reviewChecklist = await readFile(compiled.policyArtifactPaths.find((item) => item.endsWith("review-checklist.md"))!, "utf8");
    expect(reviewChecklist).not.toContain("Parser source");
  });

  it("raw Learn v2 explicitly accepts generated safe ambient telemetry and preserves trace ids", async () => {
    const root = await tempProject();
    await compileBehaviorLayer(root, { targets: ["plugin"] });
    const pluginPath = path.join(root, ".openskill-kit", "compiled", "plugin", "opencode", "plugins", "openskillkit.ts");
    const previousTrace = process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE;
    const previousSession = process.env.OSK_SESSION_ID;
    const previousEpisode = process.env.OSK_EPISODE_ID;
    const previousTraceId = process.env.OSK_TRACE_ID;
    process.env.OSK_SESSION_ID = "osk_session_raw_v2_ambient";
    process.env.OSK_EPISODE_ID = "osk_episode_raw_v2_ambient";
    process.env.OSK_TRACE_ID = "osk_trace_raw_v2_ambient";
    delete process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE;
    try {
      const imported = await import(`${pathToFileURL(pluginPath).href}?case=${Date.now()}-raw-v2`);
      const hooks = await imported.OpenSkillKitPlugin({
        worktree: root,
        client: { app: { log: async () => ({}) } }
      });
      await hooks["tool.execute.after"]({ tool: "bash", command: "npm test", path: "src/parser.ts" }, { status: "success" });
      await hooks["tool.execute.after"]({ tool: "bash", command: "npm test", path: "src/parser.ts" }, { status: "success" });
    } finally {
      restoreEnv("OPENSKILLKIT_AMBIENT_TRACE_MODE", previousTrace);
      restoreEnv("OSK_SESSION_ID", previousSession);
      restoreEnv("OSK_EPISODE_ID", previousEpisode);
      restoreEnv("OSK_TRACE_ID", previousTraceId);
    }

    const ambientPath = path.join(root, ".openskill-kit", "ambient", "opencode-events.jsonl");
    const ambient = await readFile(ambientPath, "utf8");
    expect(ambient).not.toContain("npm test");
    expect(ambient).not.toContain("src/parser.ts");
    expect(ambient).not.toContain(root);

    const result = await runRawLocalLearning(root, {
      sourceFiles: [ambientPath],
      previewOnly: false,
      now: new Date("2026-06-28T00:14:00.000Z")
    });

    expect(result.sources[0]!.projectRelevance.decision).toBe("include");
    expect(result.sources[0]!.projectRelevance.reasons).toContain("safe-opencode-ambient-telemetry");
    expect(result.sources[0]!.projectRelevance.reasons).toContain("hard-accept:trusted-privacy-safe-opencode-ambient");
    expect(result.learnV2.episodes).toHaveLength(1);
    expect(result.learnV2.episodes[0]!.stitching.method).toBe("explicit-id");
    expect(result.learnV2.episodes[0]!.sessionIds).toEqual(["osk_session_raw_v2_ambient"]);
    expect(result.learnV2.episodes[0]!.traceIds).toEqual(["osk_trace_raw_v2_ambient"]);
    expect(result.learnV2.episodes[0]!.toolSummaries.some((tool) =>
      tool.command?.startsWith("opencode-derived:package-manager:sha256:")
    )).toBe(true);
    expect(JSON.stringify(result.learnV2.episodes)).not.toContain("npm test");
    expect(JSON.stringify(result.learnV2.episodes)).not.toContain("src/parser.ts");
    expect(JSON.stringify(result.learnV2.episodes)).not.toContain(root);
  });

  it("skips stale ambient records with raw-prone keys even when flags claim safe", async () => {
    const root = await tempProject();
    const ambientDir = path.join(root, ".openskill-kit", "ambient");
    await mkdir(ambientDir, { recursive: true });
    await writeFile(path.join(ambientDir, "opencode-events.jsonl"), [
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        eventType: "post-tool-use",
        traceMode: "safe",
        containsRawFields: false,
        metadata: {
          "input.commandHash": "sha256:already-derived",
          command: SECRET_COMMAND,
          path: SECRET_PATH
        }
      }),
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        eventType: "post-tool-use",
        containsRawFields: false,
        command: SECRET_COMMAND,
        metadata: {
          "input.commandKind": "package-manager",
          "input.pathHash": "sha256:path-only"
        }
      })
    ].join("\n") + "\n", "utf8");

    const preview = await runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: ["opencode-ambient"],
      previewOnly: true,
      now: new Date("2026-06-28T00:12:00.000Z")
    });
    expect(preview.preview!.recordsRead).toBe(2);
    expect(preview.preview!.recordsSkipped).toBe(2);
    expect(preview.preview!.eventsRead).toBe(0);
    expect(preview.preview!.rawFieldsDetected).toBe(true);
    expect(preview.preview!.rawFieldWarnings.join("\n")).toContain("raw-prone key(s)");
    expect(preview.preview!.rawFieldWarnings.join("\n")).toContain("metadata.command");
    expect(preview.preview!.rawFieldWarnings.join("\n")).not.toContain(SECRET_COMMAND);
    expect(preview.preview!.rawFieldWarnings.join("\n")).not.toContain(SECRET_PATH);
    expect(preview.digest.eventsAppended).toBe(0);
    expect(await readEvents(root)).toHaveLength(0);

    const applied = await runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: ["opencode-ambient"],
      previewOnly: false,
      now: new Date("2026-06-28T00:13:00.000Z")
    });
    expect(applied.safeMetadata.opencode!.skippedCount).toBe(2);
    expect(applied.digest.eventsAppended).toBe(0);
    expect(await readEvents(root)).toHaveLength(0);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "osk-ambient-privacy-"));
  await initAdaptiveProject({ projectRoot: root, projectName: "ambient-privacy", now: new Date("2026-06-28T00:00:00.000Z") });
  await writeGraph(root);
  return root;
}

async function writeGraph(root: string): Promise<void> {
  const graph: PreferenceGraph = {
    schemaVersion: "openskill-kit.preference-graph.v1",
    projectId: "ambient-privacy",
    nodes: [pref("ambient", "Prefer privacy-safe ambient telemetry", "workflow")],
    conflicts: [],
    updatedAt: "2026-06-28T00:00:00.000Z"
  };
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.join(root, ".openskill-kit", "preferences"), { recursive: true });
  await writeFile(path.join(root, ".openskill-kit", "preferences", "graph.json"), `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

function pref(id: string, statement: string, category: PreferenceNode["category"]): PreferenceNode {
  return {
    id,
    schemaVersion: "openskill-kit.preference-node.v2",
    statement,
    category,
    confidence: 0.9,
    status: "active",
    scope: { level: "project", paths: [] },
    evidence: [],
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z"
  };
}
