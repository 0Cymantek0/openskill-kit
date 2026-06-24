import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readEvidenceLedger, type EvidenceLedger } from "../evidence/ledger.js";
import { createLocalSandboxPolicy, type SandboxPolicy } from "../sandbox/policy.js";
import { runSandboxCommand } from "../sandbox/runner.js";
import { scanSkillPath, type SafetyReport } from "../safety/scanner.js";
import { validateSkillPackage, loadSkillPackage } from "../skill/parser.js";
import type { ValidationIssue } from "../skill/schema.js";
import { buildVerifierExecution, writeVerifierExecution, type AssertionResult, type VerifierCommandResult, type VerifierExecution, type VerifierMutationResult } from "./execution.js";
import { runSkillPackageFixture, type FixtureCheckResult } from "./fixture.js";
import { buildVerifierPack, readVerifierPack, type VerifierCommand, type VerifierPack } from "./pack.js";

export interface VerifierReport {
  status: "pass" | "fail" | "warning";
  skillPath: string;
  generatedAt: string;
  verifierPack?: VerifierPack;
  execution?: VerifierExecution;
  reportPath?: string;
  executionPath?: string;
  assertionResults: AssertionResult[];
  fixtureResults: FixtureCheckResult[];
  commandResults: VerifierCommandResult[];
  mutationResults: VerifierMutationResult[];
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

export interface VerifyOptions {
  runRepoChecks?: boolean;
}

export async function verifySkill(skillPath: string, reportDir?: string, sandboxPolicy?: SandboxPolicy, options: VerifyOptions = {}): Promise<VerifierReport> {
  const issues = await validateSkillPackage(skillPath);
  const safety = await scanSkillPath(skillPath);
  const pkg = issues.some((issue) => issue.severity === "error") ? undefined : await loadSkillPackage(skillPath);
  const ledger = await readSiblingLedger(pkg?.root);
  const verifierPack = pkg ? await readSiblingVerifierPack(pkg.root).catch(() => buildVerifierPack(pkg, ledger)) : undefined;
  const projectRoot = pkg ? deriveProjectRoot(pkg.root) : undefined;
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
  const effectivePolicy = sandboxPolicy ?? createLocalSandboxPolicy({ projectRoot: projectRoot ?? path.dirname(path.resolve(skillPath)) });
  const fixtureResults = pkg ? [await runSkillPackageFixture(pkg, effectivePolicy)] : [];
  const mutationResults = pkg ? [await runSkillPackageMutation(pkg)] : [];
  const commandResults = verifierPack ? await evaluateVerifierCommands(verifierPack.commands, effectivePolicy, projectRoot ?? effectivePolicy.projectRoot, options.runRepoChecks === true) : [];
  assertionResults.push(...commandResults.map((command) => result(
    command.assertionId,
    command.status === "skipped" ? "warning" : command.status === "pass" ? "pass" : "fail",
    command.message
  )));
  const execution = verifierPack ? buildVerifierExecution({
    skillName: pkg?.manifest.name,
    generatedAt,
    assertionResults,
    visibleAssertionIds: verifierPack.visibleAssertionIds,
    holdoutAssertionIds: verifierPack.holdoutAssertionIds,
    sandboxPolicy: effectivePolicy,
    fixtureResults,
    commandResults,
    mutationResults
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
  const hasFixtureFailure = fixtureResults.some((fixture) => fixture.status === "fail" || fixture.status === "blocked" || fixture.status === "timeout");
  const hasCommandFailure = commandResults.some((command) => command.status === "fail" || command.status === "blocked" || command.status === "timeout");
  const hasMutationFailure = mutationResults.some((mutation) => mutation.status === "survived" || mutation.status === "error");
  const hasWarning = issues.some((issue) => issue.severity === "warning") || Object.values(safety.summary).some((count) => count > 0) || fixtureResults.some((fixture) => fixture.status === "missing");
  const report: VerifierReport = {
    status: hasError || hasFixtureFailure || hasCommandFailure || hasMutationFailure ? "fail" : hasWarning ? "warning" : "pass",
    skillPath: path.normalize(skillPath),
    generatedAt: generatedAt.toISOString(),
    verifierPack,
    execution,
    assertionResults,
    fixtureResults,
    commandResults,
    mutationResults,
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

async function runSkillPackageMutation(pkg: Awaited<ReturnType<typeof loadSkillPackage>>): Promise<VerifierMutationResult> {
  const fixturePath = path.join(pkg.root, "tests", "skill-package-fixture.cjs");
  if (!existsSync(fixturePath)) {
    return {
      id: "mutation.remove-verification-section",
      status: "skipped",
      message: "Mutation skipped because generated fixture is missing."
    };
  }
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openskill-mutant-"));
  const mutantRoot = path.join(tempRoot, path.basename(pkg.root));
  try {
    await fs.cp(pkg.root, mutantRoot, { recursive: true });
    const skillPath = path.join(mutantRoot, "SKILL.md");
    const markdown = await fs.readFile(skillPath, "utf8");
    await fs.writeFile(skillPath, markdown.replace("Verification checklist", "Verification removed"), "utf8");
    const mutantPkg = await loadSkillPackage(mutantRoot);
    const result = await runSkillPackageFixture(mutantPkg, createLocalSandboxPolicy({ projectRoot: mutantPkg.root }));
    return {
      id: "mutation.remove-verification-section",
      status: result.status === "fail" ? "killed" : result.status === "pass" ? "survived" : "error",
      message: result.status === "fail"
        ? "Verifier fixture killed mutant with missing verification section."
        : `Verifier fixture did not cleanly kill mutant; fixture status ${result.status}.`
    };
  } catch (error) {
    return {
      id: "mutation.remove-verification-section",
      status: "error",
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function evaluateVerifierCommands(commands: VerifierCommand[], policy: SandboxPolicy, projectRoot: string, runRepoChecks: boolean): Promise<VerifierCommandResult[]> {
  const results: VerifierCommandResult[] = [];
  for (const command of commands) {
    if (!runRepoChecks) {
      results.push({
        id: command.id,
        assertionId: command.assertionId,
        status: "skipped",
        message: "Repository command check recorded but not executed; pass runRepoChecks to run it."
      });
      continue;
    }
    const commandSpec = normalizeVerifierCommand(command);
    const commandResult = await runSandboxCommand(policy, {
      command: commandSpec.command,
      args: commandSpec.args,
      cwd: path.resolve(projectRoot, command.cwd)
    });
    results.push({
      id: command.id,
      assertionId: command.assertionId,
      status: commandResult.status,
      message: commandResult.status === "pass"
        ? `Repository command passed: ${command.command} ${command.args.join(" ")}`
        : `Repository command did not pass: ${command.command} ${command.args.join(" ")}`,
      command: commandResult
    });
  }
  return results;
}

function normalizeVerifierCommand(command: VerifierCommand): { command: string; args: string[] } {
  if (command.command !== "npm" || process.platform !== "win32") {
    return { command: command.command, args: command.args };
  }
  const npmExecPath = process.env.npm_execpath && existsSync(process.env.npm_execpath)
    ? process.env.npm_execpath
    : path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(npmExecPath)) {
    return { command: process.execPath, args: [npmExecPath, ...command.args] };
  }
  return { command: command.command, args: command.args };
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
  return pack.assertions.filter((assertion) => assertion.type !== "repo-command").map((assertion) => {
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

function deriveProjectRoot(skillRoot: string): string | undefined {
  const parts = path.resolve(skillRoot).split(path.sep);
  const marker = parts.lastIndexOf(".openskill-kit");
  if (marker <= 0) return undefined;
  return parts.slice(0, marker).join(path.sep) || path.sep;
}

function result(assertionId: string, status: AssertionResult["status"], message: string): AssertionResult {
  return { assertionId, status, message };
}
