import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  OSK_PUBLIC_COMMAND_COUNT,
  OSK_PUBLIC_COMMAND_FAMILIES,
  getAdaptiveStatus,
  initAdaptiveProject,
  planLearningSources,
  pluginCommandProjections,
  renderOskCommandsMarkdown,
  renderOskLearnMarkdown,
  runLearningPlan,
  validateOskCommandFamilies
} from "../src/index.js";
import { readEvents } from "../src/events/store.js";

describe("OSK command family registry", () => {
  it("defines exactly twelve public command families", () => {
    const families = validateOskCommandFamilies();
    expect(families).toHaveLength(OSK_PUBLIC_COMMAND_COUNT);
    expect(families.map((family) => family.publicCommand)).toEqual([
      "/osk init",
      "/osk status",
      "/osk task",
      "/osk learn",
      "/osk review",
      "/osk research",
      "/osk evolve",
      "/osk verify",
      "/osk compile",
      "/osk deploy",
      "/osk eval",
      "/osk pack"
    ]);
    expect(new Set(families.map((family) => family.commandFile)).size).toBe(OSK_PUBLIC_COMMAND_COUNT);
    expect(OSK_PUBLIC_COMMAND_FAMILIES.every((family) => family.neverReads.some((rule) => rule.includes("raw prompts")))).toBe(true);
  });

  it("projects registry into plugin command map records", () => {
    const commands = pluginCommandProjections();
    expect(commands).toHaveLength(OSK_PUBLIC_COMMAND_COUNT);
    expect(commands.find((item) => item.command === "/osk learn")?.mcpTool).toBe("osk_plan_learning_sources");
    expect(commands.find((item) => item.command === "/osk learn")?.cli).toBe("openskill-kit osk learn");
    expect(commands.find((item) => item.command === "/osk pack")?.cli).toBe("openskill-kit osk pack export");
    expect(commands.find((item) => item.command === "/osk deploy")?.approvalRequired).toBe(true);
    expect(commands.find((item) => item.command === "/osk eval")?.mcpTool).toBe("osk_run_eval");
    expect(commands.find((item) => item.command === "/osk status")?.readOnly).toBe(true);
  });

  it("renders command docs from the public registry", () => {
    const commands = renderOskCommandsMarkdown();
    const learn = renderOskLearnMarkdown();
    expect(commands).toContain("| `/osk learn` |");
    expect(commands).toContain("OpenWorld proof boundary");
    expect(commands).toContain("Never store raw prompts by default.");
    expect(commands).toContain("### /osk deploy");
    expect(learn).toContain("openskill-kit osk learn --all-detected");
    expect(learn).toContain("User/global memory stores");
  });

  it("plans learning sources without silently importing private stores", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-learn-plan-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "osk-learn-home-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "learn-plan", now: new Date("2026-06-27T00:00:00.000Z") });
    await writeText(root, "session-codex.jsonl", "{\"role\":\"user\",\"content\":\"Prefer focused tests\"}\n");
    await mkdir(path.join(home, ".codex", "memories"), { recursive: true });

    const plan = await planLearningSources(root, { sourceMode: "all-detected", homeDir: home, now: new Date("2026-06-27T00:01:00.000Z") });

    expect(plan.schemaVersion).toBe("openskill-kit.learn-source-plan.v1");
    expect(plan.summary.safeMetadata).toBeGreaterThanOrEqual(2);
    expect(plan.summary.explicitImport).toBeGreaterThanOrEqual(1);
    expect(plan.defaults.previewOnly).toBe(true);
    expect(plan.defaults.selectedSourceIds).toEqual(expect.arrayContaining(["current-session", "git-local"]));
    expect(plan.defaults.selectedSourceIds.some((id) => id.startsWith("explicit:"))).toBe(false);
    expect(plan.privacyPreview.join(" ")).toContain("No raw prompts");
    expect(plan.options.some((option) => option.policy === "explicit-import" && option.path?.endsWith("session-codex.jsonl"))).toBe(true);
    expect(plan.options.some((option) => option.policy === "blocked" && option.path?.includes(`${path.sep}.codex${path.sep}memories`))).toBe(true);
  });

  it("surfaces raw local learn-v2 candidates without opening them through normal source plans", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-learn-raw-candidates-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "learn-raw-candidates", now: new Date("2026-06-27T00:00:00.000Z") });
    await writeText(root, "logs/terminal-build.log", "$ npm test\nPASS packages/core/tests/learn-v2.test.ts\n");
    await writeText(root, "plans/frontier-plan.md", "# Frontier plan\nUse high precision learning traces.\n");
    await writeText(root, "dist/logs/session-build.log", "generated log should not be considered\n");
    await writeText(root, "node_modules/session-cached.jsonl", "{\"role\":\"user\",\"content\":\"ignored vendor cache\"}\n");
    await writeText(root, "package.json", "{\"name\":\"not-evidence\"}\n");

    const plan = await planLearningSources(root, { sourceMode: "all-detected", now: new Date("2026-06-27T00:01:00.000Z") });
    const rawOptions = plan.options.filter((option) => option.id.startsWith("raw-local:"));
    const rawPaths = rawOptions.map((option) => option.path ?? "");

    expect(rawOptions.length).toBeGreaterThanOrEqual(2);
    expect(rawOptions.every((option) => option.policy === "blocked")).toBe(true);
    expect(rawOptions.every((option) => option.defaultSelected === false)).toBe(true);
    expect(plan.question.choices.some((choice) => choice.id.startsWith("raw-local:"))).toBe(false);
    expect(plan.defaults.selectedSourceIds.some((id) => id.startsWith("raw-local:"))).toBe(false);
    expect(rawPaths.some((item) => item.endsWith(`${path.sep}logs${path.sep}terminal-build.log`))).toBe(true);
    expect(rawPaths.some((item) => item.endsWith(`${path.sep}plans${path.sep}frontier-plan.md`))).toBe(true);
    expect(rawPaths.some((item) => item.includes(`${path.sep}dist${path.sep}`))).toBe(false);
    expect(rawPaths.some((item) => item.includes(`${path.sep}node_modules${path.sep}`))).toBe(false);
    const terminalCandidate = rawOptions.find((option) => option.path?.endsWith(`${path.sep}logs${path.sep}terminal-build.log`))!;
    const planCandidate = rawOptions.find((option) => option.path?.endsWith(`${path.sep}plans${path.sep}frontier-plan.md`))!;
    expect(terminalCandidate.adapter).toBe("learn-v2:terminal");
    expect(terminalCandidate.label).toContain("Terminal transcript");
    expect(terminalCandidate.learnV2Surface).toMatchObject({
      adapterId: "terminal",
      normalizationProfile: "terminal",
      contentKind: "log",
      sensitivity: "high",
      matchedBy: "filename",
      confidence: "high"
    });
    expect(planCandidate.adapter).toBe("learn-v2:project-docs");
    expect(planCandidate.learnV2Surface?.normalizationProfile).toBe("project-docs");
    expect(terminalCandidate.privacy.notes.join(" ")).toContain("Adapter contract: terminal / terminal / log");
    expect(terminalCandidate.privacy.notes.join(" ")).toContain("model=declassified-only");
    expect(plan.privacyPreview.join(" ")).toContain("path metadata only");
    expect(plan.nextActions.join(" ")).toContain("--raw --surface-file");
    expect(rawOptions[0]!.privacy.notes.join(" ")).toContain("did not read or copy");

    await expect(runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: [rawOptions[0]!.id],
      previewOnly: true,
      now: new Date("2026-06-27T00:02:00.000Z")
    })).rejects.toThrow(/Blocked learning source/);
  });

  it("detects and learns from OpenCode ambient metadata without raw prompts or diffs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-learn-opencode-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "learn-opencode", now: new Date("2026-06-27T00:00:00.000Z") });
    await writeText(root, ".openskill-kit/ambient/opencode-events.jsonl", [
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        source: "opencode-plugin",
        eventType: "file-changed",
        capturedAt: "2026-06-27T00:01:00.000Z",
        metadata: {
          "input.pathKind": "relative",
          "input.pathHash": "sha256:parser",
          "input.pathExtension": ".ts",
          "input.pathDepth": 1,
          "input.pathRiskFlags": [],
          "output.status": "ok"
        }
      }),
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        source: "opencode-plugin",
        eventType: "permission-decision",
        capturedAt: "2026-06-27T00:02:00.000Z",
        metadata: {
          decision: "denied",
          "input.commandKind": "shell",
          "input.commandHash": "sha256:denied",
          "input.commandLengthBucket": "short",
          "input.commandRiskFlags": ["destructive"],
          "output.status": "blocked"
        }
      })
    ].join("\n") + "\n");

    const plan = await planLearningSources(root, { sourceMode: "all-detected", now: new Date("2026-06-27T00:03:00.000Z") });
    const ambient = plan.options.find((option) => option.id === "opencode-ambient");
    expect(ambient?.policy).toBe("safe-metadata");
    expect(plan.defaults.selectedSourceIds).toContain("opencode-ambient");
    expect(ambient?.reason).toContain("no raw prompts or raw diffs");

    const applied = await runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: ["opencode-ambient"],
      previewOnly: false,
      now: new Date("2026-06-27T00:04:00.000Z")
    });
    expect(applied.safeMetadata.opencode.appendedCount).toBe(2);
    expect(applied.digest.eventsAppended).toBe(2);
    const serialized = JSON.stringify(await readEvents(root));
    expect(serialized).toContain("opencode-ambient");
    expect(serialized).toContain("opencode-derived:relative:sha256:parser.ts");
    expect(serialized).not.toContain("raw prompt must not survive");
    expect(serialized).not.toContain("raw diff must not survive");
    expect(serialized).not.toContain("rm -rf build");
  });

  it("runs learning plans preview-first and keeps activation review-gated", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-learn-run-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "learn-run", now: new Date("2026-06-27T00:00:00.000Z") });
    await writeText(root, "session-review-notes.md", "Always run focused parser tests before final answer.\n");
    const plan = await planLearningSources(root, { sourceMode: "ask", now: new Date("2026-06-27T00:01:00.000Z") });
    const explicit = plan.options.find((option) => option.policy === "explicit-import" && option.path?.endsWith("session-review-notes.md"))!;

    const preview = await runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: [explicit.id],
      previewOnly: true,
      now: new Date("2026-06-27T00:02:00.000Z")
    });
    expect(preview.previewOnly).toBe(true);
    expect(preview.importRuns[0]?.status).toBe("planned");
    expect(preview.digest.eventsAppended).toBe(0);
    expect(preview.lifecycle).toBeUndefined();

    const applied = await runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: [explicit.id],
      previewOnly: false,
      now: new Date("2026-06-27T00:03:00.000Z")
    });
    expect(applied.previewOnly).toBe(false);
    expect(applied.importRuns[0]?.status).toBe("imported");
    expect(applied.digest.eventsAppended).toBeGreaterThan(0);
    expect(applied.digest.signalsExtracted).toBeGreaterThan(0);
    expect(applied.nextActions.join(" ")).toContain("/osk review");
    expect(applied.privacy.join(" ")).toContain("remains candidate/staged");
  });

  it("blocks unknown or blocked learning source selections instead of silently running nothing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-learn-source-errors-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "osk-learn-source-errors-home-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "learn-source-errors", now: new Date("2026-06-27T00:00:00.000Z") });
    await mkdir(path.join(home, ".codex", "memories"), { recursive: true });

    await expect(runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: ["not-a-source"],
      previewOnly: false,
      now: new Date("2026-06-27T00:04:00.000Z")
    })).rejects.toThrow(/Unknown learning source\(s\): not-a-source.*Supported source ids: current-session, git-local/s);
    await expect(planLearningSources(root, {
      sourceMode: "selected",
      selectedSourceIds: ["not-a-source"],
      now: new Date("2026-06-27T00:04:30.000Z")
    })).rejects.toThrow(/Unknown learning source\(s\): not-a-source.*Supported source ids: current-session, git-local/s);

    const plan = await planLearningSources(root, { sourceMode: "ask", homeDir: home, now: new Date("2026-06-27T00:05:00.000Z") });
    const blocked = plan.options.find((option) => option.policy === "blocked" && option.path?.includes(`${path.sep}.codex${path.sep}memories`))!;
    await expect(planLearningSources(root, {
      sourceMode: "selected",
      selectedSourceIds: [blocked.id],
      homeDir: home,
      now: new Date("2026-06-27T00:05:30.000Z")
    })).rejects.toThrow(/Blocked learning source\(s\): blocked:/);
    await expect(runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: [blocked.id],
      homeDir: home,
      previewOnly: false,
      now: new Date("2026-06-27T00:06:00.000Z")
    })).rejects.toThrow(/Blocked learning source\(s\): blocked:/);
  });

  it("preview with opencode-ambient shows transient signals and candidate behavior", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-preview-ambient-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "preview-ambient", now: new Date("2026-06-27T00:00:00.000Z") });
    await writeText(root, ".openskill-kit/ambient/opencode-events.jsonl", [
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        source: "opencode-plugin",
        eventType: "post-tool-use",
        capturedAt: "2026-06-27T00:01:00.000Z",
        metadata: {
          "input.tool": "bash",
          "input.commandKind": "package-manager",
          "input.commandHash": "sha256:testcmd",
          "input.commandLengthBucket": "short",
          "input.commandRiskFlags": [],
          "output.status": "success"
        }
      }),
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        source: "opencode-plugin",
        eventType: "post-tool-use",
        capturedAt: "2026-06-27T00:02:00.000Z",
        metadata: {
          "input.tool": "bash",
          "input.commandKind": "package-manager",
          "input.commandHash": "sha256:testcmd",
          "input.commandLengthBucket": "short",
          "input.commandRiskFlags": [],
          "output.status": "success"
        }
      }),
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        source: "opencode-plugin",
        eventType: "file-changed",
        capturedAt: "2026-06-27T00:03:00.000Z",
        metadata: {
          "input.pathKind": "relative",
          "input.pathHash": "sha256:fileone",
          "input.pathExtension": ".ts",
          "input.pathDepth": 1,
          "input.pathRiskFlags": [],
          "output.status": "ok"
        }
      })
    ].join("\n") + "\n");

    const preview = await runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: ["opencode-ambient"],
      previewOnly: true,
      now: new Date("2026-06-27T00:04:00.000Z")
    });
    expect(preview.previewOnly).toBe(true);
    expect(preview.preview).toBeDefined();
    expect(preview.preview!.eventsRead).toBe(3);
    expect(preview.preview!.recordsRead).toBe(3);
    expect(preview.preview!.recordsSkipped).toBeUndefined();
    expect(preview.preview!.rawFieldsDetected).toBe(false);
    expect(preview.preview!.candidateBehavior.length).toBeGreaterThan(0);
    expect(preview.preview!.candidateBehavior.some((item) => item.statement.includes("package-manager command pattern"))).toBe(true);
    expect(preview.digest.eventsAppended).toBe(0);
    expect(preview.digest.signalsExtracted).toBeGreaterThan(0);
    expect(preview.lifecycle).toBeUndefined();
    const events = await readEvents(root);
    const ambientEvents = events.filter((e) => e.source.adapter === "opencode-ambient");
    expect(ambientEvents).toHaveLength(0);
  });

  it("preview with opencode-ambient warns about raw field records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-preview-rawwarn-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "preview-rawwarn", now: new Date("2026-06-27T00:00:00.000Z") });
    await writeText(root, ".openskill-kit/ambient/opencode-events.jsonl", [
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        source: "opencode-plugin",
        eventType: "file-changed",
        capturedAt: "2026-06-27T00:01:00.000Z",
        containsRawFields: true,
        metadata: { path: "src/secret.ts", status: "ok", prompt: "raw prompt here" }
      }),
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        source: "opencode-plugin",
        eventType: "post-tool-use",
        capturedAt: "2026-06-27T00:02:00.000Z",
        traceMode: "eval",
        metadata: { command: "npm test", status: "pass" }
      })
    ].join("\n") + "\n");

    const preview = await runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: ["opencode-ambient"],
      previewOnly: true,
      now: new Date("2026-06-27T00:03:00.000Z")
    });
    expect(preview.preview!.rawFieldsDetected).toBe(true);
    expect(preview.preview!.recordsRead).toBe(2);
    expect(preview.preview!.recordsSkipped).toBe(2);
    expect(preview.preview!.rawFieldWarnings.length).toBeGreaterThan(0);
    expect(preview.preview!.rawFieldWarnings[0]).toContain("containsRawFields");
  });

  it("preview skips eval-origin safe records instead of learning them as normal behavior", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-preview-eval-skip-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "preview-eval-skip", now: new Date("2026-06-27T00:00:00.000Z") });
    await writeText(root, ".openskill-kit/ambient/opencode-events.jsonl", [
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        source: "opencode-plugin",
        eventType: "post-tool-use",
        capturedAt: "2026-06-27T00:01:00.000Z",
        traceMode: "eval",
        containsRawFields: false,
        metadata: {
          "input.tool": "bash",
          "input.commandKind": "package-manager",
          "input.commandHash": "sha256:evalcmd",
          "input.commandLengthBucket": "short",
          "input.commandRiskFlags": [],
          "output.status": "success"
        }
      }),
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        source: "opencode-plugin",
        eventType: "post-tool-use",
        capturedAt: "2026-06-27T00:02:00.000Z",
        traceMode: "eval",
        containsRawFields: false,
        metadata: {
          "input.tool": "bash",
          "input.commandKind": "package-manager",
          "input.commandHash": "sha256:evalcmd",
          "input.commandLengthBucket": "short",
          "input.commandRiskFlags": [],
          "output.status": "success"
        }
      })
    ].join("\n") + "\n");
    await writeText(root, ".openskill-kit/evals/traces/opencode-events.raw.jsonl", [
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event-eval.v1",
        traceMode: "eval",
        containsRawFields: true,
        intendedUse: "local-evaluation-only",
        rawInput: { command: "SECRET_TOKEN=abc npm test" }
      })
    ].join("\n") + "\n");

    const preview = await runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: ["opencode-ambient"],
      previewOnly: true,
      now: new Date("2026-06-27T00:03:00.000Z")
    });

    expect(preview.preview!.eventsRead).toBe(0);
    expect(preview.preview!.recordsRead).toBe(2);
    expect(preview.preview!.recordsSkipped).toBe(2);
    expect(preview.preview!.rawFieldsDetected).toBe(true);
    expect(preview.preview!.rawFieldWarnings.join(" ")).toContain("traceMode=eval");
    expect(preview.preview!.candidateBehavior).toHaveLength(0);
    expect(JSON.stringify(preview)).not.toContain("SECRET_TOKEN");
    expect(await readEvents(root)).toHaveLength(0);
  });

  it("writes receipt on every learning run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-receipt-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "receipt-test", now: new Date("2026-06-27T00:00:00.000Z") });

    const preview = await runLearningPlan(root, {
      sourceMode: "selected",
      selectedSourceIds: ["git-local"],
      previewOnly: true,
      now: new Date("2026-06-27T00:01:00.000Z")
    });
    expect(preview.receipt).toBeDefined();
    expect(preview.receipt!.schemaVersion).toBe("openskill-kit.learn-receipt.v1");
    expect(preview.receipt!.applied).toBe(false);
    expect(preview.receipt!.reviewRequired).toBe(true);
    expect(preview.receipt!.nextCommand).toBe("/osk review");

    const receiptPath = path.join(root, ".openskill-kit", "reviews", "learn-receipt.json");
    const receiptOnDisk = JSON.parse(await (await import("node:fs/promises")).readFile(receiptPath, "utf8"));
    expect(receiptOnDisk.schemaVersion).toBe("openskill-kit.learn-receipt.v1");
    expect(receiptOnDisk.applied).toBe(false);
    const status = await getAdaptiveStatus(root);
    expect(status.operations.learn.receiptPresent).toBe(true);
    expect(status.operations.learn.latest).toMatchObject({
      applied: false,
      previewOnly: true,
      selectedSourceCount: 1,
      eventsAppended: 0,
      reviewRequired: true,
      nextCommand: "/osk review"
    });
    expect(status.operations.learn.latest!.sourceIds).toEqual(["git-local"]);
  });
});

async function writeText(root: string, relative: string, content: string): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}
