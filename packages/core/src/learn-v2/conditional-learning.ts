import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../storage/atomic.js";
import {
  LearnV2BehaviorAtomSchema,
  LearnV2ConditionalLearningArtifactSchema,
  LearnV2ConditionalHypothesisSchema,
  LearnV2ContextFactorSchema,
  LearnV2LearningObservationSchema,
  LearnV2MemoryAdmissionDecisionSchema,
  type LearnV2BehaviorAtom,
  type LearnV2ConditionalLearningArtifact,
  type LearnV2ConditionalHypothesis,
  type LearnV2ContextFactor,
  type LearnV2LearningObservation,
  type LearnV2MemoryAdmissionDecision,
  type LearnV2NormalizedEvidence,
  type LearnV2TaskEpisode
} from "./schemas.js";
import { learnV2NormalizeStatement, learnV2SafeLocalPath, learnV2ShortHash } from "./utils.js";

const colorTerms = ["green", "blue", "orange", "red", "purple", "yellow", "black", "white", "gray", "grey"];

export interface LearnV2ConditionalLearningResult {
  observations: LearnV2LearningObservation[];
  hypotheses: LearnV2ConditionalHypothesis[];
  admissionDecisions: LearnV2MemoryAdmissionDecision[];
  atoms: LearnV2BehaviorAtom[];
}

export function runLearnV2ConditionalLearning(episodes: LearnV2TaskEpisode[]): LearnV2ConditionalLearningResult {
  const observations = buildLearnV2LearningObservations(episodes);
  const hypotheses = inferLearnV2ConditionalHypotheses(observations);
  const admissionDecisions = decideLearnV2MemoryAdmission({ observations, hypotheses });
  const promotedHypothesisIds = new Set(admissionDecisions
    .filter((item) => item.subjectKind === "hypothesis" && item.decision === "promote-candidate")
    .map((item) => item.subjectId));
  const atoms = learnV2ConditionalHypothesesToBehaviorAtoms(
    hypotheses.filter((hypothesis) => promotedHypothesisIds.has(hypothesis.id)),
    observations
  );
  return { observations, hypotheses, admissionDecisions, atoms };
}

export async function writeLearnV2ConditionalLearningArtifact(
  rootInput: string,
  episodes: LearnV2TaskEpisode[],
  now = new Date()
): Promise<LearnV2ConditionalLearningArtifact & { atoms: LearnV2BehaviorAtom[] }> {
  const root = path.resolve(rootInput);
  const stamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const dir = path.join(root, ".openskill-kit", "learn-v2", "conditional-learning");
  const json = path.join(dir, `conditional-learning-${stamp}.json`);
  const markdown = path.join(dir, `conditional-learning-${stamp}.md`);
  const result = runLearnV2ConditionalLearning(episodes);
  const promotedHypothesisIds = new Set(result.admissionDecisions
    .filter((item) => item.subjectKind === "hypothesis" && item.decision === "promote-candidate")
    .map((item) => item.subjectId));
  const artifact = LearnV2ConditionalLearningArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.conditional-learning-artifact.v1",
    generatedAt: now.toISOString(),
    observations: result.observations,
    hypotheses: result.hypotheses,
    admissionDecisions: result.admissionDecisions,
    counts: {
      observations: result.observations.length,
      hypotheses: result.hypotheses.length,
      promotedHypotheses: result.hypotheses.filter((item) => promotedHypothesisIds.has(item.id)).length,
      observeOnly: result.admissionDecisions.filter((item) => item.decision === "observe-only").length,
      rejectedNoise: result.admissionDecisions.filter((item) => item.decision === "reject-noise").length
    },
    artifacts: {
      json,
      markdown
    }
  });
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(json, artifact);
  await fs.writeFile(markdown, renderLearnV2ConditionalLearningArtifact(root, artifact), "utf8");
  return { ...artifact, atoms: result.atoms };
}

export function extractLearnV2ContextFactors(input: {
  text?: string;
  paths?: string[];
  metadata?: Record<string, unknown>;
  evidenceIds?: string[];
}): LearnV2ContextFactor[] {
  const text = normalize(input.text ?? "");
  const evidenceIds = input.evidenceIds ?? [];
  const out: LearnV2ContextFactor[] = [];

  const add = (key: string, value: string, label: string, source: LearnV2ContextFactor["source"], confidence = 0.74) => {
    out.push(makeFactor(key, value, label, evidenceIds, source, confidence));
  };

  const metadataTheme = metadataString(input.metadata, "theme", "ui.theme");
  if (metadataTheme) add("ui.theme", normalizeValue(metadataTheme), `UI theme is ${normalizeValue(metadataTheme)}`, "metadata", 0.88);
  if (/\b(light|white)\b/.test(text)) add("ui.theme", "light", "UI theme is light", "text");
  if (/\b(dark|black)\b/.test(text)) add("ui.theme", "dark", "UI theme is dark", "text");

  const metadataContainer = metadataString(input.metadata, "container", "component.container");
  if (metadataContainer) {
    add("component.container", normalizeValue(metadataContainer), `Component container is ${normalizeValue(metadataContainer)}`, "metadata", 0.88);
  }
  if (/\b(card|panel|tile)\b/.test(text)) add("component.container", "card", "Component is inside a card", "text");
  if (/\b(independent|standalone|outside card|not in a card|no card)\b/.test(text)) {
    add("component.container", "independent", "Component is independent", "text");
  }

  const metadataRole = metadataString(input.metadata, "componentRole", "component.role");
  if (metadataRole) add("component.role", normalizeValue(metadataRole), `Component role is ${normalizeValue(metadataRole)}`, "metadata", 0.86);
  if (/\b(primary cta|cta|call to action)\b/.test(text)) add("component.role", "primary-cta", "Component role is primary CTA", "text");
  if (/\b(button)\b/.test(text)) add("component.role", "button", "Component role is button", "text");

  const surfaceKind = metadataString(input.metadata, "surfaceKind", "surface.kind");
  if (surfaceKind) add("surface.kind", normalizeValue(surfaceKind), `Surface is ${normalizeValue(surfaceKind)}`, "metadata", 0.84);
  if (/\blanding page\b/.test(text)) add("surface.kind", "landing-page", "Surface is landing page", "text");
  if (/\bdashboard\b/.test(text)) add("surface.kind", "dashboard", "Surface is dashboard", "text");

  for (const file of input.paths ?? []) {
    const normalizedPath = file.replace(/\\/g, "/").toLowerCase();
    if (/\.(tsx|jsx)$/.test(normalizedPath)) add("framework", "react", "Framework is React", "path", 0.72);
    if (normalizedPath.includes("/tests/") || /\.test\./.test(normalizedPath)) add("file.layer", "test", "File layer is test", "path", 0.72);
    if (normalizedPath.includes("/src/")) add("file.layer", "source", "File layer is source", "path", 0.68);
    if (normalizedPath.includes("/docs/") || normalizedPath.endsWith(".md")) add("file.layer", "docs", "File layer is docs", "path", 0.68);
  }

  return uniqueFactors(out);
}

export function buildLearnV2LearningObservations(episodes: LearnV2TaskEpisode[]): LearnV2LearningObservation[] {
  const observations = episodes.flatMap((episode) =>
    buildLearnV2LearningObservationsFromEvidence(episode.messages, {
      episodeId: episode.id,
      fallbackPaths: episode.pathCluster,
      fallbackRawRefs: episode.rawRefs
    })
  );
  return markRecurrenceCandidates(observations);
}

export function buildLearnV2LearningObservationsFromEvidence(
  evidence: LearnV2NormalizedEvidence[],
  options: { episodeId?: string; fallbackPaths?: string[]; fallbackRawRefs?: string[] } = {}
): LearnV2LearningObservation[] {
  const observations: LearnV2LearningObservation[] = [];
  for (const item of evidence) {
    const observation = observationFromEvidence(item, options);
    if (observation) observations.push(observation);
  }
  return markRecurrenceCandidates(observations);
}

export function inferLearnV2ConditionalHypotheses(observations: LearnV2LearningObservation[]): LearnV2ConditionalHypothesis[] {
  const byTarget = groupBy(observations.filter((item) => item.desiredOutcome), (item) => item.target);
  const hypotheses: LearnV2ConditionalHypothesis[] = [];

  for (const [target, targetObservations] of byTarget) {
    const byOutcome = groupBy(targetObservations, (item) => item.desiredOutcome ?? "");
    const hasContrast = byOutcome.size > 1;
    for (const [desiredOutcome, support] of byOutcome) {
      const counters = targetObservations.filter((item) => item.desiredOutcome !== desiredOutcome);
      const explicitDurable = support.some((item) => item.durabilitySignals.explicitDurable);
      if (!explicitDurable && !hasContrast && support.length < 2) continue;

      const factorSet = chooseDistinctiveFactors(support, counters);
      if (!factorSet.length && !explicitDurable) continue;

      const counterCovered = counters.filter((counter) => factorSet.every((factor) => hasFactor(counter, factor))).length;
      const precision = support.length / Math.max(1, support.length + counterCovered);
      const recall = support.filter((item) => factorSet.every((factor) => hasFactor(item, factor))).length / Math.max(1, support.length);
      const confidence = hypothesisConfidence({ supportCount: support.length, totalCount: targetObservations.length, precision, recall, explicitDurable, factorCount: factorSet.length });
      const status: LearnV2ConditionalHypothesis["status"] = confidence >= 0.5 ? "candidate" : "weak";
      const condition = factorSet.length ? factorSet.map((factor) => factor.label).join(" and ") : "explicit durable user instruction";
      hypotheses.push(LearnV2ConditionalHypothesisSchema.parse({
        schemaVersion: "openskill-kit.learn-v2.conditional-hypothesis.v1",
        id: `hyp_${learnV2ShortHash(`${target}:${desiredOutcome}:${factorSet.map(factorKey).join("|")}`)}`,
        target,
        desiredOutcome,
        statement: learnV2NormalizeStatement(`When ${condition}, prefer ${desiredOutcome} for ${target}.`),
        factorSet,
        supportObservationIds: support.map((item) => item.id).sort(),
        counterObservationIds: counters.map((item) => item.id).sort(),
        precision: Number(precision.toFixed(3)),
        recall: Number(recall.toFixed(3)),
        confidence,
        status,
        rationale: hasContrast
          ? "Contrastive observations use different outcomes for the same target; factors distinguish when each outcome applies."
          : "Explicit durable language or repeated support makes this eligible for review."
      }));
    }
  }

  return hypotheses.sort((a, b) => b.confidence - a.confidence || a.statement.localeCompare(b.statement));
}

export function decideLearnV2MemoryAdmission(input: {
  observations: LearnV2LearningObservation[];
  hypotheses: LearnV2ConditionalHypothesis[];
}): LearnV2MemoryAdmissionDecision[] {
  const decisions: LearnV2MemoryAdmissionDecision[] = [];
  const supportedObservationIds = new Set(input.hypotheses.flatMap((item) => item.supportObservationIds));

  for (const observation of input.observations) {
    const reasons: string[] = [];
    let decision: LearnV2MemoryAdmissionDecision["decision"] = "observe-only";
    let requiredReview = false;
    if (observation.durabilitySignals.oneOff && !observation.durabilitySignals.explicitDurable) {
      reasons.push("one-off-language");
    }
    if (!supportedObservationIds.has(observation.id)) reasons.push("insufficient-recurrence-or-contrast");
    if (observation.durabilitySignals.explicitDurable && observation.confidence >= 0.72) {
      decision = "promote-candidate";
      requiredReview = true;
      reasons.push("explicit-durable-user-language");
    }
    decisions.push(makeAdmission("observation", observation.id, decision, requiredReview, observation.confidence, reasons));
  }

  for (const hypothesis of input.hypotheses) {
    const promote = hypothesis.status === "candidate" && hypothesis.confidence >= 0.5;
    decisions.push(makeAdmission(
      "hypothesis",
      hypothesis.id,
      promote ? "promote-candidate" : "observe-only",
      promote,
      hypothesis.confidence,
      promote
        ? ["conditional-hypothesis-supported", "review-required-before-activation"]
        : ["weak-conditional-hypothesis"]
    ));
  }

  return decisions;
}

export function learnV2ConditionalHypothesesToBehaviorAtoms(
  hypotheses: LearnV2ConditionalHypothesis[],
  observations: LearnV2LearningObservation[]
): LearnV2BehaviorAtom[] {
  const observationsById = new Map(observations.map((item) => [item.id, item]));
  return hypotheses
    .filter((hypothesis) => hypothesis.status === "candidate")
    .map((hypothesis) => {
      const support = hypothesis.supportObservationIds.map((id) => observationsById.get(id)).filter((item): item is LearnV2LearningObservation => Boolean(item));
      const evidenceIds = unique(support.flatMap((item) => item.evidenceIds));
      const rawRefs = unique(support.flatMap((item) => item.rawRefs));
      const paths = unique(support.flatMap((item) => item.paths));
      return LearnV2BehaviorAtomSchema.parse({
        schemaVersion: "openskill-kit.learn-v2.behavior-atom.v1",
        id: `atom_${learnV2ShortHash(`conditional:${hypothesis.id}`)}`,
        kind: "preference",
        statement: hypothesis.statement,
        polarity: "positive",
        scope: {
          level: paths.length ? "path" : "task",
          paths,
          taskTypes: hypothesis.factorSet.some((factor) => factor.key.startsWith("ui.") || factor.key.startsWith("component.") || factor.key === "surface.kind")
            ? ["ui-design-change"]
            : []
        },
        confidence: hypothesis.confidence,
        confidenceCap: Math.min(0.78, Math.max(0.45, hypothesis.confidence)),
        sourceReliability: average(support.map((item) => item.confidence)),
        evidenceIds,
        rawRefs,
        rationale: hypothesis.rationale,
        risk: "medium",
        conditions: {
          appliesWhen: hypothesis.factorSet.map((factor) => factor.label),
          doesNotApplyWhen: []
        },
        activationHints: {
          phrases: unique([hypothesis.target, hypothesis.desiredOutcome, ...hypothesis.factorSet.map((factor) => factor.value)]),
          pathGlobs: paths,
          commands: [],
          negativeTriggers: ["user-specified-different-style", "explicit-one-off-style"]
        }
      });
    });
}

function observationFromEvidence(
  item: LearnV2NormalizedEvidence,
  options: { episodeId?: string; fallbackPaths?: string[]; fallbackRawRefs?: string[] }
): LearnV2LearningObservation | undefined {
  if (!["user", "reviewer"].includes(item.actor) && item.kind !== "file-change") return undefined;
  const text = item.text.trim();
  if (!text) return undefined;
  const normalized = normalize(text);
  const intent = inferIntent(item, normalized);
  if (!intent) return undefined;
  const paths = unique([...(item.paths ?? []), ...(options.fallbackPaths ?? [])]);
  const desiredOutcome = inferDesiredOutcome(normalized);
  const target = inferTarget(normalized, desiredOutcome);
  const explicitDurable = /\b(always|never|prefer|default|from now on|keep using)\b/.test(normalized);
  const oneOff = /\b(this time|for this|only here|one[- ]?off|single case)\b/.test(normalized);
  const evidenceIds = [item.id];
  const rawRefs = unique([item.rawRef, ...(options.fallbackRawRefs ?? [])]);
  const factors = extractLearnV2ContextFactors({ text, paths, metadata: item.metadata, evidenceIds });
  const confidence = explicitDurable ? 0.84 : oneOff ? 0.44 : intent === "correction" ? 0.66 : 0.58;
  return LearnV2LearningObservationSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.learning-observation.v1",
    id: `obs_${learnV2ShortHash(`${item.id}:${target}:${desiredOutcome ?? ""}:${text}`)}`,
    episodeId: options.episodeId ?? item.episodeId,
    evidenceIds,
    rawRefs,
    paths,
    actor: item.actor,
    intent,
    target,
    desiredOutcome,
    text,
    factors,
    durabilitySignals: {
      explicitDurable,
      oneOff,
      recurrenceCandidate: false
    },
    confidence
  });
}

function inferIntent(item: LearnV2NormalizedEvidence, normalized: string): LearnV2LearningObservation["intent"] | undefined {
  if (item.kind === "file-change") return "manual-edit";
  if (/\b(no|not this|wrong|instead|change|make|want|prefer|always|never|avoid)\b/.test(normalized)) return "correction";
  if (/\b(accepted|approved|looks good|works)\b/.test(normalized)) return "outcome";
  return undefined;
}

function inferDesiredOutcome(normalized: string): string | undefined {
  const directed = normalized.match(/\b(?:to|use|want|make|prefer|be|as)\s+(green|blue|orange|red|purple|yellow|black|white|gray|grey)\b/);
  if (directed) return normalizeValue(directed[1]!);
  const hits = colorTerms.filter((color) => new RegExp(`\\b${color}\\b`).test(normalized));
  const nonThemeHits = hits.filter((color) => !["black", "white"].includes(color));
  const selected = nonThemeHits.length ? nonThemeHits[nonThemeHits.length - 1] : hits[hits.length - 1];
  return selected ? normalizeValue(selected) : undefined;
}

function inferTarget(normalized: string, desiredOutcome?: string): string {
  const colorSuffix = desiredOutcome ? " color" : "";
  if (/\b(primary cta|cta|call to action)\b/.test(normalized)) return `primary cta${colorSuffix}`;
  if (/\bbutton\b/.test(normalized)) return `button${colorSuffix}`;
  if (desiredOutcome) return "ui color";
  if (/\btest|fixture|regression\b/.test(normalized)) return "verification behavior";
  return "project behavior";
}

function chooseDistinctiveFactors(support: LearnV2LearningObservation[], counters: LearnV2LearningObservation[]): LearnV2ContextFactor[] {
  const supportCount = Math.max(1, support.length);
  const factorCounts = new Map<string, { factor: LearnV2ContextFactor; support: number; counter: number }>();
  for (const observation of support) {
    for (const factor of uniqueFactors(observation.factors)) {
      const key = factorKey(factor);
      const current = factorCounts.get(key) ?? { factor, support: 0, counter: 0 };
      current.support += 1;
      factorCounts.set(key, current);
    }
  }
  for (const observation of counters) {
    for (const factor of uniqueFactors(observation.factors)) {
      const current = factorCounts.get(factorKey(factor));
      if (current) current.counter += 1;
    }
  }
  const minSupport = support.length <= 2 ? 1 : Math.ceil(support.length * 0.66);
  return [...factorCounts.values()]
    .filter((item) => item.support >= minSupport && item.counter < counters.length)
    .sort((a, b) =>
      a.counter - b.counter ||
      factorPriority(a.factor) - factorPriority(b.factor) ||
      b.support - a.support ||
      a.factor.label.localeCompare(b.factor.label)
    )
    .slice(0, 3)
    .map((item) => item.factor);
}

function hypothesisConfidence(input: { supportCount: number; totalCount: number; precision: number; recall: number; explicitDurable: boolean; factorCount: number }): number {
  const value =
    0.22 +
    Math.min(0.18, input.totalCount * 0.04) +
    Math.min(0.2, input.supportCount * 0.09) +
    input.precision * 0.18 +
    input.recall * 0.12 +
    (input.explicitDurable ? 0.14 : 0) +
    Math.min(0.08, input.factorCount * 0.03);
  return Number(Math.min(0.86, value).toFixed(3));
}

function makeAdmission(
  subjectKind: LearnV2MemoryAdmissionDecision["subjectKind"],
  subjectId: string,
  decision: LearnV2MemoryAdmissionDecision["decision"],
  requiredReview: boolean,
  confidence: number,
  reasons: string[]
): LearnV2MemoryAdmissionDecision {
  return LearnV2MemoryAdmissionDecisionSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.memory-admission-decision.v1",
    id: `admission_${learnV2ShortHash(`${subjectKind}:${subjectId}:${decision}`)}`,
    subjectKind,
    subjectId,
    decision,
    requiredReview,
    confidence: Number(confidence.toFixed(3)),
    reasons: unique(reasons.length ? reasons : ["no-durable-admission-signal"])
  });
}

function makeFactor(
  key: string,
  value: string,
  label: string,
  evidenceIds: string[],
  source: LearnV2ContextFactor["source"],
  confidence: number
): LearnV2ContextFactor {
  const normalizedValue = normalizeValue(value);
  return LearnV2ContextFactorSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.context-factor.v1",
    id: `factor_${learnV2ShortHash(`${key}:${normalizedValue}:${evidenceIds.join(",")}`)}`,
    key,
    value: normalizedValue,
    label,
    confidence,
    evidenceIds,
    source
  });
}

function markRecurrenceCandidates(observations: LearnV2LearningObservation[]): LearnV2LearningObservation[] {
  const counts = new Map<string, number>();
  for (const observation of observations) counts.set(observation.target, (counts.get(observation.target) ?? 0) + 1);
  return observations.map((observation) => LearnV2LearningObservationSchema.parse({
    ...observation,
    durabilitySignals: {
      ...observation.durabilitySignals,
      recurrenceCandidate: (counts.get(observation.target) ?? 0) > 1
    }
  }));
}

function hasFactor(observation: LearnV2LearningObservation, factor: LearnV2ContextFactor): boolean {
  return observation.factors.some((candidate) => candidate.key === factor.key && candidate.value === factor.value);
}

function factorKey(factor: LearnV2ContextFactor): string {
  return `${factor.key}:${factor.value}`;
}

function factorPriority(factor: LearnV2ContextFactor): number {
  const order = ["component.container", "ui.theme", "component.role", "surface.kind", "framework", "file.layer"];
  const index = order.indexOf(factor.key);
  return index === -1 ? 99 : index;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    out.set(key, [...(out.get(key) ?? []), item]);
  }
  return out;
}

function metadataString(metadata: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function uniqueFactors(items: LearnV2ContextFactor[]): LearnV2ContextFactor[] {
  const out = new Map<string, LearnV2ContextFactor>();
  for (const item of items) if (!out.has(factorKey(item))) out.set(factorKey(item), item);
  return [...out.values()];
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function average(values: number[]): number {
  if (!values.length) return 0.5;
  return Number((values.reduce((sum, item) => sum + item, 0) / values.length).toFixed(3));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9./:_ -]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function renderLearnV2ConditionalLearningArtifact(root: string, artifact: LearnV2ConditionalLearningArtifact): string {
  const lines = [
    "# Learn v2 Conditional Learning",
    "",
    `Generated: ${artifact.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Observations: ${artifact.counts.observations}`,
    `- Hypotheses: ${artifact.counts.hypotheses}`,
    `- Promoted hypotheses: ${artifact.counts.promotedHypotheses}`,
    `- Observe-only decisions: ${artifact.counts.observeOnly}`,
    `- Rejected noise: ${artifact.counts.rejectedNoise}`,
    "",
    "## Hypotheses",
    ""
  ];
  if (!artifact.hypotheses.length) lines.push("No conditional hypotheses proposed.");
  for (const hypothesis of artifact.hypotheses) {
    lines.push(`### ${hypothesis.id}`);
    lines.push("");
    lines.push(`Statement: ${hypothesis.statement}`);
    lines.push(`Status: ${hypothesis.status}`);
    lines.push(`Confidence: ${hypothesis.confidence.toFixed(2)}`);
    lines.push(`Precision/recall: ${hypothesis.precision.toFixed(2)} / ${hypothesis.recall.toFixed(2)}`);
    lines.push(`Factors: ${hypothesis.factorSet.map((factor) => `${factor.key}=${factor.value}`).join(", ") || "none"}`);
    lines.push(`Support: ${hypothesis.supportObservationIds.join(", ")}`);
    if (hypothesis.counterObservationIds.length) lines.push(`Counterexamples: ${hypothesis.counterObservationIds.join(", ")}`);
    lines.push("");
  }
  lines.push("## Admission Decisions");
  lines.push("");
  if (!artifact.admissionDecisions.length) lines.push("No admission decisions.");
  for (const decision of artifact.admissionDecisions) {
    lines.push(`- ${decision.subjectKind} ${decision.subjectId}: ${decision.decision}; review=${decision.requiredReview}; confidence=${decision.confidence.toFixed(2)}; reasons=${decision.reasons.join(", ")}`);
  }
  lines.push("");
  lines.push("## Observations");
  lines.push("");
  if (!artifact.observations.length) lines.push("No observations.");
  for (const observation of artifact.observations) {
    lines.push(`### ${observation.id}`);
    lines.push("");
    lines.push(`Intent: ${observation.intent}`);
    lines.push(`Target: ${observation.target}`);
    if (observation.desiredOutcome) lines.push(`Desired outcome: ${observation.desiredOutcome}`);
    if (observation.paths.length) lines.push(`Paths: ${observation.paths.map((file) => learnV2SafeLocalPath(file, root)).join(", ")}`);
    lines.push(`Factors: ${observation.factors.map((factor) => `${factor.key}=${factor.value}`).join(", ") || "none"}`);
    lines.push(`Durability: explicit=${observation.durabilitySignals.explicitDurable}, oneOff=${observation.durabilitySignals.oneOff}, recurrence=${observation.durabilitySignals.recurrenceCandidate}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
