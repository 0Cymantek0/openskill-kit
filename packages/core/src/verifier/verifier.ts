import { promises as fs } from "node:fs";
import path from "node:path";
import { readEvidenceLedger, type EvidenceLedger } from "../evidence/ledger.js";
import { createLocalSandboxPolicy, type SandboxPolicy } from "../sandbox/policy.js";
import { scanSkillPath, type SafetyReport } from "../safety/scanner.js";
import { validateSkillPackage, loadSkillPackage } from "../skill/parser.js";
import type { ValidationIssue } from "../skill/schema.js";
import { buildVerifierExecution, writeVerifierExecution, type AssertionResult, type VerifierExecution } from "./execution.js";
import { buildVerifierPack, readVerifierPack, type VerifierPack } from "./pack.js";

export interface VerifierReport {
  status: "pass" | "fail" | "warning";
  skillPath: string;
  generatedAt: string;
  verifierPack?: VerifierPack;
  execution?: VerifierExecution;
  reportPath?: string;
  executionPath?: string;
  assertionResults: AssertionResult[];
  issues: ValidationIssue[];
  safety: SafetyReport;
  scores: {
    safety: number;
    structure: number;
    installability: number;
    contextEfficiency: number;
    portability: number;
  };
}

export async function verifySkill(skillPath: string, reportDir?: string, sandboxPolicy?: SandboxPolicy): Promise<VerifierReport> {
  const issues = await validateSkillPackage(skillPath);
  const safety = await scanSkillPath(skillPath);
  const pkg = issues.some((issue) => issue.severity === "error") ? undefined : await loadSkillPackage(skillPath);
  const ledger = await readSiblingLedger(pkg?.root);
  const verifierPack = pkg ? await readSiblingVerifierPack(pkg.root).catch(() => buildVerifierPack(pkg, ledger)) : undefined;
  const assertionResults = verifierPack ? evaluateAssertions(verifierPack, {
    issues,
    safety,
    bodyLength: pkg?.body.length ?? 999999,
    hasCompatibility: Boolean(pkg?.manifest.compatibility),
    hasReferences: Boolean(pkg?.files.some((file) => file.startsWith("references/"))),
    hasCommonMistakes: Boolean(pkg?.body.includes("Common mistakes")),
    hasVerification: Boolean(pkg?.body.includes("Verification checklist"))
  }) : [];
  const generatedAt = new Date();
  const execution = verifierPack ? buildVerifierExecution({
    skillName: pkg?.manifest.name,
    generatedAt,
    assertionResults,
    visibleAssertionIds: verifierPack.visibleAssertionIds,
    holdoutAssertionIds: verifierPack.holdoutAssertionIds,
    sandboxPolicy: sandboxPolicy ?? createLocalSandboxPolicy({ projectRoot: path.dirname(path.resolve(skillPath)) })
  }) : undefined;
  const bodyLength = pkg?.body.length ?? 999999;
  const scores = {
    safety: safety.score,
    structure: Math.max(0, 100 - issues.filter((issue) => issue.severity === "error").length * 40 - issues.filter((issue) => issue.severity === "warning").length * 10),
    installability: issues.some((issue) => issue.severity === "error") ? 0 : 100,
    contextEfficiency: bodyLength <= 4000 ? 100 : bodyLength <= 8000 ? 70 : 30,
    portability: pkg?.manifest.compatibility ? 100 : 70
  };
  const hasError = issues.some((issue) => issue.severity === "error") || safety.status === "fail";
  const hasWarning = issues.some((issue) => issue.severity === "warning") || Object.values(safety.summary).some((count) => count > 0);
  const report: VerifierReport = {
    status: hasError ? "fail" : hasWarning ? "warning" : "pass",
    skillPath: path.normalize(skillPath),
    generatedAt: generatedAt.toISOString(),
    verifierPack,
    execution,
    assertionResults,
    issues,
    safety,
    scores
  };
  if (reportDir) {
    await fs.mkdir(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, "verifier.json");
    const executionPath = path.join(reportDir, "verifier-execution.json");
    report.reportPath = reportPath;
    if (execution) {
      report.executionPath = executionPath;
      await writeVerifierExecution(executionPath, execution);
    }
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  }
  return report;
}

function evaluateAssertions(pack: VerifierPack, state: {
  issues: ValidationIssue[];
  safety: SafetyReport;
  bodyLength: number;
  hasCompatibility: boolean;
  hasReferences: boolean;
  hasCommonMistakes: boolean;
  hasVerification: boolean;
}): AssertionResult[] {
  return pack.assertions.map((assertion) => {
    if (assertion.id === "assert.skill-frontmatter-valid") {
      const failed = state.issues.some((issue) => issue.severity === "error");
      return result(assertion.id, failed ? "fail" : "pass", failed ? "Skill schema validation failed." : "Skill schema validation passed.");
    }
    if (assertion.id === "assert.skill-progressive-disclosure-sections") {
      const passed = state.hasReferences && state.hasCommonMistakes && state.hasVerification;
      return result(assertion.id, passed ? "pass" : "warning", passed ? "Progressive-disclosure sections present." : "Some recommended sections are missing.");
    }
    if (assertion.id === "assert.skill-safety-scan-pass") {
      return result(assertion.id, state.safety.status === "pass" ? "pass" : "fail", state.safety.status === "pass" ? "Safety scan passed." : "Safety scan has high or critical findings.");
    }
    if (assertion.id === "assert.skill-install-simulation") {
      const failed = state.issues.some((issue) => issue.severity === "error");
      return result(assertion.id, failed ? "fail" : "pass", failed ? "Install simulation blocked by validation errors." : "Install simulation prerequisites passed.");
    }
    if (assertion.id === "assert.skill-context-efficient") {
      const passed = state.bodyLength <= 4000;
      return result(assertion.id, passed ? "pass" : "warning", passed ? "Main skill body is concise." : "Main skill body is too large for efficient discovery.");
    }
    if (assertion.id === "assert.skill-portable-adapters") {
      return result(assertion.id, state.hasCompatibility ? "pass" : "warning", state.hasCompatibility ? "Compatibility metadata present." : "Compatibility metadata missing.");
    }
    return result(assertion.id, "warning", "Assertion type has no evaluator yet.");
  });
}

async function readSiblingLedger(skillRoot?: string): Promise<EvidenceLedger | undefined> {
  if (!skillRoot) return undefined;
  const runRoot = path.resolve(skillRoot, "..", "..");
  return readEvidenceLedger(path.join(runRoot, "evidence-ledger.json")).catch(() => undefined);
}

async function readSiblingVerifierPack(skillRoot: string): Promise<VerifierPack> {
  const runRoot = path.resolve(skillRoot, "..", "..");
  return readVerifierPack(path.join(runRoot, "verifier-pack.json"));
}

function result(assertionId: string, status: AssertionResult["status"], message: string): AssertionResult {
  return { assertionId, status, message };
}
