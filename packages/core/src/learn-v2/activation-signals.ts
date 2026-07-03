import type { LearnV2ConceptCard } from "./schemas.js";

export interface LearnV2ActivationSignals {
  semanticAliases: string[];
  keywordFingerprint: string[];
  subsystemLabels: string[];
}

export interface LearnV2ActivationIndexEntry {
  conceptId: string;
  status: LearnV2ConceptCard["status"];
  title: string;
  phrases: string[];
  pathGlobs: string[];
  commands: string[];
  taskTypes: string[];
  negativeTriggers: string[];
  semanticAliases: string[];
  keywordFingerprint: string[];
  subsystemLabels: string[];
  confidence: number;
  risk: LearnV2ConceptCard["risk"];
}

const semanticFamilies: Array<{ id: string; terms: string[] }> = [
  { id: "test", terms: ["test", "tests", "spec", "specs", "fixture", "fixtures", "regression", "coverage", "assert", "assertion"] },
  { id: "parser", terms: ["parser", "parse", "parsing", "syntax", "grammar", "ast", "token", "lexer"] },
  { id: "security", terms: ["security", "secret", "secrets", "credential", "credentials", "token", "key", "keys", "auth"] },
  { id: "docs", terms: ["docs", "documentation", "readme", "guide", "markdown", "changelog"] },
  { id: "scope", terms: ["scope", "narrow", "focused", "targeted", "specific", "local", "minimal"] },
  { id: "rewrite", terms: ["rewrite", "rewrites", "refactor", "refactors", "broad", "global", "sweeping", "overhaul"] },
  { id: "validation", terms: ["validate", "validation", "verify", "verification", "check", "ci", "build"] },
  { id: "privacy", terms: ["privacy", "redact", "redaction", "declassify", "declassified", "raw", "vault", "leak"] },
  { id: "mcp", terms: ["mcp", "tool", "tools", "resource", "resources", "server"] },
  { id: "opencode", terms: ["opencode", "agent", "subagent", "model", "routing", "permission"] }
];

const familiesByTerm = new Map<string, Set<string>>();
for (const family of semanticFamilies) {
  for (const term of family.terms) {
    const current = familiesByTerm.get(term) ?? new Set<string>();
    current.add(family.id);
    familiesByTerm.set(term, current);
  }
}

const SUBSYSTEM_STOP_TOKENS = new Set([
  "package",
  "packages",
  "source",
  "src",
  "lib",
  "test",
  "tests",
  "spec",
  "specs",
  "index",
  "main",
  "dist",
  "build",
  "node",
  "with",
  "from",
  "this",
  "that",
  "work",
  "context"
]);

export function deriveLearnV2ActivationSignals(card: LearnV2ConceptCard): LearnV2ActivationSignals {
  const sources = [
    card.title,
    card.canonicalBehavior,
    card.behaviorDelta,
    ...card.activation.phrases,
    ...card.scope.taskTypes,
    ...card.activation.commands,
    ...card.activation.pathGlobs.flatMap(pathTokens)
  ];
  const text = sources.join(" ");
  return {
    ...deriveActivationSignalsFromText(text),
    subsystemLabels: deriveLearnV2SubsystemLabels({
      text,
      paths: [...card.scope.paths, ...card.activation.pathGlobs],
      taskTypes: card.scope.taskTypes,
      commands: card.activation.commands
    })
  };
}

export function buildLearnV2ActivationIndexEntry(card: LearnV2ConceptCard): LearnV2ActivationIndexEntry {
  const activationSignals = deriveLearnV2ActivationSignals(card);
  return {
    conceptId: card.id,
    status: card.status,
    title: card.title,
    phrases: card.activation.phrases,
    pathGlobs: card.activation.pathGlobs,
    commands: card.activation.commands,
    taskTypes: card.scope.taskTypes,
    negativeTriggers: card.scope.negativeTriggers,
    semanticAliases: activationSignals.semanticAliases,
    keywordFingerprint: activationSignals.keywordFingerprint,
    subsystemLabels: activationSignals.subsystemLabels,
    confidence: card.confidence,
    risk: card.risk
  };
}

export function deriveActivationSignalsFromText(text: string): LearnV2ActivationSignals {
  const tokens = normalizedTokens(text);
  const families = new Set<string>();
  for (const token of tokens) {
    for (const family of familiesByTerm.get(token) ?? []) families.add(family);
  }
  const semanticAliases = buildSemanticAliases(tokens, families);
  const subsystemLabels = deriveLearnV2SubsystemLabels({ text });
  const keywordFingerprint = [
    ...new Set([
      ...tokens.filter((token) => token.length > 3).slice(0, 48),
      ...[...families].map((family) => `family:${family}`)
    ])
  ].sort();
  return { semanticAliases, keywordFingerprint, subsystemLabels };
}

export function deriveLearnV2SubsystemLabels(input: {
  text?: string;
  paths?: string[];
  taskTypes?: string[];
  commands?: string[];
}): string[] {
  const rawTokens = [
    ...normalizedTokens(input.text ?? ""),
    ...(input.paths ?? []).flatMap(pathTokens),
    ...(input.taskTypes ?? []).flatMap(normalizedTokens),
    ...(input.commands ?? []).flatMap(normalizedTokens)
  ];
  const tokens = [...new Set(rawTokens.filter(isSubsystemToken))].slice(0, 20);
  const families = new Set<string>();
  for (const token of tokens) for (const family of familiesByTerm.get(token) ?? []) families.add(family);
  const labels = new Set<string>();
  for (const token of tokens) {
    labels.add(`${token} subsystem`);
    labels.add(`${token} files`);
    labels.add(`${token} changes`);
  }
  for (let index = 0; index < Math.min(tokens.length - 1, 8); index++) {
    const left = tokens[index]!;
    const right = tokens[index + 1]!;
    if (left !== right) labels.add(`${left} ${right}`);
  }
  for (const family of families) {
    labels.add(`${family} subsystem`);
    labels.add(`${family} work`);
  }
  return [...labels]
    .filter((label) => label.length >= 5)
    .sort()
    .slice(0, 32);
}

function normalizedTokens(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9_./:-]+/g, " ")
    .split(/[\s/._:-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && token !== "**");
}

function buildSemanticAliases(tokens: string[], families: Set<string>): string[] {
  const aliases = new Set<string>();
  for (const phrase of familyPairAliases(families)) aliases.add(phrase);
  for (const token of tokens) {
    for (const family of familiesByTerm.get(token) ?? []) {
      aliases.add(`${family} work`);
      aliases.add(`${family} context`);
    }
  }
  return [...aliases]
    .filter((alias) => alias.length >= 5)
    .sort()
    .slice(0, 24);
}

function familyPairAliases(families: Set<string>): string[] {
  const out: string[] = [];
  if (families.has("parser") && families.has("test")) out.push("parser tests", "syntax regression", "grammar fixture");
  if (families.has("scope") && families.has("rewrite")) out.push("focused change", "avoid broad rewrite", "narrow refactor");
  if (families.has("security") && families.has("privacy")) out.push("secret redaction", "credential privacy", "raw evidence leak");
  if (families.has("validation") && families.has("test")) out.push("verification command", "ci test", "test validation");
  if (families.has("mcp") && families.has("opencode")) out.push("opencode mcp", "agent tool routing", "mcp agent handoff");
  return out;
}

function pathTokens(value: string): string[] {
  return value
    .replace(/\\/g, "/")
    .toLowerCase()
    .split(/[/.\\_-]+/)
    .filter((item) => item.length > 2 && item !== "**");
}

function isSubsystemToken(token: string): boolean {
  return token.length > 3 && !SUBSYSTEM_STOP_TOKENS.has(token);
}
