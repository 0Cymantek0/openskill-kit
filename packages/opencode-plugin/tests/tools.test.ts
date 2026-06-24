import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openskillKitDraft, openskillKitEvaluate, openskillKitInstall, toolSchemas } from "../src/index.js";

describe("OpenCode tool schemas", () => {
  it("validates draft args", () => {
    expect(toolSchemas.draft.parse({ topic: "debug tests" }).topic).toBe("debug tests");
  });

  it("validates evolve args", () => {
    expect(toolSchemas.evolve.parse({ topic: "evolve skill" }).topic).toBe("evolve skill");
  });

  it("evaluates a generated skill through the adapter", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-opencode-evaluate-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { "verify:repo": "node -e \"console.log('adapter ok')\"" } }), "utf8");
    const drafted = await openskillKitDraft({ topic: "adapter evaluate skill", projectRoot: root });
    const skillDir = (drafted.data as { skillDir: string }).skillDir;
    const evaluated = await openskillKitEvaluate({ skillPath: skillDir, projectRoot: root, runRepoChecks: true });

    expect(evaluated.kind).toBe("evaluate pass");
    expect((evaluated.data as { metrics: { commandsExecuted: number } }).metrics.commandsExecuted).toBe(1);
  });

  it("keeps install dry-run by default and writes only with explicit yes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-opencode-"));
    const skillDir = path.join(root, "adapter-skill");
    await mkdir(skillDir);
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: adapter-skill\ndescription: Adapter install test\n---\n\n## When to use\nUse it.\n\n## When not to use\nAvoid unrelated tasks.\n", "utf8");

    const planned = await openskillKitInstall({ skillPath: skillDir, target: "agents-project", projectRoot: root });
    expect(planned.kind).toBe("planned");
    await expect(stat(path.join(root, ".agents", "skills", "adapter-skill"))).rejects.toThrow();

    const blocked = await openskillKitInstall({ skillPath: skillDir, target: "agents-project", projectRoot: root, dryRun: false });
    expect(blocked.kind).toBe("blocked");

    const installed = await openskillKitInstall({ skillPath: skillDir, target: "agents-project", projectRoot: root, dryRun: false, yes: true });
    expect(installed.kind).toBe("installed");
    await expect(stat(path.join(root, ".agents", "skills", "adapter-skill", "SKILL.md"))).resolves.toBeTruthy();
  });
});
