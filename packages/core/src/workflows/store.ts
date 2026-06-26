import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonAtomic, withFileLock } from "../storage/atomic.js";
import { WorkflowGraphSchema, type WorkflowGraph, type WorkflowMiningEvidence } from "./schema.js";

export async function readWorkflowGraph(projectRoot: string, projectId: string, now: Date): Promise<WorkflowGraph> {
  const root = path.resolve(projectRoot);
  const file = workflowGraphFile(root);
  const text = await fs.readFile(file, "utf8").catch(() => "");
  if (!text) {
    return WorkflowGraphSchema.parse({
      schemaVersion: "openskill-kit.workflow-graph.v1",
      projectId,
      nodes: [],
      conflicts: [],
      updatedAt: now.toISOString()
    });
  }
  return migrateWorkflowGraph(JSON.parse(text));
}

export function migrateWorkflowGraph(value: unknown): WorkflowGraph {
  return WorkflowGraphSchema.parse(value);
}

export async function writeWorkflowGraph(projectRoot: string, graph: WorkflowGraph): Promise<string> {
  const file = workflowGraphFile(path.resolve(projectRoot));
  await writeJsonAtomic(file, graph);
  return file;
}

export async function writeWorkflowMiningEvidence(projectRoot: string, evidence: WorkflowMiningEvidence): Promise<string> {
  const root = path.resolve(projectRoot);
  const dir = path.join(root, ".openskill-kit", "workflows", "mining");
  const file = path.join(dir, `${evidence.workflowId}.json`);
  await writeJsonAtomic(file, evidence);
  return file;
}

export async function lockWorkflowGraph(projectRoot: string, fn: () => Promise<WorkflowGraph>): Promise<WorkflowGraph> {
  const lockFile = path.join(path.resolve(projectRoot), ".openskill-kit", "workflows", ".graph.lock");
  return withFileLock(lockFile, fn);
}

export function workflowGraphFile(root: string): string {
  return path.join(root, ".openskill-kit", "workflows", "graph.json");
}

export function workflowPendingFile(root: string): string {
  return path.join(root, ".openskill-kit", "workflows", "candidates", "pending.json");
}
