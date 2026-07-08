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
const candidateAdmissionDecisions = new Set<LearnV2MemoryAdmissionDecision["decision"]>(["candidate-concept", "requires-human-review"]);

export interface LearnV2ConditionalLearningResult {
  observations: LearnV2LearningObservation[];
  hypotheses: LearnV2ConditionalHypothesis[];
  admissionDecisions: LearnV2MemoryAdmissionDecision[];
  atoms: LearnV2BehaviorAtom[];
}

export interface LearnV2ConditionalLearningDebugView {
  schemaVersion: "openskill-kit.learn-v2.conditional-learning-debug-view.v1";
  generatedAt: string;
  sourcePath: string;
  counts: LearnV2ConditionalLearningArtifact["counts"];
  observations: LearnV2LearningObservationDebugEntry[];
  hypotheses: LearnV2ConditionalHypothesis[];
  admissionDecisions: LearnV2MemoryAdmissionDecision[];
}

export interface LearnV2LearningObservationDebugEntry {
  id: string;
  episodeId?: string;
  evidenceIds: string[];
  rawRefCount: number;
  paths: string[];
  actor: LearnV2LearningObservation["actor"];
  intent: LearnV2LearningObservation["intent"];
  target: string;
  desiredOutcome?: string;
  textHash: string;
  textChars: number;
  factors: LearnV2ContextFactor[];
  durabilitySignals: LearnV2LearningObservation["durabilitySignals"];
  confidence: number;
}

export function runLearnV2ConditionalLearning(episodes: LearnV2TaskEpisode[]): LearnV2ConditionalLearningResult {
  const observations = buildLearnV2LearningObservations(episodes);
  const hypotheses = inferLearnV2ConditionalHypotheses(observations);
  const admissionDecisions = decideLearnV2MemoryAdmission({ observations, hypotheses });
  const promotedHypothesisIds = new Set(admissionDecisions
    .filter((item) => item.subjectKind === "hypothesis" && isCandidateAdmission(item))
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
    .filter((item) => item.subjectKind === "hypothesis" && isCandidateAdmission(item))
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
      observeOnly: result.admissionDecisions.filter((item) => item.decision === "episode-note" || item.decision === "weak-observation").length,
      rejectedNoise: result.admissionDecisions.filter((item) => item.decision === "reject-noise").length,
      episodeNotes: result.admissionDecisions.filter((item) => item.decision === "episode-note").length,
      weakObservations: result.admissionDecisions.filter((item) => item.decision === "weak-observation").length,
      candidateConcepts: result.admissionDecisions.filter((item) => item.decision === "candidate-concept").length,
      requiresHumanReview: result.admissionDecisions.filter((item) => item.decision === "requires-human-review").length
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

export async function readLearnV2ConditionalLearningDebugView(
  rootInput: string,
  options: { learningPath?: string; observationId?: string; hypothesisId?: string } = {}
): Promise<LearnV2ConditionalLearningDebugView> {
  const root = path.resolve(rootInput);
  const file = options.learningPath ? path.resolve(root, options.learningPath) : await latestConditionalLearningArtifactPath(root);
  const artifact = LearnV2ConditionalLearningArtifactSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
  const observationIdsForHypothesis = new Set(
    options.hypothesisId
      ? artifact.hypotheses
        .filter((hypothesis) => hypothesis.id === options.hypothesisId)
        .flatMap((hypothesis) => [...hypothesis.supportObservationIds, ...hypothesis.counterObservationIds])
      : []
  );
  const observations = artifact.observations.filter((observation) =>
    options.observationId
      ? observation.id === options.observationId
      : options.hypothesisId
        ? observationIdsForHypothesis.has(observation.id)
        : true
  );
  const hypotheses = artifact.hypotheses.filter((hypothesis) =>
    options.hypothesisId
      ? hypothesis.id === options.hypothesisId
      : options.observationId
        ? hypothesis.supportObservationIds.includes(options.observationId) || hypothesis.counterObservationIds.includes(options.observationId)
        : true
  );
  const visibleIds = new Set([
    ...observations.map((observation) => observation.id),
    ...hypotheses.map((hypothesis) => hypothesis.id)
  ]);
  return {
    schemaVersion: "openskill-kit.learn-v2.conditional-learning-debug-view.v1",
    generatedAt: artifact.generatedAt,
    sourcePath: learnV2SafeLocalPath(file, root),
    counts: artifact.counts,
    observations: observations.map((observation) => summarizeObservation(root, observation)),
    hypotheses,
    admissionDecisions: artifact.admissionDecisions.filter((decision) =>
      visibleIds.has(decision.subjectId) || (!options.observationId && !options.hypothesisId)
    )
  };
}

async function latestConditionalLearningArtifactPath(root: string): Promise<string> {
  const dir = path.join(root, ".openskill-kit", "learn-v2", "conditional-learning");
  const files = await fs.readdir(dir).catch(() => []);
  const jsonFiles = files
    .filter((file) => /^conditional-learning-(?:\d{14}|\d{8,})\.json$/.test(file) || file === "conditional-learning.json")
    .sort();
  const latest = jsonFiles.at(-1);
  if (!latest) throw new Error("No Learn v2 conditional-learning artifact found. Run `openskill-kit osk learn --raw --surface-file <path> --apply` or `openskill-kit osk learn --extract-concepts` first.");
  return path.join(dir, latest);
}

function summarizeObservation(root: string, observation: LearnV2LearningObservation): LearnV2LearningObservationDebugEntry {
  return {
    id: observation.id,
    episodeId: observation.episodeId,
    evidenceIds: observation.evidenceIds,
    rawRefCount: observation.rawRefs.length,
    paths: observation.paths.map((file) => safePath(root, file)),
    actor: observation.actor,
    intent: observation.intent,
    target: observation.target,
    desiredOutcome: observation.desiredOutcome,
    textHash: `sha256:${learnV2ShortHash(observation.text)}`,
    textChars: observation.text.length,
    factors: observation.factors,
    durabilitySignals: observation.durabilitySignals,
    confidence: observation.confidence
  };
}

function safePath(root: string, value: string): string {
  if (!value) return value;
  if (path.resolve(value) === path.resolve(root)) return "[PROJECT_ROOT]";
  if (path.isAbsolute(value)) return learnV2SafeLocalPath(value, root);
  return value.replace(/\\/g, "/");
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

  const cssText = normalize(metadataStrings(input.metadata, "className", "class", "classes", "cssClasses", "tailwindClasses").join(" "));
  if (cssText) {
    if (hasDarkSurfaceSignal(cssText)) add("ui.theme", "dark", "UI theme is dark", "css", 0.76);
    if (hasLightSurfaceSignal(cssText)) add("ui.theme", "light", "UI theme is light", "css", 0.76);
    if (/\b(card|panel|tile)\b/.test(cssText)) add("component.container", "card", "Component is inside a card", "css", 0.76);
    if (/\b(primary|cta)\b/.test(cssText)) add("component.role", "primary-cta", "Component role is primary CTA", "css", 0.7);
  }

  const componentTreeText = normalize(metadataStrings(input.metadata, "componentTree", "ancestorComponents", "parentComponents", "jsxAncestors", "domPath").map(pathSignalText).join(" "));
  if (componentTreeText) {
    if (/\b(card|panel|tile)\b/.test(componentTreeText)) add("component.container", "card", "Component is inside a card", "component-tree", 0.83);
    if (/\b(page|main|root|screen)\b/.test(componentTreeText) && !/\b(card|panel|tile)\b/.test(componentTreeText)) {
      add("component.container", "independent", "Component is independent", "component-tree", 0.78);
    }
    if (/\b(primary cta|cta)\b/.test(componentTreeText)) add("component.role", "primary-cta", "Component role is primary CTA", "component-tree", 0.8);
    if (/\bbutton\b/.test(componentTreeText)) add("component.role", "button", "Component role is button", "component-tree", 0.76);
  }

  const astText = normalize(metadataStrings(input.metadata, "symbols", "componentNames", "jsxComponents", "imports", "exportedNames").map(pathSignalText).join(" "));
  if (astText) {
    if (/\b(card|panel|tile)\b/.test(astText)) add("component.container", "card", "Component is inside a card", "ast", 0.78);
    if (/\b(primary cta|cta)\b/.test(astText)) add("component.role", "primary-cta", "Component role is primary CTA", "ast", 0.76);
    if (/\bbutton\b/.test(astText)) add("component.role", "button", "Component role is button", "ast", 0.72);
  }

  const screenshotText = normalize(metadataStrings(input.metadata, "screenshotLabels", "visualLabels", "detectedObjects", "imageLabels").join(" "));
  if (screenshotText) {
    if (/\b(dark background|black background|dark page|dark mode)\b/.test(screenshotText)) add("ui.theme", "dark", "UI theme is dark", "screenshot", 0.68);
    if (/\b(light background|white background|light page|light mode)\b/.test(screenshotText)) add("ui.theme", "light", "UI theme is light", "screenshot", 0.68);
    if (/\b(card|panel|tile)\b/.test(screenshotText)) add("component.container", "card", "Component is inside a card", "screenshot", 0.66);
  }

  const designTokens = metadataStrings(input.metadata, "designToken", "designTokens", "design.token", "cssVariable", "cssVariables", "colorToken", "colorTokens")
    .map((value) => value.trim())
    .filter(looksLikeDesignToken)
    .slice(0, 8);
  for (const token of designTokens) {
    const normalizedToken = normalizeValue(token).slice(0, 80);
    add("ui.design-token", normalizedToken, `Design token is ${normalizedToken}`, "design-token", 0.82);
    const tokenText = normalize(token);
    if (hasDarkSurfaceSignal(tokenText)) add("ui.theme", "dark", "UI theme is dark", "design-token", 0.78);
    if (hasLightSurfaceSignal(tokenText)) add("ui.theme", "light", "UI theme is light", "design-token", 0.78);
  }

  for (const file of input.paths ?? []) {
    const normalizedPath = file.replace(/\\/g, "/").toLowerCase();
    const pathText = pathSignalText(file);
    if (/\.(tsx|jsx)$/.test(normalizedPath)) add("framework", "react", "Framework is React", "path", 0.72);
    if (normalizedPath.includes("/tests/") || /\.test\./.test(normalizedPath)) add("file.layer", "test", "File layer is test", "path", 0.72);
    if (normalizedPath.includes("/src/")) add("file.layer", "source", "File layer is source", "path", 0.68);
    if (normalizedPath.includes("/docs/") || normalizedPath.endsWith(".md")) add("file.layer", "docs", "File layer is docs", "path", 0.68);
    if (/\b(light|white)\b/.test(pathText)) add("ui.theme", "light", "UI theme is light", "path", 0.7);
    if (/\b(dark|black)\b/.test(pathText)) add("ui.theme", "dark", "UI theme is dark", "path", 0.7);
    if (/\b(card|panel|tile)\b/.test(pathText)) add("component.container", "card", "Component is inside a card", "path", 0.7);
    if (/\b(independent|standalone)\b/.test(pathText)) add("component.container", "independent", "Component is independent", "path", 0.68);
    if (/\b(primary cta|cta)\b/.test(pathText)) add("component.role", "primary-cta", "Component role is primary CTA", "path", 0.7);
    if (/\bbutton\b/.test(pathText)) add("component.role", "button", "Component role is button", "path", 0.68);
    if (/\blanding\b/.test(pathText)) add("surface.kind", "landing-page", "Surface is landing page", "path", 0.68);
    if (/\bmarketing\b/.test(pathText)) add("surface.kind", "marketing-page", "Surface is marketing page", "path", 0.68);
    if (/\bdashboard\b/.test(pathText)) add("surface.kind", "dashboard", "Surface is dashboard", "path", 0.68);
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
      const explicitDurable = support.some((item) => item.durabilitySignals.explicitDurable && !item.durabilitySignals.oneOff);
      if (!explicitDurable && !hasContrast && support.length < 2) continue;

      const factorSet = chooseDistinctiveFactors(support, counters);
      if (!factorSet.length && !explicitDurable) continue;

      const counterCovered = counters.filter((counter) => factorSet.every((factor) => hasFactor(counter, factor))).length;
      const precision = support.length / Math.max(1, support.length + counterCovered);
      const recall = support.filter((item) => factorSet.every((factor) => hasFactor(item, factor))).length / Math.max(1, support.length);
      const confidence = hypothesisConfidence({ supportCount: support.length, totalCount: targetObservations.length, precision, recall, explicitDurable, factorCount: factorSet.length });
      const durableSupportCount = support.filter((item) => !item.durabilitySignals.oneOff).length;
      const changingContextContrast = hasChangingContextContrast(factorSet, counters);
      const candidateEligible = explicitDurable || (durableSupportCount >= 2 && changingContextContrast);
      const status: LearnV2ConditionalHypothesis["status"] = candidateEligible && confidence >= 0.5 ? "candidate" : "weak";
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
  const observationsById = new Map(input.observations.map((item) => [item.id, item]));

  for (const observation of input.observations) {
    const reasons: string[] = [];
    const policy = admissionPolicyForObservation(observation, supportedObservationIds.has(observation.id));
    reasons.push(...policy.reasons);
    if (observation.durabilitySignals.oneOff && !observation.durabilitySignals.explicitDurable) {
      reasons.push("one-off-language");
    }
    if (!supportedObservationIds.has(observation.id)) reasons.push("insufficient-recurrence-or-contrast");
    decisions.push(makeAdmission("observation", observation.id, policy, observation.confidence, reasons));
  }

  for (const hypothesis of input.hypotheses) {
    const support = hypothesis.supportObservationIds
      .map((id) => observationsById.get(id))
      .filter((item): item is LearnV2LearningObservation => Boolean(item));
    const counters = hypothesis.counterObservationIds
      .map((id) => observationsById.get(id))
      .filter((item): item is LearnV2LearningObservation => Boolean(item));
    const policy = admissionPolicyForHypothesis(hypothesis, support, counters);
    decisions.push(makeAdmission(
      "hypothesis",
      hypothesis.id,
      policy,
      hypothesis.confidence,
      policy.reasons
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
      const counters = hypothesis.counterObservationIds.map((id) => observationsById.get(id)).filter((item): item is LearnV2LearningObservation => Boolean(item));
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
          doesNotApplyWhen: contrastingCounterFactors(hypothesis.factorSet, counters).map((factor) => factor.label)
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

function hasChangingContextContrast(factorSet: LearnV2ContextFactor[], counters: LearnV2LearningObservation[]): boolean {
  return contrastingCounterFactors(factorSet, counters).length > 0;
}

function contrastingCounterFactors(factorSet: LearnV2ContextFactor[], counters: LearnV2LearningObservation[]): LearnV2ContextFactor[] {
  const supportValuesByKey = new Map(factorSet.map((factor) => [factor.key, factor.value]));
  const contrasts: LearnV2ContextFactor[] = [];
  for (const counter of counters) {
    for (const factor of uniqueFactors(counter.factors)) {
      const supportValue = supportValuesByKey.get(factor.key);
      if (supportValue && supportValue !== factor.value) contrasts.push(factor);
    }
  }
  return uniqueFactors(contrasts).sort((a, b) =>
    factorPriority(a) - factorPriority(b) ||
    a.label.localeCompare(b.label)
  );
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

interface AdmissionPolicy {
  decision: LearnV2MemoryAdmissionDecision["decision"];
  requiredReview: boolean;
  reviewPriority: LearnV2MemoryAdmissionDecision["reviewPriority"];
  riskLevel: LearnV2MemoryAdmissionDecision["riskLevel"];
  privacyBoundary: LearnV2MemoryAdmissionDecision["privacyBoundary"];
  scopeLevel: LearnV2MemoryAdmissionDecision["scopeLevel"];
  reasons: string[];
}

function admissionPolicyForObservation(observation: LearnV2LearningObservation, supportedByHypothesis: boolean): AdmissionPolicy {
  const risk = admissionRiskFromText(observation.text);
  const scopeLevel = observationScopeLevel(observation);
  const reasons: string[] = [];
  if (risk.privacyBoundary !== "low") reasons.push(`privacy-boundary:${risk.privacyBoundary}`);
  if (risk.riskLevel === "high") reasons.push("high-risk-learning-signal");
  if (scopeLevel === "project" || scopeLevel === "unknown") reasons.push(`scope:${scopeLevel}`);
  if (observation.durabilitySignals.explicitDurable) reasons.push("explicit-durable-user-language");
  if (observation.durabilitySignals.recurrenceCandidate) reasons.push("recurrence-candidate");
  if (supportedByHypothesis) reasons.push("supports-conditional-hypothesis");

  if (risk.riskLevel === "high" || risk.privacyBoundary === "high") {
    return {
      decision: "requires-human-review",
      requiredReview: true,
      reviewPriority: "critical",
      ...risk,
      scopeLevel,
      reasons: [...reasons, "strict-review-gate-for-sensitive-behavior"]
    };
  }
  if (observation.durabilitySignals.oneOff && !observation.durabilitySignals.explicitDurable) {
    return {
      decision: "episode-note",
      requiredReview: false,
      reviewPriority: "none",
      ...risk,
      scopeLevel,
      reasons: [...reasons, "trace-only-one-off"]
    };
  }
  if (observation.durabilitySignals.oneOff) {
    return {
      decision: "episode-note",
      requiredReview: false,
      reviewPriority: "none",
      ...risk,
      scopeLevel,
      reasons: [...reasons, "trace-only-one-off-overrides-durable-language"]
    };
  }
  if (observation.durabilitySignals.explicitDurable && observation.confidence >= 0.72) {
    return {
      decision: risk.privacyBoundary === "medium" ? "requires-human-review" : "candidate-concept",
      requiredReview: true,
      reviewPriority: risk.privacyBoundary === "medium" ? "high" : "normal",
      ...risk,
      scopeLevel,
      reasons: risk.privacyBoundary === "medium" ? [...reasons, "sensitive-durable-instruction"] : reasons
    };
  }
  if (supportedByHypothesis || observation.durabilitySignals.recurrenceCandidate) {
    return {
      decision: "weak-observation",
      requiredReview: false,
      reviewPriority: "none",
      ...risk,
      scopeLevel,
      reasons: [...reasons, "stored-for-future-pattern-matching"]
    };
  }
  return {
    decision: observation.confidence < 0.4 ? "reject-noise" : "weak-observation",
    requiredReview: false,
    reviewPriority: "none",
    ...risk,
    scopeLevel,
    reasons: [...reasons, observation.confidence < 0.4 ? "low-confidence-noise" : "insufficient-durable-signal"]
  };
}

function admissionPolicyForHypothesis(
  hypothesis: LearnV2ConditionalHypothesis,
  support: LearnV2LearningObservation[],
  counters: LearnV2LearningObservation[]
): AdmissionPolicy {
  const joinedText = [hypothesis.statement, ...support.map((item) => item.text)].join(" ");
  const risk = admissionRiskFromText(joinedText);
  const scopeLevel = hypothesis.factorSet.length || support.some((item) => item.paths.length) ? "path" : "project";
  const changingContextContrast = hasChangingContextContrast(hypothesis.factorSet, counters);
  const explicitDurable = support.some((item) => item.durabilitySignals.explicitDurable && !item.durabilitySignals.oneOff);
  const promotionEligible = hypothesis.status === "candidate" && hypothesis.confidence >= 0.5;
  const gatedCandidate = promotionEligible && (explicitDurable || changingContextContrast);
  const reasons = gatedCandidate
    ? ["conditional-hypothesis-supported", "review-required-before-activation"]
    : ["weak-conditional-hypothesis"];
  if (hypothesis.counterObservationIds.length) reasons.push("counterexamples-preserved");
  if (hypothesis.factorSet.length) reasons.push("stable-context-factors");
  if (support.length < 2 && !support.some((item) => item.durabilitySignals.explicitDurable)) reasons.push("single-support-hypothesis-kept-weak");
  if (changingContextContrast) reasons.push("changing-context-contrast");
  if (hypothesis.counterObservationIds.length && !changingContextContrast && !explicitDurable) reasons.push("missing-changing-context-contrast-kept-weak");
  if (!hypothesis.counterObservationIds.length && support.length >= 2 && !explicitDurable) reasons.push("no-counterexamples-for-conditional-promotion");
  if (risk.privacyBoundary !== "low") reasons.push(`privacy-boundary:${risk.privacyBoundary}`);

  if (risk.riskLevel === "high" || risk.privacyBoundary !== "low" || scopeLevel === "project") {
    return {
      decision: gatedCandidate ? "requires-human-review" : "weak-observation",
      requiredReview: gatedCandidate,
      reviewPriority: risk.riskLevel === "high" || risk.privacyBoundary === "high" ? "critical" : "high",
      ...risk,
      scopeLevel,
      reasons: [...reasons, "strict-review-gate-before-durable-memory"]
    };
  }

  return {
    decision: gatedCandidate ? "candidate-concept" : "weak-observation",
    requiredReview: gatedCandidate,
    reviewPriority: gatedCandidate ? "normal" : "none",
    ...risk,
    scopeLevel,
    reasons
  };
}

function admissionRiskFromText(text: string): Pick<AdmissionPolicy, "riskLevel" | "privacyBoundary"> {
  const normalized = normalize(text);
  if (/\b(secret|credential|token|api key|password|auth|permission|private|pii|personal data)\b/.test(normalized)) {
    return { riskLevel: "high", privacyBoundary: "high" };
  }
  if (/\b(security|privacy|access|login|session|cookie)\b/.test(normalized)) {
    return { riskLevel: "high", privacyBoundary: "medium" };
  }
  if (/\b(always|never|global|project-wide|all files|everywhere)\b/.test(normalized)) {
    return { riskLevel: "medium", privacyBoundary: "low" };
  }
  return { riskLevel: "low", privacyBoundary: "low" };
}

function observationScopeLevel(observation: LearnV2LearningObservation): AdmissionPolicy["scopeLevel"] {
  if (observation.paths.length === 1) return "path";
  if (observation.paths.length > 1) return "directory";
  if (observation.factors.length || observation.target !== "project behavior") return "task";
  return "project";
}

function isCandidateAdmission(decision: LearnV2MemoryAdmissionDecision): boolean {
  return candidateAdmissionDecisions.has(decision.decision);
}

function makeAdmission(
  subjectKind: LearnV2MemoryAdmissionDecision["subjectKind"],
  subjectId: string,
  policy: AdmissionPolicy,
  confidence: number,
  reasons: string[]
): LearnV2MemoryAdmissionDecision {
  return LearnV2MemoryAdmissionDecisionSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.memory-admission-decision.v1",
    id: `admission_${learnV2ShortHash(`${subjectKind}:${subjectId}:${policy.decision}`)}`,
    subjectKind,
    subjectId,
    decision: policy.decision,
    requiredReview: policy.requiredReview,
    reviewPriority: policy.reviewPriority,
    riskLevel: policy.riskLevel,
    privacyBoundary: policy.privacyBoundary,
    scopeLevel: policy.scopeLevel,
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
  const order = ["component.container", "ui.theme", "component.role", "ui.design-token", "surface.kind", "framework", "file.layer"];
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
  return metadataStrings(metadata, ...keys)[0];
}

function metadataStrings(metadata: Record<string, unknown> | undefined, ...keys: string[]): string[] {
  if (!metadata) return [];
  const out: string[] = [];
  for (const key of keys) out.push(...metadataValueStrings(metadata[key]));
  return unique(out.map((item) => item.trim()).filter(Boolean)).slice(0, 40);
}

function metadataValueStrings(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(metadataValueStrings);
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(metadataValueStrings);
}

function hasDarkSurfaceSignal(value: string): boolean {
  return /\b(?:dark|black|night|theme-dark|surface-dark|bg-black|bg-slate-9\d{2}|bg-zinc-9\d{2}|bg-neutral-9\d{2}|background-dark)\b/.test(value);
}

function hasLightSurfaceSignal(value: string): boolean {
  return /\b(?:light|white|theme-light|surface-light|bg-white|bg-slate-50|bg-zinc-50|bg-neutral-50|background-light)\b/.test(value);
}

function looksLikeDesignToken(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= 120 && /^(?:--|[a-z0-9_.-]+$)/i.test(trimmed) && /\b(?:color|theme|surface|background|bg|brand|accent|primary|secondary|dark|light|card|cta)\b/i.test(trimmed.replace(/[_-]+/g, " "));
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

function pathSignalText(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
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
    `- Episode notes: ${artifact.counts.episodeNotes}`,
    `- Weak observations: ${artifact.counts.weakObservations}`,
    `- Candidate concepts: ${artifact.counts.candidateConcepts}`,
    `- Requires human review: ${artifact.counts.requiresHumanReview}`,
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
    lines.push(`- ${decision.subjectKind} ${decision.subjectId}: ${decision.decision}; review=${decision.requiredReview}; priority=${decision.reviewPriority}; risk=${decision.riskLevel}; privacy=${decision.privacyBoundary}; scope=${decision.scopeLevel}; confidence=${decision.confidence.toFixed(2)}; reasons=${decision.reasons.join(", ")}`);
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
