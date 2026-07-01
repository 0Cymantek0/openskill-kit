import type { LearnV2NormalizedEvidence } from "./schemas.js";
import { LearnV2EvidenceQualityScoreSchema, type LearnV2EvidenceQualityScore } from "./schemas.js";

/**
 * Evidence quality scoring at intake.
 *
 * Not all raw evidence is equally valuable. This module scores normalized evidence
 * records so the pipeline can prioritize high-value sources (corrections, manual edits,
 * rejected outputs, diffs with semantic changes) before spending vault storage,
 * episode reconstruction, and extraction budget on low-value noise.
 *
 * Tiers:
 * - critical: explicit user correction, security correction, manual edit, rejected output
 * - high: review comment, test failure, diff with semantic change, accepted final patch
 * - medium: assistant message with preference language, passing command, doc instruction
 * - low: generic assistant boilerplate, passing test without correction context
 * - noise: tool schema chatter, unrelated chat, progress bars
 */

const CRITICAL_KEYWORDS = /\b(?:never|avoid|do not|don't|wrong|instead|manual edit|should have|must not|security|secret|credential|private key|api key|token)\b/i;
const HIGH_KEYWORDS = /\b(?:prefer|always|blocker|review|test|fixture|regression|reject|accept|merge|approve|nit|convention)\b/i;
const MEDIUM_KEYWORDS = /\b(?:use|run|add|keep|verify|check|lint|format|typecheck|build)\b/i;
const NOISE_KEYWORDS = /\b(?:ok|sure|done|thanks|sounds good|got it|understood)\b/i;

export function scoreLearnV2EvidenceQuality(evidence: LearnV2NormalizedEvidence): LearnV2EvidenceQualityScore {
  const signals: string[] = [];
  let score = 0.15; // baseline
  const text = `${evidence.actor}: ${evidence.text} ${evidence.commands.join(" ")}`;

  // Actor-based weighting: user and reviewer signals are highest authority.
  if (evidence.actor === "user") {
    score += 0.2;
    signals.push("user-actor");
  } else if (evidence.actor === "reviewer") {
    score += 0.18;
    signals.push("reviewer-actor");
  } else if (evidence.actor === "assistant") {
    score += 0.05;
    signals.push("assistant-actor");
  }

  // Correction / rejection signals are the strongest learning evidence.
  if (CRITICAL_KEYWORDS.test(text)) {
    score += 0.35;
    signals.push("correction-or-security-language");
  }
  if (evidence.kind === "review") {
    score += 0.2;
    signals.push("review-comment");
  }
  if (evidence.status === "fail") {
    score += 0.15;
    signals.push("failure-outcome");
  }

  // Diffs and file changes with semantic content are high-value.
  if (evidence.kind === "file-change") {
    score += 0.12;
    signals.push("file-change");
  }

  // High-value preference / convention language.
  if (HIGH_KEYWORDS.test(text)) {
    score += 0.1;
    signals.push("preference-language");
  }

  // Medium-value actionable language.
  if (MEDIUM_KEYWORDS.test(text)) {
    score += 0.05;
    signals.push("actionable-language");
  }

  // Noise penalty.
  if (NOISE_KEYWORDS.test(text) && text.length < 60) {
    score -= 0.1;
    signals.push("noise-language");
  }

  // Test results without correction context are lower value.
  if (evidence.kind === "test-result" && evidence.status === "pass" && !CRITICAL_KEYWORDS.test(text)) {
    score -= 0.05;
    signals.push("passing-test-without-correction");
  }

  score = Math.min(1, Math.max(0, score));
  const tier = scoreTier(score, signals.length, evidence);
  const estimatedAtomYield = estimateAtomYield(tier, signals);
  const recommendedAction = score >= 0.7 ? "process-immediately"
    : score >= 0.4 ? "process-batch"
      : score >= 0.2 ? "defer"
        : "skip";

  return LearnV2EvidenceQualityScoreSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.evidence-quality.v1",
    evidenceId: evidence.id,
    score: Number(score.toFixed(2)),
    tier,
    signals,
    estimatedAtomYield,
    recommendedAction
  });
}

/**
 * Score a batch of evidence and return a prioritized processing order.
 * High-value evidence is processed first; noise is deferred or skipped.
 */
export function prioritizeLearnV2Evidence(evidence: LearnV2NormalizedEvidence[]): {
  scored: Array<{ evidence: LearnV2NormalizedEvidence; quality: LearnV2EvidenceQualityScore }>;
  processImmediately: LearnV2NormalizedEvidence[];
  processBatch: LearnV2NormalizedEvidence[];
  defer: LearnV2NormalizedEvidence[];
  skip: LearnV2NormalizedEvidence[];
} {
  const scored = evidence
    .map((item) => ({ evidence: item, quality: scoreLearnV2EvidenceQuality(item) }))
    .sort((a, b) => b.quality.score - a.quality.score);
  return {
    scored,
    processImmediately: scored.filter((item) => item.quality.recommendedAction === "process-immediately").map((item) => item.evidence),
    processBatch: scored.filter((item) => item.quality.recommendedAction === "process-batch").map((item) => item.evidence),
    defer: scored.filter((item) => item.quality.recommendedAction === "defer").map((item) => item.evidence),
    skip: scored.filter((item) => item.quality.recommendedAction === "skip").map((item) => item.evidence)
  };
}

function scoreTier(score: number, signalCount: number, evidence: LearnV2NormalizedEvidence): LearnV2EvidenceQualityScore["tier"] {
  if (evidence.actor === "user" && CRITICAL_KEYWORDS.test(`${evidence.text} ${evidence.commands.join(" ")}`)) return "critical";
  if (score >= 0.65 && signalCount >= 3) return "critical";
  if (score >= 0.5) return "high";
  if (score >= 0.3) return "medium";
  if (score >= 0.15) return "low";
  return "noise";
}

function estimateAtomYield(tier: LearnV2EvidenceQualityScore["tier"], signals: string[]): number {
  const base = tier === "critical" ? 3 : tier === "high" ? 2 : tier === "medium" ? 1 : 0;
  const bonus = signals.includes("correction-or-security-language") ? 1 : 0;
  return base + bonus;
}
