import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { draftSkill, installSkill, readRegistry, uninstallSkill, verifySkill } from "../src/index.js";

describe("draft, verify, install", () => {
  it("creates run artifacts and installs to project agents target", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-flow-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest --run", typecheck: "tsc --noEmit" }, devDependencies: { vitest: "1.0.0" } }), "utf8");
    const draft = await draftSkill({ topic: "test skill", projectRoot: root, noLlm: true, now: new Date("2026-06-24T00:00:00.000Z") });
    expect(await readFile(path.join(draft.skillDir, "SKILL.md"), "utf8")).toContain("name: test-skill");
    await expect(stat(draft.evidenceLedgerPath)).resolves.toBeTruthy();
    await expect(stat(draft.verifierPackPath)).resolves.toBeTruthy();
    const report = await verifySkill(draft.skillDir);
    expect(report.status).not.toBe("fail");
    expect(report.assertionResults.length).toBeGreaterThan(0);
    const dryRun = await installSkill({ skillPath: draft.skillDir, target: "agents-project", projectRoot: root, dryRun: true });
    expect(dryRun.status).toBe("planned");
    await expect(stat(path.join(root, ".agents", "skills", "test-skill"))).rejects.toThrow();
    const installed = await installSkill({ skillPath: draft.skillDir, target: "agents-project", projectRoot: root });
    expect(installed.status).toBe("installed");
    await expect(stat(path.join(root, ".agents", "skills", "test-skill", "SKILL.md"))).resolves.toBeTruthy();
    const registry = await readRegistry(root);
    expect(registry.skills[0]?.name).toBe("test-skill");
    await uninstallSkill({ skillName: "test-skill", target: "agents-project", projectRoot: root });
    await expect(stat(path.join(root, ".agents", "skills", "test-skill"))).rejects.toThrow();
  });
});
