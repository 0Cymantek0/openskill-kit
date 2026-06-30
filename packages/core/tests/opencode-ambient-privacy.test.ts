import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compileBehaviorLayer, initAdaptiveProject, runLearningPlan, type PreferenceGraph, type PreferenceNode } from "../src/index.js";
import { readEvents } from "../src/events/store.js";

// These are the fake sensitive values ambient telemetry must never store verbatim.
const SECRET_COMMAND = "GITHUB_TOKEN=abc123 npm test";
const SECRET_PATH = "/Users/alice/work/customer-acme/private.ts";
const SECRET_URL = "https://example.com/private?token=abc";
const SECRET_INLINE = "sk-SECRET";

describe("OpenCode ambient telemetry privacy", () => {
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
      await hooks["tool.execute.after"]({ tool: "bash", command: "npm test" }, { status: "success" });
      await hooks["tool.execute.after"]({ tool: "bash", command: "npm test" }, { status: "success" });
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
    expect(await readEvents(root)).toHaveLength(0);

    const applied = await runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: ["opencode-ambient"],
      previewOnly: false,
      now: new Date("2026-06-28T00:11:00.000Z")
    });
    expect(applied.digest.eventsAppended).toBe(2);
    expect(applied.digest.signalsExtracted).toBeGreaterThan(0);
    const stored = JSON.stringify(await readEvents(root));
    expect(stored).toContain("opencode-derived:package-manager:sha256:");
    expect(stored).not.toContain("npm test");
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
