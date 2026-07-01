import type { LearnV2BehaviorAtom, LearnV2ConceptCard } from "./schemas.js";

const SCORING_POLICY_VERSION = "deterministic-concept-scoring-v1";

export interface LearnV2ConceptScoringBreakdown {
  schemaVersion: "openskill-kit.learn-v2.concept-scoring.v1";
  policyVersion: typeof SCORING_POLICY_VERSION;
  calibratedFrom: Array<"deterministic-heuristic" | "golden-fixture" | "human-review" | "activation-outcome">;
  supportAtomCount: number;
  evidenceCount: number;
  rawRefCount: number;
  counterevidenceCount: number;
  maxAtomConfidence: number;
  supportBoost: number;
  reliabilityPenalty: number;
  counterevidencePenalty: number;
  confidence: number;
  durability: number;
  sourceReliability: number;
  reasons: string[];
  penalties: string[];
}

export interface LearnV2ConceptScoringInput {
  atoms: LearnV2BehaviorAtom[];
  evidenceIds?: string[];
  rawRefs?: string[];
  risk?: LearnV2ConceptCard["risk"];
  counterevidenceCount?: number;
}

export function calculateLearnV2ConceptScoring(input: LearnV2ConceptScoringInput): LearnV2ConceptScoringBreakdown {
  if (!input.atoms.length) throw new Error("Cannot score learn-v2 concept without atoms.");
  const evidenceIds = unique(input.evidenceIds ?? input.atoms.flatMap((atom) => atom.evidenceIds));
  const rawRefs = unique(input.rawRefs ?? input.atoms.flatMap((atom) => atom.rawRefs));
  const sourceReliability = average(input.atoms.map((atom) => atom.sourceReliability));
  const maxAtomConfidence = Math.max(...input.atoms.map((atom) => atom.confidence));
  const supportBoost = round(Math.min(0.12, Math.max(0, input.atoms.length - 1) * 0.03));
  const reliabilityPenalty = round(sourceReliability < 0.55 ? Math.min(0.18, (0.55 - sourceReliability) * 0.45) : 0);
  const counterevidenceCount = input.counterevidenceCount ?? 0;
  const counterevidencePenalty = round(Math.min(0.24, counterevidenceCount * 0.08));
  const confidence = round(clamp(maxAtomConfidence + supportBoost - reliabilityPenalty - counterevidencePenalty, 0.05, 0.95));
  const durability = round(clamp(
    0.45
      + Math.min(0.25, evidenceIds.length * 0.03)
      + Math.min(0.15, rawRefs.length * 0.05)
      + Math.min(0.08, Math.max(0, input.atoms.length - 1) * 0.02)
      + (input.risk === "low" ? 0.08 : 0)
      - Math.min(0.2, counterevidenceCount * 0.06),
    0.05,
    0.95
  ));
  const reasons = [
    `max-atom-confidence:${maxAtomConfidence.toFixed(2)}`,
    `support-atoms:${input.atoms.length}`,
    `evidence:${evidenceIds.length}`,
    `raw-refs:${rawRefs.length}`,
    `source-reliability:${sourceReliability.toFixed(2)}`
  ];
  if (supportBoost > 0) reasons.push(`support-boost:${supportBoost.toFixed(2)}`);
  if (input.risk === "low") reasons.push("low-risk-durability-boost");
  const penalties = [];
  if (reliabilityPenalty > 0) penalties.push(`low-source-reliability:${reliabilityPenalty.toFixed(2)}`);
  if (counterevidencePenalty > 0) penalties.push(`counterevidence:${counterevidencePenalty.toFixed(2)}`);
  return {
    schemaVersion: "openskill-kit.learn-v2.concept-scoring.v1",
    policyVersion: SCORING_POLICY_VERSION,
    calibratedFrom: ["deterministic-heuristic"],
    supportAtomCount: input.atoms.length,
    evidenceCount: evidenceIds.length,
    rawRefCount: rawRefs.length,
    counterevidenceCount,
    maxAtomConfidence: round(maxAtomConfidence),
    supportBoost,
    reliabilityPenalty,
    counterevidencePenalty,
    confidence,
    durability,
    sourceReliability: round(sourceReliability),
    reasons,
    penalties
  };
}

export function withLearnV2ConceptScoring<T extends LearnV2ConceptCard>(card: T): T {
  const scoring = calculateLearnV2ConceptScoring({
    atoms: card.atoms,
    evidenceIds: card.evidenceIds,
    rawRefs: card.rawRefs,
    risk: card.risk,
    counterevidenceCount: card.counterevidence.length
  });
  return {
    ...card,
    confidence: scoring.confidence,
    durability: scoring.durability,
    sourceReliability: scoring.sourceReliability,
    scoring
  };
}

function average(values: number[]): number {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
