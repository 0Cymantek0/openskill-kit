import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readProjectConfig } from "../events/store.js";
import { SignalSchema, type Signal } from "../signals/schema.js";
import { scoreConfidence } from "./confidence.js";
import { detectConflicts } from "./conflict.js";
import { PreferenceGraphSchema, PreferenceNodeSchema, type PreferenceGraph, type PreferenceNode } from "./schema.js";

export interface UpdateGraphResult {
  schemaVersion: "openskill-kit.graph-update.v1";
  graphPath: string;
  candidatesPath: string;
  graph: PreferenceGraph;
  candidateCount: number;
}

export async function updatePreferenceGraph(projectRoot: string, now = new Date()): Promise<UpdateGraphResult> {
  const root = path.resolve(projectRoot);
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
    const status = existingNode?.status && existingNode.status !== "candidate"
      ? existingNode.status
      : confidence >= config.learning.minConfidenceToApply && config.learning.mode === "auto-apply-safe" ? "active" : "candidate";
    nextNodes.push(PreferenceNodeSchema.parse({
      schemaVersion: "openskill-kit.preference-node.v1",
      id,
      title: titleFromStatement(group[0]?.statement ?? "Preference"),
      statement: group[0]?.statement ?? "Preference",
      category: group[0]?.category ?? "general",
      scope: mergeScopes(group),
      confidence,
      status,
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
    }));
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
  await fs.mkdir(path.dirname(graphPath), { recursive: true });
  await fs.writeFile(graphPath, JSON.stringify(graph, null, 2), "utf8");
  await fs.mkdir(path.dirname(candidatesPath), { recursive: true });
  const pending = graph.nodes.filter((node) => node.status === "candidate" || node.status === "conflict");
  await fs.writeFile(candidatesPath, JSON.stringify(pending, null, 2), "utf8");
  return { schemaVersion: "openskill-kit.graph-update.v1", graphPath, candidatesPath, graph, candidateCount: pending.length };
}

export async function applyPreferenceReview(projectRoot: string, options: { activate?: string[]; reject?: string[]; activateAll?: boolean; lock?: string[] }, now = new Date()): Promise<PreferenceGraph> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  const graph = await readGraph(root, config.projectId, now);
  const activate = new Set(options.activate ?? []);
  const reject = new Set(options.reject ?? []);
  const lock = new Set(options.lock ?? []);
  const nodes = graph.nodes.map((node) => {
    if (options.activateAll && (node.status === "candidate" || node.status === "conflict")) return { ...node, status: "active" as const, updatedAt: now.toISOString() };
    if (activate.has(node.id)) return { ...node, status: "active" as const, updatedAt: now.toISOString() };
    if (reject.has(node.id)) return { ...node, status: "rejected" as const, updatedAt: now.toISOString() };
    if (lock.has(node.id)) return { ...node, status: "locked" as const, updatedAt: now.toISOString() };
    return node;
  });
  const next = PreferenceGraphSchema.parse({ ...graph, nodes, conflicts: detectConflicts(nodes.filter((node) => node.status === "active" || node.status === "candidate")), updatedAt: now.toISOString() });
  await fs.writeFile(graphFile(root), JSON.stringify(next, null, 2), "utf8");
  await fs.writeFile(pendingFile(root), JSON.stringify(next.nodes.filter((node) => node.status === "candidate" || node.status === "conflict"), null, 2), "utf8");
  return next;
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
    .then((text) => PreferenceGraphSchema.parse(JSON.parse(text)))
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

function graphFile(root: string): string {
  return path.join(root, ".openskill-kit", "preferences", "graph.json");
}

function pendingFile(root: string): string {
  return path.join(root, ".openskill-kit", "preferences", "candidates", "pending.json");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
