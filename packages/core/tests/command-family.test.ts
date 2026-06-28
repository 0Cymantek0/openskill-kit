import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  OSK_PUBLIC_COMMAND_COUNT,
  OSK_PUBLIC_COMMAND_FAMILIES,
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
          path: "src/parser.ts",
          status: "ok",
          prompt: "raw prompt must not survive",
          diff: "raw diff must not survive"
        }
      }),
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        source: "opencode-plugin",
        eventType: "permission-decision",
        capturedAt: "2026-06-27T00:02:00.000Z",
        metadata: { decision: "denied", command: "rm -rf build" }
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
    expect(serialized).toContain("src/parser.ts");
    expect(serialized).not.toContain("raw prompt must not survive");
    expect(serialized).not.toContain("raw diff must not survive");
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
});

async function writeText(root: string, relative: string, content: string): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}
