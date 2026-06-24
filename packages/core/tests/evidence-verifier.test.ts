import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EvidenceLedgerSchema,
  VerifierPackSchema,
  readVerifierExecution,
  buildVerifierPack,
  collectRepoContext,
  createLocalEvidenceLedger,
  draftSkill,
  loadSkillPackage,
  verifySkill
} from "../src/index.js";

describe("evidence ledger and verifier pack", () => {
  it("creates local provenance from real repo context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-evidence-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest --run" }, devDependencies: { vitest: "4.0.0" } }), "utf8");
    await writeFile(path.join(root, "README.md"), "# Fixture\n\nUse Vitest.\n", "utf8");

    const context = await collectRepoContext(root);
    const ledger = createLocalEvidenceLedger("verify vitest workflow", context, new Date("2026-06-24T00:00:00.000Z"));

    expect(EvidenceLedgerSchema.parse(ledger).schemaVersion).toBe("openskill-kit.evidence.v0");
    expect(ledger.sources.length).toBeGreaterThan(0);
    expect(ledger.claims.some((claim) => claim.id === "claim.repo.verification-scripts")).toBe(true);
    expect(ledger.sources.every((source) => !source.path?.includes(root))).toBe(true);
  });

  it("draft writes evidence ledger and verifier pack artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-draft-ledger-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest --run" } }), "utf8");

    const draft = await draftSkill({ topic: "repo verifier skill", projectRoot: root, noLlm: true, now: new Date("2026-06-24T00:00:00.000Z") });
    const ledger = EvidenceLedgerSchema.parse(JSON.parse(await readFile(draft.evidenceLedgerPath, "utf8")));
    const pack = VerifierPackSchema.parse(JSON.parse(await readFile(draft.verifierPackPath, "utf8")));
    const report = await verifySkill(draft.skillDir);

    expect(ledger.task).toBe("repo verifier skill");
    expect(pack.assertions.map((assertion) => assertion.id)).toContain("assert.skill-safety-scan-pass");
    expect(report.assertionResults.some((result) => result.assertionId === "assert.skill-safety-scan-pass" && result.status === "pass")).toBe(true);
    expect(report.execution?.visibleResults.length).toBeGreaterThan(0);
    expect(report.execution?.holdoutResults.length).toBeGreaterThan(0);
  });

  it("writes verifier report and execution artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-execution-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest --run" } }), "utf8");

    const draft = await draftSkill({ topic: "artifact verifier skill", projectRoot: root, noLlm: true });
    const reportDir = path.join(root, ".openskill-kit", "reports", "artifact-verifier-skill");
    const report = await verifySkill(draft.skillDir, reportDir);

    expect(report.reportPath).toBe(path.join(reportDir, "verifier.json"));
    expect(report.executionPath).toBe(path.join(reportDir, "verifier-execution.json"));
    await expect(stat(report.reportPath!)).resolves.toBeTruthy();
    await expect(stat(report.executionPath!)).resolves.toBeTruthy();
    const execution = await readVerifierExecution(report.executionPath!);
    expect(execution.summary.visible).toBeGreaterThan(0);
    expect(execution.summary.holdout).toBeGreaterThan(0);
    expect(execution.limitations.join(" ")).toContain("not hidden benchmark tests");
  });

  it("verifier pack does not claim downstream agent performance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-pack-"));
    const skillDir = path.join(root, "portable-skill");
    await mkdir(path.join(skillDir, "references"), { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: portable-skill\ndescription: Portable skill\ncompatibility: opencode,codex\n---\n\n## When to use\nUse it.\n\n## When not to use\nAvoid unrelated tasks.\n\n## Verification checklist\n- Run tests.\n\n## Common mistakes\n- Do not skip validation.\n\n## References\n- [Notes](references/research.md)\n", "utf8");
    await writeFile(path.join(skillDir, "references", "research.md"), "# Notes\n", "utf8");
    const pkg = await loadSkillPackage(skillDir);
    const pack = buildVerifierPack(pkg);

    expect(pack.warnings.join(" ")).toContain("does not claim downstream agent performance");
    expect(pack.holdoutAssertionIds).toContain("assert.skill-install-simulation");
    expect(pack.visibleAssertionIds).not.toContain("assert.skill-install-simulation");
  });
});
