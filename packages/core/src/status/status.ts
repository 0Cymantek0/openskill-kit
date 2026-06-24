import { promises as fs } from "node:fs";
import path from "node:path";
import { readProjectConfig } from "../events/store.js";

export interface AdaptiveStatus {
  schemaVersion: "openskill-kit.status.v1";
  initialized: boolean;
  projectRoot: string;
  projectId?: string;
  projectName?: string;
  eventCount: number;
  signalCount: number;
  activePreferenceCount: number;
  candidateCount: number;
  compiled: {
    contextPack: boolean;
    projectBehaviorSkill: boolean;
  };
}

export async function getAdaptiveStatus(projectRoot: string): Promise<AdaptiveStatus> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root).catch(() => undefined);
  const graph = await readJson(path.join(root, ".openskill-kit", "preferences", "graph.json")).catch(() => undefined) as { nodes?: unknown[] } | undefined;
  const candidates = await readJson(path.join(root, ".openskill-kit", "preferences", "candidates", "pending.json")).catch(() => []) as unknown[];
  const signalCount = await countJsonl(path.join(root, ".openskill-kit", "signals", "normalized.jsonl"));
  const eventIndex = await readJson(path.join(root, ".openskill-kit", "events", "index.json")).catch(() => undefined) as { eventCount?: number } | undefined;
  return {
    schemaVersion: "openskill-kit.status.v1",
    initialized: Boolean(config),
    projectRoot: root,
    projectId: config?.projectId,
    projectName: config?.projectName,
    eventCount: eventIndex?.eventCount ?? 0,
    signalCount,
    activePreferenceCount: graph?.nodes?.length ?? 0,
    candidateCount: Array.isArray(candidates) ? candidates.length : 0,
    compiled: {
      contextPack: await exists(path.join(root, ".openskill-kit", "compiled", "context-pack.md")),
      projectBehaviorSkill: await exists(path.join(root, ".openskill-kit", "compiled", "skills", "project-behavior", "SKILL.md"))
    }
  };
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function countJsonl(file: string): Promise<number> {
  const text = await fs.readFile(file, "utf8").catch(() => "");
  return text.split(/\r?\n/).filter((line) => line.trim()).length;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}
