import type { LearnV2BehaviorAtom, LearnV2ConceptCard } from "./schemas.js";
import { calculateLearnV2ConceptScoring, withLearnV2ConceptScoring } from "./scoring.js";
import { learnV2CanonicalKey, learnV2NormalizeStatement, learnV2ShortHash, learnV2Title } from "./utils.js";

export function mergeLearnV2ConceptCards(atoms: LearnV2BehaviorAtom[], now: Date): LearnV2ConceptCard[] {
  const groups = new Map<string, LearnV2BehaviorAtom[]>();
  for (const atom of atoms) {
    const key = learnV2ConceptSemanticKeyForAtoms([atom]);
    groups.set(key, [...(groups.get(key) ?? []), atom]);
  }
  const cards = [...groups.values()].map((items) => makeConceptCard(items, now));
  return applyConflictCounterevidence(cards).sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title));
}

export function learnV2ConceptSemanticKeyForAtoms(atoms: LearnV2BehaviorAtom[]): string {
  if (!atoms.length) throw new Error("Cannot build learn-v2 concept semantic key without atoms.");
  const first = atoms[0]!;
  const paths = [...new Set(atoms.flatMap((atom) => atom.scope.paths))];
  const taskTypes = [...new Set(atoms.flatMap((atom) => atom.scope.taskTypes))];
  return [
    `kind:${first.kind}`,
    `polarity:${first.polarity}`,
    `behavior:${learnV2ConceptBehaviorSignature(first.statement)}`,
    `scope:${learnV2ConceptScopeFingerprint(paths, taskTypes)}`
  ].join("|");
}

export function learnV2ConceptSemanticKeyForCard(card: LearnV2ConceptCard): string {
  return card.semanticKey ?? [
    `kind:${card.atoms[0]?.kind ?? "unknown"}`,
    `polarity:${card.atoms[0]?.polarity ?? "neutral"}`,
    `behavior:${learnV2ConceptBehaviorSignature(card.canonicalBehavior)}`,
    `scope:${learnV2ConceptScopeFingerprint(card.scope.paths, card.scope.taskTypes)}`
  ].join("|");
}

export function learnV2ConceptSemanticSignatureForCard(card: LearnV2ConceptCard): string {
  return [
    `kind:${card.atoms[0]?.kind ?? "unknown"}`,
    `polarity:${card.atoms[0]?.polarity ?? "neutral"}`,
    `behavior:${learnV2ConceptBehaviorSignature(card.canonicalBehavior)}`
  ].join("|");
}

function makeConceptCard(items: LearnV2BehaviorAtom[], now: Date): LearnV2ConceptCard {
  const first = items[0]!;
  const evidenceIds = [...new Set(items.flatMap((item) => item.evidenceIds))];
  const rawRefs = [...new Set(items.flatMap((item) => item.rawRefs))];
  const paths = [...new Set(items.flatMap((item) => item.scope.paths))].slice(0, 20);
  const taskTypes = [...new Set(items.flatMap((item) => item.scope.taskTypes))].slice(0, 12);
  const appliesWhen = uniqueStrings(items.flatMap((item) => item.conditions?.appliesWhen ?? [])).slice(0, 16);
  const doesNotApplyWhen = uniqueStrings(items.flatMap((item) => item.conditions?.doesNotApplyWhen ?? [])).slice(0, 16);
  const activationHintPhrases = uniqueStrings(items.flatMap((item) => item.activationHints?.phrases ?? [])).slice(0, 16);
  const activationHintPathGlobs = uniqueStrings(items.flatMap((item) => item.activationHints?.pathGlobs ?? [])).slice(0, 12);
  const activationHintCommands = uniqueStrings(items.flatMap((item) => item.activationHints?.commands ?? [])).slice(0, 12);
  const activationHintNegativeTriggers = uniqueStrings(items.flatMap((item) => item.activationHints?.negativeTriggers ?? [])).slice(0, 16);
  const counterevidence = uniqueCounterevidence(items.flatMap((item) => item.counterevidence ?? [])).slice(0, 24);
  const risk = items.some((item) => item.risk === "high") ? "high" : items.some((item) => item.risk === "medium") ? "medium" : "low";
  const scoring = calculateLearnV2ConceptScoring({ atoms: items, evidenceIds, rawRefs, risk, counterevidenceCount: counterevidence.length });
  const semanticKey = learnV2ConceptSemanticKeyForAtoms(items);
  return {
    schemaVersion: "openskill-kit.learn-v2.concept-card.v1",
    id: `concept_${learnV2ShortHash(semanticKey)}`,
    semanticKey,
    title: learnV2Title(first.statement),
    canonicalBehavior: learnV2NormalizeStatement(first.statement),
    behaviorDelta: behaviorDelta(first),
    status: "candidate",
    scope: {
      level: paths.length ? "path" : first.scope.level,
      paths,
      taskTypes,
      negativeTriggers: uniqueStrings([
        ...negativeTriggers(first),
        ...activationHintNegativeTriggers,
        ...doesNotApplyWhen
      ]).slice(0, 20)
    },
    activation: {
      phrases: uniqueStrings([...activationPhrases(first.statement, taskTypes), ...activationHintPhrases, ...appliesWhen]).slice(0, 24),
      pathGlobs: uniqueStrings([...paths.map(pathToGlob), ...activationHintPathGlobs]).slice(0, 24),
      commands: uniqueStrings([...(first.kind === "command-policy" ? commandSnippets(first.statement) : []), ...activationHintCommands]).slice(0, 16)
    },
    conditions: appliesWhen.length || doesNotApplyWhen.length ? { appliesWhen, doesNotApplyWhen } : undefined,
    confidence: scoring.confidence,
    durability: scoring.durability,
    sourceReliability: scoring.sourceReliability,
    scoring,
    risk,
    evidenceIds,
    rawRefs,
    atoms: items,
    counterevidence,
    privacy: {
      outputClass: "project-private",
      declassificationRequired: true,
      rawRefsExportable: false,
      placeholders: []
    },
    lifecycle: {
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      supersedes: []
    }
  };
}

function applyConflictCounterevidence(cards: LearnV2ConceptCard[]): LearnV2ConceptCard[] {
  return cards.map((card) => {
    const conflicts = cards.filter((other) => other.id !== card.id && conceptConflict(card, other));
    if (!conflicts.length) return card;
    return withLearnV2ConceptScoring({
      ...card,
      status: "conflict",
      counterevidence: conflicts.flatMap((other) => other.evidenceIds.map((evidenceId) => ({
        evidenceId,
        reason: `Potential conflict with ${other.id}: ${other.canonicalBehavior}`
      })))
    });
  });
}

function conceptConflict(a: LearnV2ConceptCard, b: LearnV2ConceptCard): boolean {
  if (a.atoms[0]?.kind !== b.atoms[0]?.kind) return false;
  const aWords = new Set(learnV2CanonicalKey(a.canonicalBehavior).split("-"));
  const bWords = new Set(learnV2CanonicalKey(b.canonicalBehavior).split("-"));
  const overlap = [...aWords].filter((word) => bWords.has(word)).length;
  const oppositePolarity = a.atoms.some((left) => b.atoms.some((right) => left.polarity !== right.polarity));
  const scopeOverlap = !a.scope.paths.length || !b.scope.paths.length || a.scope.paths.some((path) => b.scope.paths.includes(path));
  return oppositePolarity && scopeOverlap && overlap >= 3;
}

function behaviorDelta(atom: LearnV2BehaviorAtom): string {
  if (atom.kind === "command-policy") return "Adds conditional verification guidance for matching tasks.";
  if (atom.kind === "security") return "Adds security-sensitive avoidance behavior at compile/review boundaries.";
  if (atom.polarity === "negative") return "Narrows future agent behavior by blocking a risky pattern.";
  return "Adds reusable project behavior for similar future work.";
}

function negativeTriggers(atom: LearnV2BehaviorAtom): string[] {
  const triggers: string[] = [];
  if (atom.polarity === "negative") triggers.push("direct-user-request-overrides");
  if (atom.kind === "command-policy") triggers.push("unrelated-task-scope", "command-known-flaky");
  if (atom.kind === "security") triggers.push("no-sensitive-data-context");
  return triggers;
}

function activationPhrases(statement: string, taskTypes: string[]): string[] {
  const phrases = new Set<string>();
  for (const taskType of taskTypes) phrases.add(taskType.replace(/-/g, " "));
  for (const word of learnV2CanonicalKey(statement).split("-").filter((item) => item.length > 4).slice(0, 8)) phrases.add(word);
  return [...phrases].slice(0, 12);
}

function pathToGlob(file: string): string {
  const parts = file.split("/");
  return parts.length > 1 ? `${parts.slice(0, -1).join("/")}/**` : file;
}

function commandSnippets(statement: string): string[] {
  return [...statement.matchAll(/`([^`]+)`/g)].map((match) => match[1]!).slice(0, 6);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function uniqueCounterevidence(values: LearnV2ConceptCard["counterevidence"]): LearnV2ConceptCard["counterevidence"] {
  const seen = new Set<string>();
  const out: LearnV2ConceptCard["counterevidence"] = [];
  for (const item of values) {
    const key = `${item.evidenceId}:${item.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function learnV2ConceptBehaviorSignature(statement: string): string {
  const aliases: Record<string, string> = {
    spec: "test",
    specs: "test",
    test: "test",
    tests: "test",
    testing: "test",
    fixture: "test",
    fixtures: "test",
    regression: "regression",
    regressions: "regression",
    parser: "parser",
    parsing: "parser",
    syntax: "parser",
    grammar: "parser",
    rewrite: "rewrite",
    rewrites: "rewrite",
    rewritten: "rewrite",
    refactor: "rewrite",
    refactors: "rewrite",
    broad: "broad",
    focused: "focused",
    focus: "focused",
    secret: "secret",
    secrets: "secret",
    credential: "secret",
    credentials: "secret",
    dependency: "dependency",
    dependencies: "dependency"
  };
  const stop = new Set([
    "always",
    "avoid",
    "before",
    "change",
    "changes",
    "default",
    "instead",
    "make",
    "must",
    "never",
    "prefer",
    "require",
    "requires",
    "should",
    "when",
    "with",
    "without"
  ]);
  const tokens = learnV2CanonicalKey(statement)
    .split("-")
    .map((token) => aliases[token] ?? token)
    .filter((token) => token.length > 2 && !stop.has(token));
  return [...new Set(tokens)].sort().slice(0, 16).join("-") || "general";
}

function learnV2ConceptScopeFingerprint(paths: string[], taskTypes: string[]): string {
  const tasks = [...new Set(taskTypes.map((item) => item.toLowerCase().trim()).filter(Boolean))].sort();
  if (tasks.length) return `task:${tasks.slice(0, 6).join("+")}`;
  const scopes = [...new Set(paths.map(pathScopeFingerprint).filter(Boolean))].sort();
  return scopes.length ? `path:${scopes.slice(0, 6).join("+")}` : "project";
}

function pathScopeFingerprint(file: string): string {
  const parts = file.replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length) return "";
  if (parts.length >= 3 && ["packages", "src", "tests", "docs"].includes(parts[0]!)) return parts.slice(0, 3).join("/");
  if (parts.length >= 2) return parts.slice(0, 2).join("/");
  return parts[0]!;
}
