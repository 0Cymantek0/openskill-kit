import type { LearnV2ConceptCard, LearnV2EvalReport } from "./schemas.js";

export interface LearnV2ConceptQualityGate {
  name: string;
  conceptIds: string[];
  passDetails: string;
  failDetails: (ids: string[]) => string;
}

export interface LearnV2ConceptActivationGateFailure {
  name: string;
  conceptIds: string[];
  details: string;
}

export function evaluateLearnV2ConceptQualityGates(concepts: LearnV2ConceptCard[]): LearnV2EvalReport["results"][number] {
  const gates = buildLearnV2ConceptQualityGates(concepts);
  const checks = gates.map((gate) => check(
    gate.name,
    gate.conceptIds.length === 0,
    gate.conceptIds.length ? gate.failDetails(gate.conceptIds.slice(0, 6)) : gate.passDetails
  ));
  return {
    id: "concept-quality-gates",
    status: checks.every((item) => item.status === "pass") ? "pass" : "fail",
    checks
  };
}

export function findLearnV2ActivationGateFailures(
  concepts: LearnV2ConceptCard[],
  conceptIds: Iterable<string>
): LearnV2ConceptActivationGateFailure[] {
  const requested = new Set(conceptIds);
  if (!requested.size) return [];
  return buildLearnV2ConceptQualityGates(concepts)
    .map((gate) => {
      const blocked = gate.conceptIds.filter((id) => requested.has(id));
      return blocked.length
        ? { name: gate.name, conceptIds: blocked, details: gate.failDetails(blocked.slice(0, 6)) }
        : undefined;
    })
    .filter((item): item is LearnV2ConceptActivationGateFailure => item !== undefined);
}

function buildLearnV2ConceptQualityGates(concepts: LearnV2ConceptCard[]): LearnV2ConceptQualityGate[] {
  const reviewable = concepts.filter((concept) => concept.status !== "rejected" && concept.status !== "one-off" && concept.status !== "superseded");
  const missingActivation = reviewable
    .filter((concept) => !concept.activation.phrases.length && !concept.activation.pathGlobs.length && !concept.activation.commands.length)
    .map((concept) => concept.id);
  const overbroadWeak = reviewable
    .filter((concept) => concept.scope.level === "project" && !concept.scope.paths.length && !concept.scope.taskTypes.length && concept.evidenceIds.length < 2 && concept.status !== "locked")
    .map((concept) => concept.id);
  const unsupportedHighConfidence = reviewable
    .filter((concept) => concept.evidenceIds.length < 2 && concept.confidence > 0.85)
    .map((concept) => concept.id);
  const commandPoliciesWithoutCommands = reviewable
    .filter((concept) => concept.atoms.some((atom) => atom.kind === "command-policy") && !concept.activation.commands.length)
    .map((concept) => concept.id);
  const activeLowReliability = reviewable
    .filter((concept) => (concept.status === "active" || concept.status === "locked") && concept.sourceReliability < 0.45)
    .map((concept) => concept.id);
  const activeLowDurability = reviewable
    .filter((concept) => (concept.status === "active" || concept.status === "locked") && concept.durability < 0.35)
    .map((concept) => concept.id);
  const activeWithCounterevidence = reviewable
    .filter((concept) => (concept.status === "active" || concept.status === "locked") && concept.counterevidence.length > 0)
    .map((concept) => concept.id);
  const riskyWithoutSuppression = reviewable
    .filter((concept) => (concept.risk === "high" || concept.atoms.some((atom) => atom.polarity === "negative")) && !concept.scope.negativeTriggers.length)
    .map((concept) => concept.id);
  const confidenceOverAtomCap = reviewable
    .filter((concept) => {
      const cap = Math.max(...concept.atoms.map((atom) => atom.confidenceCap), 0);
      return concept.confidence > cap + 0.01;
    })
    .map((concept) => concept.id);
  const rawExportable = reviewable
    .filter((concept) => concept.privacy.rawRefsExportable !== false || concept.privacy.declassificationRequired !== true)
    .map((concept) => concept.id);

  return [
    gate(
      "activation-surface",
      missingActivation,
      "all reviewable concepts have activation phrases, paths, or commands",
      "missing activation on"
    ),
    gate(
      "overbroad-weak-evidence",
      overbroadWeak,
      "no unlocked project-scope concept relies on single evidence",
      "project-scope concepts need stronger evidence or narrower scope"
    ),
    gate(
      "single-evidence-confidence-cap",
      unsupportedHighConfidence,
      "single-evidence concepts stay below high-confidence cap",
      "single-evidence concepts over confidence cap"
    ),
    gate(
      "command-policy-has-command",
      commandPoliciesWithoutCommands,
      "command policies expose concrete command activation",
      "command-policy concepts without extracted commands"
    ),
    gate(
      "active-source-reliability",
      activeLowReliability,
      "active concepts meet source reliability floor",
      "active concepts with weak source reliability"
    ),
    gate(
      "active-durability",
      activeLowDurability,
      "active concepts meet durability floor",
      "active concepts with weak durability"
    ),
    gate(
      "active-counterevidence",
      activeWithCounterevidence,
      "counterevidence blocks active/locked concepts",
      "active concepts still have counterevidence"
    ),
    gate(
      "risky-suppression",
      riskyWithoutSuppression,
      "risky or negative concepts expose suppression triggers",
      "risky/negative concepts missing suppression triggers"
    ),
    gate(
      "confidence-cap",
      confidenceOverAtomCap,
      "concept confidence stays within atom confidence caps",
      "concept confidence exceeds atom cap"
    ),
    gate(
      "privacy-boundary",
      rawExportable,
      "raw refs remain non-exportable and declassification-required",
      "concept privacy boundary broken"
    )
  ];
}

function gate(
  name: string,
  conceptIds: string[],
  passDetails: string,
  failPrefix: string
): LearnV2ConceptQualityGate {
  return {
    name,
    conceptIds,
    passDetails,
    failDetails: (ids) => `${failPrefix}: ${ids.join(", ")}`
  };
}

function check(name: string, passed: boolean, details: string): LearnV2EvalReport["results"][number]["checks"][number] {
  return { name, status: passed ? "pass" : "fail", details };
}
