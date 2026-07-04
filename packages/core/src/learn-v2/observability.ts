import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "../storage/atomic.js";
import type { LearnV2ConceptCard, LearnV2ConceptDriftReport, LearnV2ConflictLedger, LearnV2DeclassifiedEvidenceSnippetArtifact, LearnV2EvalReport, LearnV2EvidenceQualityScore, LearnV2ReviewQueue, LearnV2TaskEpisode } from "./schemas.js";
import { learnV2SafeLocalPath } from "./utils.js";

export const LearnV2PipelineObservabilityReportSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.pipeline-observability.v1"),
  generatedAt: z.string().datetime(),
  run: z.object({
    previewOnly: z.boolean(),
    modelMode: z.string(),
    eventsAppended: z.number().int().min(0),
    modelRequestCount: z.number().int().min(0)
  }),
  sources: z.object({
    considered: z.number().int().min(0),
    included: z.number().int().min(0),
    reviewNeeded: z.number().int().min(0),
    excluded: z.number().int().min(0),
    totalBytes: z.number().int().min(0),
    redactedSources: z.number().int().min(0),
    adapterCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    adapterMatchedByCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    adapterDetectionConfidenceCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    contentKindCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    normalizationProfileCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    sensitivityCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    modelBoundaryCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    explicitOnlySources: z.number().int().min(0).default(0),
    rawLocalFileSources: z.number().int().min(0).default(0),
    declassifiedOnlyModelSources: z.number().int().min(0).default(0)
  }),
  evidence: z.object({
    normalizedEvidence: z.number().int().min(0),
    episodes: z.number().int().min(0),
    phaseCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    outcomeCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    stitchingMethodCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    stitchingRiskCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    confidenceBuckets: z.object({
      high: z.number().int().min(0),
      medium: z.number().int().min(0),
      low: z.number().int().min(0)
    }),
    qualityTierCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    qualityActionCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    qualitySignalCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    declassifiedSnippets: z.number().int().min(0),
    blockedDeclassifiedSnippets: z.number().int().min(0),
    snippetResidualRiskCounts: z.record(z.string(), z.number().int().min(0)).default({})
  }),
  compression: z.object({
    tools: z.number().int().min(0),
    toolStatusCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    toolCompressionStrategyCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    totalToolOmittedBytes: z.number().int().min(0),
    patches: z.number().int().min(0),
    behaviorEligiblePatches: z.number().int().min(0),
    auditOnlyPatches: z.number().int().min(0),
    patchFilterReasonCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    structuralClassCounts: z.record(z.string(), z.number().int().min(0)).default({})
  }),
  concepts: z.object({
    cards: z.number().int().min(0),
    statusCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    riskCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    counterevidenceItems: z.number().int().min(0),
    reviewReadyCards: z.number().int().min(0),
    reviewFocusCards: z.number().int().min(0).default(0),
    reviewAppendixCards: z.number().int().min(0).default(0),
    unresolvedConflicts: z.number().int().min(0),
    conflictTypeCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    driftHealthScore: z.number().min(0).max(1),
    staleDriftCandidates: z.number().int().min(0),
    driftReasonCounts: z.record(z.string(), z.number().int().min(0)).default({})
  }),
  qualityGates: z.object({
    evalStatus: z.enum(["pass", "fail"]),
    leakStatus: z.enum(["pass", "fail"]),
    behaviorDeltaStatus: z.enum(["pass", "fail", "not-configured"]).default("not-configured"),
    behaviorDeltaScenarios: z.number().int().min(0).default(0),
    activationReplayRate: z.number().min(0).max(1).default(1),
    counterfactualTraceRate: z.number().min(0).max(1).default(1),
    reviewCards: z.number().int().min(0),
    safeBulkActions: z.array(z.string()).default([])
  }),
  health: z.object({
    status: z.enum(["pass", "warn", "fail"]),
    score: z.number().min(0).max(1),
    blockers: z.array(z.string()).default([]),
    warnings: z.array(z.string()).default([]),
    reviewFocus: z.array(z.string()).default([])
  }).default({
    status: "pass",
    score: 1,
    blockers: [],
    warnings: [],
    reviewFocus: []
  }),
  artifacts: z.record(z.string(), z.string()).default({}),
  privacy: z.object({
    rawRefsExported: z.literal(false),
    rawSourcePathsExported: z.literal(false),
    localPathsRedacted: z.literal(true),
    notes: z.array(z.string()).default([])
  }),
  nextActions: z.array(z.string()).default([]),
  artifactsWritten: z.object({
    json: z.string(),
    markdown: z.string()
  })
});
export type LearnV2PipelineObservabilityReport = z.infer<typeof LearnV2PipelineObservabilityReportSchema>;

export interface LearnV2PipelineObservabilityInput {
  generatedAt: string;
  previewOnly: boolean;
  modelMode: string;
  sources: Array<{
    byteCount: number;
    projectRelevance: { decision: "include" | "ask" | "exclude" };
    deidentification: { redacted: boolean };
    turnCount: number;
    learnV2?: {
      adapterId?: string;
      adapterDetection?: {
        matchedBy?: string;
        confidence?: string;
      };
      contentKind?: string;
      normalizationProfile?: string;
      surfacePolicy?: {
        selection?: string;
        read?: string;
        modelBoundary?: string;
        sensitivity?: string;
      };
    };
  }>;
  episodes: LearnV2TaskEpisode[];
  concepts: LearnV2ConceptCard[];
  conflictLedger?: LearnV2ConflictLedger;
  conceptDrift?: LearnV2ConceptDriftReport;
  declassifiedSnippets?: LearnV2DeclassifiedEvidenceSnippetArtifact;
  reviewQueue: LearnV2ReviewQueue;
  evalReport: LearnV2EvalReport;
  evidenceQualityScores?: LearnV2EvidenceQualityScore[];
  eventsAppended: number;
  modelRequestCount: number;
  artifacts: Record<string, string | undefined>;
  nextActions: string[];
}

export async function readLearnV2PipelineObservabilityReport(rootInput: string, reportPathInput?: string): Promise<LearnV2PipelineObservabilityReport> {
  const root = path.resolve(rootInput);
  const file = reportPathInput ? path.resolve(root, reportPathInput) : await latestLearnV2PipelineObservabilityReportPath(root);
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  return LearnV2PipelineObservabilityReportSchema.parse(parsed);
}

export async function latestLearnV2PipelineObservabilityReportPath(rootInput: string): Promise<string> {
  const root = path.resolve(rootInput);
  const dir = path.join(root, ".openskill-kit", "learn-v2", "observability");
  const files = (await fs.readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && /^pipeline-\d+\.json$/.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
  const latest = files.at(-1);
  if (!latest) throw new Error(`No Learn v2 observability report found under ${learnV2SafeLocalPath(dir, root)}. Run /osk learn --raw first.`);
  return latest;
}

export async function writeLearnV2PipelineObservabilityReport(
  rootInput: string,
  input: LearnV2PipelineObservabilityInput
): Promise<LearnV2PipelineObservabilityReport> {
  const root = path.resolve(rootInput);
  const stamp = input.generatedAt.replace(/[^0-9]/g, "").slice(0, 14);
  const dir = path.join(root, ".openskill-kit", "learn-v2", "observability");
  const json = path.join(dir, `pipeline-${stamp}.json`);
  const markdown = path.join(dir, `pipeline-${stamp}.md`);
  const tools = input.episodes.flatMap((episode) => episode.toolSummaries);
  const patches = input.episodes.flatMap((episode) => episode.patchComparisons);
  const auditOnlyPatches = patches.filter((patch) => patch.behaviorEligible === false);
  const evidenceQualityScores = input.evidenceQualityScores ?? [];
  const conflictLedger = input.conflictLedger;
  const conceptDrift = input.conceptDrift;
  const declassifiedSnippets = input.declassifiedSnippets;
  const health = buildPipelineHealth(input, {
    auditOnlyPatches,
    conflictLedger,
    conceptDrift,
    declassifiedSnippets
  });
  const report = LearnV2PipelineObservabilityReportSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.pipeline-observability.v1",
    generatedAt: input.generatedAt,
    run: {
      previewOnly: input.previewOnly,
      modelMode: input.modelMode,
      eventsAppended: input.eventsAppended,
      modelRequestCount: input.modelRequestCount
    },
    sources: {
      considered: input.sources.length,
      included: input.sources.filter((source) => source.projectRelevance.decision === "include").length,
      reviewNeeded: input.sources.filter((source) => source.projectRelevance.decision === "ask").length,
      excluded: input.sources.filter((source) => source.projectRelevance.decision === "exclude").length,
      totalBytes: input.sources.reduce((sum, source) => sum + source.byteCount, 0),
      redactedSources: input.sources.filter((source) => source.deidentification.redacted).length,
      adapterCounts: countBy(input.sources.map((source) => source.learnV2?.adapterId ?? "unknown")),
      adapterMatchedByCounts: countBy(input.sources.map((source) => source.learnV2?.adapterDetection?.matchedBy ?? "unknown")),
      adapterDetectionConfidenceCounts: countBy(input.sources.map((source) => source.learnV2?.adapterDetection?.confidence ?? "unknown")),
      contentKindCounts: countBy(input.sources.map((source) => source.learnV2?.contentKind ?? "unknown")),
      normalizationProfileCounts: countBy(input.sources.map((source) => source.learnV2?.normalizationProfile ?? "unknown")),
      sensitivityCounts: countBy(input.sources.map((source) => source.learnV2?.surfacePolicy?.sensitivity ?? "unknown")),
      modelBoundaryCounts: countBy(input.sources.map((source) => source.learnV2?.surfacePolicy?.modelBoundary ?? "unknown")),
      explicitOnlySources: input.sources.filter((source) => source.learnV2?.surfacePolicy?.selection === "explicit-only").length,
      rawLocalFileSources: input.sources.filter((source) => source.learnV2?.surfacePolicy?.read === "raw-local-file").length,
      declassifiedOnlyModelSources: input.sources.filter((source) => source.learnV2?.surfacePolicy?.modelBoundary === "declassified-only").length
    },
    evidence: {
      normalizedEvidence: input.sources.reduce((sum, source) => sum + source.turnCount, 0),
      episodes: input.episodes.length,
      phaseCounts: countBy(input.episodes.flatMap((episode) => episode.phases.map((phase) => phase.phase))),
      outcomeCounts: countBy(input.episodes.map((episode) => episode.outcome)),
      stitchingMethodCounts: countBy(input.episodes.map((episode) => episode.stitching.method)),
      stitchingRiskCounts: countBy(input.episodes.flatMap((episode) => episode.episodeConfidenceBreakdown?.risks ?? [])),
      confidenceBuckets: {
        high: input.episodes.filter((episode) => episode.episodeConfidence >= 0.75).length,
        medium: input.episodes.filter((episode) => episode.episodeConfidence >= 0.5 && episode.episodeConfidence < 0.75).length,
        low: input.episodes.filter((episode) => episode.episodeConfidence < 0.5).length
      },
      qualityTierCounts: countBy(evidenceQualityScores.map((score) => score.tier)),
      qualityActionCounts: countBy(evidenceQualityScores.map((score) => score.recommendedAction)),
      qualitySignalCounts: countBy(evidenceQualityScores.flatMap((score) => score.signals)),
      declassifiedSnippets: declassifiedSnippets?.counts.total ?? input.reviewQueue.evidenceSnippetSummary.snippetCount,
      blockedDeclassifiedSnippets: declassifiedSnippets?.counts.blockedFromCompile ?? input.reviewQueue.evidenceSnippetSummary.blockedFromCompileCount,
      snippetResidualRiskCounts: declassifiedSnippets?.counts.residualRiskCounts ?? input.reviewQueue.evidenceSnippetSummary.residualRiskCounts
    },
    compression: {
      tools: tools.length,
      toolStatusCounts: countBy(tools.map((tool) => tool.status)),
      toolCompressionStrategyCounts: countBy(tools.map((tool) => tool.outputCompression.strategy)),
      totalToolOmittedBytes: tools.reduce((sum, tool) => sum + tool.outputCompression.omittedBytes, 0),
      patches: patches.length,
      behaviorEligiblePatches: patches.length - auditOnlyPatches.length,
      auditOnlyPatches: auditOnlyPatches.length,
      patchFilterReasonCounts: countBy(patches.flatMap((patch) => patch.filterReasons ?? [])),
      structuralClassCounts: countBy(patches.flatMap((patch) => patch.structuralClasses))
    },
    concepts: {
      cards: input.concepts.length,
      statusCounts: countBy(input.concepts.map((concept) => concept.status)),
      riskCounts: countBy(input.concepts.map((concept) => concept.risk)),
      counterevidenceItems: input.concepts.reduce((sum, concept) => sum + concept.counterevidence.length, 0),
      reviewReadyCards: input.concepts.filter((concept) => concept.evidenceIds.length && concept.confidence >= 0.55).length,
      reviewFocusCards: input.reviewQueue.reviewFocus.focusCardIds.length,
      reviewAppendixCards: input.reviewQueue.reviewFocus.omittedCardCount,
      unresolvedConflicts: conflictLedger?.unresolvedCount ?? input.reviewQueue.conflictSummary.unresolvedCount,
      conflictTypeCounts: countBy((conflictLedger?.conflicts ?? []).map((conflict) => conflict.conflictType)),
      driftHealthScore: conceptDrift?.healthScore ?? input.reviewQueue.driftSummary.healthScore,
      staleDriftCandidates: conceptDrift?.staleCandidates.length ?? input.reviewQueue.driftSummary.staleCandidateCount,
      driftReasonCounts: conceptDrift ? countBy(conceptDrift.staleCandidates.map((candidate) => candidate.reason)) : input.reviewQueue.driftSummary.reasonCounts
    },
    qualityGates: {
      evalStatus: input.evalReport.status,
      leakStatus: input.evalReport.leakCheck.status,
      behaviorDeltaStatus: input.evalReport.summary.behaviorDelta.status,
      behaviorDeltaScenarios: input.evalReport.summary.behaviorDelta.scenarioCount,
      activationReplayRate: input.evalReport.summary.activationReplay.retrievalRate,
      counterfactualTraceRate: input.evalReport.summary.counterfactualTrace.activationRate,
      reviewCards: input.reviewQueue.cards.length,
      safeBulkActions: input.reviewQueue.safeBulkActions
    },
    health,
    artifacts: Object.fromEntries(Object.entries(input.artifacts)
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(([key, value]) => [key, learnV2SafeLocalPath(value, root)])),
    privacy: {
      rawRefsExported: false,
      rawSourcePathsExported: false,
      localPathsRedacted: true,
      notes: [
        "Report contains counts, safe artifact pointers, and declassified status only.",
        "Raw evidence refs, raw source paths, raw prompts, raw diffs, and secret-like values are intentionally omitted."
      ]
    },
    nextActions: input.nextActions,
    artifactsWritten: {
      json: learnV2SafeLocalPath(json, root),
      markdown: learnV2SafeLocalPath(markdown, root)
    }
  });
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(json, report);
  await fs.writeFile(markdown, renderPipelineObservabilityReport(report), "utf8");
  return report;
}

function renderPipelineObservabilityReport(report: LearnV2PipelineObservabilityReport): string {
  return [
    "# Learn v2 Pipeline Observability",
    "",
    `Generated: ${report.generatedAt}`,
    `Preview only: ${report.run.previewOnly}`,
    `Model mode: ${report.run.modelMode}`,
    "",
    "## Source Intake",
    "",
    `- Sources: ${report.sources.included} included, ${report.sources.reviewNeeded} review-needed, ${report.sources.excluded} excluded / ${report.sources.considered} considered`,
    `- Total bytes: ${report.sources.totalBytes}`,
    `- Redacted sources: ${report.sources.redactedSources}`,
    `- Adapters: ${renderCounts(report.sources.adapterCounts)}`,
    `- Adapter detection: by=${renderCounts(report.sources.adapterMatchedByCounts)}, confidence=${renderCounts(report.sources.adapterDetectionConfidenceCounts)}`,
    `- Content kinds: ${renderCounts(report.sources.contentKindCounts)}`,
    `- Normalization profiles: ${renderCounts(report.sources.normalizationProfileCounts)}`,
    `- Source policy: explicit-only=${report.sources.explicitOnlySources}, raw-local-file=${report.sources.rawLocalFileSources}, declassified-only-model=${report.sources.declassifiedOnlyModelSources}`,
    `- Sensitivity: ${renderCounts(report.sources.sensitivityCounts)}`,
    `- Model boundary: ${renderCounts(report.sources.modelBoundaryCounts)}`,
    "",
    "## Evidence Reconstruction",
    "",
    `- Normalized evidence records: ${report.evidence.normalizedEvidence}`,
    `- Episodes: ${report.evidence.episodes}`,
    `- Outcomes: ${renderCounts(report.evidence.outcomeCounts)}`,
    `- Stitching: ${renderCounts(report.evidence.stitchingMethodCounts)}`,
    `- Confidence buckets: high=${report.evidence.confidenceBuckets.high}, medium=${report.evidence.confidenceBuckets.medium}, low=${report.evidence.confidenceBuckets.low}`,
    `- Evidence quality: ${renderCounts(report.evidence.qualityTierCounts)}`,
    `- Quality actions: ${renderCounts(report.evidence.qualityActionCounts)}`,
    `- Declassified snippets: ${report.evidence.declassifiedSnippets} (${renderCounts(report.evidence.snippetResidualRiskCounts)} residual risk, ${report.evidence.blockedDeclassifiedSnippets} compile-blocked)`,
    "",
    "## Compression And Filtering",
    "",
    `- Tool summaries: ${report.compression.tools}`,
    `- Tool compression: ${renderCounts(report.compression.toolCompressionStrategyCounts)}`,
    `- Omitted tool bytes: ${report.compression.totalToolOmittedBytes}`,
    `- Patches: ${report.compression.behaviorEligiblePatches} behavior-eligible, ${report.compression.auditOnlyPatches} audit-only / ${report.compression.patches} total`,
    `- Patch filters: ${renderCounts(report.compression.patchFilterReasonCounts)}`,
    `- Structural classes: ${renderCounts(report.compression.structuralClassCounts)}`,
    "",
    "## Concepts And Gates",
    "",
    `- Concept cards: ${report.concepts.cards}`,
    `- Status: ${renderCounts(report.concepts.statusCounts)}`,
    `- Risk: ${renderCounts(report.concepts.riskCounts)}`,
    `- Review-ready cards: ${report.concepts.reviewReadyCards}`,
    `- Review focus: ${report.concepts.reviewFocusCards} focus, ${report.concepts.reviewAppendixCards} appendix`,
    `- Unresolved conflicts: ${report.concepts.unresolvedConflicts}`,
    `- Conflict types: ${renderCounts(report.concepts.conflictTypeCounts)}`,
    `- Drift health: ${report.concepts.driftHealthScore.toFixed(2)} (${report.concepts.staleDriftCandidates} stale, ${renderCounts(report.concepts.driftReasonCounts)})`,
    `- Eval: ${report.qualityGates.evalStatus}`,
    `- Leak check: ${report.qualityGates.leakStatus}`,
    `- Behavior delta: ${report.qualityGates.behaviorDeltaStatus} (${report.qualityGates.behaviorDeltaScenarios} scenarios)`,
    `- Activation replay rate: ${report.qualityGates.activationReplayRate}`,
    `- Counterfactual trace rate: ${report.qualityGates.counterfactualTraceRate}`,
    "",
    "## Health",
    "",
    `- Status: ${report.health.status}`,
    `- Score: ${report.health.score.toFixed(2)}`,
    `- Blockers: ${report.health.blockers.length ? report.health.blockers.join("; ") : "none"}`,
    `- Warnings: ${report.health.warnings.length ? report.health.warnings.join("; ") : "none"}`,
    `- Review focus: ${report.health.reviewFocus.length ? report.health.reviewFocus.join("; ") : "none"}`,
    "",
    "## Artifacts",
    "",
    ...Object.entries(report.artifacts).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Privacy",
    "",
    ...report.privacy.notes.map((note) => `- ${note}`),
    "",
    "## Next Actions",
    "",
    ...report.nextActions.map((action) => `- ${action}`)
  ].join("\n") + "\n";
}

function buildPipelineHealth(
  input: LearnV2PipelineObservabilityInput,
  context: {
    auditOnlyPatches: LearnV2TaskEpisode["patchComparisons"];
    conflictLedger?: LearnV2ConflictLedger;
    conceptDrift?: LearnV2ConceptDriftReport;
    declassifiedSnippets?: LearnV2DeclassifiedEvidenceSnippetArtifact;
  }
): LearnV2PipelineObservabilityReport["health"] {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const reviewFocus: string[] = [];
  if (input.evalReport.status === "fail") blockers.push("Learn v2 eval failed.");
  if (input.evalReport.leakCheck.status === "fail") blockers.push("Leak check failed.");
  if (input.evalReport.summary.behaviorDelta.status === "not-configured") warnings.push("No behavior-delta eval goldens configured.");
  if (input.evalReport.summary.activationReplay.status === "fail") reviewFocus.push("Fix activation replay misses.");
  if (input.evalReport.summary.counterfactualTrace.status === "fail") reviewFocus.push("Fix counterfactual trace misses.");
  const blockedSnippets = context.declassifiedSnippets?.counts.blockedFromCompile ?? input.reviewQueue.evidenceSnippetSummary.blockedFromCompileCount;
  if (blockedSnippets > 0) blockers.push(`${blockedSnippets} declassified snippet(s) are compile-blocked.`);
  const unresolvedConflicts = context.conflictLedger?.unresolvedCount ?? input.reviewQueue.conflictSummary.unresolvedCount;
  if (unresolvedConflicts > 0) {
    warnings.push(`${unresolvedConflicts} unresolved concept conflict(s).`);
    reviewFocus.push("Resolve concept conflicts before activation.");
  }
  const staleCandidates = context.conceptDrift?.staleCandidates.length ?? input.reviewQueue.driftSummary.staleCandidateCount;
  const driftHealth = context.conceptDrift?.healthScore ?? input.reviewQueue.driftSummary.healthScore;
  if (staleCandidates > 0 || driftHealth < 0.75) {
    warnings.push(`${staleCandidates} stale drift candidate(s); drift health ${driftHealth.toFixed(2)}.`);
    reviewFocus.push("Review stale or negatively reinforced concepts.");
  }
  const lowConfidenceEpisodes = input.episodes.filter((episode) => episode.episodeConfidence < 0.5).length;
  if (lowConfidenceEpisodes > 0) warnings.push(`${lowConfidenceEpisodes} low-confidence reconstructed episode(s).`);
  if (input.reviewQueue.reviewFocus.focusCardIds.length > 0) reviewFocus.push(`Review ${input.reviewQueue.reviewFocus.focusCardIds.length} focus card(s).`);
  if (input.sources.some((source) => source.projectRelevance.decision === "ask")) warnings.push("Some sources need relevance review.");
  if (context.auditOnlyPatches.length > 0) warnings.push(`${context.auditOnlyPatches.length} audit-only patch summary item(s).`);
  const penalty = Math.min(1, blockers.length * 0.35 + warnings.length * 0.08);
  const score = Number(Math.max(0, 1 - penalty).toFixed(2));
  return {
    status: blockers.length ? "fail" : warnings.length ? "warn" : "pass",
    score,
    blockers,
    warnings,
    reviewFocus: [...new Set(reviewFocus)].slice(0, 8)
  };
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function renderCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "none";
}
