import { promises as fs } from "node:fs";
import path from "node:path";
import type { LearnV2ConceptCard, LearnV2ConceptDriftReport, LearnV2ConflictLedger, LearnV2DeclassifiedEvidenceSnippetArtifact, LearnV2ReviewQueue } from "./schemas.js";
import { LearnV2ReviewQueueSchema } from "./schemas.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { learnV2SafeLocalPath } from "./utils.js";

export async function writeLearnV2ReviewQueue(
  rootInput: string,
  cards: LearnV2ConceptCard[],
  now: Date,
  context?: {
    ledger?: LearnV2ConflictLedger;
    markdownPath?: string;
    declassifiedSnippets?: LearnV2DeclassifiedEvidenceSnippetArtifact;
    conceptDrift?: { report: LearnV2ConceptDriftReport; artifactPath: string };
  }
): Promise<LearnV2ReviewQueue> {
  const root = path.resolve(rootInput);
  const reviewDir = path.join(root, ".openskill-kit", "learn-v2", "review");
  const markdown = path.join(reviewDir, "concept-review-queue.md");
  const json = path.join(reviewDir, "concept-review-queue.json");
  const conflictTypeCounts = context?.ledger ? countBy(context.ledger.conflicts.map((conflict) => conflict.conflictType)) : {};
  const evidenceSnippets = selectReviewEvidenceSnippets(cards, context?.declassifiedSnippets);
  const queue = LearnV2ReviewQueueSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.review-queue.v1",
    generatedAt: now.toISOString(),
    cards,
    behaviorDeltaFirst: true,
    safeBulkActions: ["accept-low-risk", "reject-one-off", "mark-superseded"],
    conflictSummary: {
      unresolvedCount: context?.ledger?.unresolvedCount ?? 0,
      conflictTypeCounts,
      ledgerPath: context?.markdownPath ? learnV2SafeLocalPath(context.markdownPath, root) : undefined
    },
    evidenceSnippetSummary: {
      snippetCount: context?.declassifiedSnippets?.counts.total ?? 0,
      blockedFromCompileCount: context?.declassifiedSnippets?.counts.blockedFromCompile ?? 0,
      residualRiskCounts: context?.declassifiedSnippets?.counts.residualRiskCounts ?? {},
      artifactPath: context?.declassifiedSnippets?.artifacts.markdown ? learnV2SafeLocalPath(context.declassifiedSnippets.artifacts.markdown, root) : undefined
    },
    evidenceSnippets,
    driftSummary: {
      healthScore: context?.conceptDrift?.report.healthScore ?? 1,
      staleCandidateCount: context?.conceptDrift?.report.staleCandidates.length ?? 0,
      reasonCounts: context?.conceptDrift ? countBy(context.conceptDrift.report.staleCandidates.map((candidate) => candidate.reason)) : {},
      reportPath: context?.conceptDrift ? learnV2SafeLocalPath(context.conceptDrift.artifactPath, root) : undefined
    },
    artifacts: {
      markdown,
      conflictLedger: context?.markdownPath,
      declassifiedSnippets: context?.declassifiedSnippets?.artifacts.markdown,
      conceptDrift: context?.conceptDrift?.artifactPath
    }
  });
  await fs.mkdir(reviewDir, { recursive: true });
  await writeJsonAtomic(json, queue);
  await fs.writeFile(markdown, renderLearnV2ReviewQueue(queue), "utf8");
  return queue;
}

export function renderLearnV2ReviewQueue(queue: LearnV2ReviewQueue): string {
  const lines = [
    "# Learn v2 Concept Review Queue",
    "",
    `Generated: ${queue.generatedAt}`,
    `Cards: ${queue.cards.length}`,
    `Behavior delta first: ${queue.behaviorDeltaFirst}`,
    `Unresolved conflicts: ${queue.conflictSummary.unresolvedCount}`,
    "",
    "## Safe Bulk Actions",
    "",
    ...queue.safeBulkActions.map((action) => `- ${action}`),
    "",
    "## Conflict Summary",
    "",
    queue.conflictSummary.unresolvedCount
      ? `Ledger: ${queue.conflictSummary.ledgerPath ?? "not written"}`
      : "No unresolved concept conflicts detected.",
    ...Object.entries(queue.conflictSummary.conflictTypeCounts).map(([type, count]) => `- ${type}: ${count}`),
    "",
    "## Evidence Snippet Summary",
    "",
    `Snippets: ${queue.evidenceSnippetSummary.snippetCount}`,
    `Blocked from compile: ${queue.evidenceSnippetSummary.blockedFromCompileCount}`,
    `Residual risk: ${renderCounts(queue.evidenceSnippetSummary.residualRiskCounts)}`,
    queue.evidenceSnippetSummary.artifactPath ? `Artifact: ${queue.evidenceSnippetSummary.artifactPath}` : "Artifact: not written",
    "",
    "## Drift Summary",
    "",
    `Health: ${queue.driftSummary.healthScore.toFixed(2)}`,
    `Stale candidates: ${queue.driftSummary.staleCandidateCount}`,
    `Reasons: ${renderCounts(queue.driftSummary.reasonCounts)}`,
    queue.driftSummary.reportPath ? `Report: ${queue.driftSummary.reportPath}` : "Report: not written",
    "",
    "## Cards",
    ""
  ];
  for (const card of queue.cards) {
    lines.push(`### ${card.title}`);
    lines.push("");
    lines.push(`Status: ${card.status}`);
    lines.push(`Delta: ${card.behaviorDelta}`);
    lines.push(`Behavior: ${card.canonicalBehavior}`);
    lines.push(`Confidence: ${card.confidence.toFixed(2)} Durability: ${card.durability.toFixed(2)} Reliability: ${card.sourceReliability.toFixed(2)} Risk: ${card.risk}`);
    if (card.scope.paths.length) lines.push(`Scope paths: ${card.scope.paths.join(", ")}`);
    if (card.scope.taskTypes.length) lines.push(`Task types: ${card.scope.taskTypes.join(", ")}`);
    if (card.activation.phrases.length) lines.push(`Activation: ${card.activation.phrases.join(", ")}`);
    if (card.activation.commands.length) lines.push(`Commands: ${card.activation.commands.join(", ")}`);
    lines.push(`Evidence: ${card.evidenceIds.join(", ")}`);
    lines.push("Raw refs: local-only, not exportable");
    const snippets = queue.evidenceSnippets.filter((snippet) => card.evidenceIds.includes(snippet.evidenceId)).slice(0, 3);
    if (snippets.length) {
      lines.push("Evidence snippets:");
      for (const snippet of snippets) {
        lines.push(`- ${snippet.evidenceId} (${snippet.residualRisk}${snippet.blockedFromCompile ? ", compile-blocked" : ""}): ${snippet.text}`);
      }
    }
    if (card.counterevidence.length) {
      lines.push("Counterevidence:");
      for (const item of card.counterevidence) lines.push(`- ${item.evidenceId}: ${item.reason}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function selectReviewEvidenceSnippets(cards: LearnV2ConceptCard[], artifact?: LearnV2DeclassifiedEvidenceSnippetArtifact): LearnV2ReviewQueue["evidenceSnippets"] {
  if (!artifact) return [];
  const evidenceIds = new Set(cards.flatMap((card) => card.evidenceIds));
  return artifact.snippets
    .filter((snippet) => evidenceIds.has(snippet.evidenceId))
    .slice(0, 80)
    .map((snippet) => ({
      snippetId: snippet.id,
      evidenceId: snippet.evidenceId,
      text: snippet.text,
      residualRisk: snippet.risk.residualRisk,
      blockedFromCompile: snippet.risk.blockedFromCompile
    }));
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
