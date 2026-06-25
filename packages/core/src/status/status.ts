import { promises as fs } from "node:fs";
import path from "node:path";
import { readCalibrationReport, type CalibrationReport } from "../preferences/calibration.js";
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

export interface AdaptiveStatusExplanation {
  schemaVersion: "openskill-kit.status-explain.v1";
  status: AdaptiveStatus;
  nextActions: string[];
  stale: boolean;
  calibration?: {
    path: string;
    categories: CalibrationReport["categories"];
    extractors: CalibrationReport["extractors"];
  };
}

export async function getAdaptiveStatus(projectRoot: string): Promise<AdaptiveStatus> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root).catch(() => undefined);
  const graph = await readJson(path.join(root, ".openskill-kit", "preferences", "graph.json")).catch(() => undefined) as { nodes?: Array<{ status?: string }> } | undefined;
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
    activePreferenceCount: graph?.nodes?.filter((node) => node.status === "active" || node.status === "locked").length ?? 0,
    candidateCount: Array.isArray(candidates) ? candidates.length : 0,
    compiled: {
      contextPack: await exists(path.join(root, ".openskill-kit", "compiled", "context-pack.md")),
      projectBehaviorSkill: await exists(path.join(root, ".openskill-kit", "compiled", "skills", "project-behavior", "SKILL.md"))
    }
  };
}

export async function explainAdaptiveStatus(projectRoot: string): Promise<AdaptiveStatusExplanation> {
  const root = path.resolve(projectRoot);
  const status = await getAdaptiveStatus(root);
  const graphFile = path.join(root, ".openskill-kit", "preferences", "graph.json");
  const contextFile = path.join(root, ".openskill-kit", "compiled", "context-pack.md");
  const calibrationPath = path.join(root, ".openskill-kit", "preferences", "calibration.json");
  const calibration = await readCalibrationReport(root).catch(() => undefined);
  const graphMtime = await mtime(graphFile);
  const contextMtime = await mtime(contextFile);
  const stale = Boolean(graphMtime && contextMtime && graphMtime > contextMtime);
  const nextActions: string[] = [];
  if (!status.initialized) nextActions.push("Run init to create project state.");
  if (status.eventCount === 0) nextActions.push("Record lifecycle events with observe or installed hooks.");
  if (status.signalCount === 0 && status.eventCount > 0) nextActions.push("Run learn or daemon to extract signals.");
  if (status.candidateCount > 0) nextActions.push("Run review --queue, then accept or reject candidates.");
  if (status.activePreferenceCount > 0 && (!status.compiled.contextPack || stale)) nextActions.push("Run compile to refresh behavior artifacts.");
  if (status.activePreferenceCount === 0 && status.candidateCount === 0 && status.signalCount > 0) nextActions.push("Wait for stronger evidence or propose a semantic preference.");
  if (calibration) nextActions.push(`Calibration loaded: ${Object.keys(calibration.categories).length} categor${Object.keys(calibration.categories).length === 1 ? "y" : "ies"}, ${Object.keys(calibration.extractors).length} extractor(s).`);
  if (nextActions.length === 0) nextActions.push("Behavior layer current; keep collecting high-value events.");
  return {
    schemaVersion: "openskill-kit.status-explain.v1",
    status,
    nextActions,
    stale,
    calibration: calibration ? { path: calibrationPath, categories: calibration.categories, extractors: calibration.extractors } : undefined
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

async function mtime(file: string): Promise<number | undefined> {
  return fs.stat(file).then((stat) => stat.mtimeMs).catch(() => undefined);
}
