import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../storage/atomic.js";
import {
  LearnV2ConceptDebugTraceArtifactSchema,
  LearnV2ConceptDebugTraceEntrySchema,
  type LearnV2ConceptCard,
  type LearnV2ConceptDebugTraceArtifact,
  type LearnV2ConceptDebugTraceEntry,
  type LearnV2ConditionalLearningArtifact,
  type LearnV2LearningObservation,
  type LearnV2OpenWorldGroundingArtifact,
  type LearnV2OutcomePolicyArtifact,
  type LearnV2ReviewQueue,
  type LearnV2SkillOntologyArtifact
} from "./schemas.js";
import { learnV2SafeLocalPath } from "./utils.js";

export interface LearnV2ConceptDebugTraceContext {
  conditionalLearning?: LearnV2ConditionalLearningArtifact;
  skillOntology?: LearnV2SkillOntologyArtifact;
  openWorldGrounding?: LearnV2OpenWorldGroundingArtifact;
  outcomePolicy?: LearnV2OutcomePolicyArtifact;
  reviewQueue?: LearnV2ReviewQueue;
}

export interface LearnV2ConceptDebugTraceView {
  schemaVersion: "openskill-kit.learn-v2.concept-debug-trace-view.v1";
  generatedAt: string;
  sourcePath: string;
  counts: LearnV2ConceptDebugTraceArtifact["counts"];
  traces: LearnV2ConceptDebugTraceEntry[];
  artifacts: {
    json: string;
    markdown: string;
  };
}

export async function writeLearnV2ConceptDebugTraceArtifact(
  rootInput: string,
  concepts: LearnV2ConceptCard[],
  now = new Date(),
  context: LearnV2ConceptDebugTraceContext = {}
): Promise<LearnV2ConceptDebugTraceArtifact> {
  const root = path.resolve(rootInput);
  const stamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const dir = path.join(root, ".openskill-kit", "learn-v2", "concept-debug-trace");
  const json = path.join(dir, `concept-debug-trace-${stamp}.json`);
  const markdown = path.join(dir, `concept-debug-trace-${stamp}.md`);
  const traces = concepts.map((concept) => buildTrace(concept, context));
  const artifact = LearnV2ConceptDebugTraceArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.concept-debug-trace-artifact.v1",
    generatedAt: now.toISOString(),
    traces,
    counts: {
      concepts: concepts.length,
      tracedConcepts: traces.length,
      conditionalLinks: traces.reduce((sum, trace) => sum + trace.conditional.hypothesisIds.length + trace.conditional.observationIds.length, 0),
      openWorldLinks: traces.reduce((sum, trace) => sum + trace.openWorldGrounding.anchorIds.length, 0),
      reviewBlockedConcepts: traces.filter((trace) => trace.whyActive.activationState === "inactive-review-required" || trace.review.conflictIds.length || trace.review.driftReasons.length).length,
      outcomePolicyLinks: traces.filter((trace) => trace.outcomePolicy.action).length,
      outcomeSuppressedConcepts: traces.filter((trace) => trace.outcomePolicy.suppressed).length
    },
    artifacts: { json, markdown }
  });
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(json, artifact);
  await fs.writeFile(markdown, renderConceptDebugTrace(root, artifact), "utf8");
  return artifact;
}

export async function readLearnV2ConceptDebugTraceView(
  rootInput: string,
  options: { tracePath?: string; conceptId?: string } = {}
): Promise<LearnV2ConceptDebugTraceView> {
  const root = path.resolve(rootInput);
  const file = options.tracePath ? path.resolve(root, options.tracePath) : await latestConceptDebugTracePath(root);
  const artifact = LearnV2ConceptDebugTraceArtifactSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
  const traces = options.conceptId
    ? artifact.traces.filter((trace) => trace.conceptId === options.conceptId)
    : artifact.traces;
  return {
    schemaVersion: "openskill-kit.learn-v2.concept-debug-trace-view.v1",
    generatedAt: artifact.generatedAt,
    sourcePath: learnV2SafeLocalPath(file, root),
    counts: artifact.counts,
    traces,
    artifacts: {
      json: learnV2SafeLocalPath(artifact.artifacts.json, root),
      markdown: learnV2SafeLocalPath(artifact.artifacts.markdown, root)
    }
  };
}

async function latestConceptDebugTracePath(root: string): Promise<string> {
  const dir = path.join(root, ".openskill-kit", "learn-v2", "concept-debug-trace");
  const files = await fs.readdir(dir).catch(() => []);
  const jsonFiles = files
    .filter((file) => /^concept-debug-trace-(?:\d{14}|\d{8,})\.json$/.test(file) || file === "concept-debug-trace.json")
    .sort();
  const latest = jsonFiles.at(-1);
  if (!latest) throw new Error("No Learn v2 concept debug trace artifact found. Run `openskill-kit osk learn --raw --surface-file <path> --apply` or `openskill-kit osk learn --extract-concepts` first.");
  return path.join(dir, latest);
}

function buildTrace(concept: LearnV2ConceptCard, context: LearnV2ConceptDebugTraceContext): LearnV2ConceptDebugTraceEntry {
  const evidenceIds = new Set(concept.evidenceIds);
  const atomStatements = concept.atoms.map((atom) => atom.statement);
  const hypotheses = (context.conditionalLearning?.hypotheses ?? []).filter((hypothesis) =>
    hypothesis.supportObservationIds.some((id) => observationEvidenceIds(id, context).some((evidenceId) => evidenceIds.has(evidenceId))) ||
    atomStatements.some((statement) => normalize(statement) === normalize(hypothesis.statement))
  );
  const hypothesisObservationIds = new Set(hypotheses.flatMap((hypothesis) => hypothesis.supportObservationIds));
  const observations = (context.conditionalLearning?.observations ?? []).filter((observation) =>
    observation.evidenceIds.some((evidenceId) => evidenceIds.has(evidenceId)) || hypothesisObservationIds.has(observation.id)
  );
  const linkedIds = new Set([...observations.map((item) => item.id), ...hypotheses.map((item) => item.id)]);
  const admissionDecisions = (context.conditionalLearning?.admissionDecisions ?? [])
    .filter((decision) => linkedIds.has(decision.subjectId))
    .map((decision) => ({
      id: decision.id,
      subjectKind: decision.subjectKind,
      subjectId: decision.subjectId,
      decision: decision.decision,
      requiredReview: decision.requiredReview,
      reviewPriority: decision.reviewPriority,
      riskLevel: decision.riskLevel,
      privacyBoundary: decision.privacyBoundary,
      scopeLevel: decision.scopeLevel,
      reasons: decision.reasons
    }));
  const namespaces = (context.skillOntology?.namespaces ?? []).filter((namespace) => namespace.conceptIds.includes(concept.id));
  const anchors = (context.openWorldGrounding?.anchors ?? []).filter((anchor) => anchor.conceptId === concept.id);
  const groundingRecommendations = (context.openWorldGrounding?.recommendations ?? []).filter((recommendation) => recommendation.conceptId === concept.id);
  const conflicts = (context.reviewQueue?.conflictDetails ?? []).filter((conflict) => conflict.conceptIds.includes(concept.id));
  const drift = (context.reviewQueue?.driftSummary.staleCandidates ?? []).filter((candidate) => candidate.conceptId === concept.id);
  const snippets = (context.reviewQueue?.evidenceSnippets ?? []).filter((snippet) => evidenceIds.has(snippet.evidenceId));
  const reviewActions = context.reviewQueue?.reviewActions[concept.id] ?? [];
  const factorLabels = unique([
    ...observations.flatMap((observation) => observation.factors.map((factor) => `${factor.key}=${factor.value}`)),
    ...hypotheses.flatMap((hypothesis) => hypothesis.factorSet.map((factor) => `${factor.key}=${factor.value}`))
  ]);
  const namespaceIds = new Set(namespaces.map((namespace) => namespace.id));
  const ontologyOperations = (context.skillOntology?.operations ?? []).filter((operation) =>
    operation.conceptIds.includes(concept.id) || operation.namespaceIds.some((id) => namespaceIds.has(id))
  );
  const outcomePolicyDecision = context.outcomePolicy?.decisions.find((decision) => decision.conceptId === concept.id);
  const outcomePolicy = outcomePolicyDecision
    ? {
        action: outcomePolicyDecision.action,
        suppressed: outcomePolicyDecision.action === "suppress-activation",
        reasons: outcomePolicyDecision.reasons,
        counts: outcomePolicyDecision.counts,
        lastRecordedAt: outcomePolicyDecision.lastRecordedAt
      }
    : {
        suppressed: false,
        reasons: [],
        counts: { helpful: 0, ignored: 0, wrong: 0, harmful: 0, superseded: 0 }
      };
  const activationDetails = buildActivationTraceDetails(concept, admissionDecisions, conflicts, drift, outcomePolicyDecision);
  const missingLinks = missingLinkDiagnostics(concept, {
    observationCount: observations.length,
    hypothesisCount: hypotheses.length,
    namespaceCount: namespaces.length,
    groundingCount: anchors.length
  });
  const userPreferenceEvidence = observations.filter((observation) => ["user", "reviewer"].includes(observation.actor)).length;
  const modelInterpretation = hypotheses.length + namespaces.length;
  return LearnV2ConceptDebugTraceEntrySchema.parse({
    schemaVersion: "openskill-kit.learn-v2.concept-debug-trace-entry.v1",
    conceptId: concept.id,
    title: concept.title,
    status: concept.status,
    risk: concept.risk,
    canonicalBehavior: concept.canonicalBehavior,
    behaviorDelta: concept.behaviorDelta,
    whyLearned: {
      summary: summarizeWhyLearned(concept, observations, hypotheses, namespaces.length, anchors.length, missingLinks),
      evidenceIds: concept.evidenceIds,
      supportAtomIds: concept.atoms.map((atom) => atom.id),
      supportAtomStatements: atomStatements,
      scoringReasons: concept.scoring?.reasons ?? [],
      scoringPenalties: concept.scoring?.penalties ?? [],
      rawRefCount: concept.rawRefs.length,
      confidence: concept.confidence,
      durability: concept.durability,
      sourceReliability: concept.sourceReliability
    },
    whyActive: {
      activationState: activationState(concept),
      reviewGate: activationDetails.blockedConditions.length || activationDetails.negativeTriggers.length
        ? activationDetails.reviewGate
        : summarizeWhyActive(concept, outcomePolicy.suppressed, outcomePolicy.reasons, missingLinks),
      phrases: concept.activation.phrases,
      pathGlobs: concept.activation.pathGlobs,
      commands: concept.activation.commands,
      appliesWhen: concept.conditions?.appliesWhen ?? [],
      doesNotApplyWhen: unique([...(concept.conditions?.doesNotApplyWhen ?? []), ...activationDetails.blockedConditions]),
      negativeTriggers: unique([...concept.scope.negativeTriggers, ...activationDetails.negativeTriggers])
    },
    conditional: {
      observationIds: observations.map((observation) => observation.id),
      hypothesisIds: hypotheses.map((hypothesis) => hypothesis.id),
      factorLabels,
      admissionDecisions
    },
    ontology: {
      namespaceIds: namespaces.map((namespace) => namespace.id),
      labels: namespaces.map((namespace) => namespace.label),
      operationIds: ontologyOperations.map((operation) => operation.id)
    },
    openWorldGrounding: {
      anchorIds: anchors.map((anchor) => anchor.id),
      titles: anchors.map((anchor) => anchor.title),
      trustTiers: unique(anchors.map((anchor) => anchor.trustTier)),
      precedence: unique(anchors.map((anchor) => anchor.precedence)),
      rankedAnchors: anchors
        .map((anchor) => ({
          id: anchor.id,
          title: anchor.title,
          trustTier: anchor.trustTier,
          precedence: anchor.precedence,
          retrievalScore: anchor.retrievalScore,
          matchReasons: anchor.matchReasons,
          usedFor: anchor.usedFor
        }))
        .sort((a, b) => b.retrievalScore - a.retrievalScore || a.title.localeCompare(b.title)),
      recommendations: groundingRecommendations.map((recommendation) => ({
        id: recommendation.id,
        recommendation: recommendation.recommendation,
        proposedSkillText: recommendation.proposedSkillText,
        proposedConditions: recommendation.proposedConditions,
        verificationChecks: recommendation.verificationChecks,
        sourceAnchorIds: recommendation.sourceAnchorIds,
        confidence: recommendation.confidence,
        reviewRequired: recommendation.reviewRequired
      }))
    },
    review: {
      conflictIds: conflicts.map((conflict) => conflict.conflictId),
      counterevidenceCount: concept.counterevidence.length,
      driftReasons: drift.map((candidate) => candidate.reason),
      evidenceSnippetIds: snippets.map((snippet) => snippet.snippetId),
      reviewActionLabels: reviewActions.map((action) => action.label)
    },
    outcomePolicy,
    evidenceSeparation: {
      userPreferenceEvidence,
      projectEvidence: Math.max(0, concept.evidenceIds.length - userPreferenceEvidence),
      externalGrounding: anchors.length,
      modelInterpretation
    }
  });
}

function observationEvidenceIds(observationId: string, context: LearnV2ConceptDebugTraceContext): string[] {
  return context.conditionalLearning?.observations.find((observation) => observation.id === observationId)?.evidenceIds ?? [];
}

type TraceAdmissionDecision = LearnV2ConceptDebugTraceEntry["conditional"]["admissionDecisions"][number];
type TraceConflict = NonNullable<LearnV2ConceptDebugTraceContext["reviewQueue"]>["conflictDetails"][number];
type TraceDriftCandidate = NonNullable<LearnV2ConceptDebugTraceContext["reviewQueue"]>["driftSummary"]["staleCandidates"][number];
type TraceOutcomePolicyDecision = NonNullable<LearnV2ConceptDebugTraceContext["outcomePolicy"]>["decisions"][number];

interface ActivationTraceDetails {
  reviewGate: string;
  blockedConditions: string[];
  negativeTriggers: string[];
}

function buildActivationTraceDetails(
  concept: LearnV2ConceptCard,
  admissionDecisions: TraceAdmissionDecision[],
  conflicts: TraceConflict[],
  drift: TraceDriftCandidate[],
  outcomePolicyDecision?: TraceOutcomePolicyDecision
): ActivationTraceDetails {
  const blockers: string[] = [];
  const blockedConditions: string[] = [];
  const negativeTriggers: string[] = [];
  let suppressedByOutcome = false;
  if (outcomePolicyDecision?.action === "suppress-activation") {
    suppressedByOutcome = true;
    const reasonText = outcomePolicyDecision.reasons.join("; ") || "outcome policy threshold reached";
    blockers.push(`Outcome policy suppresses activation: ${reasonText}`);
    blockedConditions.push(`Outcome policy suppresses activation: ${reasonText}`);
    negativeTriggers.push(...outcomePolicyDecision.reasons.map((reason) => `outcome suppression: ${reason}`));
  }
  if (concept.status !== "active" && concept.status !== "locked") {
    const statusReason = activationStatusBlocker(concept.status);
    blockers.push(statusReason);
    blockedConditions.push(statusReason);
  }
  for (const decision of admissionDecisions.filter((item) => item.requiredReview || item.decision === "requires-human-review")) {
    const reasons = decision.reasons.join("; ") || decision.decision;
    const label = `Review required for ${decision.subjectKind}:${decision.subjectId} (${decision.decision}; priority=${decision.reviewPriority}; risk=${decision.riskLevel}; scope=${decision.scopeLevel}): ${reasons}`;
    blockers.push(label);
    blockedConditions.push(label);
  }
  for (const conflict of conflicts) {
    const authority = conflict.diagnostics?.authorityReasons.length
      ? `; authority=${conflict.diagnostics.authorityReasons.join(", ")}`
      : "";
    const protectedReasons = conflict.diagnostics?.protectedReasons.length
      ? `; protected=${conflict.diagnostics.protectedReasons.join(", ")}`
      : "";
    const label = `Review conflict ${conflict.conflictId}: type=${conflict.conflictType}; suggested=${conflict.suggestedResolution}${authority}${protectedReasons}`;
    blockers.push(label);
    blockedConditions.push(label);
  }
  for (const candidate of drift) {
    const label = `Review drift ${candidate.reason}: ${candidate.suggestion}`;
    blockers.push(label);
    blockedConditions.push(label);
  }
  if (blockers.length) {
    return {
      reviewGate: `${suppressedByOutcome ? "Why suppressed: " : ""}Activation blocked or suppressed: ${unique(blockers).join(" | ")}`,
      blockedConditions: unique(blockedConditions),
      negativeTriggers: unique(negativeTriggers)
    };
  }
  return {
    reviewGate: "Concept can activate when task context matches scope, phrases, paths, commands, and conditions.",
    blockedConditions: [],
    negativeTriggers: []
  };
}

function activationStatusBlocker(status: LearnV2ConceptCard["status"]): string {
  switch (status) {
    case "candidate":
      return "Status candidate blocks runtime activation until review accepts or stages it.";
    case "staged":
      return "Status staged blocks runtime activation until it is promoted active.";
    case "rejected":
      return "Status rejected blocks runtime activation.";
    case "conflict":
      return "Status conflict blocks runtime activation until conflict review resolves it.";
    case "superseded":
      return "Status superseded blocks runtime activation.";
    case "one-off":
      return "Status one-off keeps this as trace/debug evidence only.";
    case "active":
    case "locked":
      return "Concept can activate.";
  }
}

function summarizeWhyLearned(
  concept: LearnV2ConceptCard,
  observations: LearnV2LearningObservation[],
  hypotheses: { id: string }[],
  namespaceCount: number,
  anchorCount: number,
  missingLinks: string[]
): string {
  const parts = [
    "Why learned:",
    `${concept.evidenceIds.length} declassified evidence item(s) produced ${concept.atoms.length} support atom(s).`,
    observations.length ? `${observations.length} learning observation(s) link this concept to user/reviewer behavior.` : "No conditional observation link found.",
    hypotheses.length ? `${hypotheses.length} conditional hypothesis link(s) explain hidden factors.` : "No conditional hypothesis link found.",
    namespaceCount ? `${namespaceCount} emergent namespace(s) group this behavior.` : "No emergent namespace linked.",
    anchorCount ? `${anchorCount} open-world anchor(s) provide review/verification grounding.` : "No open-world anchor linked.",
    `Missing links: ${missingLinks.join(", ") || "none"}.`
  ];
  return parts.join(" ");
}

function summarizeWhyActive(
  concept: LearnV2ConceptCard,
  suppressed: boolean,
  suppressionReasons: string[],
  missingLinks: string[]
): string {
  if (suppressed) {
    return `Why suppressed: outcome policy suppresses activation (${suppressionReasons.join(", ") || "no declassified reason"}).`;
  }
  if (concept.status === "active" || concept.status === "locked") {
    return missingLinks.includes("missing-activation-evidence")
      ? "Why active: concept is accepted, but no compact activation evidence is linked; activation may rely on broad fallback matching."
      : "Why active: concept can activate when task context matches scope, phrases, paths, commands, and conditions.";
  }
  return "Why active: concept remains review-gated; it explains learning but should not activate until accepted.";
}

function missingLinkDiagnostics(
  concept: LearnV2ConceptCard,
  links: {
    observationCount: number;
    hypothesisCount: number;
    namespaceCount: number;
    groundingCount: number;
  }
): string[] {
  const missing: string[] = [];
  if (!links.observationCount) missing.push("missing-observations");
  if (!links.hypothesisCount) missing.push("missing-hypotheses");
  if (!links.namespaceCount) missing.push("missing-ontology-namespace");
  if (!links.groundingCount) missing.push("missing-grounding");
  if (!hasActivationEvidence(concept)) missing.push("missing-activation-evidence");
  return missing;
}

function hasActivationEvidence(concept: LearnV2ConceptCard): boolean {
  return [
    concept.activation.phrases,
    concept.activation.pathGlobs,
    concept.activation.commands,
    concept.conditions?.appliesWhen ?? [],
    concept.conditions?.doesNotApplyWhen ?? [],
    concept.scope.negativeTriggers
  ].some((items) => items.length > 0);
}

function activationState(concept: LearnV2ConceptCard): LearnV2ConceptDebugTraceEntry["whyActive"]["activationState"] {
  if (concept.status === "active") return "active";
  if (concept.status === "locked") return "locked";
  if (concept.status === "staged") return "staged";
  if (concept.status === "rejected") return "rejected";
  if (concept.status === "superseded") return "superseded";
  if (concept.status === "one-off") return "one-off";
  return "inactive-review-required";
}

function renderConceptDebugTrace(root: string, artifact: LearnV2ConceptDebugTraceArtifact): string {
  const lines = [
    "# Learn v2 Concept Debug Trace",
    "",
    `Generated: ${artifact.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Concepts: ${artifact.counts.concepts}`,
    `- Traced concepts: ${artifact.counts.tracedConcepts}`,
    `- Conditional links: ${artifact.counts.conditionalLinks}`,
    `- Open-world links: ${artifact.counts.openWorldLinks}`,
    `- Review-blocked concepts: ${artifact.counts.reviewBlockedConcepts}`,
    `- Outcome policy links: ${artifact.counts.outcomePolicyLinks}`,
    `- Outcome-suppressed concepts: ${artifact.counts.outcomeSuppressedConcepts}`,
    "",
    "## Traces",
    ""
  ];
  if (!artifact.traces.length) lines.push("No concept debug traces written.");
  for (const trace of artifact.traces) {
    lines.push(`### ${trace.title}`);
    lines.push("");
    lines.push(`Concept: ${trace.conceptId}`);
    lines.push(`Status: ${trace.status}; Risk: ${trace.risk}`);
    lines.push(`Behavior: ${trace.canonicalBehavior}`);
    lines.push(`Delta: ${trace.behaviorDelta}`);
    lines.push("");
    lines.push("Trace summary:");
    lines.push(`- Why learned: ${trace.whyLearned.summary}`);
    lines.push(`- Why active/suppressed: ${trace.whyActive.reviewGate}`);
    lines.push("");
    lines.push("Why learned:");
    lines.push(`- ${trace.whyLearned.summary}`);
    lines.push(`- Evidence IDs: ${trace.whyLearned.evidenceIds.join(", ") || "none"}`);
    lines.push(`- Support atoms: ${trace.whyLearned.supportAtomStatements.join(" | ") || "none"}`);
    lines.push(`- Scoring reasons: ${trace.whyLearned.scoringReasons.join(", ") || "none"}`);
    lines.push(`- Scoring penalties: ${trace.whyLearned.scoringPenalties.join(", ") || "none"}`);
    lines.push("");
    lines.push("Why active:");
    lines.push(`- Activation state: ${trace.whyActive.activationState}`);
    lines.push(`- Review gate: ${trace.whyActive.reviewGate}`);
    lines.push(`- Apply when: ${trace.whyActive.appliesWhen.join("; ") || "none"}`);
    lines.push(`- Do not apply when: ${trace.whyActive.doesNotApplyWhen.join("; ") || "none"}`);
    lines.push(`- Activation blockers: ${[...trace.whyActive.doesNotApplyWhen, ...trace.whyActive.negativeTriggers].join("; ") || "none"}`);
    lines.push(`- Activation phrases: ${trace.whyActive.phrases.join(", ") || "none"}`);
    lines.push(`- Commands: ${trace.whyActive.commands.join(", ") || "none"}`);
    lines.push("");
    lines.push("Outcome policy:");
    lines.push(`- Action: ${trace.outcomePolicy.action ?? "none"}`);
    lines.push(`- Suppressed: ${trace.outcomePolicy.suppressed}`);
    lines.push(`- Reasons: ${trace.outcomePolicy.reasons.join(", ") || "none"}`);
    lines.push(`- Counts: helpful=${trace.outcomePolicy.counts.helpful}, ignored=${trace.outcomePolicy.counts.ignored}, wrong=${trace.outcomePolicy.counts.wrong}, harmful=${trace.outcomePolicy.counts.harmful}, superseded=${trace.outcomePolicy.counts.superseded}`);
    lines.push(`- Last outcome: ${trace.outcomePolicy.lastRecordedAt ?? "none"}`);
    lines.push("");
    lines.push("Conditional reasoning:");
    lines.push(`- Observations: ${trace.conditional.observationIds.join(", ") || "none"}`);
    lines.push(`- Hypotheses: ${trace.conditional.hypothesisIds.join(", ") || "none"}`);
    lines.push(`- Factors: ${trace.conditional.factorLabels.join(", ") || "none"}`);
    lines.push(`- Admission: ${trace.conditional.admissionDecisions.map((decision) => `${decision.subjectKind}:${decision.decision}`).join(", ") || "none"}`);
    lines.push(`- Admission details: ${trace.conditional.admissionDecisions.map((decision) =>
      `${decision.subjectKind}:${decision.subjectId} requiredReview=${decision.requiredReview} priority=${decision.reviewPriority} risk=${decision.riskLevel} scope=${decision.scopeLevel} reasons=${decision.reasons.join(", ") || "none"}`
    ).join(" | ") || "none"}`);
    lines.push("");
    lines.push("Source separation:");
    lines.push(`- User preference evidence: ${trace.evidenceSeparation.userPreferenceEvidence}`);
    lines.push(`- Project evidence: ${trace.evidenceSeparation.projectEvidence}`);
    lines.push(`- External grounding: ${trace.evidenceSeparation.externalGrounding}`);
    lines.push(`- Model interpretation: ${trace.evidenceSeparation.modelInterpretation}`);
    lines.push("");
    lines.push("Ontology and grounding:");
    lines.push(`- Namespaces: ${trace.ontology.labels.join(", ") || "none"}`);
    lines.push(`- Ontology operations: ${trace.ontology.operationIds.join(", ") || "none"}`);
    lines.push(`- Open-world anchors: ${trace.openWorldGrounding.titles.join(", ") || "none"}`);
    lines.push(`- Anchor precedence: ${trace.openWorldGrounding.precedence.join(", ") || "none"}`);
    for (const anchor of trace.openWorldGrounding.rankedAnchors.slice(0, 5)) {
      lines.push(`  - ${anchor.title}: score=${anchor.retrievalScore.toFixed(2)}; trust=${anchor.trustTier}; precedence=${anchor.precedence}; usedFor=${anchor.usedFor.join(", ") || "review"}; reasons=${anchor.matchReasons.join(", ") || "default"}`);
    }
    lines.push(`- Grounding recommendations: ${trace.openWorldGrounding.recommendations.length}`);
    for (const recommendation of trace.openWorldGrounding.recommendations.slice(0, 3)) {
      lines.push(`  - ${recommendation.id}: confidence=${recommendation.confidence.toFixed(2)}; reviewRequired=${recommendation.reviewRequired}; ${recommendation.recommendation}`);
      lines.push(`    Proposed skill text: ${recommendation.proposedSkillText}`);
      lines.push(`    Verification: ${recommendation.verificationChecks.join("; ") || "none"}`);
    }
    lines.push("");
    lines.push("Review signals:");
    lines.push(`- Conflicts: ${trace.review.conflictIds.join(", ") || "none"}`);
    lines.push(`- Counterevidence count: ${trace.review.counterevidenceCount}`);
    lines.push(`- Drift reasons: ${trace.review.driftReasons.join(", ") || "none"}`);
    lines.push(`- Evidence snippets: ${trace.review.evidenceSnippetIds.join(", ") || "none"}`);
    lines.push(`- Review actions: ${trace.review.reviewActionLabels.join(", ") || "none"}`);
    lines.push("");
  }
  lines.push("## Artifacts");
  lines.push("");
  lines.push(`- JSON: ${learnV2SafeLocalPath(artifact.artifacts.json, root)}`);
  lines.push(`- Markdown: ${learnV2SafeLocalPath(artifact.artifacts.markdown, root)}`);
  return `${lines.join("\n")}\n`;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
