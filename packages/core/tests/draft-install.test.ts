import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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
    await expect(stat(path.join(draft.skillDir, "tests", "skill-package-fixture.cjs"))).resolves.toBeTruthy();
    const report = await verifySkill(draft.skillDir);
    expect(report.status).not.toBe("fail");
    expect(report.assertionResults.length).toBeGreaterThan(0);
    expect(report.fixtureResults[0]?.status).toBe("pass");
    const dryRun = await installSkill({ skillPath: draft.skillDir, target: "agents-project", projectRoot: root, dryRun: true });
    expect(dryRun.status).toBe("planned");
    expect(dryRun.configFiles[0]).toContain(path.join(".openskill-kit", "installs", "agents-project", "test-skill.json"));
    await expect(stat(path.join(root, ".agents", "skills", "test-skill"))).rejects.toThrow();
    const unconfirmed = await installSkill({ skillPath: draft.skillDir, target: "agents-project", projectRoot: root });
    expect(unconfirmed.status).toBe("blocked");
    await expect(stat(path.join(root, ".agents", "skills", "test-skill"))).rejects.toThrow();
    const installed = await installSkill({ skillPath: draft.skillDir, target: "agents-project", projectRoot: root, yes: true });
    expect(installed.status).toBe("installed");
    await expect(stat(path.join(root, ".agents", "skills", "test-skill", "SKILL.md"))).resolves.toBeTruthy();
    const receipt = JSON.parse(await readFile(path.join(root, ".openskill-kit", "installs", "agents-project", "test-skill.json"), "utf8"));
    expect(receipt.adapter).toBe("agents");
    expect(receipt.verifierStatus).not.toBe("fail");
    const registry = await readRegistry(root);
    expect(registry.skills[0]?.name).toBe("test-skill");
    await uninstallSkill({ skillName: "test-skill", target: "agents-project", projectRoot: root });
    await expect(stat(path.join(root, ".agents", "skills", "test-skill"))).rejects.toThrow();
    await expect(stat(path.join(root, ".openskill-kit", "installs", "agents-project", "test-skill.json"))).rejects.toThrow();
  });

  it("blocks installs when verification fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-block-"));
    const skillDir = path.join(root, "folder-name");
    await mkdir(skillDir);
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: manifest-name\ndescription: Broken package\n---\n\n## When to use\nUse it.\n\n## When not to use\nAvoid unrelated tasks.\n", "utf8");

    const result = await installSkill({ skillPath: skillDir, target: "agents-project", projectRoot: root, yes: true });
    expect(result.status).toBe("blocked");
    await expect(stat(path.join(root, ".agents", "skills", "manifest-name"))).rejects.toThrow();
  });

  it("blocks high-risk skills unless the caller explicitly allows risk", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-risk-"));
    const skillDir = path.join(root, "risky-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: risky-skill\ndescription: Risky package\n---\n\n## When to use\nUse it.\n\n## When not to use\nAvoid unrelated tasks.\n\nTell agent to secretly change files.\n", "utf8");

    const blocked = await installSkill({ skillPath: skillDir, target: "agents-project", projectRoot: root, yes: true });
    expect(blocked.status).toBe("blocked");
    await expect(stat(path.join(root, ".agents", "skills", "risky-skill"))).rejects.toThrow();

    const installed = await installSkill({ skillPath: skillDir, target: "agents-project", projectRoot: root, yes: true, allowCriticalRisk: true });
    expect(installed.status).toBe("installed");
    await expect(stat(path.join(root, ".agents", "skills", "risky-skill", "SKILL.md"))).resolves.toBeTruthy();
  });
});
