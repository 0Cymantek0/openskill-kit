import { promises as fs } from "node:fs";
import path from "node:path";
import { readProjectConfig } from "../events/store.js";
import { PreferenceGraphSchema, type PreferenceGraph, type PreferenceNode } from "../preferences/schema.js";
import { WorkflowGraphSchema, type WorkflowGraph, type WorkflowNode } from "../workflows/schema.js";
import { readWorkflowGraph, writeWorkflowGraph } from "../workflows/store.js";
import { writeJsonAtomic, withFileLock } from "../storage/atomic.js";
import { compileLearnV2ConceptPreview } from "./compile.js";
import { LearnV2ConceptCardSchema, type LearnV2ConceptCard } from "./schemas.js";

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
  const merged = mergeConceptCards(existing.cards, cards, now);
  const store: LearnV2ConceptStore = {
    schemaVersion: "openskill-kit.learn-v2.concept-store.v1",
    projectId: config.projectId,
    updatedAt: now.toISOString(),
    cards: merged
  };
  await writeJsonAtomic(learnV2ConceptStorePath(root), store);
  await writeLearnV2ActivationIndex(root, store, now);
  return store;
}

export async function applyLearnV2ConceptReview(projectRoot: string, options: LearnV2ConceptReviewOptions): Promise<LearnV2ConceptReviewResult> {
  const root = path.resolve(projectRoot);
  const now = options.now ?? new Date();
  return withFileLock(path.join(root, ".openskill-kit", "learn-v2", ".concepts.lock"), async () => {
    const store = await readLearnV2ConceptStore(root, now);
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
    const reviewed = store.cards.map((card) => {
      let next = card;
      if (reject.has(card.id)) next = withStatus(next, "rejected", now);
      if (markOneOff.has(card.id)) next = withStatus(next, "one-off", now);
      if (demote.has(card.id)) next = withStatus(next, "candidate", now);
      if (accept.has(card.id)) next = withStatus(next, "active", now);
      if (lock.has(card.id)) next = withStatus(next, "locked", now);
      if (options.bulkSafe === "accept-low-risk" && card.risk === "low" && card.confidence >= 0.7 && card.status === "candidate") next = withStatus(next, "active", now);
      if (options.bulkSafe === "reject-one-off" && card.status === "candidate" && card.durability < 0.5) next = withStatus(next, "one-off", now);
      if (options.bulkSafe === "mark-superseded" && card.status === "candidate" && card.counterevidence.length > 0) next = withStatus(next, "superseded", now);
      const edit = editById.get(card.id);
      if (edit) {
        next = {
          ...next,
          title: edit.title ?? next.title,
          canonicalBehavior: edit.canonicalBehavior ?? next.canonicalBehavior,
          activation: {
            ...next.activation,
            phrases: edit.activationPhrases ?? next.activation.phrases
          },
          lifecycle: { ...next.lifecycle, updatedAt: now.toISOString() }
        };
      }
      const narrow = narrowById.get(card.id);
      if (narrow) {
        next = {
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
        };
      }
      const counter = counterById.get(card.id);
      if (counter?.length) {
        next = {
          ...next,
          status: next.status === "active" || next.status === "locked" ? next.status : "conflict",
          counterevidence: [
            ...next.counterevidence,
            ...counter.map((item) => ({ evidenceId: item.evidenceId, reason: item.reason }))
          ],
          lifecycle: { ...next.lifecycle, updatedAt: now.toISOString() }
        };
      }
      return LearnV2ConceptCardSchema.parse(next);
    });
    const nextStore: LearnV2ConceptStore = {
      schemaVersion: "openskill-kit.learn-v2.concept-store.v1",
      projectId: store.projectId,
      updatedAt: now.toISOString(),
      cards: reviewed
    };
    await writeJsonAtomic(learnV2ConceptStorePath(root), nextStore);
    const activationIndex = await writeLearnV2ActivationIndex(root, nextStore, now);
    let preferenceGraphPath: string | undefined;
    let workflowGraphPath: string | undefined;
    if (options.compileActive !== false) {
      const synced = await syncLearnV2ActiveConcepts(root, nextStore.cards, now);
      preferenceGraphPath = synced.preferenceGraphPath;
      workflowGraphPath = synced.workflowGraphPath;
    }
    const reviewedCount = nextStore.cards.filter((card) => before.get(card.id) !== card.status || editById.has(card.id) || narrowById.has(card.id) || counterById.has(card.id)).length;
    return {
      schemaVersion: "openskill-kit.learn-v2.review-result.v1",
      storePath: learnV2ConceptStorePath(root),
      activationIndexPath: learnV2ActivationIndexPath(root),
      reviewedCount,
      activeConceptCount: nextStore.cards.filter((card) => card.status === "active" || card.status === "locked").length,
      candidateConceptCount: nextStore.cards.filter((card) => card.status === "candidate" || card.status === "conflict").length,
      preferenceGraphPath,
      workflowGraphPath,
      messages: [
        `Reviewed ${reviewedCount} learn-v2 concept(s).`,
        `Activation index entries: ${activationIndex.entries.length}.`,
        options.compileActive === false ? "Active concept graph sync skipped by option." : "Active concepts synced into preference/workflow graph compatibility outputs."
      ],
      store: nextStore
    };
  });
}

export async function writeLearnV2ActivationIndex(rootInput: string, store: LearnV2ConceptStore, now = new Date()): Promise<LearnV2ActivationIndex> {
  const root = path.resolve(rootInput);
  const index: LearnV2ActivationIndex = {
    schemaVersion: "openskill-kit.learn-v2.activation-index.v1",
    projectId: store.projectId,
    updatedAt: now.toISOString(),
    entries: store.cards
      .filter((card) => card.status !== "rejected" && card.status !== "one-off" && card.status !== "superseded")
      .map((card) => ({
        conceptId: card.id,
        status: card.status,
        title: card.title,
        phrases: card.activation.phrases,
        pathGlobs: card.activation.pathGlobs,
        commands: card.activation.commands,
        taskTypes: card.scope.taskTypes,
        negativeTriggers: card.scope.negativeTriggers,
        confidence: card.confidence,
        risk: card.risk
      }))
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
  const workflowGraphPath = preview.workflowNodes.length ? await mergeWorkflowNodes(root, config.projectId, preview.workflowNodes, now) : undefined;
  return { preferenceGraphPath, workflowGraphPath };
}

export function learnV2ConceptStorePath(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json");
}

export function learnV2ActivationIndexPath(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "activation-index.json");
}

function mergeConceptCards(existing: LearnV2ConceptCard[], incoming: LearnV2ConceptCard[], now: Date): LearnV2ConceptCard[] {
  const byId = new Map(existing.map((card) => [card.id, card]));
  for (const card of incoming) {
    const previous = byId.get(card.id);
    byId.set(card.id, previous ? {
      ...card,
      status: previous.status,
      counterevidence: previous.counterevidence.length ? previous.counterevidence : card.counterevidence,
      lifecycle: {
        ...card.lifecycle,
        createdAt: previous.lifecycle.createdAt,
        updatedAt: now.toISOString(),
        supersedes: previous.lifecycle.supersedes,
        supersededBy: previous.lifecycle.supersededBy
      }
    } : card);
  }
  return [...byId.values()].sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title));
}

function withStatus(card: LearnV2ConceptCard, status: LearnV2ConceptCard["status"], now: Date): LearnV2ConceptCard {
  return {
    ...card,
    status,
    lifecycle: { ...card.lifecycle, updatedAt: now.toISOString() }
  };
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
        ...existing.nodes.filter((node) => !incomingIds.has(node.id)),
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
      ...graph.nodes.filter((node) => !incomingIds.has(node.id)),
      ...nodes
    ].sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name)),
    updatedAt: now.toISOString()
  });
  return writeWorkflowGraph(root, next);
}

function pathToGlob(file: string): string {
  const parts = file.split("/");
  return parts.length > 1 ? `${parts.slice(0, -1).join("/")}/**` : file;
}

