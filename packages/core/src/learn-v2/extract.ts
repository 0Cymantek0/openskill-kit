import type { LearnV2BehaviorAtom, LearnV2TaskEpisode } from "./schemas.js";
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
  return { atoms: dedupeAtoms(atoms), rejected };
}

function extractEpisodeAtoms(episode: LearnV2TaskEpisode): LearnV2BehaviorAtom[] {
  const atoms: LearnV2BehaviorAtom[] = [];
  const text = [
    ...episode.messages.map((message) => `${message.actor}: ${message.text}`),
    ...episode.toolSummaries.map((tool) => `tool:${tool.toolName}:${tool.status}:${tool.command ?? ""}:${tool.summary}`),
    ...episode.patchComparisons.map((patch) => `patch:${patch.structuralClasses.join(",")}:${patch.summary}`)
  ].join("\n");
  for (const statement of extractPreferenceStatements(text)) {
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
      rationale: "Command passed in episode; scoped as conditional command policy, not unconditional global rule.",
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
  const baseConfidence = 0.5
    + (episode.episodeConfidence * 0.24)
    + (episode.outcome === "edited" || episode.outcome === "rejected" ? 0.12 : 0)
    + (episode.rawRefs.length > 1 ? 0.04 : 0)
    + (episode.patchComparisons.length ? 0.04 : 0);
  const sourceReliability = Number(Math.min(0.95, 0.45 + episode.episodeConfidence * 0.35 + (episode.outcome === "edited" || episode.outcome === "rejected" ? 0.12 : 0)).toFixed(2));
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
    confidence: Number(Math.min(input.confidenceCap, baseConfidence).toFixed(2)),
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
  const repeated = [...counts.entries()].filter(([, count]) => count > 1).map(([command]) => command);
  return repeated.length ? repeated : [...counts.keys()].slice(0, 2);
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

