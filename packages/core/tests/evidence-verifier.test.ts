import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
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
  readEvidenceLedger,
  readLeakageAudit,
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
    const leakageAudit = await readLeakageAudit(draft.leakageAuditPath);
    const runReport = await readFile(draft.runReportPath, "utf8");
    const pack = VerifierPackSchema.parse(JSON.parse(await readFile(draft.verifierPackPath, "utf8")));
    const report = await verifySkill(draft.skillDir);

    expect(ledger.task).toBe("repo verifier skill");
    expect(leakageAudit.status).toBe("pass");
    expect(runReport).toContain("# OpenSkill Run Report");
    expect(runReport).toContain("Repository commands:");
    expect(pack.commands.some((command) => command.id === "cmd.repo.test")).toBe(true);
    expect(pack.assertions.map((assertion) => assertion.id)).toContain("assert.skill-safety-scan-pass");
    expect(report.assertionResults.some((result) => result.assertionId === "assert.skill-safety-scan-pass" && result.status === "pass")).toBe(true);
    expect(report.fixtureResults.some((result) => result.id === "fixture.skill-package" && result.status === "pass")).toBe(true);
    expect(report.mutationResults.some((result) => result.id === "mutation.remove-verification-section" && result.status === "killed")).toBe(true);
    expect(report.execution?.visibleResults.length).toBeGreaterThan(0);
    expect(report.execution?.holdoutResults.length).toBeGreaterThan(0);
    expect(report.execution?.fixtureResults[0]?.status).toBe("pass");
    expect(report.execution?.sandbox?.mode).toBe("local-process");
    expect(report.execution?.sandbox?.allowNetwork).toBe(false);
  });

  it("runs repository verifier commands when explicitly enabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-repo-command-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: {
        "verify:repo": "node -e \"console.log('repo check ok')\""
      }
    }), "utf8");

    const draft = await draftSkill({ topic: "repo command verifier", projectRoot: root, noLlm: true, now: new Date("2026-06-24T00:00:00.000Z") });
    const report = await verifySkill(draft.skillDir, undefined, undefined, { runRepoChecks: true });

    expect(report.status).toBe("pass");
    expect(report.commandResults.some((result) => result.id === "cmd.repo.verify-repo" && result.status === "pass")).toBe(true);
    expect(report.execution?.commandResults[0]?.stdout).toContain("repo check ok");
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
    expect(execution.summary.fixtures).toBe(1);
    expect(execution.summary.mutations).toBe(1);
    expect(execution.limitations.join(" ")).toContain("not hidden benchmark tests");
  });

  it("records supplied evidence files in the ledger and references", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-evidence-file-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest --run" } }), "utf8");
    await writeFile(path.join(root, "evidence-notes.md"), "# Evidence\n\nUse repo tests as verifier anchors.", "utf8");

    const draft = await draftSkill({
      topic: "repo verifier workflow",
      projectRoot: root,
      noLlm: true,
      evidenceFiles: ["evidence-notes.md"],
      now: new Date("2026-06-24T00:00:00.000Z")
    });
    const ledger = await readEvidenceLedger(draft.evidenceLedgerPath);

    expect(ledger.sources.some((source) => source.id === "src.manual.1" && source.sha256)).toBe(true);
    expect(ledger.claims.some((claim) => claim.id === "claim.manual.1")).toBe(true);
    await expect(stat(path.join(draft.skillDir, "references", "evidence.md"))).resolves.toBeTruthy();
    expect(await readFile(path.join(draft.skillDir, "references", "research.md"), "utf8")).toContain("evidence-notes.md");
  });

  it("fetches explicit evidence URLs into the ledger and references", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-evidence-url-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest --run" } }), "utf8");
    const server = createServer((socket) => {
      socket.once("data", () => {
        socket.end([
          "HTTP/1.1 200 OK",
          "content-type: text/markdown; charset=utf-8",
          "connection: close",
          "",
          "# Remote Docs",
          "",
          "Use independent verifier anchors."
        ].join("\r\n"));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const url = `http://127.0.0.1:${port}/docs`;
      const draft = await draftSkill({
        topic: "repo verifier workflow",
        projectRoot: root,
        noLlm: true,
        evidenceUrls: [url],
        now: new Date("2026-06-24T00:00:00.000Z")
      });
      const ledger = await readEvidenceLedger(draft.evidenceLedgerPath);
      const evidenceMarkdown = await readFile(path.join(draft.skillDir, "references", "evidence.md"), "utf8");

      expect(ledger.sources.some((source) => source.id === "src.external.1" && source.url === url)).toBe(true);
      expect(ledger.claims.some((claim) => claim.id === "claim.external.1")).toBe(true);
      expect(evidenceMarkdown).toContain("Use independent verifier anchors.");
    } finally {
      server.close();
    }
  });

  it("blocks hidden target evidence from the ledger and records a leakage audit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-leakage-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest --run" } }), "utf8");
    await mkdir(path.join(root, "hidden-tests"));
    await writeFile(path.join(root, "hidden-tests", "oracle-output.md"), "oracle_output: pass", "utf8");

    const draft = await draftSkill({
      topic: "repo verifier workflow",
      projectRoot: root,
      noLlm: true,
      evidenceFiles: [path.join("hidden-tests", "oracle-output.md")],
      now: new Date("2026-06-24T00:00:00.000Z")
    });
    const ledger = await readEvidenceLedger(draft.evidenceLedgerPath);
    const leakageAudit = await readLeakageAudit(draft.leakageAuditPath);

    expect(leakageAudit.status).toBe("blocked");
    expect(leakageAudit.findings.some((finding) => finding.id === "hidden-tests-path")).toBe(true);
    expect(ledger.sources.some((source) => source.id.startsWith("src.manual."))).toBe(false);
    await expect(stat(path.join(draft.skillDir, "references", "evidence.md"))).rejects.toThrow();
    expect(draft.warnings.some((warning) => warning.includes("blocked by leakage audit"))).toBe(true);
  });

  it("verifier pack does not claim downstream agent performance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-pack-"));
    const skillDir = path.join(root, "portable-skill");
    await mkdir(path.join(skillDir, "references"), { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: portable-skill\ndescription: Portable skill\ncompatibility: opencode,codex\n---\n\n## When to use\nUse it.\n\n## When not to use\nAvoid unrelated tasks.\n\n## Verification checklist\n- Run tests.\n\n## Common mistakes\n- Do not skip validation.\n\n## References\n- [Notes](references/research.md)\n", "utf8");
    await writeFile(path.join(skillDir, "references", "research.md"), "# Notes\n", "utf8");
    await mkdir(path.join(skillDir, "tests"));
    await writeFile(path.join(skillDir, "tests", "skill-package-fixture.cjs"), "console.log('ok')\n", "utf8");
    const pkg = await loadSkillPackage(skillDir);
    const pack = buildVerifierPack(pkg);

    expect(pack.warnings.join(" ")).toContain("does not claim downstream agent performance");
    expect(pack.holdoutAssertionIds).toContain("assert.skill-install-simulation");
    expect(pack.visibleAssertionIds).not.toContain("assert.skill-install-simulation");
  });
});
