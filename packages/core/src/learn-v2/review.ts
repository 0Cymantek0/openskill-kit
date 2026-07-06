import { promises as fs } from "node:fs";
import path from "node:path";
import type { LearnV2ConceptCard, LearnV2ConceptDriftReport, LearnV2ConflictLedger, LearnV2CounterevidenceLedger, LearnV2DeclassifiedEvidenceSnippetArtifact, LearnV2ReviewQueue } from "./schemas.js";
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
    counterevidenceLedger?: { ledger: LearnV2CounterevidenceLedger; markdownPath: string };
    conceptDrift?: { report: LearnV2ConceptDriftReport; artifactPath: string };
  }
): Promise<LearnV2ReviewQueue> {
  const root = path.resolve(rootInput);
  const reviewDir = path.join(root, ".openskill-kit", "learn-v2", "review");
  const markdown = path.join(reviewDir, "concept-review-queue.md");
  const json = path.join(reviewDir, "concept-review-queue.json");
  const conflictTypeCounts = context?.ledger ? countBy(context.ledger.conflicts.map((conflict) => conflict.conflictType)) : {};
  const evidenceSnippets = selectReviewEvidenceSnippets(cards, context?.declassifiedSnippets);
  const reviewFocus = selectReviewFocus(cards, context);
  const queue = LearnV2ReviewQueueSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.review-queue.v1",
    generatedAt: now.toISOString(),
    cards,
    behaviorDeltaFirst: true,
    reviewFocus,
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
    counterevidenceSummary: {
      itemCount: context?.counterevidenceLedger?.ledger.totalItems ?? cards.reduce((sum, card) => sum + card.counterevidence.length, 0),
      conceptCount: context?.counterevidenceLedger?.ledger.conceptCount ?? cards.filter((card) => card.counterevidence.length).length,
      activationBlockingCount: context?.counterevidenceLedger?.ledger.activationBlockingCount ?? cards
        .filter((card) => card.status !== "rejected" && card.status !== "superseded" && card.status !== "one-off")
        .reduce((sum, card) => sum + card.counterevidence.length, 0),
      reasonCounts: context?.counterevidenceLedger?.ledger.reasonCounts ?? {},
      artifactPath: context?.counterevidenceLedger?.markdownPath ? learnV2SafeLocalPath(context.counterevidenceLedger.markdownPath, root) : undefined
    },
    driftSummary: {
      healthScore: context?.conceptDrift?.report.healthScore ?? 1,
      staleCandidateCount: context?.conceptDrift?.report.staleCandidates.length ?? 0,
      reasonCounts: context?.conceptDrift ? countBy(context.conceptDrift.report.staleCandidates.map((candidate) => candidate.reason)) : {},
      staleCandidates: (context?.conceptDrift?.report.staleCandidates ?? []).slice(0, 50),
      reportPath: context?.conceptDrift ? learnV2SafeLocalPath(context.conceptDrift.artifactPath, root) : undefined
    },
    artifacts: {
      markdown,
      conflictLedger: context?.markdownPath,
      declassifiedSnippets: context?.declassifiedSnippets?.artifacts.markdown,
      counterevidenceLedger: context?.counterevidenceLedger?.markdownPath,
      conceptDrift: context?.conceptDrift?.artifactPath
    }
  });
  await fs.mkdir(reviewDir, { recursive: true });
  await writeJsonAtomic(json, queue);
  await fs.writeFile(markdown, renderLearnV2ReviewQueue(queue), "utf8");
  return queue;
}

export async function readLearnV2ReviewQueue(rootInput: string): Promise<LearnV2ReviewQueue> {
  const root = path.resolve(rootInput);
  const json = path.join(root, ".openskill-kit", "learn-v2", "review", "concept-review-queue.json");
  const text = await fs.readFile(json, "utf8").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Learn v2 review queue not found. Run raw learning, concept extraction, or model-output apply first: ${message}`);
  });
  return LearnV2ReviewQueueSchema.parse(JSON.parse(text));
}

export function renderLearnV2ReviewQueue(queue: LearnV2ReviewQueue): string {
  const lines = [
    "# Learn v2 Concept Review Queue",
    "",
    `Generated: ${queue.generatedAt}`,
    `Cards: ${queue.cards.length}`,
    `Focus cards: ${queue.reviewFocus.focusCardIds.length}`,
    `Appendix cards: ${queue.reviewFocus.omittedCardCount}`,
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
    "## Counterevidence Summary",
    "",
    `Items: ${queue.counterevidenceSummary.itemCount}`,
    `Concepts: ${queue.counterevidenceSummary.conceptCount}`,
    `Activation-blocking items: ${queue.counterevidenceSummary.activationBlockingCount}`,
    `Reasons: ${renderCounts(queue.counterevidenceSummary.reasonCounts)}`,
    queue.counterevidenceSummary.artifactPath ? `Counterevidence ledger: ${queue.counterevidenceSummary.artifactPath}` : "Counterevidence ledger: not written",
    "",
    "## Drift Summary",
    "",
    `Health: ${queue.driftSummary.healthScore.toFixed(2)}`,
    `Stale candidates: ${queue.driftSummary.staleCandidateCount}`,
    `Reasons: ${renderCounts(queue.driftSummary.reasonCounts)}`,
    queue.driftSummary.reportPath ? `Report: ${queue.driftSummary.reportPath}` : "Report: not written",
    ...queue.driftSummary.staleCandidates.slice(0, 12).map((candidate) =>
      `- ${candidate.conceptId}: ${candidate.reason}; negative=${candidate.negativeOutcomeCount}; activations=${candidate.activationCount}; ageDays=${candidate.ageDays}; suggestion=${candidate.suggestion}`
    ),
    "",
    "## Focus Cards",
    ""
  ];
  const focusIds = new Set(queue.reviewFocus.focusCardIds);
  const focusCards = queue.cards.filter((card) => focusIds.has(card.id));
  const appendixCards = queue.cards.filter((card) => !focusIds.has(card.id));
  const driftByConcept = new Map(queue.driftSummary.staleCandidates.map((candidate) => [candidate.conceptId, candidate]));
  for (const card of focusCards) {
    lines.push(`### ${card.title}`);
    lines.push("");
    const reasons = queue.reviewFocus.reasons[card.id] ?? [];
    if (reasons.length) lines.push(`Focus reasons: ${reasons.join(", ")}`);
    lines.push(`Status: ${card.status}`);
    lines.push(`Delta: ${card.behaviorDelta}`);
    lines.push(`Behavior: ${card.canonicalBehavior}`);
    lines.push(`Confidence: ${card.confidence.toFixed(2)} Durability: ${card.durability.toFixed(2)} Reliability: ${card.sourceReliability.toFixed(2)} Risk: ${card.risk}`);
    if (card.scope.reviewLocked) lines.push(`Scope lock: reviewer-narrowed${card.scope.reviewedAt ? ` at ${card.scope.reviewedAt}` : ""}`);
    if (card.scope.paths.length) lines.push(`Scope paths: ${card.scope.paths.join(", ")}`);
    if (card.scope.taskTypes.length) lines.push(`Task types: ${card.scope.taskTypes.join(", ")}`);
    if (card.conditions?.appliesWhen.length) lines.push(`Applies when: ${card.conditions.appliesWhen.join("; ")}`);
    if (card.conditions?.doesNotApplyWhen.length) lines.push(`Does not apply when: ${card.conditions.doesNotApplyWhen.join("; ")}`);
    if (card.scope.negativeTriggers.length) lines.push(`Negative triggers: ${card.scope.negativeTriggers.join(", ")}`);
    if (card.activation.phrases.length) lines.push(`Activation: ${card.activation.phrases.join(", ")}`);
    if (card.activation.commands.length) lines.push(`Commands: ${card.activation.commands.join(", ")}`);
    lines.push(`Evidence: ${card.evidenceIds.join(", ")}`);
    lines.push("Raw refs: local-only, not exportable");
    const drift = driftByConcept.get(card.id);
    if (drift) {
      lines.push(`Drift: ${drift.reason}; negative=${drift.negativeOutcomeCount}; activations=${drift.activationCount}; ageDays=${drift.ageDays}${drift.lastOutcomeDays !== undefined ? `; lastOutcomeDays=${drift.lastOutcomeDays}` : ""}`);
      lines.push(`Drift suggestion: ${drift.suggestion}`);
    }
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
  if (appendixCards.length) {
    lines.push("## Full Store Appendix");
    lines.push("");
    lines.push("Cards below are present in the merged concept store but are not the primary review focus for this run.");
    lines.push("");
    for (const card of appendixCards) {
      lines.push(`- ${card.id}: ${card.title} (${card.status}, confidence=${card.confidence.toFixed(2)}, risk=${card.risk})`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function selectReviewFocus(
  cards: LearnV2ConceptCard[],
  context?: {
    ledger?: LearnV2ConflictLedger;
    conceptDrift?: { report: LearnV2ConceptDriftReport; artifactPath: string };
  }
): LearnV2ReviewQueue["reviewFocus"] {
  const reasons = new Map<string, Set<string>>();
  const add = (id: string, reason: string): void => {
    if (!cards.some((card) => card.id === id)) return;
    const current = reasons.get(id) ?? new Set<string>();
    current.add(reason);
    reasons.set(id, current);
  };
  for (const card of cards) {
    if (card.status === "candidate" || card.status === "staged" || card.status === "conflict") add(card.id, `status:${card.status}`);
    if (card.counterevidence.length) add(card.id, "counterevidence");
  }
  for (const conflict of context?.ledger?.conflicts ?? []) {
    if (conflict.resolved) continue;
    for (const id of conflict.conceptIds) add(id, `conflict:${conflict.conflictType}`);
  }
  for (const stale of context?.conceptDrift?.report.staleCandidates ?? []) add(stale.conceptId, `drift:${stale.reason}`);
  const focusCardIds = cards
    .filter((card) => reasons.has(card.id))
    .sort((a, b) => focusRank(a, reasons.get(a.id)!) - focusRank(b, reasons.get(b.id)!) || b.confidence - a.confidence || a.title.localeCompare(b.title))
    .map((card) => card.id);
  return {
    focusCardIds,
    omittedCardCount: Math.max(0, cards.length - focusCardIds.length),
    reasons: Object.fromEntries([...reasons.entries()].map(([id, values]) => [id, [...values].sort()]))
  };
}

function focusRank(card: LearnV2ConceptCard, reasons: Set<string>): number {
  if ([...reasons].some((reason) => reason.startsWith("conflict:"))) return 0;
  if (card.status === "conflict") return 1;
  if (card.status === "candidate" || card.status === "staged") return 2;
  if ([...reasons].some((reason) => reason.startsWith("drift:"))) return 3;
  return 4;
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
