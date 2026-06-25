import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readProjectConfig } from "../events/store.js";
import { writeJsonAtomic, withFileLock } from "../storage/atomic.js";
import { SignalSchema, type Signal } from "../signals/schema.js";
import { scoreConfidence } from "./confidence.js";
import { detectConflicts } from "./conflict.js";
import { migratePreferenceGraph } from "./migrations.js";
import { PreferenceGraphSchema, PreferenceNodeSchema, type PreferenceGraph, type PreferenceNode } from "./schema.js";
import { validateMemoryNodes } from "./integrity.js";

export interface UpdateGraphResult {
  schemaVersion: "openskill-kit.graph-update.v1";
  graphPath: string;
  candidatesPath: string;
  graph: PreferenceGraph;
  candidateCount: number;
}

export interface PreferenceReviewEdit {
  id: string;
  title?: string;
  statement?: string;
  category?: PreferenceNode["category"];
  scope?: PreferenceNode["scope"];
  confidence?: number;
  polarity?: PreferenceNode["polarity"];
}

export interface PreferenceReviewMerge {
  targetId: string;
  sourceIds: string[];
  statement?: string;
}

export interface PreferenceReviewSplit {
  id: string;
  statements: string[];
}

export interface ApplyPreferenceReviewOptions {
  activate?: string[];
  reject?: string[];
  activateAll?: boolean;
  lock?: string[];
  demote?: string[];
  promote?: string[];
  promoteGlobal?: string[];
  edits?: PreferenceReviewEdit[];
  merges?: PreferenceReviewMerge[];
  splits?: PreferenceReviewSplit[];
}

export async function updatePreferenceGraph(projectRoot: string, now = new Date()): Promise<UpdateGraphResult> {
  const root = path.resolve(projectRoot);
  return withFileLock(path.join(root, ".openskill-kit", "preferences", ".graph.lock"), async () => {
    const config = await readProjectConfig(root);
    const existing = await readGraph(root, config.projectId, now);
    const signals = await readSignals(root);
    const grouped = groupSignals(signals);
    const byId = new Map(existing.nodes.map((node) => [node.id, node]));
    const nextNodes: PreferenceNode[] = [];
    for (const group of grouped) {
      const id = `pref_${shortHash(`${group[0]?.category}:${group[0]?.statement.toLowerCase()}`)}`;
      const existingNode = byId.get(id);
      const confidence = scoreConfidence(group, config.learning.decayHalfLifeDays, now);
      const desiredStatus = existingNode?.status && existingNode.status !== "candidate"
        ? existingNode.status
        : confidence >= config.learning.minConfidenceToApply && config.learning.mode === "auto-apply-safe" ? "active" : "candidate";
      const node = PreferenceNodeSchema.parse({
        schemaVersion: "openskill-kit.preference-node.v1",
        id,
        title: titleFromStatement(group[0]?.statement ?? "Preference"),
        statement: group[0]?.statement ?? "Preference",
        category: group[0]?.category ?? "general",
        scope: mergeScopes(group),
        confidence,
        status: desiredStatus,
        polarity: dominantPolarity(group),
        evidence: group.map((signal) => ({
          signalId: signal.id,
          eventIds: signal.eventIds,
          weight: signal.weight,
          quote: signal.evidence[0]?.quote,
          command: signal.evidence[0]?.command
        })),
        createdAt: existingNode?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString()
      });
      const integrityIssues = desiredStatus === "active" ? validateMemoryNodes([node], { config }).filter((issue) => issue.severity === "fail") : [];
      nextNodes.push(integrityIssues.length ? { ...node, status: "candidate" } : node);
    }
    const merged = mergeLockedAndRejected(existing.nodes, nextNodes);
    const conflicts = detectConflicts(merged.filter((node) => node.status === "active" || node.status === "candidate"));
    const graph = PreferenceGraphSchema.parse({
      schemaVersion: "openskill-kit.preference-graph.v1",
      projectId: config.projectId,
      nodes: merged.map((node) => conflicts.some((conflict) => conflict.nodeIds.includes(node.id)) && node.status === "candidate" ? { ...node, status: "conflict" } : node),
      conflicts,
      updatedAt: now.toISOString()
    });
    const graphPath = graphFile(root);
    const candidatesPath = pendingFile(root);
    await writeJsonAtomic(graphPath, graph);
    const pending = graph.nodes.filter((node) => node.status === "candidate" || node.status === "conflict");
    await writeJsonAtomic(candidatesPath, pending);
    return { schemaVersion: "openskill-kit.graph-update.v1", graphPath, candidatesPath, graph, candidateCount: pending.length };
  });
}

export async function applyPreferenceReview(projectRoot: string, options: ApplyPreferenceReviewOptions, now = new Date()): Promise<PreferenceGraph> {
  const root = path.resolve(projectRoot);
  return withFileLock(path.join(root, ".openskill-kit", "preferences", ".graph.lock"), async () => {
    const config = await readProjectConfig(root);
    const graph = await readGraph(root, config.projectId, now);
    const activate = new Set(options.activate ?? []);
    const reject = new Set(options.reject ?? []);
    const lock = new Set(options.lock ?? []);
    const demote = new Set(options.demote ?? []);
    const promote = new Set(options.promote ?? []);
    const promoteGlobal = new Set(options.promoteGlobal ?? []);
    if (promote.size > 0 && !config.scopes.user) throw new Error("User-scope promotion disabled by config");
    if (promoteGlobal.size > 0 && config.scopes.globalPromotion === "off") throw new Error("Global promotion disabled by config");
    let nodes = graph.nodes.map((node) => {
      let next = node;
      if (reject.has(node.id)) next = { ...next, status: "rejected" as const };
      else if (lock.has(node.id)) next = { ...next, status: "locked" as const };
      else if (activate.has(node.id)) next = { ...next, status: "active" as const };
      else if (demote.has(node.id)) next = { ...next, status: "candidate" as const };
      else if (options.activateAll && node.status === "candidate") next = { ...next, status: "active" as const };
      if (promote.has(node.id)) next = { ...next, scope: { ...next.scope, level: "user" as const } };
      if (promoteGlobal.has(node.id)) next = { ...next, scope: { ...next.scope, level: "global" as const } };
      return next === node ? node : { ...next, updatedAt: now.toISOString() };
    });
    nodes = applyReviewEdits(nodes, options.edits ?? [], now);
    nodes = applyReviewMerges(nodes, options.merges ?? [], now);
    nodes = applyReviewSplits(nodes, options.splits ?? [], now);
    const next = PreferenceGraphSchema.parse({ ...graph, nodes, conflicts: detectConflicts(nodes.filter((node) => node.status === "active" || node.status === "candidate" || node.status === "conflict")), updatedAt: now.toISOString() });
    await writeJsonAtomic(graphFile(root), next);
    await writeJsonAtomic(pendingFile(root), next.nodes.filter((node) => node.status === "candidate" || node.status === "conflict"));
    return next;
  });
}

export async function explainPreference(projectRoot: string, id: string): Promise<PreferenceNode | undefined> {
  const config = await readProjectConfig(projectRoot);
  const graph = await readGraph(projectRoot, config.projectId, new Date());
  return graph.nodes.find((node) => node.id === id || node.title.toLowerCase() === id.toLowerCase());
}

export async function readPreferenceGraph(projectRoot: string): Promise<PreferenceGraph> {
  const config = await readProjectConfig(projectRoot);
  return readGraph(projectRoot, config.projectId, new Date());
}

async function readGraph(root: string, projectId: string, now: Date): Promise<PreferenceGraph> {
  return fs.readFile(graphFile(root), "utf8")
    .then((text) => migratePreferenceGraph(JSON.parse(text)))
    .catch(() => PreferenceGraphSchema.parse({ schemaVersion: "openskill-kit.preference-graph.v1", projectId, nodes: [], conflicts: [], updatedAt: now.toISOString() }));
}

async function readSignals(root: string): Promise<Signal[]> {
  const file = path.join(root, ".openskill-kit", "signals", "normalized.jsonl");
  const text = await fs.readFile(file, "utf8").catch(() => "");
  return text.split(/\r?\n/).filter(Boolean).map((line) => SignalSchema.parse(JSON.parse(line)));
}

function groupSignals(signals: Signal[]): Signal[][] {
  const groups = new Map<string, Signal[]>();
  for (const signal of signals) {
    const key = `${signal.category}:${signal.statement.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), signal]);
  }
  return [...groups.values()];
}

function mergeLockedAndRejected(existing: PreferenceNode[], next: PreferenceNode[]): PreferenceNode[] {
  const nextIds = new Set(next.map((node) => node.id));
  return [
    ...next,
    ...existing.filter((node) => !nextIds.has(node.id) && (node.status === "locked" || node.status === "rejected" || node.status === "active"))
  ].sort((a, b) => a.category.localeCompare(b.category) || b.confidence - a.confidence || a.title.localeCompare(b.title));
}

function mergeScopes(signals: Signal[]): PreferenceNode["scope"] {
  const paths = [...new Set(signals.flatMap((signal) => signal.scope.paths))].sort();
  return { level: paths.length ? "path" : "project", paths };
}

function dominantPolarity(signals: Signal[]): Signal["polarity"] {
  const scores = { positive: 0, negative: 0, neutral: 0 };
  for (const signal of signals) scores[signal.polarity] += signal.weight;
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] as Signal["polarity"] ?? "positive";
}

function titleFromStatement(statement: string): string {
  return statement.replace(/^Prefer\s+/i, "").replace(/^Do not\s+/i, "Avoid ").slice(0, 72);
}

function applyReviewEdits(nodes: PreferenceNode[], edits: PreferenceReviewEdit[], now: Date): PreferenceNode[] {
  if (!edits.length) return nodes;
  const byId = new Map(edits.map((edit) => [edit.id, edit]));
  return nodes.map((node) => {
    const edit = byId.get(node.id);
    if (!edit) return node;
    return PreferenceNodeSchema.parse({
      ...node,
      title: edit.title ?? (edit.statement ? titleFromStatement(edit.statement) : node.title),
      statement: edit.statement ?? node.statement,
      category: edit.category ?? node.category,
      scope: edit.scope ?? node.scope,
      confidence: edit.confidence ?? node.confidence,
      polarity: edit.polarity ?? node.polarity,
      updatedAt: now.toISOString()
    });
  });
}

function applyReviewMerges(nodes: PreferenceNode[], merges: PreferenceReviewMerge[], now: Date): PreferenceNode[] {
  let next = nodes;
  for (const merge of merges) {
    const sourceIds = new Set(merge.sourceIds.filter((id) => id !== merge.targetId));
    const target = next.find((node) => node.id === merge.targetId);
    const sources = next.filter((node) => sourceIds.has(node.id));
    if (!target || sources.length === 0) continue;
    const mergedEvidence = dedupeEvidence([...target.evidence, ...sources.flatMap((node) => node.evidence)]);
    next = next.map((node) => {
      if (node.id === target.id) {
        return PreferenceNodeSchema.parse({
          ...node,
          statement: merge.statement ?? node.statement,
          title: merge.statement ? titleFromStatement(merge.statement) : node.title,
          evidence: mergedEvidence,
          confidence: Math.max(node.confidence, ...sources.map((source) => source.confidence)),
          updatedAt: now.toISOString()
        });
      }
      if (sourceIds.has(node.id)) return { ...node, status: "rejected" as const, updatedAt: now.toISOString() };
      return node;
    });
  }
  return next;
}

function applyReviewSplits(nodes: PreferenceNode[], splits: PreferenceReviewSplit[], now: Date): PreferenceNode[] {
  let next = nodes;
  for (const split of splits) {
    const original = next.find((node) => node.id === split.id);
    if (!original || split.statements.length < 2) continue;
    const children = split.statements.map((statement) => PreferenceNodeSchema.parse({
      ...original,
      id: `pref_${shortHash(`${original.category}:${statement.toLowerCase()}`)}`,
      title: titleFromStatement(statement),
      statement,
      status: "candidate" as const,
      confidence: Math.max(0, Math.round((original.confidence * 0.92) * 1000) / 1000),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    }));
    const existingIds = new Set(next.map((node) => node.id));
    next = next.map((node) => node.id === original.id ? { ...node, status: "rejected" as const, updatedAt: now.toISOString() } : node);
    next.push(...children.filter((child) => !existingIds.has(child.id)));
  }
  return next;
}

function dedupeEvidence(evidence: PreferenceNode["evidence"]): PreferenceNode["evidence"] {
  const seen = new Map<string, PreferenceNode["evidence"][number]>();
  for (const item of evidence) seen.set(`${item.signalId}:${item.eventIds.join(",")}`, item);
  return [...seen.values()];
}

function graphFile(root: string): string {
  return path.join(root, ".openskill-kit", "preferences", "graph.json");
}

function pendingFile(root: string): string {
  return path.join(root, ".openskill-kit", "preferences", "candidates", "pending.json");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
