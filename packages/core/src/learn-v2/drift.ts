import type { LearnV2ConceptCard, LearnV2ConceptDriftReport } from "./schemas.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../storage/atomic.js";
import { LearnV2ConceptDriftReportSchema } from "./schemas.js";

/**
 * Concept drift detection (Plan §22.8 Stale concepts + §14.5 supersession).
 *
 * Without drift detection, learned concepts accumulate forever. A concept that
 * was relevant 90 days ago may no longer match current project conventions if
 * the project has evolved (e.g., package manager changed, testing framework
 * swapped, security posture shifted). This module surfaces stale, underused,
 * and contradicted concepts so reviewers can supersede, narrow, or delete them.
 *
 * Drift signals:
 * - stale-no-outcomes: concept created long ago, never activated, never reviewed
 * - low-activation: activation count is zero or very low relative to age
 * - recent-negative-outcomes: harmful/wrong outcomes recorded recently
 * - supersession-candidate: newer concept with overlapping scope exists
 * - evidence-expired: raw refs backing this concept have been compacted/GC'd
 *
 * This is a read-only diagnostic. It does not modify concepts. Reviewers decide.
 */

export interface LearnV2ConceptDriftOptions {
  now?: Date;
  staleAfterDays?: number;
  lowActivationThreshold?: number;
  recentOutcomeDays?: number;
  outcomeRecords?: Array<{
    conceptId: string;
    outcome: string;
    recordedAt: string;
  }>;
  activationCounts?: Map<string, number>;
}

export interface LearnV2ConceptDriftResult {
  report: LearnV2ConceptDriftReport;
  artifactPath: string;
}

const DEFAULT_STALE_DAYS = 60;
const DEFAULT_LOW_ACTIVATION = 1;
const DEFAULT_RECENT_OUTCOME_DAYS = 30;

export async function detectLearnV2ConceptDrift(
  rootInput: string,
  cards: LearnV2ConceptCard[],
  options: LearnV2ConceptDriftOptions = {}
): Promise<LearnV2ConceptDriftResult> {
  const root = path.resolve(rootInput);
  const now = options.now ?? new Date();
  const staleAfterDays = options.staleAfterDays ?? DEFAULT_STALE_DAYS;
  const lowActivationThreshold = options.lowActivationThreshold ?? DEFAULT_LOW_ACTIVATION;
  const recentOutcomeDays = options.recentOutcomeDays ?? DEFAULT_RECENT_OUTCOME_DAYS;

  const activeCards = cards.filter((card) => card.status === "active" || card.status === "locked");
  const outcomeByConcept = groupOutcomesByConcept(options.outcomeRecords ?? []);
  const activationCounts = options.activationCounts ?? new Map<string, number>();

  const staleCandidates: LearnV2ConceptDriftReport["staleCandidates"][number][] = [];

  for (const card of activeCards) {
    const ageDays = daysBetween(card.lifecycle.createdAt, now.toISOString());
    const outcomes = outcomeByConcept.get(card.id) ?? [];
    const recentNegative = outcomes.filter(
      (item) =>
        (item.outcome === "harmful" || item.outcome === "wrong" || item.outcome === "superseded") &&
        daysBetween(item.recordedAt, now.toISOString()) <= recentOutcomeDays
    );
    const activationCount = activationCounts.get(card.id) ?? 0;
    const lastOutcomeDays = outcomes.length
      ? Math.min(...outcomes.map((item) => daysBetween(item.recordedAt, now.toISOString())))
      : undefined;

    if (recentNegative.length >= 2) {
      staleCandidates.push({
        conceptId: card.id,
        reason: "recent-negative-outcomes",
        ageDays,
        lastOutcomeDays,
        activationCount,
        negativeOutcomeCount: recentNegative.length,
        suggestion: `Concept has ${recentNegative.length} recent negative outcome(s); consider superseding, narrowing scope, or marking for human review.`
      });
      continue;
    }

    const newerOverlapping = activeCards.find(
      (other) =>
        other.id !== card.id &&
        other.lifecycle.createdAt > card.lifecycle.createdAt &&
        scopesOverlap(card, other)
    );
    if (newerOverlapping) {
      staleCandidates.push({
        conceptId: card.id,
        reason: "supersession-candidate",
        ageDays,
        lastOutcomeDays,
        activationCount,
        negativeOutcomeCount: 0,
        suggestion: `Newer concept ${newerOverlapping.id} overlaps this concept's scope; consider superseding this older concept.`
      });
      continue;
    }

    if (ageDays >= staleAfterDays && activationCount <= lowActivationThreshold) {
      staleCandidates.push({
        conceptId: card.id,
        reason: "stale-no-outcomes",
        ageDays,
        lastOutcomeDays,
        activationCount,
        negativeOutcomeCount: 0,
        suggestion: `Concept is ${ageDays} days old with ${activationCount} activation(s); verify it is still accurate or supersede it.`
      });
      continue;
    }

    if (activationCount === 0 && ageDays >= staleAfterDays / 2) {
      staleCandidates.push({
        conceptId: card.id,
        reason: "low-activation",
        ageDays,
        lastOutcomeDays,
        activationCount,
        negativeOutcomeCount: 0,
        suggestion: `Concept has never been activated in ${ageDays} days; scope may be too narrow or behavior may be outdated.`
      });
    }
  }

  const healthScore = activeCards.length
    ? Number((1 - staleCandidates.length / activeCards.length).toFixed(2))
    : 1;

  const report = LearnV2ConceptDriftReportSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.concept-drift.v1",
    generatedAt: now.toISOString(),
    totalActiveConcepts: activeCards.length,
    staleCandidates: staleCandidates.sort((a, b) => rankReason(a.reason) - rankReason(b.reason) || b.ageDays - a.ageDays),
    healthScore
  });

  const dir = path.join(root, ".openskill-kit", "learn-v2", "drift");
  const artifactPath = path.join(dir, `drift-${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.json`);
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(artifactPath, report);
  return { report, artifactPath };
}

function groupOutcomesByConcept(
  records: Array<{ conceptId: string; outcome: string; recordedAt: string }>
): Map<string, Array<{ outcome: string; recordedAt: string }>> {
  const map = new Map<string, Array<{ outcome: string; recordedAt: string }>>();
  for (const record of records) {
    const list = map.get(record.conceptId) ?? [];
    list.push({ outcome: record.outcome, recordedAt: record.recordedAt });
    map.set(record.conceptId, list);
  }
  return map;
}

function scopesOverlap(a: LearnV2ConceptCard, b: LearnV2ConceptCard): boolean {
  if (!a.scope.paths.length || !b.scope.paths.length) return true;
  return a.scope.paths.some((p) => b.scope.paths.includes(p));
}

function rankReason(reason: string): number {
  const order: Record<string, number> = {
    "recent-negative-outcomes": 0,
    "supersession-candidate": 1,
    "stale-no-outcomes": 2,
    "low-activation": 3,
    "evidence-expired": 4
  };
  return order[reason] ?? 5;
}

function daysBetween(earlier: string, later: string): number {
  const ms = new Date(later).getTime() - new Date(earlier).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}
