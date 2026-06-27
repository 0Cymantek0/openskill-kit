import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AnchorCardSchema,
  OpenWorldCandidateSkillSchema,
  OpenWorldCandidateRepairRunSchema,
  OpenWorldEvalReportSchema,
  OpenWorldEvolutionRunSchema,
  OpenWorldHiddenOracleHarnessSchema,
  OpenWorldLeakageAuditSchema,
  OpenWorldResearchExecutionSchema,
  OpenWorldVerifierQualityReportSchema,
  OpenWorldSourceSchema,
  SkillPlanSchema,
  VirtualTestSuiteExecutionSchema,
  VirtualTestSuiteSchema,
  type AnchorCard,
  type OpenWorldCandidateSkill,
  type OpenWorldCandidateRepairRun,
  type OpenWorldEvalReport,
  type OpenWorldEvolutionRun,
  type OpenWorldHiddenOracleHarness,
  type OpenWorldLeakageAudit,
  type OpenWorldResearchExecution,
  type OpenWorldVerifierQualityReport,
  type OpenWorldSource,
  type OpenWorldTask,
  type SkillPlan,
  type VirtualTestSuite,
  type VirtualTestSuiteExecution
} from "./schema.js";
import { readOpenWorldTask, writeOpenWorldTaskTextArtifact } from "./store.js";

export interface BuildOpenWorldTaskReportResult {
  schemaVersion: "openskill-kit.openworld-task-report-result.v1";
  task: OpenWorldTask;
  sources: OpenWorldSource[];
  anchors: AnchorCard[];
  suites: VirtualTestSuite[];
  executions: VirtualTestSuiteExecution[];
  plans: SkillPlan[];
  candidateSkills: OpenWorldCandidateSkill[];
  candidateRepairRuns: OpenWorldCandidateRepairRun[];
  audits: OpenWorldLeakageAudit[];
  researchExecutions: OpenWorldResearchExecution[];
  runs: OpenWorldEvolutionRun[];
  evalReports: OpenWorldEvalReport[];
  hiddenOracleHarnesses: OpenWorldHiddenOracleHarness[];
  qualityReports: OpenWorldVerifierQualityReport[];
  proofSummary: OpenWorldProofSummary;
  nextActions: string[];
  markdown: string;
  markdownPath?: string;
}

export interface OpenWorldProofSummary {
  schemaVersion: "openskill-kit.openworld-proof-summary.v1";
  status: "missing-evidence" | "failed" | "ready-for-review";
  proofLevel: "not-proof" | "artifact-verifier";
  hiddenOracleProof: false;
  promotionEligible: boolean;
  latestRunId?: string;
  latestEvalReportId?: string;
  latestHarnessId?: string;
  visiblePassRate?: number;
  holdoutPassRate?: number;
  visibleCaseCount: number;
  holdoutCaseCount: number;
  overfitRisk: boolean;
  requiredEvidence: string[];
  satisfiedEvidence: string[];
  missingEvidence: string[];
  limitations: string[];
}

export async function buildOpenWorldTaskReport(projectRoot: string, taskId: string, options: { write?: boolean } = {}): Promise<BuildOpenWorldTaskReportResult> {
  const root = path.resolve(projectRoot);
  const task = await readOpenWorldTask(root, taskId);
  const taskDir = path.join(root, ".openskill-kit", "openworld", "tasks", taskId);
  const sources = await readJsonFiles(path.join(taskDir, "sources"), (value) => OpenWorldSourceSchema.parse(value));
  const anchors = await readJsonFiles(path.join(taskDir, "anchors"), (value) => AnchorCardSchema.parse(value));
  const suites = await readJsonFiles(path.join(taskDir, "verifiers"), (value) => VirtualTestSuiteSchema.parse(value));
  const executions = await readVerifierExecutions(path.join(taskDir, "verifiers"));
  const plans = await readJsonFiles(path.join(taskDir, "plans"), (value) => SkillPlanSchema.parse(value));
  const candidateSkills = await readJsonFiles(path.join(taskDir, "candidates"), (value) => OpenWorldCandidateSkillSchema.parse(value));
  const candidateRepairRuns = await readCandidateRepairRuns(path.join(taskDir, "candidates"));
  const audits = await readJsonFiles(path.join(taskDir, "audits"), (value) => OpenWorldLeakageAuditSchema.parse(value));
  const researchExecutions = await readJsonFiles(path.join(taskDir, "research", "executions"), (value) => OpenWorldResearchExecutionSchema.parse(value));
  const runs = await readEvolutionRuns(root, taskId);
  const evalReports = await readJsonFiles(path.join(taskDir, "reports"), (value) => OpenWorldEvalReportSchema.parse(value));
  const hiddenOracleHarnesses = await readJsonFiles(path.join(taskDir, "harness"), (value) => OpenWorldHiddenOracleHarnessSchema.parse(value));
  const qualityReports = await readJsonFiles(path.join(taskDir, "reports"), (value) => OpenWorldVerifierQualityReportSchema.parse(value));
  const proofSummary = buildOpenWorldProofSummary({ task, suites, runs, evalReports, hiddenOracleHarnesses, qualityReports });
  const nextActions = inferNextActions({ task, sources, anchors, suites, runs, evalReports, hiddenOracleHarnesses, qualityReports });
  const markdown = renderOpenWorldTaskReport({ task, sources, anchors, suites, executions, plans, candidateSkills, candidateRepairRuns, audits, researchExecutions, runs, evalReports, hiddenOracleHarnesses, qualityReports, proofSummary, nextActions });
  const markdownPath = options.write === true
    ? await writeOpenWorldTaskTextArtifact(root, taskId, ["reports", "task-report.md"], markdown)
    : undefined;
  return {
    schemaVersion: "openskill-kit.openworld-task-report-result.v1",
    task,
    sources,
    anchors,
    suites,
    executions,
    plans,
    candidateSkills,
    candidateRepairRuns,
    audits,
    researchExecutions,
    runs,
    evalReports,
    hiddenOracleHarnesses,
    qualityReports,
    proofSummary,
    nextActions,
    markdown,
    markdownPath
  };
}

export function renderOpenWorldTaskReport(input: {
  task: OpenWorldTask;
  sources?: OpenWorldSource[];
  anchors?: AnchorCard[];
  suites?: VirtualTestSuite[];
  executions?: VirtualTestSuiteExecution[];
  plans?: SkillPlan[];
  candidateSkills?: OpenWorldCandidateSkill[];
  candidateRepairRuns?: OpenWorldCandidateRepairRun[];
  audits?: OpenWorldLeakageAudit[];
  researchExecutions?: OpenWorldResearchExecution[];
  runs?: OpenWorldEvolutionRun[];
  evalReports?: OpenWorldEvalReport[];
  hiddenOracleHarnesses?: OpenWorldHiddenOracleHarness[];
  qualityReports?: OpenWorldVerifierQualityReport[];
  proofSummary?: OpenWorldProofSummary;
  nextActions?: string[];
}): string {
  const sources = input.sources ?? [];
  const anchors = input.anchors ?? [];
  const suites = input.suites ?? [];
  const executions = input.executions ?? [];
  const plans = input.plans ?? [];
  const candidateSkills = input.candidateSkills ?? [];
  const candidateRepairRuns = input.candidateRepairRuns ?? [];
  const audits = input.audits ?? [];
  const researchExecutions = input.researchExecutions ?? [];
  const runs = input.runs ?? [];
  const evalReports = input.evalReports ?? [];
  const hiddenOracleHarnesses = input.hiddenOracleHarnesses ?? [];
  const qualityReports = input.qualityReports ?? [];
  const proofSummary = input.proofSummary ?? buildOpenWorldProofSummary({ task: input.task, suites, runs, evalReports, hiddenOracleHarnesses, qualityReports });
  const nextActions = input.nextActions ?? inferNextActions({ task: input.task, sources, anchors, suites, runs, evalReports, hiddenOracleHarnesses, qualityReports });
  const lines = [
    `# OpenWorld Task: ${input.task.title}`,
    "",
    `Task ID: ${input.task.id}`,
    `Status: ${input.task.status}`,
    `Type: ${input.task.taskType}`,
    `Privacy: ${input.task.privacyClass}`,
    `Web allowed: ${input.task.allowWeb ? "yes" : "no"}`,
    "",
    "## Prompt",
    "",
    input.task.prompt,
    "",
    "## Leakage Guard",
    "",
    `Forbidden identifiers: ${input.task.forbiddenIdentifiers.length}`,
    `Forbidden paths: ${input.task.forbiddenPaths.length}`,
    ...section("Artifact Summary", [
      `- Sources: ${sources.length}`,
      `- Anchors: ${anchors.length}`,
      `- Virtual suites: ${suites.length}`,
      `- Candidate skills: ${candidateSkills.length}`,
      `- Candidate repair runs: ${candidateRepairRuns.length}`,
      `- Verifier executions: ${executions.length}`,
      `- Evolution runs: ${runs.length}`,
      `- Eval reports: ${evalReports.length}`,
      `- Hidden-oracle harnesses: ${hiddenOracleHarnesses.length}`,
      `- Verifier quality reports: ${qualityReports.length}`,
      `- Research executions: ${researchExecutions.length}`,
      `- Leakage audits: ${audits.length}`
    ]),
    ...section("Proof Summary", [
      `- Status: ${proofSummary.status}`,
      `- Proof level: ${proofSummary.proofLevel}`,
      `- Hidden-oracle proof: no`,
      `- Promotion eligible: ${proofSummary.promotionEligible ? "yes" : "no"}`,
      `- Latest run: ${proofSummary.latestRunId ?? "none"}`,
      `- Latest eval report: ${proofSummary.latestEvalReportId ?? "none"}`,
      `- Latest denied-path harness: ${proofSummary.latestHarnessId ?? "none"}`,
      `- Visible pass rate: ${proofSummary.visiblePassRate === undefined ? "n/a" : formatNumber(proofSummary.visiblePassRate)}`,
      `- Holdout pass rate: ${proofSummary.holdoutPassRate === undefined ? "n/a" : formatNumber(proofSummary.holdoutPassRate)}`,
      `- Visible cases: ${proofSummary.visibleCaseCount}`,
      `- Holdout cases: ${proofSummary.holdoutCaseCount}`,
      `- Overfit risk: ${proofSummary.overfitRisk ? "yes" : "no"}`,
      `- Satisfied evidence: ${proofSummary.satisfiedEvidence.length ? proofSummary.satisfiedEvidence.join("; ") : "none"}`,
      `- Missing evidence: ${proofSummary.missingEvidence.length ? proofSummary.missingEvidence.join("; ") : "none"}`,
      `- Limitations: ${proofSummary.limitations.join("; ")}`
    ]),
    ...table("Sources", ["ID", "Kind", "Trust", "Privacy", "URI"], sources.map((source) => [
      source.id,
      source.kind,
      formatNumber(source.trust.score ?? 0),
      source.privacyClass,
      source.uri
    ])),
    ...table("Anchors", ["ID", "Type", "Confidence", "Risk", "Claim"], anchors.map((anchor) => [
      anchor.id,
      anchor.anchorType,
      formatNumber(anchor.confidence),
      anchor.leakageRisk,
      anchor.claim
    ])),
    ...table("Virtual Test Suites", ["ID", "Cases", "Visible", "Holdout", "Audit"], suites.map((suite) => [
      suite.id,
      String(suite.cases.length),
      String(suite.cases.filter((testCase) => testCase.split === "visible").length),
      String(suite.cases.filter((testCase) => testCase.split === "holdout").length),
      suite.leakageAuditId ?? "none"
    ])),
    ...table("Verifier Executions", ["ID", "Suite", "Split", "Pass", "Fail", "Blocked"], executions.map((execution) => [
      execution.id,
      execution.suiteId,
      execution.split,
      String(execution.summary.pass),
      String(execution.summary.fail),
      String(execution.summary.blocked + execution.summary.timeout)
    ])),
    ...table("Verifier Quality Reports", ["ID", "Suite", "Status", "Traceability", "Determinism", "Holdout"], qualityReports.map((report) => [
      report.id,
      report.suiteId,
      report.status,
      formatNumber(report.metrics.traceabilityScore),
      formatNumber(report.metrics.determinismScore),
      String(report.metrics.holdoutCount)
    ])),
    ...section("Skill Plans", plans.map((plan) => `- ${plan.id}: ${plan.status} (${plan.anchorIds.length} anchor(s), ${plan.sourceIds.length} source(s))`)),
    ...table("Candidate Skills", ["ID", "Skill", "Status", "Anchors", "Safety"], candidateSkills.map((candidate) => [
      candidate.id,
      candidate.skillName,
      candidate.status,
      String(candidate.anchorIds.length),
      `${candidate.safety.status} ${candidate.safety.score}`
    ])),
    ...table("Candidate Repair Runs", ["ID", "Candidate", "Status", "Mode", "Rounds"], candidateRepairRuns.map((repair) => [
      repair.id,
      repair.candidateSkillId,
      repair.status,
      repair.sandboxMode,
      String(repair.rounds.length)
    ])),
    ...table("Research Executions", ["ID", "Plan", "Status", "Ingested", "Errors"], researchExecutions.map((execution) => [
      execution.id,
      execution.planId,
      execution.status,
      String(execution.summary.ingestedCount),
      String(execution.summary.errorCount)
    ])),
    ...section("Leakage Audits", audits.map((audit) => `- ${audit.id}: ${audit.status} (${audit.findings.length} finding(s))`)),
    ...table("Evolution Runs", ["ID", "Status", "Rounds", "Visible", "Holdout", "Overfit"], runs.map((run) => [
      run.id,
      run.status,
      String(run.rounds.length),
      formatRunRate(run, "visible"),
      formatRunRate(run, "holdout"),
      run.rounds.some((round) => round.failureType === "overfit-risk") ? "yes" : "no"
    ])),
    ...table("Eval Reports", ["ID", "Run", "Status", "Proof", "Hidden Oracle"], evalReports.map((report) => [
      report.id,
      report.runId,
      report.status,
      report.proofLevel,
      report.hiddenOracleProof ? "yes" : "no"
    ])),
    ...table("Hidden-Oracle Harnesses", ["ID", "Status", "Proof", "Denied Paths", "Leaks"], hiddenOracleHarnesses.map((harness) => [
      harness.id,
      harness.status,
      harness.proofLevel,
      String(harness.deniedPathProof.deniedPathCount),
      String(harness.deniedPathProof.leakedReferenceCount)
    ])),
    ...section("Next Actions", nextActions.map((action) => `- ${action}`))
  ];
  return `${lines.join("\n")}\n`;
}

function section(title: string, rows: string[]): string[] {
  return ["", `## ${title}`, "", ...(rows.length ? rows : ["None"])];
}

function table(title: string, headers: string[], rows: string[][]): string[] {
  if (!rows.length) return section(title, []);
  return [
    "",
    `## ${title}`,
    "",
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(tableCell).join(" | ")} |`)
  ];
}

function tableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ").slice(0, 180);
}

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function formatRunRate(run: OpenWorldEvolutionRun, split: "visible" | "holdout"): string {
  const rounds = run.rounds.filter((round) => round.split === split && round.summary);
  const pass = rounds.reduce((total, round) => total + (round.summary?.pass ?? 0), 0);
  const fail = rounds.reduce((total, round) => total + (round.summary?.fail ?? 0) + (round.summary?.blocked ?? 0) + (round.summary?.timeout ?? 0), 0);
  if (pass + fail === 0) return "n/a";
  return formatNumber(pass / (pass + fail));
}

function buildOpenWorldProofSummary(input: {
  task: OpenWorldTask;
  suites: VirtualTestSuite[];
  runs: OpenWorldEvolutionRun[];
  evalReports: OpenWorldEvalReport[];
  hiddenOracleHarnesses: OpenWorldHiddenOracleHarness[];
  qualityReports: OpenWorldVerifierQualityReport[];
}): OpenWorldProofSummary {
  const latestRun = [...input.runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  const latestSuite = latestRun?.virtualTestSuiteIds[0]
    ? input.suites.find((suite) => suite.id === latestRun.virtualTestSuiteIds[0])
    : [...input.suites].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const latestEval = latestRun
    ? [...input.evalReports].filter((report) => report.runId === latestRun.id).sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0]
    : undefined;
  const latestHarness = [...input.hiddenOracleHarnesses].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
  const latestQuality = latestSuite
    ? [...input.qualityReports].filter((report) => report.suiteId === latestSuite.id).sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0]
    : undefined;
  const visibleCaseCount = latestSuite?.cases.filter((testCase) => testCase.split === "visible").length ?? 0;
  const holdoutCaseCount = latestSuite?.cases.filter((testCase) => testCase.split === "holdout").length ?? 0;
  const visiblePassRate = latestEval?.metrics.visiblePassRate ?? runPassRate(latestRun, "visible");
  const holdoutPassRate = latestEval?.metrics.holdoutPassRate ?? runPassRate(latestRun, "holdout");
  const overfitRisk = Boolean(latestRun?.rounds.some((round) => round.failureType === "overfit-risk")) || latestEval?.metrics.overfitRisk === true;
  const requiredEvidence = [
    "visible verifier pass",
    "holdout verifier pass",
    "artifact eval report",
    "quality report not failing",
    ...(input.task.forbiddenPaths.length ? ["denied-path harness pass"] : [])
  ];
  const satisfiedEvidence = [
    ...(latestRun?.status === "passed" && visiblePassRate === 1 ? ["visible verifier pass"] : []),
    ...(latestRun?.status === "passed" && holdoutPassRate === 1 ? ["holdout verifier pass"] : []),
    ...(latestEval?.status === "pass" && latestEval.proofLevel === "artifact-verifier" ? ["artifact eval report"] : []),
    ...(latestQuality && latestQuality.status !== "fail" ? ["quality report not failing"] : []),
    ...(input.task.forbiddenPaths.length && latestHarness?.status === "pass" ? ["denied-path harness pass"] : [])
  ];
  const missingEvidence = requiredEvidence.filter((item) => !satisfiedEvidence.includes(item));
  const promotionEligible = Boolean(latestRun?.status === "passed" && latestEval?.status === "pass" && latestEval.proofLevel === "artifact-verifier" && !overfitRisk && !missingEvidence.length);
  const failed = latestRun?.status === "failed" || latestRun?.status === "blocked" || overfitRisk || latestEval?.status === "fail" || latestQuality?.status === "fail" || latestHarness?.status === "fail";
  return {
    schemaVersion: "openskill-kit.openworld-proof-summary.v1",
    status: promotionEligible ? "ready-for-review" : failed ? "failed" : "missing-evidence",
    proofLevel: latestEval?.proofLevel === "artifact-verifier" ? "artifact-verifier" : "not-proof",
    hiddenOracleProof: false,
    promotionEligible,
    latestRunId: latestRun?.id,
    latestEvalReportId: latestEval?.id,
    latestHarnessId: latestHarness?.id,
    visiblePassRate,
    holdoutPassRate,
    visibleCaseCount,
    holdoutCaseCount,
    overfitRisk,
    requiredEvidence,
    satisfiedEvidence,
    missingEvidence,
    limitations: [
      "Artifact-verifier proof is local OpenWorld evidence, not hidden-oracle benchmark proof.",
      "Promotion remains review-only; no active behavior changes until normal review approval.",
      ...(input.task.forbiddenPaths.length ? ["Denied-path harness scans generated artifacts without reading hidden oracle contents."] : [])
    ]
  };
}

function runPassRate(run: OpenWorldEvolutionRun | undefined, split: "visible" | "holdout"): number | undefined {
  if (!run) return undefined;
  const rounds = run.rounds.filter((round) => round.split === split && round.summary);
  const pass = rounds.reduce((total, round) => total + (round.summary?.pass ?? 0), 0);
  const fail = rounds.reduce((total, round) => total + (round.summary?.fail ?? 0) + (round.summary?.blocked ?? 0) + (round.summary?.timeout ?? 0), 0);
  return pass + fail === 0 ? undefined : pass / (pass + fail);
}

function inferNextActions(input: {
  task: OpenWorldTask;
  sources: OpenWorldSource[];
  anchors: AnchorCard[];
  suites: VirtualTestSuite[];
  runs: OpenWorldEvolutionRun[];
  evalReports: OpenWorldEvalReport[];
  hiddenOracleHarnesses: OpenWorldHiddenOracleHarness[];
  qualityReports: OpenWorldVerifierQualityReport[];
}): string[] {
  if (!input.sources.length) return [`Ingest project-local source with: openskill-kit openworld research --task-id ${input.task.id} --file <path>`];
  if (!input.anchors.length) return [`Draft anchors from trusted sources with: openskill-kit openworld anchors --task-id ${input.task.id} --source-id <source_id>`];
  const candidateSkillsDirHint = `Generate candidate skill with: openskill-kit openworld candidate-skill --task-id ${input.task.id} --anchor-id <anchor_id>`;
  if (!input.suites.length) return [`Build visible/holdout verifier with: openskill-kit openworld build-verifier --task-id ${input.task.id} --anchor-id <anchor_id>`];
  const latestSuite = [...input.suites].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (latestSuite && !input.qualityReports.some((report) => report.suiteId === latestSuite.id)) return [`Score verifier quality with: openskill-kit openworld verifier-quality --task-id ${input.task.id} --suite-id ${latestSuite.id}`];
  const latestQuality = latestSuite
    ? [...input.qualityReports].filter((report) => report.suiteId === latestSuite.id).sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0]
    : undefined;
  if (latestQuality && latestQuality.status === "fail") return [`Fix verifier quality findings in ${latestQuality.id} before refinement.`];
  if (!input.runs.length) return [candidateSkillsDirHint, `Run bounded refinement with: openskill-kit openworld refine --task-id ${input.task.id} --suite-id <suite_id>`];
  const latestRun = [...input.runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  if (!latestRun) return ["No next action inferred."];
  if (latestRun.status !== "passed") return [`Inspect failed run ${latestRun.id}; fix sources, anchors, or verifier before promotion.`];
  if (!input.evalReports.some((report) => report.runId === latestRun.id)) return [`Write artifact-verifier report with: openskill-kit openworld eval-report --run-id ${latestRun.id}`];
  if (input.task.forbiddenPaths.length && !input.hiddenOracleHarnesses.length) return [`Write denied-path harness with: openskill-kit openworld hidden-oracle-harness --task-id ${input.task.id}`];
  return [`Passed run ${latestRun.id} is ready for review-only promotion: openskill-kit openworld promote-review --run-id ${latestRun.id} --dry-run`];
}

async function readJsonFiles<T>(dir: string, parse: (value: unknown) => T): Promise<T[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  const values: Array<T | undefined> = await Promise.all(files.map(async (entry) => {
    const file = path.join(dir, entry.name);
    try {
      return parse(JSON.parse(await fs.readFile(file, "utf8")));
    } catch {
      return undefined;
    }
  }));
  return values.filter((value): value is T => value !== undefined);
}

async function readVerifierExecutions(verifiersDir: string): Promise<VirtualTestSuiteExecution[]> {
  const suiteDirs = await fs.readdir(verifiersDir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(suiteDirs
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJsonFiles(path.join(verifiersDir, entry.name, "results"), (value) => VirtualTestSuiteExecutionSchema.parse(value))));
  return nested.flat().sort((left, right) => right.executedAt.localeCompare(left.executedAt));
}

async function readCandidateRepairRuns(candidatesDir: string): Promise<OpenWorldCandidateRepairRun[]> {
  const entries = await fs.readdir(candidatesDir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJsonFiles(path.join(candidatesDir, entry.name, "repairs"), (value) => OpenWorldCandidateRepairRunSchema.parse(value))));
  return nested.flat().sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

async function readEvolutionRuns(projectRoot: string, taskId: string): Promise<OpenWorldEvolutionRun[]> {
  const runsDir = path.join(projectRoot, ".openskill-kit", "evolution", "runs");
  const entries = await fs.readdir(runsDir, { withFileTypes: true }).catch(() => []);
  const runs = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => fs.readFile(path.join(runsDir, entry.name, "run.json"), "utf8")
      .then((text) => OpenWorldEvolutionRunSchema.parse(JSON.parse(text)))
      .catch(() => undefined)));
  return runs
    .filter((run): run is OpenWorldEvolutionRun => run?.taskId === taskId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}
