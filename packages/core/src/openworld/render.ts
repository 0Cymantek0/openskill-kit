import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AnchorCardSchema,
  OpenWorldEvalReportSchema,
  OpenWorldEvolutionRunSchema,
  OpenWorldLeakageAuditSchema,
  OpenWorldResearchExecutionSchema,
  OpenWorldVerifierQualityReportSchema,
  OpenWorldSourceSchema,
  SkillPlanSchema,
  VirtualTestSuiteExecutionSchema,
  VirtualTestSuiteSchema,
  type AnchorCard,
  type OpenWorldEvalReport,
  type OpenWorldEvolutionRun,
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
  audits: OpenWorldLeakageAudit[];
  researchExecutions: OpenWorldResearchExecution[];
  runs: OpenWorldEvolutionRun[];
  evalReports: OpenWorldEvalReport[];
  qualityReports: OpenWorldVerifierQualityReport[];
  nextActions: string[];
  markdown: string;
  markdownPath?: string;
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
  const audits = await readJsonFiles(path.join(taskDir, "audits"), (value) => OpenWorldLeakageAuditSchema.parse(value));
  const researchExecutions = await readJsonFiles(path.join(taskDir, "research", "executions"), (value) => OpenWorldResearchExecutionSchema.parse(value));
  const runs = await readEvolutionRuns(root, taskId);
  const evalReports = await readJsonFiles(path.join(taskDir, "reports"), (value) => OpenWorldEvalReportSchema.parse(value));
  const qualityReports = await readJsonFiles(path.join(taskDir, "reports"), (value) => OpenWorldVerifierQualityReportSchema.parse(value));
  const nextActions = inferNextActions({ task, sources, anchors, suites, runs, evalReports, qualityReports });
  const markdown = renderOpenWorldTaskReport({ task, sources, anchors, suites, executions, plans, audits, researchExecutions, runs, evalReports, qualityReports, nextActions });
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
    audits,
    researchExecutions,
    runs,
    evalReports,
    qualityReports,
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
  audits?: OpenWorldLeakageAudit[];
  researchExecutions?: OpenWorldResearchExecution[];
  runs?: OpenWorldEvolutionRun[];
  evalReports?: OpenWorldEvalReport[];
  qualityReports?: OpenWorldVerifierQualityReport[];
  nextActions?: string[];
}): string {
  const sources = input.sources ?? [];
  const anchors = input.anchors ?? [];
  const suites = input.suites ?? [];
  const executions = input.executions ?? [];
  const plans = input.plans ?? [];
  const audits = input.audits ?? [];
  const researchExecutions = input.researchExecutions ?? [];
  const runs = input.runs ?? [];
  const evalReports = input.evalReports ?? [];
  const qualityReports = input.qualityReports ?? [];
  const nextActions = input.nextActions ?? inferNextActions({ task: input.task, sources, anchors, suites, runs, evalReports, qualityReports });
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
      `- Verifier executions: ${executions.length}`,
      `- Evolution runs: ${runs.length}`,
      `- Eval reports: ${evalReports.length}`,
      `- Verifier quality reports: ${qualityReports.length}`,
      `- Research executions: ${researchExecutions.length}`,
      `- Leakage audits: ${audits.length}`
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

function inferNextActions(input: {
  task: OpenWorldTask;
  sources: OpenWorldSource[];
  anchors: AnchorCard[];
  suites: VirtualTestSuite[];
  runs: OpenWorldEvolutionRun[];
  evalReports: OpenWorldEvalReport[];
  qualityReports: OpenWorldVerifierQualityReport[];
}): string[] {
  if (!input.sources.length) return [`Ingest project-local source with: openskill-kit openworld research --task-id ${input.task.id} --file <path>`];
  if (!input.anchors.length) return [`Draft anchors from trusted sources with: openskill-kit openworld anchors --task-id ${input.task.id} --source-id <source_id>`];
  if (!input.suites.length) return [`Build visible/holdout verifier with: openskill-kit openworld build-verifier --task-id ${input.task.id} --anchor-id <anchor_id>`];
  const latestSuite = [...input.suites].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (latestSuite && !input.qualityReports.some((report) => report.suiteId === latestSuite.id)) return [`Score verifier quality with: openskill-kit openworld verifier-quality --task-id ${input.task.id} --suite-id ${latestSuite.id}`];
  const latestQuality = latestSuite
    ? [...input.qualityReports].filter((report) => report.suiteId === latestSuite.id).sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0]
    : undefined;
  if (latestQuality && latestQuality.status === "fail") return [`Fix verifier quality findings in ${latestQuality.id} before refinement.`];
  if (!input.runs.length) return [`Run bounded refinement with: openskill-kit openworld refine --task-id ${input.task.id} --suite-id <suite_id>`];
  const latestRun = [...input.runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  if (!latestRun) return ["No next action inferred."];
  if (latestRun.status !== "passed") return [`Inspect failed run ${latestRun.id}; fix sources, anchors, or verifier before promotion.`];
  if (!input.evalReports.some((report) => report.runId === latestRun.id)) return [`Write artifact-verifier report with: openskill-kit openworld eval-report --run-id ${latestRun.id}`];
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
