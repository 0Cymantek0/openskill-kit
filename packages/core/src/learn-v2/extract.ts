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
    ...learningPatches.map((patch) => `patch:${patch.structuralClasses.join(",")}:${patch.summary}`)
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
  input: Pick<LearnV2BehaviorAtom, "kind" | "statement" | "polarity" | "rationale" | "confidenceCap" | "risk">
): LearnV2BehaviorAtom {
  const scopedPaths = episode.pathCluster.filter((file) => !file.includes("[")).slice(0, 12);
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
      level: scopedPaths.length ? "path" : "project",
      paths: scopedPaths,
      taskTypes: episode.taskHints.filter((hint) => !hint.startsWith("command:")).slice(0, 8)
    },
    confidence: Number(confidence.toFixed(2)),
    confidenceCap: input.confidenceCap,
    sourceReliability,
    evidenceIds: episode.evidenceIds,
    rawRefs: episode.rawRefs,
    rationale: input.rationale,
    risk: input.risk
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
    rationale?: string;
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
        confidence: 0.7,
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
  return LearnV2LlmConceptExtractionOutputSchema.parse(JSON.parse(text));
}

export function validateLearnV2LlmExtractionProposal(episode: LearnV2TaskEpisode, proposal: LearnV2LlmExtractionProposal): LearnV2ExtractorResult {
  const validEvidence = new Set(episode.evidenceIds);
  const validRawRefs = new Set(episode.rawRefs);
  const atoms: LearnV2BehaviorAtom[] = [];
  const rejected: LearnV2ExtractorResult["rejected"] = [];
  for (const [index, item] of proposal.atoms.entries()) {
    const id = item.id ?? `llm_atom_${index}`;
    if (!item.evidenceIds.length || item.evidenceIds.some((evidenceId) => !validEvidence.has(evidenceId))) {
      rejected.push({ id, reason: "missing-or-invalid-evidence-id" });
      continue;
    }
    if (item.rawRefs?.some((rawRef) => !validRawRefs.has(rawRef))) {
      rejected.push({ id, reason: "invalid-raw-ref" });
      continue;
    }
    if (containsRawSecret(item.statement)) {
      rejected.push({ id, reason: "raw-secret-like-output" });
      continue;
    }
    atoms.push(makeAtom(episode, {
      kind: item.kind,
      statement: item.statement,
      polarity: item.polarity,
      rationale: item.rationale ?? "OpenCode-routed model proposal validated against episode evidence.",
      confidenceCap: Math.min(0.78, item.confidence ?? 0.7),
      risk: item.kind === "security" ? "high" : "medium"
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
