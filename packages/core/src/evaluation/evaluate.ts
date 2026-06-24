import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readLeakageAudit, type LeakageAudit } from "../leakage/audit.js";
import { verifySkill, type VerifyOptions, type VerifierReport } from "../verifier/verifier.js";

export const EvaluationGateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pass", "warning", "fail"]),
  message: z.string().min(1)
});

export const EvaluationReportSchema = z.object({
  schemaVersion: z.literal("openskill-kit.evaluation.v0"),
  generatedAt: z.string().datetime(),
  skillPath: z.string().min(1),
  status: z.enum(["pass", "warning", "fail"]),
  verifierStatus: z.enum(["pass", "warning", "fail"]),
  leakageStatus: z.enum(["pass", "warning", "blocked", "missing"]),
  gates: z.array(EvaluationGateSchema),
  metrics: z.object({
    visibleAssertions: z.number().int().nonnegative(),
    holdoutAssertions: z.number().int().nonnegative(),
    fixtures: z.number().int().nonnegative(),
    commands: z.number().int().nonnegative(),
    commandsExecuted: z.number().int().nonnegative(),
    mutations: z.number().int().nonnegative(),
    mutationsKilled: z.number().int().nonnegative()
  }),
  artifacts: z.object({
    evaluation: z.string().min(1),
    markdown: z.string().min(1),
    verifier: z.string().optional(),
    verifierExecution: z.string().optional(),
    leakageAudit: z.string().optional()
  }),
  limitations: z.array(z.string())
});

export type EvaluationGate = z.infer<typeof EvaluationGateSchema>;
export type EvaluationReport = z.infer<typeof EvaluationReportSchema>;

export interface EvaluateOptions extends VerifyOptions {
  reportDir?: string;
}

export async function evaluateSkill(skillPath: string, options: EvaluateOptions = {}): Promise<EvaluationReport> {
  const absoluteSkillPath = path.resolve(skillPath);
  const reportDir = path.resolve(options.reportDir ?? deriveEvaluationDir(absoluteSkillPath));
  await fs.mkdir(reportDir, { recursive: true });

  const verifier = await verifySkill(absoluteSkillPath, reportDir, undefined, { runRepoChecks: options.runRepoChecks });
  const leakage = await readSiblingLeakageAudit(absoluteSkillPath);
  const evaluationPath = path.join(reportDir, "evaluation.json");
  const markdownPath = path.join(reportDir, "evaluation.md");
  const report = buildEvaluationReport({
    skillPath: absoluteSkillPath,
    evaluationPath,
    markdownPath,
    verifier,
    leakage
  });

  await fs.writeFile(evaluationPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(markdownPath, renderEvaluationMarkdown(report), "utf8");
  return report;
}

function buildEvaluationReport(input: {
  skillPath: string;
  evaluationPath: string;
  markdownPath: string;
  verifier: VerifierReport;
  leakage?: { path: string; audit: LeakageAudit };
}): EvaluationReport {
  const commandResults = input.verifier.commandResults;
  const mutationResults = input.verifier.mutationResults;
  const visibleAssertions = input.verifier.execution?.summary.visible ?? input.verifier.verifierPack?.visibleAssertionIds.length ?? 0;
  const holdoutAssertions = input.verifier.execution?.summary.holdout ?? input.verifier.verifierPack?.holdoutAssertionIds.length ?? 0;
  const gates: EvaluationGate[] = [
    verifierGate(input.verifier),
    leakageGate(input.leakage?.audit),
    repoCommandGate(commandResults),
    mutationGate(mutationResults)
  ];
  const status = gates.some((gate) => gate.status === "fail")
    ? "fail"
    : gates.some((gate) => gate.status === "warning")
      ? "warning"
      : "pass";

  return EvaluationReportSchema.parse({
    schemaVersion: "openskill-kit.evaluation.v0",
    generatedAt: new Date().toISOString(),
    skillPath: path.normalize(input.skillPath),
    status,
    verifierStatus: input.verifier.status,
    leakageStatus: input.leakage?.audit.status ?? "missing",
    gates,
    metrics: {
      visibleAssertions,
      holdoutAssertions,
      fixtures: input.verifier.fixtureResults.length,
      commands: commandResults.length,
      commandsExecuted: commandResults.filter((result) => result.status !== "skipped").length,
      mutations: mutationResults.length,
      mutationsKilled: mutationResults.filter((result) => result.status === "killed").length
    },
    artifacts: {
      evaluation: path.normalize(input.evaluationPath),
      markdown: path.normalize(input.markdownPath),
      verifier: input.verifier.reportPath ? path.normalize(input.verifier.reportPath) : undefined,
      verifierExecution: input.verifier.executionPath ? path.normalize(input.verifier.executionPath) : undefined,
      leakageAudit: input.leakage?.path ? path.normalize(input.leakage.path) : undefined
    },
    limitations: [
      "Evaluation uses local generated verifier artifacts, not private benchmark answers.",
      "Leakage audit only covers explicit supplied evidence and generated run artifacts.",
      "Repository command checks run only when runRepoChecks is enabled."
    ]
  });
}

function verifierGate(report: VerifierReport): EvaluationGate {
  if (report.status === "pass") {
    return { id: "gate.verifier", status: "pass", message: "Verifier passed schema, safety, fixtures, commands, and mutations." };
  }
  if (report.status === "warning") {
    return { id: "gate.verifier", status: "warning", message: "Verifier passed with warnings." };
  }
  return { id: "gate.verifier", status: "fail", message: "Verifier failed; see verifier.json for failing assertions, fixtures, commands, or mutations." };
}

function leakageGate(audit?: LeakageAudit): EvaluationGate {
  if (!audit) {
    return { id: "gate.leakage", status: "warning", message: "No leakage audit found next to this skill package." };
  }
  if (audit.status === "pass") {
    return { id: "gate.leakage", status: "pass", message: "Leakage audit passed for explicit evidence inputs." };
  }
  if (audit.status === "warning") {
    return { id: "gate.leakage", status: "warning", message: "Leakage audit has warning findings." };
  }
  return { id: "gate.leakage", status: "fail", message: "Leakage audit blocked one or more explicit evidence sources." };
}

function repoCommandGate(commands: VerifierReport["commandResults"]): EvaluationGate {
  if (!commands.length) {
    return { id: "gate.repo-commands", status: "warning", message: "No repository command checks were discovered." };
  }
  if (commands.some((command) => command.status === "fail" || command.status === "blocked" || command.status === "timeout")) {
    return { id: "gate.repo-commands", status: "fail", message: "One or more repository command checks failed." };
  }
  if (commands.some((command) => command.status === "skipped")) {
    return { id: "gate.repo-commands", status: "warning", message: "Repository command checks were discovered but skipped." };
  }
  return { id: "gate.repo-commands", status: "pass", message: "Repository command checks executed successfully." };
}

function mutationGate(mutations: VerifierReport["mutationResults"]): EvaluationGate {
  if (!mutations.length) {
    return { id: "gate.mutations", status: "warning", message: "No mutation checks ran." };
  }
  if (mutations.some((mutation) => mutation.status === "survived" || mutation.status === "error")) {
    return { id: "gate.mutations", status: "fail", message: "Verifier mutation check survived or errored." };
  }
  if (mutations.some((mutation) => mutation.status === "skipped")) {
    return { id: "gate.mutations", status: "warning", message: "Verifier mutation check was skipped." };
  }
  return { id: "gate.mutations", status: "pass", message: "Verifier mutation checks were killed." };
}

function renderEvaluationMarkdown(report: EvaluationReport): string {
  return `# OpenSkill Evaluation

## Summary

- Status: ${report.status}
- Verifier: ${report.verifierStatus}
- Leakage: ${report.leakageStatus}
- Skill: ${report.skillPath}

## Gates

${report.gates.map((gate) => `- ${gate.id}: ${gate.status} - ${gate.message}`).join("\n")}

## Metrics

- Visible assertions: ${report.metrics.visibleAssertions}
- Holdout assertions: ${report.metrics.holdoutAssertions}
- Fixtures: ${report.metrics.fixtures}
- Repository commands: ${report.metrics.commandsExecuted}/${report.metrics.commands}
- Mutations killed: ${report.metrics.mutationsKilled}/${report.metrics.mutations}

## Artifacts

- Evaluation JSON: ${report.artifacts.evaluation}
- Verifier report: ${report.artifacts.verifier ?? "not written"}
- Verifier execution: ${report.artifacts.verifierExecution ?? "not written"}
- Leakage audit: ${report.artifacts.leakageAudit ?? "not found"}

## Limitations

${report.limitations.map((limitation) => `- ${limitation}`).join("\n")}
`;
}

async function readSiblingLeakageAudit(skillPath: string): Promise<{ path: string; audit: LeakageAudit } | undefined> {
  const skillRoot = skillPath.endsWith("SKILL.md") ? path.dirname(skillPath) : skillPath;
  const runRoot = path.resolve(skillRoot, "..", "..");
  const auditPath = path.join(runRoot, "leakage-audit.json");
  const audit = await readLeakageAudit(auditPath).catch(() => undefined);
  return audit ? { path: auditPath, audit } : undefined;
}

function deriveEvaluationDir(skillPath: string): string {
  const skillRoot = skillPath.endsWith("SKILL.md") ? path.dirname(skillPath) : skillPath;
  const parts = path.resolve(skillRoot).split(path.sep);
  const marker = parts.lastIndexOf(".openskill-kit");
  if (marker > 0) {
    const projectRoot = parts.slice(0, marker).join(path.sep) || path.sep;
    return path.join(projectRoot, ".openskill-kit", "evaluations", path.basename(skillRoot));
  }
  return path.join(path.dirname(skillRoot), ".openskill-kit", "evaluations", path.basename(skillRoot));
}
