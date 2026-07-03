import {
  LearnV2EpisodeLearningBundleSchema,
  LearnV2LlmConceptExtractionOutputSchema,
  type LearnV2BehaviorAtom,
  type LearnV2EpisodeLearningBundle,
  type LearnV2LlmConceptExtractionOutput,
  type LearnV2TaskEpisode
} from "./schemas.js";
import { learnV2CanonicalKey, learnV2NormalizeStatement, learnV2ShortHash, learnV2Snippet } from "./utils.js";

export interface LearnV2ExtractorResult {
  atoms: LearnV2BehaviorAtom[];
  rejected: Array<{ id: string; reason: string }>;
}

export function extractLearnV2BehaviorAtoms(episodes: LearnV2TaskEpisode[]): LearnV2ExtractorResult {
  const atoms: LearnV2BehaviorAtom[] = [];
  const rejected: LearnV2ExtractorResult["rejected"] = [];
  for (const episode of episodes) {
    for (const atom of extractEpisodeAtoms(episode)) {
      if (containsRawSecret(atom.statement)) {
        rejected.push({ id: atom.id, reason: "raw-secret-like-output" });
        continue;
      }
      atoms.push(atom);
    }
  }
  atoms.push(...extractCrossEpisodeCommandPolicies(episodes));
  return { atoms: dedupeAtoms(atoms), rejected };
}

function extractEpisodeAtoms(episode: LearnV2TaskEpisode): LearnV2BehaviorAtom[] {
  const atoms: LearnV2BehaviorAtom[] = [];
  const learningEvidenceIds = learnablePreferenceEvidenceIds(episode);
  const learningPatches = learnablePatchComparisons(episode);
  const text = [
    ...episode.messages.map((message) => `${message.actor}: ${message.text}`),
    ...episode.toolSummaries.map((tool) => `tool:${tool.toolName}:${tool.status}:${tool.command ?? ""}:${tool.summary}`),
    ...learningPatches.map((patch) => `patch:${patch.structuralClasses.join(",")}:${patch.summary}`),
    ...learningPatches
      .filter((patch) => patch.comparison)
      .map((patch) => `patch-comparison:${patch.comparison!.relation}:${patch.comparison!.behaviorSignal}:${patch.comparison!.reasons.join(",")}`)
  ].join("\n");
  const preferenceText = [
    ...episode.messages
      .filter((message) => learningEvidenceIds.has(message.id))
      .map((message) => `${message.actor}: ${message.text}`),
    ...episode.phases
      .filter((phase) => phase.phase === "review/correction" || phase.phase === "goal" || phase.phase === "finalization")
      .map((phase) => phase.summary)
  ].join("\n");
  for (const statement of extractPreferenceStatements(preferenceText)) {
    atoms.push(makeAtom(episode, {
      kind: /secret|token|credential|authorization|api key/i.test(statement) ? "security" : "workflow",
      statement,
      polarity: /\b(never|avoid|do not|don't|stop)\b/i.test(statement) ? "negative" : "positive",
      rationale: "Explicit preference or correction language in episode.",
      confidenceCap: 0.9,
      risk: /never|secret|credential|authorization/i.test(statement) ? "high" : "medium"
    }));
  }
  if (episode.outcome === "rejected" && /\b(?:broad rewrite|rewrite the whole|large refactor|big refactor)\b/i.test(text)) {
    atoms.push(makeAtom(episode, {
      kind: "scope-boundary",
      statement: "Avoid broad rewrites or large refactors when a focused project-scoped fix can satisfy the task.",
      polarity: "negative",
      rationale: "Rejected episode criticized broad rewrite/refactor behavior.",
      confidenceCap: 0.86,
      risk: "medium"
    }));
  }
  if (/\b(?:manual edit|user edited|instead|wrong approach|should have)\b/i.test(text) && /\b(?:fixture|regression|test)\b/i.test(text)) {
    atoms.push(makeAtom(episode, {
      kind: "verification",
      statement: "Prefer focused regression tests or fixtures around the changed behavior before broader verification.",
      polarity: "positive",
      rationale: "Correction or manual edit paired with test/fixture language.",
      confidenceCap: 0.88,
      risk: "medium"
    }));
  }
  atoms.push(...extractPatchCorrectionAtoms(episode, learningPatches));
  if (episode.taskHints.includes("parser-change") && episode.taskHints.includes("testing")) {
    atoms.push(makeAtom(episode, {
      kind: "verification",
      statement: "For parser changes, add or run focused parser regression tests before relying on broad suites.",
      polarity: "positive",
      rationale: "Episode links parser changes with tests or regression fixtures.",
      confidenceCap: 0.9,
      risk: "medium"
    }));
  }
  if (/\b(?:secret|token|api key|authorization|credential|private key)\b/i.test(text)) {
    atoms.push(makeAtom(episode, {
      kind: "security",
      statement: "Never propagate secrets, credentials, authorization headers, private keys, or API keys into generated artifacts or logs.",
      polarity: "negative",
      rationale: "Episode contains security-sensitive correction or evidence.",
      confidenceCap: 0.92,
      risk: "high"
    }));
  }
  const passingCommands = episode.toolSummaries.filter((tool) => tool.status === "pass" && tool.command);
  for (const command of repeatedCommands(passingCommands.map((tool) => tool.command!))) {
    atoms.push(makeAtom(episode, {
      kind: "command-policy",
      statement: `When task scope matches ${scopeLabel(episode)}, prefer running \`${command}\` as a focused verification command before broader suites.`,
      polarity: "positive",
      rationale: "Command passed more than once in one reconstructed episode; scoped as conditional command policy, not unconditional global rule.",
      confidenceCap: 0.82,
      risk: "low"
    }));
  }
  return atoms;
}

function makeAtom(
  episode: LearnV2TaskEpisode,
  input: Pick<LearnV2BehaviorAtom, "kind" | "statement" | "polarity" | "rationale" | "confidenceCap" | "risk"> & {
    evidenceIds?: string[];
    rawRefs?: string[];
    scope?: Partial<LearnV2BehaviorAtom["scope"]>;
    conditions?: LearnV2BehaviorAtom["conditions"];
    activationHints?: LearnV2BehaviorAtom["activationHints"];
    counterevidence?: LearnV2BehaviorAtom["counterevidence"];
  }
): LearnV2BehaviorAtom {
  const scopedPaths = episode.pathCluster.filter((file) => !file.includes("[")).slice(0, 12);
  const inputPaths = (input.scope?.paths ?? []).filter((file) => !file.includes("[")).slice(0, 12);
  const paths = inputPaths.length ? inputPaths : scopedPaths;
  const taskTypes = uniqueStrings([
    ...(input.scope?.taskTypes ?? []),
    ...episode.taskHints.filter((hint) => !hint.startsWith("command:"))
  ]).slice(0, 8);
  const supportConfidence = 0.72
    + (episode.outcome === "edited" || episode.outcome === "rejected" ? 0.12 : 0)
    + (episode.rawRefs.length > 1 ? 0.04 : 0)
    + (learnablePatchComparisons(episode).length ? 0.04 : 0);
  const episodeCap = 0.34 + (episode.episodeConfidence * 0.58);
  const confidence = Math.min(input.confidenceCap, episodeCap, supportConfidence * episode.episodeConfidence);
  const sourceReliability = Number(Math.min(0.95, 0.35 + episode.episodeConfidence * 0.5 + (episode.outcome === "edited" || episode.outcome === "rejected" ? 0.08 : 0)).toFixed(2));
  return {
    schemaVersion: "openskill-kit.learn-v2.behavior-atom.v1",
    id: `atom_${learnV2ShortHash(`${episode.id}:${input.kind}:${input.polarity}:${input.statement}`)}`,
    kind: input.kind,
    statement: learnV2NormalizeStatement(input.statement),
    polarity: input.polarity,
    scope: {
      level: input.scope?.level ?? (paths.length ? "path" : "project"),
      paths,
      taskTypes
    },
    confidence: Number(confidence.toFixed(2)),
    confidenceCap: input.confidenceCap,
    sourceReliability,
    evidenceIds: input.evidenceIds ?? episode.evidenceIds,
    rawRefs: input.rawRefs ?? episode.rawRefs,
    rationale: input.rationale,
    risk: input.risk,
    conditions: input.conditions,
    activationHints: input.activationHints,
    counterevidence: input.counterevidence ?? []
  };
}

export interface LearnV2LlmExtractionProposal {
  atoms: Array<{
    id?: string;
    statement: string;
    kind: LearnV2BehaviorAtom["kind"];
    polarity: LearnV2BehaviorAtom["polarity"];
    evidenceIds: string[];
    rawRefs?: string[];
    confidence?: number;
    confidenceCap?: number;
    rationale?: string;
    risk?: LearnV2BehaviorAtom["risk"];
    scope?: Partial<LearnV2BehaviorAtom["scope"]>;
    appliesWhen?: string[];
    doesNotApplyWhen?: string[];
    activation?: LearnV2BehaviorAtom["activationHints"];
    counterevidence?: LearnV2BehaviorAtom["counterevidence"];
    oneOff?: boolean;
  }>;
}

export function buildLearnV2EpisodeLearningBundle(episode: LearnV2TaskEpisode): LearnV2EpisodeLearningBundle {
  return LearnV2EpisodeLearningBundleSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.episode-learning-bundle.v1",
    episodeId: episode.id,
    evidenceIds: episode.evidenceIds,
    taskHints: episode.taskHints,
    outcome: episode.outcome,
    episodeConfidence: episode.episodeConfidence,
    episodeConfidenceBreakdown: episode.episodeConfidenceBreakdown,
    phases: episode.phases,
    scope: {
      paths: episode.pathCluster,
      branch: episode.branch
    },
    messages: episode.messages.slice(0, 40).map((message) => ({
      evidenceId: message.id,
      actor: message.actor,
      status: message.status,
      text: learnV2Snippet(message.text, 1200)
    })),
    tools: episode.toolSummaries.slice(0, 30).map((tool) => ({
      id: tool.id,
      evidenceId: tool.evidenceId,
      toolName: tool.toolName,
      status: tool.status,
      command: tool.command,
      commandShape: tool.commandShape,
      summary: learnV2Snippet(tool.summary, 800),
      outputCompression: tool.outputCompression
    })),
    patches: episode.patchComparisons.slice(0, 20).map((patch) => ({
      id: patch.id,
      evidenceId: patch.evidenceId,
      paths: patch.paths,
      structuralClasses: patch.structuralClasses,
      structuralSummary: patch.structuralSummary,
      comparison: patch.comparison,
      behaviorEligible: patch.behaviorEligible !== false,
      filterReasons: patch.filterReasons ?? [],
      addedLines: patch.addedLines,
      removedLines: patch.removedLines,
      summary: learnV2Snippet(patch.summary, 1000)
    })),
    instructions: [
      "Return strict JSON only with schemaVersion openskill-kit.learn-v2.llm-concept-extraction-output.v1.",
      "Every atom must cite one or more evidenceIds from this bundle.",
      "Do not include raw refs, raw local paths, secrets, credentials, or private identifiers.",
      "Prefer scoped, durable project behavior over one-off task facts.",
      "Commands must be conditional on task/path scope, never unconditional global rules.",
      "Do not infer behavior from patches where behaviorEligible is false; those patches are shown only for audit context."
    ]
  });
}

function learnablePatchComparisons(episode: LearnV2TaskEpisode): LearnV2TaskEpisode["patchComparisons"] {
  return episode.patchComparisons.filter((patch) => patch.behaviorEligible !== false);
}

function extractPatchCorrectionAtoms(
  episode: LearnV2TaskEpisode,
  patches: LearnV2TaskEpisode["patchComparisons"]
): LearnV2BehaviorAtom[] {
  const byId = new Map(patches.map((patch) => [patch.id, patch]));
  const atoms: LearnV2BehaviorAtom[] = [];
  for (const patch of patches) {
    const comparison = patch.comparison;
    if (!comparison || (comparison.role !== "user-final" && comparison.role !== "manual-edit")) continue;
    if (comparison.confidence < 0.5) continue;
    if (comparison.behaviorSignal === "user-kept-proposal" || comparison.behaviorSignal === "unknown") continue;
    const counterpart = comparison.counterpartPatchId ? byId.get(comparison.counterpartPatchId) : undefined;
    const evidenceIds = uniqueStrings([patch.evidenceId, counterpart?.evidenceId].filter((value): value is string => Boolean(value)));
    const correctionScopePaths = uniqueStrings([
      ...comparison.sharedPaths,
      ...comparison.finalOnlyPaths,
      ...patch.paths
    ]).filter((file) => !file.includes("[")).slice(0, 12);
    const common = {
      evidenceIds: evidenceIds.length ? evidenceIds : episode.evidenceIds,
      rawRefs: episode.rawRefs,
      scope: {
        level: correctionScopePaths.length ? "path" as const : "task" as const,
        paths: correctionScopePaths,
        taskTypes: uniqueStrings([
          ...episode.taskHints.filter((hint) => !hint.startsWith("command:")),
          "patch-correction",
          comparison.behaviorSignal
        ]).slice(0, 8)
      },
      activationHints: patchComparisonActivationHints(comparison, correctionScopePaths),
      counterevidence: counterpart?.evidenceId ? [{
        evidenceId: counterpart.evidenceId,
        reason: `Earlier proposed patch differed from final patch: ${comparison.reasons.join(", ") || comparison.behaviorSignal}.`
      }] : undefined
    };
    if (comparison.behaviorSignal === "user-added-tests") {
      atoms.push(makeAtom(episode, {
        kind: "verification",
        statement: "When final edits add tests over an earlier patch, include focused regression coverage for the changed behavior.",
        polarity: "positive",
        rationale: "Final patch added test scope that was absent from the proposed patch.",
        confidenceCap: 0.88,
        risk: "medium",
        conditions: {
          appliesWhen: ["A user-final or manual-edit patch adds tests, fixtures, or regression coverage absent from the proposed patch."],
          doesNotApplyWhen: ["Patch comparison is generated-only, lockfile-only, formatting-only, or lacks shared semantic scope."]
        },
        ...common
      }));
    } else if (comparison.behaviorSignal === "user-narrowed-scope") {
      atoms.push(makeAtom(episode, {
        kind: "scope-boundary",
        statement: "Avoid broad patch scope when final user edits narrow the assistant proposal; keep changes to the semantic files needed for the task.",
        polarity: "negative",
        rationale: "Final patch removed paths or structural classes from the proposed patch.",
        confidenceCap: 0.84,
        risk: "medium",
        conditions: {
          appliesWhen: ["Final patch keeps only a narrower subset of paths or structural classes from the proposed patch."],
          doesNotApplyWhen: ["User explicitly asks for broad refactor, migration, or architecture-wide cleanup."]
        },
        ...common
      }));
    } else if (comparison.behaviorSignal === "user-removed-generated-or-lockfile") {
      atoms.push(makeAtom(episode, {
        kind: "scope-boundary",
        statement: "Do not treat generated files or lockfile churn as durable learning signal when final user edits remove them from the patch.",
        polarity: "negative",
        rationale: "Final patch removed generated or lockfile-only changes from an earlier proposed patch.",
        confidenceCap: 0.86,
        risk: "low",
        conditions: {
          appliesWhen: ["Proposed patch includes generated or lockfile files that final user edits omit."],
          doesNotApplyWhen: ["Task explicitly requests dependency lockfile updates or generated artifact refresh."]
        },
        ...common
      }));
    } else if (comparison.behaviorSignal === "user-changed-api-surface") {
      atoms.push(makeAtom(episode, {
        kind: "review-policy",
        statement: "Treat user changes to exported symbols or imports over a proposal as API-surface correction and re-check public contracts plus dependent tests.",
        polarity: "positive",
        rationale: "Final patch changed symbols or imports relative to the proposed patch.",
        confidenceCap: 0.82,
        risk: "medium",
        conditions: {
          appliesWhen: ["Final patch changes exported symbols, public declarations, or imports compared with the proposed patch."],
          doesNotApplyWhen: ["Only comments, formatting, generated files, or lockfiles changed."]
        },
        ...common
      }));
    } else if (comparison.behaviorSignal === "user-expanded-scope") {
      atoms.push(makeAtom(episode, {
        kind: "workflow",
        statement: "When final user edits expand scope beyond the proposal, carry related semantic files and focused tests needed to complete the task.",
        polarity: "positive",
        rationale: "Final patch added paths or structural classes that were absent from the proposed patch.",
        confidenceCap: 0.82,
        risk: "medium",
        conditions: {
          appliesWhen: ["Final patch adds related semantic files, test files, or structural classes absent from the proposed patch."],
          doesNotApplyWhen: ["Expansion is generated-only, dependency-only, or unrelated to the task path cluster."]
        },
        ...common
      }));
    } else if (comparison.behaviorSignal === "user-reworked-patch") {
      atoms.push(makeAtom(episode, {
        kind: "review-policy",
        statement: "When user final edits materially rework a patch, prefer the final diff structure over the assistant proposal as learning evidence.",
        polarity: "positive",
        rationale: "Final patch materially changed the proposal without a simpler scope-only signal.",
        confidenceCap: 0.76,
        risk: "medium",
        conditions: {
          appliesWhen: ["Final patch shares task scope with the proposed patch but has materially different structural details."],
          doesNotApplyWhen: ["Final patch keeps the proposal shape or only changes formatting."]
        },
        ...common
      }));
    }
  }
  return atoms;
}

function patchComparisonActivationHints(
  comparison: NonNullable<LearnV2TaskEpisode["patchComparisons"][number]["comparison"]>,
  paths: string[]
): LearnV2BehaviorAtom["activationHints"] {
  return {
    phrases: uniqueStrings([
      "patch correction",
      comparison.behaviorSignal.replace(/^user-/, "").replace(/-/g, " "),
      ...comparison.finalOnlyStructuralClasses.map((item) => `${item} patch`)
    ]).slice(0, 8),
    pathGlobs: paths.map((file) => {
      const parts = file.split("/").filter(Boolean);
      return parts.length > 1 ? `${parts.slice(0, -1).join("/")}/**` : file;
    }).slice(0, 8),
    commands: [],
    negativeTriggers: ["formatting-only", "generated-only", "lockfile-only"]
  };
}

function learnablePreferenceEvidenceIds(episode: LearnV2TaskEpisode): Set<string> {
  const learnablePhases = new Set<LearnV2TaskEpisode["phases"][number]["phase"]>(["goal", "review/correction", "finalization"]);
  if (!episode.phases.length) return new Set(episode.messages.map((message) => message.id));
  return new Set(episode.phases.filter((phase) => learnablePhases.has(phase.phase)).flatMap((phase) => phase.evidenceIds));
}

export function renderLearnV2ConceptExtractionPrompt(bundle: LearnV2EpisodeLearningBundle): string {
  return [
    "You are an OpenSkillKit Learn v2 concept extractor running through OpenCode-configured model routing.",
    "Treat this bundle as declassified proposal input. Your output is untrusted and will be validated.",
    "",
    "Required output JSON:",
    JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
      atoms: [{
        statement: "Durable scoped behavior statement.",
        kind: "workflow|security|verification|dependency-policy|review-policy|command-policy|scope-boundary",
        polarity: "positive|negative|neutral",
        evidenceIds: ["ev_..."],
        scope: {
          level: "path|directory|task|project",
          paths: ["path/from/bundle"],
          taskTypes: ["parser-change"]
        },
        appliesWhen: ["Only under bounded condition supported by cited evidence."],
        doesNotApplyWhen: ["Condition where this behavior should be suppressed."],
        activation: {
          phrases: ["short task phrase"],
          pathGlobs: ["packages/core/src/**"],
          commands: ["npm test -- parser"],
          negativeTriggers: ["unrelated-task-scope"]
        },
        counterevidence: [{
          evidenceId: "ev_...",
          reason: "Why this cited evidence limits or contradicts the atom."
        }],
        risk: "low|medium|high",
        confidence: 0.7,
        confidenceCap: 0.78,
        oneOff: false,
        rationale: "Why this follows from cited evidence."
      }],
      rejected: []
    }, null, 2),
    "",
    "EpisodeLearningBundle:",
    JSON.stringify(bundle, null, 2)
  ].join("\n");
}

export function parseLearnV2LlmConceptExtractionOutput(text: string): LearnV2LlmConceptExtractionOutput {
  return LearnV2LlmConceptExtractionOutputSchema.parse(JSON.parse(extractFirstJsonObject(text)));
}

export function extractFirstJsonObject(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty Learn v2 model output.");
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue with wrapped-output recovery below.
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (fenced?.[1]) {
    const candidate = fenced[1].trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Continue with brace scan; models sometimes put explanatory text inside fences too.
    }
  }
  const candidate = scanBalancedJsonObject(trimmed);
  if (!candidate) throw new Error("No JSON object found in Learn v2 model output.");
  return candidate;
}

function scanBalancedJsonObject(text: string): string | undefined {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (start === -1) {
      if (char !== "{") continue;
      start = index;
      depth = 1;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth !== 0) continue;
    const candidate = text.slice(start, index + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      start = -1;
      depth = 0;
    }
  }
  return undefined;
}

export function validateLearnV2LlmExtractionProposal(episode: LearnV2TaskEpisode, proposal: LearnV2LlmExtractionProposal): LearnV2ExtractorResult {
  const validEvidence = new Set(episode.evidenceIds);
  const validRawRefs = new Set(episode.rawRefs);
  const atoms: LearnV2BehaviorAtom[] = [];
  const rejected: LearnV2ExtractorResult["rejected"] = [];
  for (const [index, item] of proposal.atoms.entries()) {
    const id = item.id ?? `llm_atom_${index}`;
    const evidenceIds = uniqueStrings(item.evidenceIds);
    if (!evidenceIds.length || evidenceIds.some((evidenceId) => !validEvidence.has(evidenceId))) {
      rejected.push({ id, reason: "missing-or-invalid-evidence-id" });
      continue;
    }
    if (item.rawRefs?.some((rawRef) => !validRawRefs.has(rawRef))) {
      rejected.push({ id, reason: "invalid-raw-ref" });
      continue;
    }
    const rawRefs = item.rawRefs?.length ? uniqueStrings(item.rawRefs) : episode.rawRefs.filter((rawRef) => evidenceIds.some((evidenceId) => rawRef.includes(evidenceId))).slice(0, 12);
    const richText = [
      item.statement,
      item.rationale ?? "",
      ...(item.appliesWhen ?? []),
      ...(item.doesNotApplyWhen ?? []),
      ...(item.activation?.phrases ?? []),
      ...(item.activation?.pathGlobs ?? []),
      ...(item.activation?.commands ?? []),
      ...(item.activation?.negativeTriggers ?? []),
      ...(item.counterevidence ?? []).flatMap((entry) => [entry.evidenceId, entry.reason])
    ].join("\n");
    if (containsRawSecret(richText)) {
      rejected.push({ id, reason: "raw-secret-like-output" });
      continue;
    }
    const scope = normalizeLlmProposalScope(episode, item.scope);
    if (scope === "invalid") {
      rejected.push({ id, reason: "invalid-scope" });
      continue;
    }
    const counterevidence = normalizeLlmCounterevidence(item.counterevidence ?? [], validEvidence);
    if (counterevidence === "invalid") {
      rejected.push({ id, reason: "invalid-counterevidence" });
      continue;
    }
    const activationHints = normalizeLlmActivationHints(episode, item.activation);
    const conditions = normalizeLlmConditions(item.appliesWhen ?? [], item.doesNotApplyWhen ?? [], item.oneOff === true);
    const confidenceCap = Math.min(
      item.oneOff === true ? 0.42 : 0.78,
      item.confidenceCap ?? item.confidence ?? 0.7
    );
    atoms.push(makeAtom(episode, {
      kind: item.kind,
      statement: item.statement,
      polarity: item.polarity,
      rationale: item.rationale ?? "OpenCode-routed model proposal validated against episode evidence.",
      confidenceCap,
      risk: item.risk ?? (item.kind === "security" ? "high" : "medium"),
      evidenceIds,
      rawRefs: rawRefs.length ? rawRefs : episode.rawRefs,
      scope,
      conditions,
      activationHints,
      counterevidence
    }));
  }
  return { atoms, rejected };
}

export function validateLearnV2LlmConceptExtractionOutput(episode: LearnV2TaskEpisode, output: LearnV2LlmConceptExtractionOutput): LearnV2ExtractorResult {
  return validateLearnV2LlmExtractionProposal(episode, output);
}

function extractPreferenceStatements(text: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\b((?:always|prefer|make sure to|default to)\s+[^.!?\n]{8,240})/gi,
    /\b((?:never|avoid|do not|don't|stop)\s+[^.!?\n]{8,240})/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) out.push(learnV2Snippet(match[1]!.trim(), 240));
  }
  return [...new Set(out)].slice(0, 12);
}

function repeatedCommands(commands: string[]): string[] {
  const counts = new Map<string, number>();
  for (const command of commands) counts.set(command, (counts.get(command) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([command]) => command)
    .slice(0, 4);
}

function extractCrossEpisodeCommandPolicies(episodes: LearnV2TaskEpisode[]): LearnV2BehaviorAtom[] {
  const byCommand = new Map<string, LearnV2TaskEpisode[]>();
  for (const episode of episodes) {
    const commands = new Set(
      episode.toolSummaries
        .filter((tool) => tool.status === "pass" && tool.command && commandCanBecomePolicy(tool))
        .map((tool) => tool.command!)
    );
    for (const command of commands) byCommand.set(command, [...(byCommand.get(command) ?? []), episode]);
  }
  const atoms: LearnV2BehaviorAtom[] = [];
  for (const [command, supportingEpisodes] of byCommand) {
    if (supportingEpisodes.length < 2) continue;
    atoms.push(makeCrossEpisodeCommandAtom(command, supportingEpisodes.slice(0, 6)));
  }
  return atoms;
}

function commandCanBecomePolicy(tool: LearnV2TaskEpisode["toolSummaries"][number]): boolean {
  const command = tool.command ?? "";
  if (!command.trim()) return false;
  if ((tool.commandShape?.riskFlags ?? []).length) return false;
  if (/\b(?:rm|del|Remove-Item|drop|truncate|destroy|delete|deploy|release|publish)\b/i.test(command)) return false;
  if (/\b(?:e2e|integration|full|all|soak|load-test|benchmark)\b/i.test(command)) return false;
  return true;
}

function makeCrossEpisodeCommandAtom(command: string, episodes: LearnV2TaskEpisode[]): LearnV2BehaviorAtom {
  const evidenceIds = [...new Set(episodes.flatMap((episode) => episode.evidenceIds))].slice(0, 20);
  const rawRefs = [...new Set(episodes.flatMap((episode) => episode.rawRefs))].slice(0, 12);
  const paths = [...new Set(episodes.flatMap((episode) => episode.pathCluster).filter((file) => !file.includes("[")))].slice(0, 12);
  const taskTypes = [...new Set(episodes.flatMap((episode) => episode.taskHints).filter((hint) => !hint.startsWith("command:")))].slice(0, 8);
  const avgConfidence = episodes.reduce((sum, episode) => sum + episode.episodeConfidence, 0) / episodes.length;
  const confidence = Math.min(0.88, 0.68 + Math.min(0.12, episodes.length * 0.04) + (avgConfidence * 0.08));
  return {
    schemaVersion: "openskill-kit.learn-v2.behavior-atom.v1",
    id: `atom_${learnV2ShortHash(`cross-episode-command:${command}:${evidenceIds.join(",")}`)}`,
    kind: "command-policy",
    statement: learnV2NormalizeStatement(`When task scope matches ${scopeLabelForEpisodes(episodes)}, prefer running \`${command}\` as a focused verification command before broader suites`),
    polarity: "positive",
    scope: {
      level: paths.length ? "path" : "project",
      paths,
      taskTypes
    },
    confidence: Number(confidence.toFixed(2)),
    confidenceCap: 0.88,
    sourceReliability: Number(Math.min(0.92, 0.58 + avgConfidence * 0.28).toFixed(2)),
    evidenceIds,
    rawRefs,
    rationale: "Same non-risky command passed across multiple reconstructed episodes; scoped as conditional command policy.",
    risk: "low"
  };
}

function scopeLabelForEpisodes(episodes: LearnV2TaskEpisode[]): string {
  const taskHints = [...new Set(episodes.flatMap((episode) => episode.taskHints))];
  if (taskHints.includes("parser-change")) return "parser changes";
  if (taskHints.includes("security")) return "security-sensitive changes";
  const paths = [...new Set(episodes.flatMap((episode) => episode.pathCluster).filter(Boolean))];
  if (paths.length) return `paths like ${paths.slice(0, 3).join(", ")}`;
  return "similar repeated tasks";
}

function scopeLabel(episode: LearnV2TaskEpisode): string {
  if (episode.taskHints.includes("parser-change")) return "parser changes";
  if (episode.taskHints.includes("security")) return "security-sensitive changes";
  if (episode.pathCluster.length) return `paths like ${episode.pathCluster.slice(0, 3).join(", ")}`;
  return "the current task";
}

function dedupeAtoms(atoms: LearnV2BehaviorAtom[]): LearnV2BehaviorAtom[] {
  const byKey = new Map<string, LearnV2BehaviorAtom>();
  for (const atom of atoms) {
    const key = `${atom.kind}:${atom.polarity}:${learnV2CanonicalKey(atom.statement)}:${atom.scope.paths[0] ?? "project"}`;
    const existing = byKey.get(key);
    if (!existing || atom.confidence > existing.confidence) byKey.set(key, atom);
  }
  return [...byKey.values()].sort((a, b) => b.confidence - a.confidence || a.statement.localeCompare(b.statement));
}

function containsRawSecret(text: string): boolean {
  return /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)\b/.test(text);
}

function normalizeLlmProposalScope(
  episode: LearnV2TaskEpisode,
  scope: Partial<LearnV2BehaviorAtom["scope"]> | undefined
): LearnV2BehaviorAtom["scope"] | "invalid" | undefined {
  if (!scope) return undefined;
  const knownPaths = new Set(episode.pathCluster.filter((file) => !file.includes("[")));
  const paths = uniqueStrings((scope.paths ?? []).map(normalizePathText).filter(Boolean));
  if (paths.some((file) => !knownPaths.has(file))) return "invalid";
  const taskTypes = uniqueStrings((scope.taskTypes ?? []).map(normalizeTaskType).filter(Boolean)).slice(0, 8);
  return {
    level: scope.level ?? (paths.length ? "path" : taskTypes.length ? "task" : "project"),
    paths,
    taskTypes
  };
}

function normalizeLlmCounterevidence(
  counterevidence: NonNullable<LearnV2BehaviorAtom["counterevidence"]>,
  validEvidence: Set<string>
): NonNullable<LearnV2BehaviorAtom["counterevidence"]> | "invalid" {
  const out: NonNullable<LearnV2BehaviorAtom["counterevidence"]> = [];
  for (const item of counterevidence) {
    if (!validEvidence.has(item.evidenceId)) return "invalid";
    const reason = safeProposalText(item.reason, 260);
    if (!reason) return "invalid";
    out.push({ evidenceId: item.evidenceId, reason });
  }
  return uniqueCounterevidence(out).slice(0, 12);
}

function normalizeLlmActivationHints(episode: LearnV2TaskEpisode, hints: LearnV2BehaviorAtom["activationHints"] | undefined): LearnV2BehaviorAtom["activationHints"] | undefined {
  if (!hints) return undefined;
  const knownScopes = new Set(episode.pathCluster.flatMap((file) => {
    const normalized = normalizePathText(file);
    const parts = normalized.split("/").filter(Boolean);
    return [normalized, parts.length > 1 ? `${parts.slice(0, -1).join("/")}/**` : normalized];
  }));
  return {
    phrases: uniqueStrings((hints.phrases ?? []).map((item) => safeProposalText(item, 100)).filter(Boolean)).slice(0, 10),
    pathGlobs: uniqueStrings((hints.pathGlobs ?? []).map(normalizePathText).filter((item) => knownScopes.has(item))).slice(0, 10),
    commands: uniqueStrings((hints.commands ?? []).map((item) => safeProposalText(item, 160)).filter(Boolean)).slice(0, 8),
    negativeTriggers: uniqueStrings((hints.negativeTriggers ?? []).map((item) => safeProposalText(item, 140)).filter(Boolean)).slice(0, 10)
  };
}

function normalizeLlmConditions(appliesWhen: string[], doesNotApplyWhen: string[], oneOff: boolean): LearnV2BehaviorAtom["conditions"] | undefined {
  const applies = uniqueStrings(appliesWhen.map((item) => safeProposalText(item, 220)).filter(Boolean)).slice(0, 8);
  const exclusions = uniqueStrings([
    ...doesNotApplyWhen.map((item) => safeProposalText(item, 220)).filter(Boolean),
    ...(oneOff ? ["One-off episode; require repeated support before activation."] : [])
  ]).slice(0, 8);
  return applies.length || exclusions.length ? { appliesWhen: applies, doesNotApplyWhen: exclusions } : undefined;
}

function normalizePathText(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function normalizeTaskType(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function safeProposalText(value: string, max: number): string {
  const text = learnV2Snippet(value.replace(/\s+/g, " ").trim(), max);
  return containsRawSecret(text) ? "" : text;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function uniqueCounterevidence(values: NonNullable<LearnV2BehaviorAtom["counterevidence"]>): NonNullable<LearnV2BehaviorAtom["counterevidence"]> {
  const seen = new Set<string>();
  const out: NonNullable<LearnV2BehaviorAtom["counterevidence"]> = [];
  for (const item of values) {
    const key = `${item.evidenceId}:${item.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
