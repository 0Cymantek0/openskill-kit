import { createHash } from "node:crypto";
import path from "node:path";
import { OpenWorldEvalReportSchema, type OpenWorldEvalReport, type OpenWorldEvolutionRun } from "./schema.js";
import { readOpenWorldEvolutionRun, writeOpenWorldTaskTextArtifact } from "./store.js";

export interface BuildOpenWorldEvalReportResult {
  schemaVersion: "openskill-kit.openworld-eval-report-result.v1";
  report: OpenWorldEvalReport;
  reportPath: string;
  markdownPath: string;
}

export async function buildOpenWorldEvalReport(projectRoot: string, runId: string, now = new Date()): Promise<BuildOpenWorldEvalReportResult> {
  const root = path.resolve(projectRoot);
  const run = await readOpenWorldEvolutionRun(root, runId);
  const report = OpenWorldEvalReportSchema.parse({
    schemaVersion: "openskill-kit.openworld-eval-report.v1",
    id: `oweval_${shortHash(`${run.id}:${now.toISOString()}`)}`,
    taskId: run.taskId,
    runId: run.id,
    suiteIds: run.virtualTestSuiteIds,
    generatedAt: now.toISOString(),
    status: run.status === "passed" ? "pass" : run.status === "blocked" ? "fail" : "warn",
    proofLevel: "artifact-verifier",
    hiddenOracleProof: false,
    metrics: {
      visiblePassRate: passRate(run, "visible"),
      holdoutPassRate: passRate(run, "holdout"),
      roundCount: run.rounds.length,
      overfitRisk: run.rounds.some((round) => round.failureType === "overfit-risk"),
      leakageAuditCount: run.leakageAuditIds.length,
      wallClockMs: run.cost.wallClockMs
    },
    references: {
      runPath: path.join(".openskill-kit", "evolution", "runs", run.id, "run.json").replace(/\\/g, "/"),
      verifierResultPaths: run.rounds.map((round) => round.verifierResultPath).filter((value): value is string => Boolean(value)),
      sourceIds: run.sourceIds,
      anchorIds: run.anchorIds
    },
    limitations: [
      "This report measures generated virtual verifier artifacts only.",
      "This is not hidden-oracle benchmark proof.",
      "This does not prove real task success or cross-agent transfer.",
      "Promotion still requires review, integrity checks, and calibration."
    ]
  });
  const reportPath = await writeOpenWorldTaskTextArtifact(root, run.taskId, ["reports", `${report.id}.json`], `${JSON.stringify(report, null, 2)}\n`);
  const markdownPath = await writeOpenWorldTaskTextArtifact(root, run.taskId, ["reports", `${report.id}.md`], renderOpenWorldEvalReport(report));
  return { schemaVersion: "openskill-kit.openworld-eval-report-result.v1", report, reportPath, markdownPath };
}

export function renderOpenWorldEvalReport(report: OpenWorldEvalReport): string {
  return [
    `# OpenWorld Eval Report ${report.id}`,
    "",
    `Status: ${report.status}`,
    `Proof level: ${report.proofLevel}`,
    `Hidden-oracle proof: ${report.hiddenOracleProof ? "yes" : "no"}`,
    "",
    "## Metrics",
    "",
    `- Visible pass rate: ${formatRate(report.metrics.visiblePassRate)}`,
    `- Holdout pass rate: ${formatRate(report.metrics.holdoutPassRate)}`,
    `- Rounds: ${report.metrics.roundCount}`,
    `- Overfit risk: ${report.metrics.overfitRisk ? "yes" : "no"}`,
    `- Leakage audits: ${report.metrics.leakageAuditCount}`,
    `- Wall clock ms: ${report.metrics.wallClockMs}`,
    "",
    "## References",
    "",
    `- Run: ${report.references.runPath ?? report.runId}`,
    ...report.references.verifierResultPaths.map((resultPath) => `- Verifier result: ${resultPath}`),
    "",
    "## Limitations",
    "",
    ...report.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].join("\n");
}

function passRate(run: OpenWorldEvolutionRun, split: "visible" | "holdout"): number {
  const rounds = run.rounds.filter((round) => round.split === split && round.summary);
  const totals = rounds.reduce((acc, round) => {
    const summary = round.summary!;
    acc.pass += summary.pass;
    acc.total += summary.pass + summary.fail + summary.blocked + summary.timeout + summary.skipped;
    return acc;
  }, { pass: 0, total: 0 });
  return totals.total === 0 ? 0 : Math.round((totals.pass / totals.total) * 1000) / 1000;
}

function formatRate(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
