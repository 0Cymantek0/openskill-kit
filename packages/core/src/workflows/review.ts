import path from "node:path";
import { readProjectConfig } from "../events/store.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { readWorkflowGraph, workflowPendingFile, writeWorkflowGraph } from "./store.js";
import { WorkflowGraphSchema, WorkflowNodeSchema, type WorkflowGraph, type WorkflowNode } from "./schema.js";

export interface ApplyWorkflowReviewOptions {
  activate?: string[];
  reject?: string[];
  lock?: string[];
  demote?: string[];
  activateAll?: boolean;
}

export interface ApplyWorkflowReviewResult {
  schemaVersion: "openskill-kit.workflow-review-result.v1";
  graph: WorkflowGraph;
  graphPath: string;
  pendingPath: string;
  reviewedCount: number;
}

export async function applyWorkflowReview(projectRoot: string, options: ApplyWorkflowReviewOptions, now = new Date()): Promise<ApplyWorkflowReviewResult> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  const graph = await readWorkflowGraph(root, config.projectId, now);
  const activate = new Set(options.activate ?? []);
  const reject = new Set(options.reject ?? []);
  const lock = new Set(options.lock ?? []);
  const demote = new Set(options.demote ?? []);
  let reviewedCount = 0;
  const nodes = graph.nodes.map((node) => {
    let next = node;
    if (reject.has(node.id)) next = { ...next, status: "rejected" as const };
    else if (lock.has(node.id)) next = { ...next, status: "locked" as const };
    else if (activate.has(node.id)) next = { ...next, status: "active" as const };
    else if (demote.has(node.id)) next = { ...next, status: "candidate" as const };
    else if (options.activateAll && (node.status === "candidate" || node.status === "staged")) next = { ...next, status: "active" as const };
    if (next === node) return node;
    reviewedCount += 1;
    return withWorkflowReviewMetadata(next, node, now);
  });
  const next = WorkflowGraphSchema.parse({
    ...graph,
    nodes,
    updatedAt: now.toISOString()
  });
  const graphPath = await writeWorkflowGraph(root, next);
  const pendingPath = workflowPendingFile(root);
  await writeJsonAtomic(pendingPath, next.nodes.filter((node) => node.status === "candidate" || node.status === "staged" || node.status === "conflict"));
  return {
    schemaVersion: "openskill-kit.workflow-review-result.v1",
    graph: next,
    graphPath,
    pendingPath,
    reviewedCount
  };
}

function withWorkflowReviewMetadata(next: WorkflowNode, previous: WorkflowNode, now: Date): WorkflowNode {
  const reviewed = next.status !== previous.status || next.status === "active" || next.status === "locked" || next.status === "rejected";
  return WorkflowNodeSchema.parse({
    ...next,
    schemaVersion: "openskill-kit.workflow-node.v1",
    lifecycle: {
      ...next.lifecycle,
      createdAt: next.lifecycle?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      reviewedAt: reviewed ? now.toISOString() : next.lifecycle?.reviewedAt,
      promotedAt: (next.status === "active" || next.status === "locked") && previous.status !== next.status ? now.toISOString() : next.lifecycle?.promotedAt
    }
  });
}
