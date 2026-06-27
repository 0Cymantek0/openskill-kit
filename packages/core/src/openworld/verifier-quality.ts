import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  AnchorCardSchema,
  OpenWorldVerifierQualityReportSchema,
  type AnchorCard,
  type OpenWorldSource,
  type OpenWorldVerifierQualityFinding,
  type OpenWorldVerifierQualityReport,
  type VirtualTestCase
} from "./schema.js";
import { readOpenWorldSource, readOpenWorldTask, readVirtualTestSuite, writeOpenWorldTaskTextArtifact } from "./store.js";

export interface AssessOpenWorldVerifierQualityOptions {
  write?: boolean;
  now?: Date;
}

export interface AssessOpenWorldVerifierQualityResult {
  schemaVersion: "openskill-kit.openworld-verifier-quality-result.v1";
  report: OpenWorldVerifierQualityReport;
  reportPath?: string;
  markdownPath?: string;
}

export async function assessOpenWorldVerifierQuality(
  projectRoot: string,
  taskId: string,
  suiteId: string,
  options: AssessOpenWorldVerifierQualityOptions = {}
): Promise<AssessOpenWorldVerifierQualityResult> {
  const root = path.resolve(projectRoot);
  await readOpenWorldTask(root, taskId);
  const suite = await readVirtualTestSuite(root, taskId, suiteId);
  const anchors = await readSuiteAnchors(root, taskId, [...new Set(suite.cases.flatMap((testCase) => testCase.anchorIds))]);
  const sources = await readAnchorSources(root, taskId, anchors);
  const findings: OpenWorldVerifierQualityFinding[] = [];

  if (suite.cases.length === 0) findings.push(finding("no-cases", "fail", "Verifier suite has no cases.", "Build a suite from at least one Anchor Card."));
  if (!suite.cases.some((testCase) => testCase.split === "visible")) findings.push(finding("no-visible-split", "fail", "Verifier suite has no visible cases.", "Regenerate suite with visible cases."));
  if (!suite.cases.some((testCase) => testCase.split === "holdout")) findings.push(finding("no-holdout-split", "warn", "Verifier suite has no holdout cases.", "Use at least four anchors or add independent holdout cases before promotion."));
  if (!suite.leakageAuditId) findings.push(finding("missing-leakage-audit", "warn", "Verifier suite has no leakage audit id.", "Regenerate or audit verifier artifacts before running refinement."));

  const knownAnchorIds = new Set(anchors.map((anchor) => anchor.id));
  const generatedAnchorIds = new Set(suite.generatedFromAnchorIds);
  for (const testCase of suite.cases) {
    checkCase(taskId, testCase, knownAnchorIds, findings);
  }
  for (const anchorId of generatedAnchorIds) {
    if (!suite.cases.some((testCase) => testCase.anchorIds.includes(anchorId))) {
      findings.push(finding("unused-generated-anchor", "warn", `Generated anchor ${anchorId} has no verifier case.`, "Regenerate suite or remove unused generated anchors.", undefined, anchorId));
    }
  }
  for (const anchor of anchors) {
    if (!anchor.usableFor.includes("virtual-test")) findings.push(finding("anchor-not-usable-for-test", "warn", `Anchor ${anchor.id} is not marked usable for virtual tests.`, "Use only virtual-test anchors for verifier cases.", undefined, anchor.id));
    if (!anchor.sourceQuote) findings.push(finding("anchor-missing-quote", "warn", `Anchor ${anchor.id} has no source quote.`, "Prefer anchors with sourceQuote for traceability.", undefined, anchor.id));
    if (anchor.confidence < 0.45) findings.push(finding("low-anchor-confidence", "warn", `Anchor ${anchor.id} has low confidence.`, "Review source quality before relying on this verifier.", undefined, anchor.id));
  }

  const usedAnchorIds = new Set(suite.cases.flatMap((testCase) => testCase.anchorIds));
  const anchorCoverage = generatedAnchorIds.size === 0
    ? usedAnchorIds.size ? 1 : 0
    : ratio([...generatedAnchorIds].filter((anchorId) => usedAnchorIds.has(anchorId)).length, generatedAnchorIds.size);
  const sourceTrustAverage = sources.length
    ? round(sources.reduce((sum, source) => sum + (source.trust.score ?? scoreTrust(source)), 0) / sources.length)
    : 0;
  const deterministicCases = suite.cases.filter((testCase) => isDeterministicCase(testCase, taskId)).length;
  const traceableCases = suite.cases.filter((testCase) => testCase.anchorIds.every((anchorId) => knownAnchorIds.has(anchorId))).length;
  const determinismScore = ratio(deterministicCases, suite.cases.length);
  const traceabilityScore = ratio(traceableCases, suite.cases.length);
  if (anchorCoverage < 1) findings.push(finding("incomplete-anchor-coverage", "warn", "Not every generated anchor is covered by verifier cases.", "Regenerate suite so every generated anchor maps to at least one case."));
  if (determinismScore < 1) findings.push(finding("non-deterministic-cases", "fail", "One or more verifier cases are not deterministic/local enough.", "Use local files, allowlisted commands, and no network-dependent assertions."));
  if (traceabilityScore < 1) findings.push(finding("traceability-gap", "fail", "One or more verifier cases reference missing anchors.", "Fix anchor ids or regenerate the suite from existing Anchor Cards."));

  const status = findings.some((item) => item.level === "fail") ? "fail" : findings.some((item) => item.level === "warn") ? "warn" : "pass";
  const now = options.now ?? new Date();
  const draft = OpenWorldVerifierQualityReportSchema.parse({
    schemaVersion: "openskill-kit.openworld-verifier-quality.v1",
    id: `owvq_${shortHash(`${taskId}:${suiteId}:${now.toISOString()}`)}`,
    taskId,
    suiteId,
    generatedAt: now.toISOString(),
    status,
    proofLevel: "verifier-quality",
    hiddenOracleProof: false,
    metrics: {
      caseCount: suite.cases.length,
      visibleCount: suite.cases.filter((testCase) => testCase.split === "visible").length,
      holdoutCount: suite.cases.filter((testCase) => testCase.split === "holdout").length,
      anchorCoverage,
      sourceTrustAverage,
      determinismScore,
      traceabilityScore,
      leakageAuditPresent: Boolean(suite.leakageAuditId)
    },
    findings
  });
  if (options.write === false) {
    return { schemaVersion: "openskill-kit.openworld-verifier-quality-result.v1", report: draft };
  }
  const reportPath = await writeOpenWorldTaskTextArtifact(root, taskId, ["reports", `${draft.id}.json`], `${JSON.stringify(draft, null, 2)}\n`);
  const markdownPath = await writeOpenWorldTaskTextArtifact(root, taskId, ["reports", `${draft.id}.md`], renderOpenWorldVerifierQualityReport(draft));
  const report = OpenWorldVerifierQualityReportSchema.parse({
    ...draft,
    reportPath: path.relative(root, reportPath).replace(/\\/g, "/"),
    markdownPath: path.relative(root, markdownPath).replace(/\\/g, "/")
  });
  await writeOpenWorldTaskTextArtifact(root, taskId, ["reports", `${draft.id}.json`], `${JSON.stringify(report, null, 2)}\n`);
  return { schemaVersion: "openskill-kit.openworld-verifier-quality-result.v1", report, reportPath, markdownPath };
}

export function renderOpenWorldVerifierQualityReport(report: OpenWorldVerifierQualityReport): string {
  return [
    `# OpenWorld Verifier Quality ${report.id}`,
    "",
    `Status: ${report.status}`,
    `Proof level: ${report.proofLevel}`,
    `Hidden-oracle proof: ${report.hiddenOracleProof ? "yes" : "no"}`,
    "",
    "## Metrics",
    "",
    `- Cases: ${report.metrics.caseCount}`,
    `- Visible: ${report.metrics.visibleCount}`,
    `- Holdout: ${report.metrics.holdoutCount}`,
    `- Anchor coverage: ${formatPercent(report.metrics.anchorCoverage)}`,
    `- Source trust average: ${formatPercent(report.metrics.sourceTrustAverage)}`,
    `- Determinism score: ${formatPercent(report.metrics.determinismScore)}`,
    `- Traceability score: ${formatPercent(report.metrics.traceabilityScore)}`,
    `- Leakage audit present: ${report.metrics.leakageAuditPresent ? "yes" : "no"}`,
    "",
    "## Findings",
    "",
    ...(report.findings.length
      ? report.findings.map((finding) => `- [${finding.level}] ${finding.message} Recommendation: ${finding.recommendation}`)
      : ["No findings."]),
    "",
    "## Boundary",
    "",
    "- Quality reports validate verifier structure only.",
    "- They do not prove hidden-oracle benchmark success.",
    "- Promotion still requires review and memory-integrity gates.",
    ""
  ].join("\n");
}

async function readSuiteAnchors(root: string, taskId: string, anchorIds: string[]): Promise<AnchorCard[]> {
  const anchors: AnchorCard[] = [];
  for (const anchorId of anchorIds) {
    const file = path.join(root, ".openskill-kit", "openworld", "tasks", taskId, "anchors", `${anchorId}.json`);
    const text = await fs.readFile(file, "utf8").catch(() => undefined);
    if (!text) continue;
    anchors.push(AnchorCardSchema.parse(JSON.parse(text)));
  }
  return anchors;
}

async function readAnchorSources(root: string, taskId: string, anchors: AnchorCard[]): Promise<OpenWorldSource[]> {
  const sources = await Promise.all([...new Set(anchors.map((anchor) => anchor.sourceId))]
    .map((sourceId) => readOpenWorldSource(root, taskId, sourceId).catch(() => undefined)));
  return sources.filter((source): source is OpenWorldSource => Boolean(source));
}

function checkCase(taskId: string, testCase: VirtualTestCase, knownAnchorIds: Set<string>, findings: OpenWorldVerifierQualityFinding[]): void {
  if (testCase.status !== "ready") findings.push(finding("case-not-ready", "fail", `Case ${testCase.id} is ${testCase.status}.`, "Only ready verifier cases should run in refinement.", testCase.id));
  for (const anchorId of testCase.anchorIds) {
    if (!knownAnchorIds.has(anchorId)) findings.push(finding("missing-anchor", "fail", `Case ${testCase.id} references missing anchor ${anchorId}.`, "Fix anchor ids or regenerate suite.", testCase.id, anchorId));
  }
  if (!isDeterministicCase(testCase, taskId)) {
    findings.push(finding("case-not-deterministic", "fail", `Case ${testCase.id} is not deterministic/local enough.`, "Use generated local verifier files and allowed commands only.", testCase.id));
  }
  if (testCase.file && !testCase.file.replace(/\\/g, "/").startsWith(`.openskill-kit/openworld/tasks/${taskId}/verifiers/`)) {
    findings.push(finding("case-file-outside-openworld", "fail", `Case ${testCase.id} file is outside the task verifier directory.`, "Keep verifier files under the OpenWorld task verifier directory.", testCase.id));
  }
}

function isDeterministicCase(testCase: VirtualTestCase, taskId: string): boolean {
  if (testCase.runner === "manual") return false;
  if (testCase.runner === "node") {
    const [command, ...args] = testCase.command;
    if (!command || command !== "node") return false;
    if (args.some((arg) => /^https?:\/\//i.test(arg) || /\b(curl|wget)\b/i.test(arg))) return false;
    if (testCase.file && !testCase.file.replace(/\\/g, "/").startsWith(`.openskill-kit/openworld/tasks/${taskId}/verifiers/`)) return false;
  }
  return true;
}

function finding(
  id: string,
  level: "info" | "warn" | "fail",
  message: string,
  recommendation: string,
  caseId?: string,
  anchorId?: string
): OpenWorldVerifierQualityFinding {
  return { id, level, message, recommendation, caseId, anchorId };
}

function scoreTrust(source: OpenWorldSource): number {
  return round(source.trust.authority * 0.45 + source.trust.freshness * 0.25 + source.trust.independence * 0.3);
}

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : round(count / total);
}

function round(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
