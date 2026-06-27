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
  validateOskCommandFamilies
} from "../src/index.js";

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
    expect(commands.find((item) => item.command === "/osk deploy")?.approvalRequired).toBe(true);
    expect(commands.find((item) => item.command === "/osk status")?.readOnly).toBe(true);
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
});

async function writeText(root: string, relative: string, content: string): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}
