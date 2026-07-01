import type { LearnV2BehaviorAtom, LearnV2ConceptCard } from "./schemas.js";
import { calculateLearnV2ConceptScoring, withLearnV2ConceptScoring } from "./scoring.js";
import { learnV2CanonicalKey, learnV2NormalizeStatement, learnV2ShortHash, learnV2Title } from "./utils.js";

export function mergeLearnV2ConceptCards(atoms: LearnV2BehaviorAtom[], now: Date): LearnV2ConceptCard[] {
  const groups = new Map<string, LearnV2BehaviorAtom[]>();
  for (const atom of atoms) {
    const key = `${atom.kind}:${atom.scope.paths[0] ?? "project"}:${learnV2CanonicalKey(atom.statement)}`;
    groups.set(key, [...(groups.get(key) ?? []), atom]);
  }
  const cards = [...groups.values()].map((items) => makeConceptCard(items, now));
  return applyConflictCounterevidence(cards).sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title));
}

function makeConceptCard(items: LearnV2BehaviorAtom[], now: Date): LearnV2ConceptCard {
  const first = items[0]!;
  const evidenceIds = [...new Set(items.flatMap((item) => item.evidenceIds))];
  const rawRefs = [...new Set(items.flatMap((item) => item.rawRefs))];
  const paths = [...new Set(items.flatMap((item) => item.scope.paths))].slice(0, 20);
  const taskTypes = [...new Set(items.flatMap((item) => item.scope.taskTypes))].slice(0, 12);
  const risk = items.some((item) => item.risk === "high") ? "high" : items.some((item) => item.risk === "medium") ? "medium" : "low";
  const scoring = calculateLearnV2ConceptScoring({ atoms: items, evidenceIds, rawRefs, risk });
  return {
    schemaVersion: "openskill-kit.learn-v2.concept-card.v1",
    id: `concept_${learnV2ShortHash(`${first.kind}:${first.polarity}:${first.statement}:${evidenceIds.join(",")}`)}`,
    title: learnV2Title(first.statement),
    canonicalBehavior: learnV2NormalizeStatement(first.statement),
    behaviorDelta: behaviorDelta(first),
    status: "candidate",
    scope: {
      level: paths.length ? "path" : first.scope.level,
      paths,
      taskTypes,
      negativeTriggers: negativeTriggers(first)
    },
    activation: {
      phrases: activationPhrases(first.statement, taskTypes),
      pathGlobs: paths.map(pathToGlob),
      commands: first.kind === "command-policy" ? commandSnippets(first.statement) : []
    },
    confidence: scoring.confidence,
    durability: scoring.durability,
    sourceReliability: scoring.sourceReliability,
    scoring,
    risk,
    evidenceIds,
    rawRefs,
    atoms: items,
    counterevidence: [],
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
