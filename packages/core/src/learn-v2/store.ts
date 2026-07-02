import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProjectConfig } from "../config/schema.js";
import { readProjectConfig } from "../events/store.js";
import { PreferenceGraphSchema, type PreferenceGraph, type PreferenceNode } from "../preferences/schema.js";
import { WorkflowGraphSchema, type WorkflowGraph, type WorkflowNode } from "../workflows/schema.js";
import { readWorkflowGraph, writeWorkflowGraph } from "../workflows/store.js";
import { writeJsonAtomic, withFileLock } from "../storage/atomic.js";
import { compileLearnV2ConceptPreview } from "./compile.js";
import {
  learnV2ConceptSemanticKeyForAtoms,
  learnV2ConceptSemanticKeyForCard,
  learnV2ConceptSemanticSignatureForCard
} from "./concepts.js";
import { buildLearnV2ActivationIndexEntry } from "./activation-signals.js";
import { findLearnV2ActivationGateFailures } from "./concept-quality-gates.js";
import { calculateLearnV2ConceptScoring, withLearnV2ConceptScoring } from "./scoring.js";
import { LearnV2ConceptCardSchema, type LearnV2ConceptCard } from "./schemas.js";
import { learnV2NormalizeStatement, learnV2ShortHash, learnV2Title } from "./utils.js";
import { syncLearnV2RawEvidenceRecordPins } from "./vault.js";

export interface LearnV2ConceptStore {
  schemaVersion: "openskill-kit.learn-v2.concept-store.v1";
  projectId: string;
  updatedAt: string;
  cards: LearnV2ConceptCard[];
}

export interface LearnV2ActivationIndex {
  schemaVersion: "openskill-kit.learn-v2.activation-index.v1";
  projectId: string;
  updatedAt: string;
  entries: Array<{
    conceptId: string;
    status: LearnV2ConceptCard["status"];
    title: string;
    phrases: string[];
    pathGlobs: string[];
    commands: string[];
    taskTypes: string[];
    negativeTriggers: string[];
    semanticAliases?: string[];
    keywordFingerprint?: string[];
    confidence: number;
    risk: LearnV2ConceptCard["risk"];
  }>;
}

export interface LearnV2ConceptReviewOptions {
  accept?: string[];
  reject?: string[];
  lock?: string[];
  demote?: string[];
  markOneOff?: string[];
  narrowScopes?: Array<{ id: string; paths?: string[]; taskTypes?: string[]; negativeTriggers?: string[] }>;
  edits?: Array<{ id: string; title?: string; canonicalBehavior?: string; activationPhrases?: string[] }>;
  addCounterevidence?: Array<{ id: string; evidenceId: string; reason: string }>;
  mergeConcepts?: Array<{ targetId: string; sourceIds: string[]; title?: string; canonicalBehavior?: string; activationPhrases?: string[] }>;
  splitConcepts?: Array<{ sourceId: string; atomIds: string[]; title?: string; canonicalBehavior?: string; paths?: string[]; taskTypes?: string[]; activationPhrases?: string[] }>;
  supersedeConcepts?: Array<{ supersededId: string; supersededById: string; reason?: string }>;
  autoPolicy?: boolean;
  bulkSafe?: "accept-low-risk" | "reject-one-off" | "mark-superseded";
  compileActive?: boolean;
  now?: Date;
}

export interface LearnV2ConceptReviewResult {
  schemaVersion: "openskill-kit.learn-v2.review-result.v1";
  storePath: string;
  activationIndexPath: string;
  reviewedCount: number;
  activeConceptCount: number;
  candidateConceptCount: number;
  preferenceGraphPath?: string;
  workflowGraphPath?: string;
  messages: string[];
  store: LearnV2ConceptStore;
}

export async function readLearnV2ConceptStore(projectRoot: string, now = new Date()): Promise<LearnV2ConceptStore> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  const text = await fs.readFile(learnV2ConceptStorePath(root), "utf8").catch(() => "");
  if (!text) return { schemaVersion: "openskill-kit.learn-v2.concept-store.v1", projectId: config.projectId, updatedAt: now.toISOString(), cards: [] };
  const parsed = JSON.parse(text) as LearnV2ConceptStore;
  return {
    schemaVersion: "openskill-kit.learn-v2.concept-store.v1",
    projectId: parsed.projectId || config.projectId,
    updatedAt: parsed.updatedAt || now.toISOString(),
    cards: (parsed.cards ?? []).map((card) => LearnV2ConceptCardSchema.parse(card))
  };
}

export async function writeLearnV2ConceptStore(projectRoot: string, cards: LearnV2ConceptCard[], now = new Date()): Promise<LearnV2ConceptStore> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  const existing = await readLearnV2ConceptStore(root, now);
  const merged = mergeLearnV2ConceptStoreCards(existing.cards, cards, now);
  const policyApplied = applyLearnV2AutoPolicies(merged, config, now);
  const store: LearnV2ConceptStore = {
    schemaVersion: "openskill-kit.learn-v2.concept-store.v1",
    projectId: config.projectId,
    updatedAt: now.toISOString(),
    cards: policyApplied
  };
  await writeJsonAtomic(learnV2ConceptStorePath(root), store);
  await syncLearnV2ConceptStoreRawPins(root, store.cards, now);
  await writeLearnV2ActivationIndex(root, store, now);
  return store;
}

export function mergeLearnV2ConceptStoreCards(existing: LearnV2ConceptCard[], incoming: LearnV2ConceptCard[], now = new Date()): LearnV2ConceptCard[] {
  const byId = new Map(existing.map((card) => [card.id, card]));
  for (const card of incoming) {
    const previous = byId.get(card.id) ?? findMatchingStoredConcept(existing, card);
    const next = previous ? mergeStoredConceptSupport(previous, card, now) : withLearnV2ConceptScoring({
      ...card,
      semanticKey: card.semanticKey ?? learnV2ConceptSemanticKeyForCard(card)
    });
    byId.set(next.id, next);
  }
  return sortConceptCards([...byId.values()]);
}

function findMatchingStoredConcept(existing: LearnV2ConceptCard[], incoming: LearnV2ConceptCard): LearnV2ConceptCard | undefined {
  const incomingSemanticKey = learnV2ConceptSemanticKeyForCard(incoming);
  const incomingSignature = learnV2ConceptSemanticSignatureForCard(incoming);
  return existing.find((card) => card.id === incoming.id) ??
    existing.find((card) => learnV2ConceptSemanticKeyForCard(card) === incomingSemanticKey) ??
    existing.find((card) => learnV2ConceptSemanticSignatureForCard(card) === incomingSignature && conceptScopesOverlap(card, incoming));
}

function mergeStoredConceptSupport(previous: LearnV2ConceptCard, incoming: LearnV2ConceptCard, now: Date): LearnV2ConceptCard {
  const atoms = uniqueAtoms([...previous.atoms, ...incoming.atoms]);
  const evidenceIds = uniqueStrings([...previous.evidenceIds, ...incoming.evidenceIds]);
  const rawRefs = uniqueStrings([...previous.rawRefs, ...incoming.rawRefs]);
  const paths = uniqueStrings([...previous.scope.paths, ...incoming.scope.paths]).slice(0, 20);
  const taskTypes = uniqueStrings([...previous.scope.taskTypes, ...incoming.scope.taskTypes]).slice(0, 12);
  const negativeTriggers = uniqueStrings([...previous.scope.negativeTriggers, ...incoming.scope.negativeTriggers]).slice(0, 20);
  const conditions = {
    appliesWhen: uniqueStrings([...(previous.conditions?.appliesWhen ?? []), ...(incoming.conditions?.appliesWhen ?? [])]).slice(0, 16),
    doesNotApplyWhen: uniqueStrings([...(previous.conditions?.doesNotApplyWhen ?? []), ...(incoming.conditions?.doesNotApplyWhen ?? [])]).slice(0, 16)
  };
  const counterevidence = [
    ...previous.counterevidence,
    ...incoming.counterevidence.filter((item) => !previous.counterevidence.some((previousItem) => previousItem.evidenceId === item.evidenceId && previousItem.reason === item.reason))
  ];
  const risk = highestRisk([previous.risk, incoming.risk, ...atoms.map((atom) => atom.risk)]);
  const scoring = calculateLearnV2ConceptScoring({ atoms, evidenceIds, rawRefs, risk, counterevidenceCount: counterevidence.length });
  return LearnV2ConceptCardSchema.parse({
    ...previous,
    semanticKey: previous.semanticKey ?? incoming.semanticKey ?? learnV2ConceptSemanticKeyForCard(previous),
    scope: {
      ...previous.scope,
      level: paths.length ? "path" : previous.scope.level,
      paths,
      taskTypes,
      negativeTriggers
    },
    activation: {
      phrases: uniqueStrings([...previous.activation.phrases, ...incoming.activation.phrases]).slice(0, 24),
      pathGlobs: uniqueStrings([...previous.activation.pathGlobs, ...incoming.activation.pathGlobs, ...paths.map(pathToGlob)]).slice(0, 24),
      commands: uniqueStrings([...previous.activation.commands, ...incoming.activation.commands]).slice(0, 16)
    },
    conditions: conditions.appliesWhen.length || conditions.doesNotApplyWhen.length ? conditions : undefined,
    confidence: scoring.confidence,
    durability: scoring.durability,
    sourceReliability: scoring.sourceReliability,
    scoring,
    risk,
    evidenceIds,
    rawRefs,
    atoms,
    counterevidence,
    lifecycle: {
      ...previous.lifecycle,
      updatedAt: now.toISOString(),
      supersedes: uniqueStrings([...previous.lifecycle.supersedes, ...incoming.lifecycle.supersedes]),
      supersededBy: previous.lifecycle.supersededBy
    }
  });
}

export async function applyLearnV2ConceptReview(projectRoot: string, options: LearnV2ConceptReviewOptions): Promise<LearnV2ConceptReviewResult> {
  const root = path.resolve(projectRoot);
  const now = options.now ?? new Date();
  return withFileLock(path.join(root, ".openskill-kit", "learn-v2", ".concepts.lock"), async () => {
    const store = await readLearnV2ConceptStore(root, now);
    const config = await readProjectConfig(root);
    const before = new Map(store.cards.map((card) => [card.id, card.status]));
    const accept = new Set(options.accept ?? []);
    const reject = new Set(options.reject ?? []);
    const lock = new Set(options.lock ?? []);
    const demote = new Set(options.demote ?? []);
    const markOneOff = new Set(options.markOneOff ?? []);
    const narrowById = new Map((options.narrowScopes ?? []).map((item) => [item.id, item]));
    const editById = new Map((options.edits ?? []).map((item) => [item.id, item]));
    const counterById = new Map<string, NonNullable<LearnV2ConceptReviewOptions["addCounterevidence"]>>();
    for (const item of options.addCounterevidence ?? []) counterById.set(item.id, [...(counterById.get(item.id) ?? []), item]);
    const modifiedIds = new Set<string>();
    const restructureMessages: string[] = [];
    const reviewed = store.cards.map((card) => {
      let next = card;
      if (reject.has(card.id)) next = markModified(withStatus(next, "rejected", now), modifiedIds);
      if (markOneOff.has(card.id)) next = markModified(withStatus(next, "one-off", now), modifiedIds);
      if (demote.has(card.id)) next = markModified(withStatus(next, "candidate", now), modifiedIds);
      if (accept.has(card.id)) next = markModified(withStatus(next, "active", now), modifiedIds);
      if (lock.has(card.id)) next = markModified(withStatus(next, "locked", now), modifiedIds);
      if (options.bulkSafe === "accept-low-risk" && card.status === "candidate" && isSafeAutoApplyCandidate(card, config)) next = markModified(withStatus(next, "active", now), modifiedIds);
      if (options.bulkSafe === "reject-one-off" && card.status === "candidate" && card.durability < 0.5) next = markModified(withStatus(next, "one-off", now), modifiedIds);
      if (options.bulkSafe === "mark-superseded" && card.status === "candidate" && card.counterevidence.length > 0) next = markModified(withStatus(next, "superseded", now), modifiedIds);
      const edit = editById.get(card.id);
      if (edit) {
        next = markModified({
          ...next,
          title: edit.title ?? next.title,
          canonicalBehavior: edit.canonicalBehavior ?? next.canonicalBehavior,
          activation: {
            ...next.activation,
            phrases: edit.activationPhrases ?? next.activation.phrases
          },
          lifecycle: { ...next.lifecycle, updatedAt: now.toISOString() }
        }, modifiedIds);
      }
      const narrow = narrowById.get(card.id);
      if (narrow) {
        next = markModified({
          ...next,
          scope: {
            ...next.scope,
            paths: narrow.paths ?? next.scope.paths,
            taskTypes: narrow.taskTypes ?? next.scope.taskTypes,
            negativeTriggers: narrow.negativeTriggers ?? next.scope.negativeTriggers
          },
          activation: {
            ...next.activation,
            pathGlobs: narrow.paths ? narrow.paths.map(pathToGlob) : next.activation.pathGlobs
          },
          lifecycle: { ...next.lifecycle, updatedAt: now.toISOString() }
        }, modifiedIds);
      }
      const counter = counterById.get(card.id);
      if (counter?.length) {
        next = markModified({
          ...next,
          status: next.status === "active" || next.status === "locked" ? next.status : "conflict",
          counterevidence: [
            ...next.counterevidence,
            ...counter.map((item) => ({ evidenceId: item.evidenceId, reason: item.reason }))
          ],
          lifecycle: { ...next.lifecycle, updatedAt: now.toISOString() }
        }, modifiedIds);
        next = withLearnV2ConceptScoring(next);
      }
      return LearnV2ConceptCardSchema.parse(next);
    });
    const restructured = applyConceptRestructure(reviewed, options, now, modifiedIds, restructureMessages);
    const policyApplied = options.autoPolicy === true
      ? applyLearnV2AutoPolicies(restructured, config, now, modifiedIds, restructureMessages)
      : restructured;
    const nextStore: LearnV2ConceptStore = {
      schemaVersion: "openskill-kit.learn-v2.concept-store.v1",
      projectId: store.projectId,
      updatedAt: now.toISOString(),
      cards: sortConceptCards(policyApplied)
    };
    const activatedModifiedIds = nextStore.cards
      .filter((card) => modifiedIds.has(card.id) && (card.status === "active" || card.status === "locked"))
      .map((card) => card.id);
    const activationGateFailures = findLearnV2ActivationGateFailures(nextStore.cards, activatedModifiedIds);
    if (activationGateFailures.length) {
      throw new Error(renderLearnV2ActivationGateError(activationGateFailures));
    }
    await writeJsonAtomic(learnV2ConceptStorePath(root), nextStore);
    await syncLearnV2ConceptStoreRawPins(root, nextStore.cards, now);
    const activationIndex = await writeLearnV2ActivationIndex(root, nextStore, now);
    let preferenceGraphPath: string | undefined;
    let workflowGraphPath: string | undefined;
    if (options.compileActive !== false) {
      const synced = await syncLearnV2ActiveConcepts(root, nextStore.cards, now);
      preferenceGraphPath = synced.preferenceGraphPath;
      workflowGraphPath = synced.workflowGraphPath;
    }
    const reviewedCount = nextStore.cards.filter((card) => before.get(card.id) !== card.status || modifiedIds.has(card.id) || !before.has(card.id)).length;
    return {
      schemaVersion: "openskill-kit.learn-v2.review-result.v1",
      storePath: learnV2ConceptStorePath(root),
      activationIndexPath: learnV2ActivationIndexPath(root),
      reviewedCount,
      activeConceptCount: nextStore.cards.filter((card) => card.status === "active" || card.status === "locked").length,
      candidateConceptCount: nextStore.cards.filter((card) => card.status === "candidate" || card.status === "staged" || card.status === "conflict").length,
      preferenceGraphPath,
      workflowGraphPath,
      messages: [
        `Reviewed ${reviewedCount} learn-v2 concept(s).`,
        ...restructureMessages,
        `Activation index entries: ${activationIndex.entries.length}.`,
        options.compileActive === false ? "Active concept graph sync skipped by option." : "Active concepts synced into preference/workflow graph compatibility outputs."
      ],
      store: nextStore
    };
  });
}

function renderLearnV2ActivationGateError(failures: ReturnType<typeof findLearnV2ActivationGateFailures>): string {
  const failedChecks = failures.map((failure) => `${failure.name}(${failure.conceptIds.join(",")})`).join("; ");
  return `Learn-v2 activation gate blocked concept review: ${failedChecks}. Narrow scope, lower confidence, add evidence/counterevidence handling, add activation triggers, or leave the concept as candidate.`;
}

export async function writeLearnV2ActivationIndex(rootInput: string, store: LearnV2ConceptStore, now = new Date()): Promise<LearnV2ActivationIndex> {
  const root = path.resolve(rootInput);
  const index: LearnV2ActivationIndex = {
    schemaVersion: "openskill-kit.learn-v2.activation-index.v1",
    projectId: store.projectId,
    updatedAt: now.toISOString(),
    entries: store.cards
      .filter((card) => card.status !== "rejected" && card.status !== "one-off" && card.status !== "superseded")
      .map(buildLearnV2ActivationIndexEntry)
      .sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title))
  };
  await writeJsonAtomic(learnV2ActivationIndexPath(root), index);
  return index;
}

export async function syncLearnV2ActiveConcepts(projectRoot: string, cards: LearnV2ConceptCard[], now = new Date()): Promise<{ preferenceGraphPath: string; workflowGraphPath?: string }> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  const preview = await compileLearnV2ConceptPreview(root, config, cards, now);
  const preferenceGraphPath = await mergePreferenceNodes(root, config.projectId, preview.preferenceNodes, now);
  const workflowGraphPath = await mergeWorkflowNodes(root, config.projectId, preview.workflowNodes, now);
  return { preferenceGraphPath, workflowGraphPath };
}

export function learnV2ConceptStorePath(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json");
}

export function learnV2ActivationIndexPath(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "activation-index.json");
}

function withStatus(card: LearnV2ConceptCard, status: LearnV2ConceptCard["status"], now: Date): LearnV2ConceptCard {
  return {
    ...card,
    status,
    lifecycle: { ...card.lifecycle, updatedAt: now.toISOString() }
  };
}

export function applyLearnV2AutoPolicies(
  cards: LearnV2ConceptCard[],
  config: ProjectConfig,
  now: Date,
  modifiedIds: Set<string> = new Set(),
  messages: string[] = []
): LearnV2ConceptCard[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const values = () => [...byId.values()];
  for (const card of values()) {
    if (!isReviewableStatus(card.status)) continue;
    if (!isAssistantOnlyLike(card)) continue;
    const successor = values().find((candidate) => candidate.id !== card.id && isStrongManualLikeSuccessor(card, candidate, config));
    if (!successor) continue;
    byId.set(card.id, LearnV2ConceptCardSchema.parse(withLearnV2ConceptScoring({
      ...card,
      status: "superseded",
      counterevidence: [...card.counterevidence, {
        evidenceId: successor.evidenceIds[0] ?? successor.id,
        reason: `Auto-superseded weak assistant-only-like candidate by stronger reviewed evidence candidate ${successor.id}.`
      }],
      lifecycle: { ...card.lifecycle, updatedAt: now.toISOString(), supersededBy: successor.id }
    })));
    byId.set(successor.id, LearnV2ConceptCardSchema.parse({
      ...successor,
      lifecycle: { ...successor.lifecycle, updatedAt: now.toISOString(), supersedes: [...new Set([...successor.lifecycle.supersedes, card.id])] }
    }));
    modifiedIds.add(card.id);
    modifiedIds.add(successor.id);
    messages.push(`Auto-superseded ${card.id} with stronger successor ${successor.id}.`);
  }

  if (config.learning.mode !== "auto-stage" && config.learning.mode !== "auto-apply-safe") return sortConceptCards(values());
  for (const card of values()) {
    if (!isReviewableStatus(card.status)) continue;
    if (!isSafeAutoApplyCandidate(card, config)) continue;
    const status: LearnV2ConceptCard["status"] = config.learning.mode === "auto-apply-safe" ? "active" : "staged";
    byId.set(card.id, LearnV2ConceptCardSchema.parse(withStatus(card, status, now)));
    modifiedIds.add(card.id);
    messages.push(`${status === "active" ? "Auto-activated" : "Auto-staged"} safe low-risk concept ${card.id}.`);
  }
  return sortConceptCards(values());
}

function markModified(card: LearnV2ConceptCard, modifiedIds: Set<string>): LearnV2ConceptCard {
  modifiedIds.add(card.id);
  return card;
}

function applyConceptRestructure(
  cards: LearnV2ConceptCard[],
  options: LearnV2ConceptReviewOptions,
  now: Date,
  modifiedIds: Set<string>,
  messages: string[]
): LearnV2ConceptCard[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  for (const item of options.mergeConcepts ?? []) {
    const target = requireConcept(byId, item.targetId, "merge target");
    const sources = item.sourceIds.map((id) => requireConcept(byId, id, "merge source")).filter((card) => card.id !== target.id);
    if (!sources.length) continue;
    const merged = rebuildConceptFromAtoms({
      base: target,
      atoms: uniqueAtoms([target, ...sources].flatMap((card) => card.atoms)),
      now,
      title: item.title ?? target.title,
      canonicalBehavior: item.canonicalBehavior ?? target.canonicalBehavior,
      activationPhrases: item.activationPhrases ?? target.activation.phrases,
      status: target.status,
      lifecycle: {
        ...target.lifecycle,
        updatedAt: now.toISOString(),
        supersedes: [...new Set([...target.lifecycle.supersedes, ...sources.map((card) => card.id), ...sources.flatMap((card) => card.lifecycle.supersedes)])]
      },
      counterevidence: [...target.counterevidence, ...sources.flatMap((card) => card.counterevidence)],
      conditions: {
        appliesWhen: uniqueStrings([...(target.conditions?.appliesWhen ?? []), ...sources.flatMap((card) => card.conditions?.appliesWhen ?? [])]).slice(0, 16),
        doesNotApplyWhen: uniqueStrings([...(target.conditions?.doesNotApplyWhen ?? []), ...sources.flatMap((card) => card.conditions?.doesNotApplyWhen ?? [])]).slice(0, 16)
      }
    });
    byId.set(target.id, LearnV2ConceptCardSchema.parse(merged));
    modifiedIds.add(target.id);
    for (const source of sources) {
      byId.set(source.id, LearnV2ConceptCardSchema.parse({
        ...source,
        status: "superseded",
        lifecycle: { ...source.lifecycle, updatedAt: now.toISOString(), supersededBy: target.id }
      }));
      modifiedIds.add(source.id);
    }
    messages.push(`Merged ${sources.length} concept(s) into ${target.id}.`);
  }

  for (const item of options.splitConcepts ?? []) {
    const source = requireConcept(byId, item.sourceId, "split source");
    const atomIds = new Set(item.atomIds);
    const selected = source.atoms.filter((atom) => atomIds.has(atom.id));
    if (!selected.length) throw new Error(`Learn-v2 concept split selected no atoms for ${source.id}.`);
    const remaining = source.atoms.filter((atom) => !atomIds.has(atom.id));
    const childId = `concept_${learnV2ShortHash(`split:${source.id}:${selected.map((atom) => atom.id).sort().join(",")}:${item.canonicalBehavior ?? ""}`)}`;
    const childBase = { ...source, id: childId, status: "candidate" as const };
    const child = rebuildConceptFromAtoms({
      base: childBase,
      atoms: selected,
      now,
      title: item.title,
      canonicalBehavior: item.canonicalBehavior,
      activationPhrases: item.activationPhrases,
      paths: item.paths,
      taskTypes: item.taskTypes,
      status: "candidate",
      lifecycle: {
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        supersedes: []
      },
      counterevidence: []
    });
    byId.set(child.id, LearnV2ConceptCardSchema.parse(child));
    modifiedIds.add(child.id);
    if (remaining.length) {
      byId.set(source.id, LearnV2ConceptCardSchema.parse(rebuildConceptFromAtoms({
        base: source,
        atoms: remaining,
        now,
        status: source.status,
        lifecycle: { ...source.lifecycle, updatedAt: now.toISOString() },
        counterevidence: source.counterevidence
      })));
    } else {
      byId.set(source.id, LearnV2ConceptCardSchema.parse({
        ...source,
        status: "superseded",
        lifecycle: { ...source.lifecycle, updatedAt: now.toISOString(), supersededBy: child.id }
      }));
    }
    modifiedIds.add(source.id);
    messages.push(`Split ${selected.length} atom(s) from ${source.id} into ${child.id}.`);
  }

  for (const item of options.supersedeConcepts ?? []) {
    const superseded = requireConcept(byId, item.supersededId, "superseded concept");
    const successor = requireConcept(byId, item.supersededById, "successor concept");
    byId.set(superseded.id, LearnV2ConceptCardSchema.parse({
      ...superseded,
      status: "superseded",
      counterevidence: item.reason ? [...superseded.counterevidence, { evidenceId: successor.evidenceIds[0] ?? successor.id, reason: item.reason }] : superseded.counterevidence,
      lifecycle: { ...superseded.lifecycle, updatedAt: now.toISOString(), supersededBy: successor.id }
    }));
    byId.set(successor.id, LearnV2ConceptCardSchema.parse({
      ...successor,
      lifecycle: { ...successor.lifecycle, updatedAt: now.toISOString(), supersedes: [...new Set([...successor.lifecycle.supersedes, superseded.id])] }
    }));
    modifiedIds.add(superseded.id);
    modifiedIds.add(successor.id);
    messages.push(`Marked ${superseded.id} superseded by ${successor.id}.`);
  }
  return [...byId.values()];
}

function rebuildConceptFromAtoms(input: {
  base: LearnV2ConceptCard;
  atoms: LearnV2ConceptCard["atoms"];
  now: Date;
  title?: string;
  canonicalBehavior?: string;
  activationPhrases?: string[];
  paths?: string[];
  taskTypes?: string[];
  status: LearnV2ConceptCard["status"];
  lifecycle: LearnV2ConceptCard["lifecycle"];
  counterevidence: LearnV2ConceptCard["counterevidence"];
  conditions?: LearnV2ConceptCard["conditions"];
}): LearnV2ConceptCard {
  const first = input.atoms[0]!;
  const paths = input.paths ?? [...new Set(input.atoms.flatMap((atom) => atom.scope.paths))].slice(0, 20);
  const taskTypes = input.taskTypes ?? [...new Set(input.atoms.flatMap((atom) => atom.scope.taskTypes))].slice(0, 12);
  const evidenceIds = [...new Set(input.atoms.flatMap((atom) => atom.evidenceIds))];
  const rawRefs = [...new Set(input.atoms.flatMap((atom) => atom.rawRefs))];
  const canonicalBehavior = learnV2NormalizeStatement(input.canonicalBehavior ?? input.base.canonicalBehavior ?? first.statement);
  const risk = input.atoms.some((atom) => atom.risk === "high") ? "high" : input.atoms.some((atom) => atom.risk === "medium") ? "medium" : "low";
  const scoring = calculateLearnV2ConceptScoring({
    atoms: input.atoms,
    evidenceIds,
    rawRefs,
    risk,
    counterevidenceCount: input.counterevidence.length
  });
  return {
    ...input.base,
    semanticKey: learnV2ConceptSemanticKeyForAtoms(input.atoms),
    title: input.title ?? learnV2Title(canonicalBehavior),
    canonicalBehavior,
    behaviorDelta: input.base.behaviorDelta,
    status: input.status,
    scope: {
      ...input.base.scope,
      level: paths.length ? "path" : input.base.scope.level,
      paths,
      taskTypes
    },
    activation: {
      phrases: input.activationPhrases ?? input.base.activation.phrases,
      pathGlobs: paths.map(pathToGlob),
      commands: input.atoms.some((atom) => atom.kind === "command-policy") ? [...new Set(input.atoms.flatMap((atom) => commandSnippets(atom.statement)))] : input.base.activation.commands
    },
    conditions: input.conditions ?? input.base.conditions,
    confidence: scoring.confidence,
    durability: scoring.durability,
    sourceReliability: scoring.sourceReliability,
    scoring,
    risk,
    evidenceIds,
    rawRefs,
    atoms: input.atoms,
    counterevidence: input.counterevidence,
    lifecycle: input.lifecycle
  };
}

function requireConcept(byId: Map<string, LearnV2ConceptCard>, id: string, label: string): LearnV2ConceptCard {
  const card = byId.get(id);
  if (!card) throw new Error(`Missing learn-v2 ${label}: ${id}`);
  return card;
}

function uniqueAtoms(atoms: LearnV2ConceptCard["atoms"]): LearnV2ConceptCard["atoms"] {
  return [...new Map(atoms.map((atom) => [atom.id, atom])).values()];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function highestRisk(values: Array<LearnV2ConceptCard["risk"]>): LearnV2ConceptCard["risk"] {
  if (values.includes("high")) return "high";
  if (values.includes("medium")) return "medium";
  return "low";
}

function conceptScopesOverlap(left: LearnV2ConceptCard, right: LearnV2ConceptCard): boolean {
  const taskOverlap = !left.scope.taskTypes.length || !right.scope.taskTypes.length || left.scope.taskTypes.some((taskType) => right.scope.taskTypes.includes(taskType));
  const pathOverlap = !left.scope.paths.length || !right.scope.paths.length || left.scope.paths.some((leftPath) => right.scope.paths.some((rightPath) => pathsOverlap(leftPath, rightPath)));
  return taskOverlap && pathOverlap;
}

function pathsOverlap(left: string, right: string): boolean {
  const normalizedLeft = left.replace(/\\/g, "/");
  const normalizedRight = right.replace(/\\/g, "/");
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(`${normalizedRight}/`) || normalizedRight.startsWith(`${normalizedLeft}/`) ||
    path.dirname(normalizedLeft) === path.dirname(normalizedRight);
}

function sortConceptCards(cards: LearnV2ConceptCard[]): LearnV2ConceptCard[] {
  return cards.sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title));
}

function isReviewableStatus(status: LearnV2ConceptCard["status"]): boolean {
  return status === "candidate" || status === "staged" || status === "conflict";
}

async function syncLearnV2ConceptStoreRawPins(root: string, cards: LearnV2ConceptCard[], now: Date): Promise<void> {
  const rawRefs = new Set<string>();
  for (const card of cards) {
    if (!isRetainedConceptStatus(card.status)) continue;
    for (const rawRef of card.rawRefs) rawRefs.add(rawRef);
    for (const atom of card.atoms) for (const rawRef of atom.rawRefs) rawRefs.add(rawRef);
  }
  await syncLearnV2RawEvidenceRecordPins(root, [...rawRefs], "concept-store", now);
}

function isRetainedConceptStatus(status: LearnV2ConceptCard["status"]): boolean {
  return status === "candidate" || status === "staged" || status === "conflict" || status === "active" || status === "locked";
}

function isAssistantOnlyLike(card: LearnV2ConceptCard): boolean {
  return card.sourceReliability <= 0.35 || card.atoms.every((atom) => atom.sourceReliability <= 0.35);
}

function isStrongManualLikeSuccessor(oldCard: LearnV2ConceptCard, candidate: LearnV2ConceptCard, config: ProjectConfig): boolean {
  if (candidate.status === "rejected" || candidate.status === "one-off" || candidate.status === "superseded") return false;
  if (candidate.sourceReliability < Math.max(0.82, config.learning.minConfidenceToApply)) return false;
  if (candidate.confidence < config.learning.minConfidenceToApply) return false;
  if (!conceptsContradictOrSupersede(oldCard, candidate)) return false;
  return true;
}

function isSafeAutoApplyCandidate(card: LearnV2ConceptCard, config: ProjectConfig): boolean {
  if (card.confidence < config.learning.minConfidenceToApply) return false;
  if (card.risk !== "low") return false;
  if (card.sourceReliability < config.learning.minConfidenceToApply) return false;
  if (card.privacy.rawRefsExportable !== false) return false;
  if (card.privacy.outputClass !== "project-private" && card.privacy.outputClass !== "shareable") return false;
  if (card.atoms.some((atom) => atom.kind === "security" || atom.risk === "high")) return false;
  if (card.scope.level === "project" || card.scope.paths.length === 0 || card.scope.paths.length > 5) return false;
  if (card.counterevidence.length > 0 || card.status === "conflict") return false;
  return true;
}

function conceptsContradictOrSupersede(left: LearnV2ConceptCard, right: LearnV2ConceptCard): boolean {
  const leftKind = left.atoms[0]?.kind;
  const rightKind = right.atoms[0]?.kind;
  if (leftKind && rightKind && leftKind !== rightKind) return false;
  const leftWords = wordSet(left.canonicalBehavior);
  const rightWords = wordSet(right.canonicalBehavior);
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  const oppositePolarity = left.atoms.some((leftAtom) => right.atoms.some((rightAtom) => leftAtom.polarity !== rightAtom.polarity));
  const scopeOverlap = !left.scope.paths.length || !right.scope.paths.length || left.scope.paths.some((item) => right.scope.paths.includes(item));
  const strongerSameTopic = overlap >= 4 && right.confidence > left.confidence + 0.12;
  return scopeOverlap && (oppositePolarity && overlap >= 3 || strongerSameTopic);
}

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((word) => word.length > 3));
}

async function mergePreferenceNodes(root: string, projectId: string, nodes: PreferenceNode[], now: Date): Promise<string> {
  return withFileLock(path.join(root, ".openskill-kit", "preferences", ".graph.lock"), async () => {
    const file = path.join(root, ".openskill-kit", "preferences", "graph.json");
    const existing = await fs.readFile(file, "utf8")
      .then((text) => PreferenceGraphSchema.parse(JSON.parse(text)))
      .catch(() => PreferenceGraphSchema.parse({ schemaVersion: "openskill-kit.preference-graph.v1", projectId, nodes: [], conflicts: [], updatedAt: now.toISOString() }));
    const incomingIds = new Set(nodes.map((node) => node.id));
    const graph: PreferenceGraph = PreferenceGraphSchema.parse({
      ...existing,
      projectId,
      nodes: [
        ...existing.nodes.filter((node) => !incomingIds.has(node.id) && !isLearnV2GeneratedPreferenceNode(node)),
        ...nodes
      ].sort((a, b) => a.category.localeCompare(b.category) || b.confidence - a.confidence || a.title.localeCompare(b.title)),
      updatedAt: now.toISOString()
    });
    await writeJsonAtomic(file, graph);
    await writeJsonAtomic(path.join(root, ".openskill-kit", "preferences", "candidates", "pending.json"), graph.nodes.filter((node) => node.status === "candidate" || node.status === "staged" || node.status === "conflict"));
    return file;
  });
}

async function mergeWorkflowNodes(root: string, projectId: string, nodes: WorkflowNode[], now: Date): Promise<string> {
  const graph = await readWorkflowGraph(root, projectId, now);
  const incomingIds = new Set(nodes.map((node) => node.id));
  const next: WorkflowGraph = WorkflowGraphSchema.parse({
    ...graph,
    projectId,
    nodes: [
      ...graph.nodes.filter((node) => !incomingIds.has(node.id) && !isLearnV2GeneratedWorkflowNode(node)),
      ...nodes
    ].sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name)),
    updatedAt: now.toISOString()
  });
  return writeWorkflowGraph(root, next);
}

function isLearnV2GeneratedPreferenceNode(node: PreferenceNode): boolean {
  return node.evidence.some((item) => item.signalId.startsWith("learn-v2:")) ||
    (node.id.startsWith("pref_concept_") && /learn-v2 concept card/i.test(node.privacy?.rationale ?? ""));
}

function isLearnV2GeneratedWorkflowNode(node: WorkflowNode): boolean {
  return node.sourceSignalIds.some((signalId) => signalId.startsWith("learn-v2:")) ||
    (node.id.startsWith("workflow_concept_") && /learn-v2 concept card/i.test(node.privacy?.rationale ?? ""));
}

function pathToGlob(file: string): string {
  const parts = file.split("/");
  return parts.length > 1 ? `${parts.slice(0, -1).join("/")}/**` : file;
}

function commandSnippets(statement: string): string[] {
  return [...statement.matchAll(/`([^`]+)`/g)].map((match) => match[1]!).slice(0, 6);
}
