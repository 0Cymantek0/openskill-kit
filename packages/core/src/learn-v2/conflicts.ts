import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../storage/atomic.js";
import type { LearnV2ConceptCard, LearnV2ConflictLedger } from "./schemas.js";
import { LearnV2ConflictLedgerSchema } from "./schemas.js";
import { learnV2CanonicalKey } from "./utils.js";

/**
 * Concept conflict ledger (Plan §14.4).
 *
 * The existing concepts.ts applies inline counterevidence during merge, but it does
 * not produce a standalone, reviewable conflict ledger. This module detects conflicts
 * across the full concept store, classifies them, and proposes resolutions — enabling
 * a dedicated conflict-review surface and audit trail.
 *
 * Conflict types:
 * - direct-opposite: same scope, opposite polarity, high token overlap.
 * - scope-overlap: same intent but overlapping scope where only one should fire.
 * - newer-supersedes-older: same behavior, newer higher-confidence replacement exists.
 * - command-policy-conflict: two command policies suggest different commands for same scope.
 * - security-vs-convenience: a security rule conflicts with a workflow convenience.
 * - style-disagreement: opposing style conventions in the same subsystem.
 */

export interface DetectedConflict {
  schemaVersion: "openskill-kit.learn-v2.concept-conflict.v1";
  id: string;
  projectId: string;
  conceptIds: string[];
  conflictType:
    | "direct-opposite"
    | "scope-overlap"
    | "newer-supersedes-older"
    | "command-policy-conflict"
    | "security-vs-convenience"
    | "style-disagreement";
  explanation: string;
  evidenceRefs: string[];
  suggestedResolution:
    | "narrow-scope"
    | "prefer-newer-explicit-user-correction"
    | "keep-both-with-conditions"
    | "reject-lower-confidence"
    | "human-review";
  detectedAt: string;
  resolved: boolean;
  resolutionAction: "auto-supersede" | "auto-narrow" | "manual" | "none";
}

const CONFLICT_OVERLAP_THRESHOLD = 3;

export function detectLearnV2ConceptConflicts(cards: LearnV2ConceptCard[], projectId: string, now: Date): LearnV2ConflictLedger {
  const conflicts: DetectedConflict[] = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i]!;
      const b = cards[j]!;
      if (a.status === "rejected" || a.status === "superseded" || b.status === "rejected" || b.status === "superseded") continue;
      const conflict = detectPairConflict(a, b, projectId, now);
      if (conflict) conflicts.push(conflict);
    }
  }
  const sorted = conflicts.sort((a, b) => a.conflictType.localeCompare(b.conflictType) || a.conceptIds.join(",").localeCompare(b.conceptIds.join(",")));
  return LearnV2ConflictLedgerSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.conflict-ledger.v1",
    projectId,
    updatedAt: now.toISOString(),
    conflicts: sorted,
    unresolvedCount: sorted.filter((item) => !item.resolved).length
  });
}

export async function writeLearnV2ConflictLedger(rootInput: string, cards: LearnV2ConceptCard[], projectId: string, now: Date): Promise<{ ledger: LearnV2ConflictLedger; artifactPaths: { json: string; markdown: string } }> {
  const root = path.resolve(rootInput);
  const dir = path.join(root, ".openskill-kit", "learn-v2", "conflicts");
  const json = path.join(dir, "conflict-ledger.json");
  const markdown = path.join(dir, "conflict-ledger.md");
  const ledger = detectLearnV2ConceptConflicts(cards, projectId, now);
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(json, ledger);
  await fs.writeFile(markdown, renderConflictLedgerMarkdown(ledger), "utf8");
  return { ledger, artifactPaths: { json, markdown } };
}

function detectPairConflict(a: LearnV2ConceptCard, b: LearnV2ConceptCard, projectId: string, now: Date): DetectedConflict | undefined {
  const scopeOverlap = hasScopeOverlap(a, b);
  const tokenOverlap = tokenOverlapCount(a.canonicalBehavior, b.canonicalBehavior);
  const oppositePolarity = a.atoms.some((left) => b.atoms.some((right) => left.polarity !== right.polarity && left.kind === right.kind));

  // newer-supersedes-older: same intent, newer is clearly stronger and older is not protected.
  const sameIntent = tokenOverlap >= 4 && a.atoms[0]?.kind === b.atoms[0]?.kind && !oppositePolarity;
  if (sameIntent) {
    const newer = new Date(a.lifecycle.updatedAt).getTime() > new Date(b.lifecycle.updatedAt).getTime() ? a : b;
    const older = newer === a ? b : a;
    if (newer.confidence >= older.confidence + 0.15 && hasSupersessionAuthority(newer) && !isSupersessionProtected(older)) {
      return makeConflict(projectId, [newer.id, older.id], "newer-supersedes-older",
        `${newer.title} appears to supersede ${older.title}: same intent with newer higher-confidence reviewer-authoritative evidence.`,
        [...newer.evidenceIds, ...older.evidenceIds].slice(0, 12),
        "prefer-newer-explicit-user-correction", now, "auto-supersede");
    }
  }

  // direct-opposite: opposite polarity + overlapping scope + shared tokens
  if (oppositePolarity && scopeOverlap && tokenOverlap >= CONFLICT_OVERLAP_THRESHOLD) {
    return makeConflict(projectId, [a.id, b.id], "direct-opposite",
      `${a.title} and ${b.title} express opposite behavior in overlapping scope.`,
      [...a.evidenceIds, ...b.evidenceIds].slice(0, 12),
      "human-review", now, "manual");
  }

  // command-policy-conflict
  const aCommands = new Set(a.activation.commands);
  const bCommands = new Set(b.activation.commands);
  const hasCommandOverlap = a.atoms.some((atom) => atom.kind === "command-policy") && b.atoms.some((atom) => atom.kind === "command-policy");
  const sharedScope = scopeOverlap && (a.scope.taskTypes.some((t) => b.scope.taskTypes.includes(t)) || (!a.scope.taskTypes.length && !b.scope.taskTypes.length));
  if (hasCommandOverlap && sharedScope && ![...aCommands].some((cmd) => bCommands.has(cmd))) {
    return makeConflict(projectId, [a.id, b.id], "command-policy-conflict",
      `${a.title} and ${b.title} recommend different commands for overlapping task scope.`,
      [...a.evidenceIds, ...b.evidenceIds].slice(0, 12),
      "keep-both-with-conditions", now, "manual");
  }

  // security-vs-convenience
  const aSecurity = a.atoms.some((atom) => atom.kind === "security");
  const bSecurity = b.atoms.some((atom) => atom.kind === "security");
  if ((aSecurity || bSecurity) && scopeOverlap && tokenOverlap >= 2) {
    const securityCard = aSecurity ? a : b;
    const otherCard = aSecurity ? b : a;
    return makeConflict(projectId, [securityCard.id, otherCard.id], "security-vs-convenience",
      `Security rule "${securityCard.title}" may constrain convenience behavior "${otherCard.title}".`,
      [...securityCard.evidenceIds].slice(0, 8),
      "narrow-scope", now, "manual");
  }

  // scope-overlap: same kind, overlapping scope, different behavior text, not opposite
  if (!oppositePolarity && a.atoms[0]?.kind === b.atoms[0]?.kind && scopeOverlap && tokenOverlap >= 2 && tokenOverlap < 4) {
    return makeConflict(projectId, [a.id, b.id], "scope-overlap",
      `${a.title} and ${b.title} cover overlapping scope; consider merging or narrowing.`,
      [...a.evidenceIds, ...b.evidenceIds].slice(0, 10),
      "narrow-scope", now, "auto-narrow");
  }

  // style-disagreement
  if (a.atoms.some((atom) => atom.kind === "preference" || atom.kind === "workflow")
    && b.atoms.some((atom) => atom.kind === "preference" || atom.kind === "workflow")
    && oppositePolarity && scopeOverlap && tokenOverlap >= 2) {
    return makeConflict(projectId, [a.id, b.id], "style-disagreement",
      `Style disagreement between "${a.title}" and "${b.title}" in same scope.`,
      [...a.evidenceIds, ...b.evidenceIds].slice(0, 8),
      "reject-lower-confidence", now, "manual");
  }

  return undefined;
}

function makeConflict(
  projectId: string,
  conceptIds: string[],
  conflictType: DetectedConflict["conflictType"],
  explanation: string,
  evidenceRefs: string[],
  suggestedResolution: DetectedConflict["suggestedResolution"],
  now: Date,
  resolutionAction: DetectedConflict["resolutionAction"]
): DetectedConflict {
  return {
    schemaVersion: "openskill-kit.learn-v2.concept-conflict.v1",
    id: `conflict_${conceptIds.sort().join("_").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60)}`,
    projectId,
    conceptIds: conceptIds.sort(),
    conflictType,
    explanation,
    evidenceRefs: [...new Set(evidenceRefs)],
    suggestedResolution,
    detectedAt: now.toISOString(),
    resolved: false,
    resolutionAction
  };
}

function hasScopeOverlap(a: LearnV2ConceptCard, b: LearnV2ConceptCard): boolean {
  if (!a.scope.paths.length || !b.scope.paths.length) return true;
  return a.scope.paths.some((p) => b.scope.paths.some((q) => p.startsWith(q.split("/**")[0]!) || q.startsWith(p.split("/**")[0]!)));
}

function tokenOverlapCount(a: string, b: string): number {
  const aWords = new Set(learnV2CanonicalKey(a).split("-").filter((w) => w.length > 2));
  const bWords = new Set(learnV2CanonicalKey(b).split("-").filter((w) => w.length > 2));
  let count = 0;
  for (const word of aWords) if (bWords.has(word)) count++;
  return count;
}

function hasSupersessionAuthority(card: LearnV2ConceptCard): boolean {
  if (card.status === "locked" || card.status === "active") return true;
  return card.atoms.some((atom) =>
    atom.rationale.toLowerCase().includes("explicit preference")
    || atom.rationale.toLowerCase().includes("correction")
    || atom.evidenceIds.some((id) => /user|review|correction|manual|edit/i.test(id))
  );
}

function isSupersessionProtected(card: LearnV2ConceptCard): boolean {
  return card.status === "locked" || card.risk === "high" || card.atoms.some((atom) => atom.kind === "security");
}

export function renderConflictLedgerMarkdown(ledger: LearnV2ConflictLedger): string {
  if (!ledger.conflicts.length) {
    return `# Learn v2 Conflict Ledger\n\nNo unresolved conflicts detected.\n\nUpdated: ${ledger.updatedAt}\n`;
  }
  const lines = ["# Learn v2 Concept Conflict Ledger", "", `Updated: ${ledger.updatedAt}`, `Unresolved: ${ledger.unresolvedCount}`, ""];
  for (const conflict of ledger.conflicts) {
    lines.push(`## ${conflict.conflictType}: ${conflict.conceptIds.join(" vs ")}`, "");
    lines.push(`- Status: ${conflict.resolved ? "resolved" : "unresolved"}`);
    lines.push(`- Resolution: ${conflict.suggestedResolution} (${conflict.resolutionAction})`);
    lines.push(`- Explanation: ${conflict.explanation}`);
    if (conflict.evidenceRefs.length) lines.push(`- Evidence: ${conflict.evidenceRefs.slice(0, 6).join(", ")}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
