import { promises as fs } from "node:fs";
import path from "node:path";
import type { LearnV2ConceptCard, LearnV2ConceptDriftReport, LearnV2ConflictLedger, LearnV2CounterevidenceLedger, LearnV2DeclassifiedEvidenceSnippetArtifact, LearnV2ReviewQueue } from "./schemas.js";
import { LearnV2ReviewQueueSchema } from "./schemas.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { readProjectConfig } from "../events/store.js";
import type { ProjectConfig } from "../config/schema.js";
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
  const reviewActions = selectReviewActions(cards, reviewFocus, context?.ledger);
  const config = await readProjectConfig(root);
  const safeBulkActionDetails = selectSafeBulkActionDetails(cards, config);
  const conflictDetails = selectReviewConflictDetails(cards, context?.ledger);
  const queue = LearnV2ReviewQueueSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.review-queue.v1",
    generatedAt: now.toISOString(),
    cards,
    behaviorDeltaFirst: true,
    reviewFocus,
    safeBulkActions: ["accept-low-risk", "reject-one-off", "mark-superseded"],
    safeBulkActionDetails,
    reviewActions,
    conflictDetails,
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
    ...queue.safeBulkActionDetails.length
      ? queue.safeBulkActionDetails.map((action) => [
          `- ${action.action}: ${action.eligibleCount} eligible`,
          `  Command: ${action.command}`,
          `  Rationale: ${action.rationale}`,
          `  Safeguards: ${action.safeguards.join("; ") || "none"}`
        ].join("\n"))
      : queue.safeBulkActions.map((action) => `- ${action}`),
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
  const conflictsByConcept = mapReviewConflictsByConcept(queue.conflictDetails);
  for (const card of focusCards) {
    lines.push(`### ${card.title}`);
    lines.push("");
    const reasons = queue.reviewFocus.reasons[card.id] ?? [];
    if (reasons.length) lines.push(`Focus reasons: ${reasons.join(", ")}`);
    lines.push(`Status: ${card.status}`);
    lines.push(`Delta: ${card.behaviorDelta}`);
    lines.push(`Behavior: ${card.canonicalBehavior}`);
    lines.push(`Confidence: ${card.confidence.toFixed(2)} Durability: ${card.durability.toFixed(2)} Reliability: ${card.sourceReliability.toFixed(2)} Risk: ${card.risk}`);
    const scoringSummary = renderScoringSummary(card);
    if (scoringSummary) lines.push(scoringSummary);
    const conflictDetails = conflictsByConcept.get(card.id) ?? [];
    if (conflictDetails.length) {
      lines.push("Conflict diagnostics:");
      for (const conflict of conflictDetails.slice(0, 4)) {
        const diagnostic = conflict.diagnostics;
        lines.push(`- ${conflict.conflictType}: resolution=${conflict.suggestedResolution}/${conflict.resolutionAction}; scopeOverlap=${diagnostic?.scopeOverlap ?? "n/a"}; tokenOverlap=${diagnostic?.tokenOverlap ?? "n/a"}; sameKind=${diagnostic?.sameKind ?? "n/a"}; oppositePolarity=${diagnostic?.oppositePolarity ?? "n/a"}; confidenceDelta=${diagnostic?.confidenceDelta ?? 0}`);
        if (diagnostic?.authorityReasons.length) lines.push(`  Authority: ${diagnostic.authorityReasons.join(", ")}`);
        if (diagnostic?.protectedReasons.length) lines.push(`  Protection: ${diagnostic.protectedReasons.join(", ")}`);
      }
    }
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
    const actions = queue.reviewActions[card.id] ?? [];
    if (actions.length) {
      lines.push("Suggested actions:");
      for (const action of actions) lines.push(`- ${action.label}: ${action.command} (${action.rationale})`);
    }
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

function mapReviewConflictsByConcept(conflicts: LearnV2ReviewQueue["conflictDetails"]): Map<string, LearnV2ReviewQueue["conflictDetails"]> {
  const out = new Map<string, LearnV2ReviewQueue["conflictDetails"]>();
  for (const conflict of conflicts) {
    for (const conceptId of conflict.conceptIds) {
      out.set(conceptId, [...(out.get(conceptId) ?? []), conflict]);
    }
  }
  return out;
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
    if (card.scoring?.calibratedFrom.includes("activation-outcome")) add(card.id, "scoring:activation-outcome");
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

function selectReviewConflictDetails(cards: LearnV2ConceptCard[], ledger?: LearnV2ConflictLedger): LearnV2ReviewQueue["conflictDetails"] {
  const cardIds = new Set(cards.map((card) => card.id));
  return (ledger?.conflicts ?? [])
    .filter((conflict) => !conflict.resolved && conflict.conceptIds.some((id) => cardIds.has(id)))
    .slice(0, 80)
    .map((conflict) => ({
      conflictId: conflict.id,
      conceptIds: conflict.conceptIds.filter((id) => cardIds.has(id)),
      conflictType: conflict.conflictType,
      suggestedResolution: conflict.suggestedResolution,
      resolutionAction: conflict.resolutionAction,
      explanation: conflict.explanation,
      diagnostics: conflict.diagnostics
    }));
}

function selectReviewActions(
  cards: LearnV2ConceptCard[],
  reviewFocus: LearnV2ReviewQueue["reviewFocus"],
  ledger?: LearnV2ConflictLedger
): LearnV2ReviewQueue["reviewActions"] {
  const focusIds = new Set(reviewFocus.focusCardIds);
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const supersedeActions = selectLedgerSupersedeActions(cardsById, ledger);
  const supersedeSuccessorIds = selectLedgerSupersedeSuccessorIds(cardsById, ledger);
  const narrowActions = selectLedgerNarrowActions(cardsById, ledger);
  const actions: LearnV2ReviewQueue["reviewActions"] = {};
  for (const card of cards) {
    if (!focusIds.has(card.id)) continue;
    const reasons = reviewFocus.reasons[card.id] ?? [];
    const out: LearnV2ReviewQueue["reviewActions"][string] = [];
    const add = (label: string, command: string, rationale: string): void => {
      if (out.some((item) => item.command === command)) return;
      out.push({ label, command, rationale });
    };
    if (card.status === "candidate" || card.status === "staged") {
      add("Accept", `openskill-kit osk review --concept-accept ${card.id}`, "Activate this concept after human review.");
      add("Reject", `openskill-kit osk review --concept-reject ${card.id}`, "Remove a wrong or overfit concept from activation candidates.");
    }
    if (card.status === "active" || card.status === "locked") {
      add("Demote", `openskill-kit osk review --concept-demote ${card.id}`, "Move this active concept back to candidate while reviewing drift or harm.");
    }
    if (card.status === "conflict" || card.counterevidence.length || reasons.some((reason) => reason.startsWith("conflict:"))) {
      add("Reject", `openskill-kit osk review --concept-reject ${card.id}`, "Reject the conflicted concept if counterevidence invalidates it.");
      add("Mark one-off", `openskill-kit osk review --concept-one-off ${card.id}`, "Keep the evidence local without treating it as durable behavior.");
      const narrow = narrowActions.get(card.id);
      if (narrow) add("Narrow scope", `openskill-kit osk review --concept-narrow '${narrow.json}'`, narrow.rationale);
      const supersede = supersedeActions.get(card.id);
      if (supersede) {
        add("Supersede", `openskill-kit osk review --concept-supersede '${supersede.json}'`, supersede.rationale);
      } else if (!supersedeSuccessorIds.has(card.id)) {
        add("Supersede", `openskill-kit osk review --concept-supersede '{"supersededId":"${card.id}","supersededById":"concept_replacement"}'`, "Replace this concept with a stronger reviewed concept.");
      }
    }
    if (reasons.some((reason) => reason.startsWith("drift:"))) {
      add("Demote", `openskill-kit osk review --concept-demote ${card.id}`, "Pause activation while reviewing stale or harmful outcome telemetry.");
    }
    if (out.length) actions[card.id] = out.slice(0, 5);
  }
  return actions;
}

function selectSafeBulkActionDetails(cards: LearnV2ConceptCard[], config: ProjectConfig): LearnV2ReviewQueue["safeBulkActionDetails"] {
  const acceptLowRisk = cards.filter((card) => card.status === "candidate" && isSafeBulkAcceptCandidate(card, config)).length;
  const rejectOneOff = cards.filter((card) => card.status === "candidate" && card.durability < 0.5).length;
  const markSuperseded = cards.filter((card) => card.status === "candidate" && card.counterevidence.length > 0).length;
  return [
    {
      action: "accept-low-risk",
      eligibleCount: acceptLowRisk,
      command: "openskill-kit osk review --concept-bulk accept-low-risk",
      rationale: "Activate only narrow low-risk candidates that pass confidence, reliability, scope, privacy, and counterevidence safeguards.",
      safeguards: [
        `confidence>=${config.learning.minConfidenceToApply}`,
        `sourceReliability>=${config.learning.minConfidenceToApply}`,
        "risk=low",
        "path-scoped",
        "no-counterevidence",
        "no-high-risk-atoms"
      ]
    },
    {
      action: "reject-one-off",
      eligibleCount: rejectOneOff,
      command: "openskill-kit osk review --concept-bulk reject-one-off",
      rationale: "Move low-durability candidate noise to one-off so it stays inspectable without activating.",
      safeguards: ["candidate-only", "durability<0.5"]
    },
    {
      action: "mark-superseded",
      eligibleCount: markSuperseded,
      command: "openskill-kit osk review --concept-bulk mark-superseded",
      rationale: "Mark counterevidenced candidates as superseded instead of letting stale behavior compete for activation.",
      safeguards: ["candidate-only", "requires-counterevidence"]
    }
  ];
}

function isSafeBulkAcceptCandidate(card: LearnV2ConceptCard, config: ProjectConfig): boolean {
  if (card.confidence < config.learning.minConfidenceToApply) return false;
  if (card.risk !== "low") return false;
  if (card.sourceReliability < config.learning.minConfidenceToApply) return false;
  if (card.privacy.rawRefsExportable !== false) return false;
  if (card.privacy.outputClass !== "project-private" && card.privacy.outputClass !== "shareable") return false;
  if (card.atoms.some((atom) => atom.kind === "security" || atom.risk === "high")) return false;
  if (card.scope.level === "project" || card.scope.paths.length === 0 || card.scope.paths.length > 5) return false;
  if (card.counterevidence.length > 0 || card.status === "conflict") return false;
  return true;
}

function selectLedgerNarrowActions(
  cardsById: Map<string, LearnV2ConceptCard>,
  ledger?: LearnV2ConflictLedger
): Map<string, { json: string; rationale: string }> {
  const out = new Map<string, { json: string; rationale: string }>();
  for (const conflict of ledger?.conflicts ?? []) {
    if (conflict.resolved || conflict.resolutionAction !== "auto-narrow") continue;
    const cards = conflict.conceptIds.map((id) => cardsById.get(id)).filter((card): card is LearnV2ConceptCard => card !== undefined);
    if (cards.length !== 2) continue;
    for (const card of cards) {
      const peer = cards.find((item) => item.id !== card.id);
      if (!peer) continue;
      const negativeTriggers = [...new Set([
        ...card.scope.negativeTriggers,
        `When ${peer.title} applies.`
      ])].slice(0, 20);
      out.set(card.id, {
        json: JSON.stringify({
          id: card.id,
          paths: card.scope.paths,
          taskTypes: card.scope.taskTypes,
          negativeTriggers
        }),
        rationale: `Lock current scope and avoid overlap with ${peer.id}; ${conflict.conflictType}.`
      });
    }
  }
  return out;
}

function selectLedgerSupersedeActions(
  cardsById: Map<string, LearnV2ConceptCard>,
  ledger?: LearnV2ConflictLedger
): Map<string, { json: string; rationale: string }> {
  const out = new Map<string, { json: string; rationale: string }>();
  for (const conflict of ledger?.conflicts ?? []) {
    if (conflict.resolved || conflict.resolutionAction !== "auto-supersede") continue;
    const pair = selectSupersedePair(cardsById, conflict.conceptIds);
    if (!pair) continue;
    const reason = `Deterministic conflict ledger ${conflict.conflictType}: ${conflict.suggestedResolution}.`;
    out.set(pair.superseded.id, {
      json: JSON.stringify({
        supersededId: pair.superseded.id,
        supersededById: pair.successor.id,
        reason
      }),
      rationale: `Replace with stronger reviewed concept ${pair.successor.id}; ${conflict.conflictType}.`
    });
  }
  return out;
}

function selectLedgerSupersedeSuccessorIds(
  cardsById: Map<string, LearnV2ConceptCard>,
  ledger?: LearnV2ConflictLedger
): Set<string> {
  const out = new Set<string>();
  for (const conflict of ledger?.conflicts ?? []) {
    if (conflict.resolved || conflict.resolutionAction !== "auto-supersede") continue;
    const pair = selectSupersedePair(cardsById, conflict.conceptIds);
    if (pair) out.add(pair.successor.id);
  }
  return out;
}

function selectSupersedePair(
  cardsById: Map<string, LearnV2ConceptCard>,
  conceptIds: string[]
): { superseded: LearnV2ConceptCard; successor: LearnV2ConceptCard } | undefined {
  const [leftId, rightId] = conceptIds;
  if (!leftId || !rightId || leftId === rightId) return undefined;
  const left = cardsById.get(leftId);
  const right = cardsById.get(rightId);
  if (!left || !right) return undefined;
  const leftUpdated = Date.parse(left.lifecycle.updatedAt);
  const rightUpdated = Date.parse(right.lifecycle.updatedAt);
  const successor = rightUpdated > leftUpdated ? right : left;
  const superseded = successor === right ? left : right;
  if (successor.confidence < superseded.confidence + 0.15) return undefined;
  return { superseded, successor };
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

function renderScoringSummary(card: LearnV2ConceptCard): string | undefined {
  const scoring = card.scoring;
  if (!scoring) return undefined;
  const outcomes = [
    `helpful=${scoring.outcomeHelpfulCount ?? 0}`,
    `ignored=${scoring.outcomeIgnoredCount ?? 0}`,
    `wrong=${scoring.outcomeWrongCount ?? 0}`,
    `harmful=${scoring.outcomeHarmfulCount ?? 0}`,
    `superseded=${scoring.outcomeSupersededCount ?? 0}`
  ].join(", ");
  return [
    `Scoring: calibrated=${scoring.calibratedFrom.join(", ")}; outcomes ${outcomes}; boost=${(scoring.outcomeBoost ?? 0).toFixed(2)} penalty=${(scoring.outcomePenalty ?? 0).toFixed(2)}`,
    scoring.reasons.length ? `Scoring reasons: ${scoring.reasons.slice(0, 6).join("; ")}` : undefined,
    scoring.penalties.length ? `Scoring penalties: ${scoring.penalties.slice(0, 6).join("; ")}` : undefined
  ].filter((line): line is string => line !== undefined).join("\n");
}
