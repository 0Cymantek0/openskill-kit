import { promises as fs } from "node:fs";
import path from "node:path";
import { readCalibrationReport, type CalibrationReport } from "../preferences/calibration.js";
import { getCompiledPluginStatus, type CompiledPluginStatus } from "../compiler/plugin-compiler.js";
import { readProjectConfig } from "../events/store.js";
import { readInteractionImportRuns } from "../interactions/importer.js";

export interface AdaptiveStatus {
  schemaVersion: "openskill-kit.status.v1";
  initialized: boolean;
  projectRoot: string;
  projectId?: string;
  projectName?: string;
  eventCount: number;
  signalCount: number;
  activePreferenceCount: number;
  stagedPreferenceCount: number;
  candidateCount: number;
  activeWorkflowCount: number;
  stagedWorkflowCount: number;
  workflowCandidateCount: number;
  interactionImportCount: number;
  importedInteractionEventCount: number;
  blockedInteractionImportCount: number;
  pendingReviewCount: number;
  compiled: {
    contextPack: boolean;
    projectBehaviorSkill: boolean;
    projectWorkflowsSkill: boolean;
    plugin: boolean;
    pluginStatus: CompiledPluginStatus;
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
    scopes: CalibrationReport["scopes"];
    evidenceKinds: CalibrationReport["evidenceKinds"];
    privacyClasses: CalibrationReport["privacyClasses"];
    evalOutcomes: CalibrationReport["evalOutcomes"];
  };
}

export async function getAdaptiveStatus(projectRoot: string): Promise<AdaptiveStatus> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root).catch(() => undefined);
  const graph = await readJson(path.join(root, ".openskill-kit", "preferences", "graph.json")).catch(() => undefined) as { nodes?: Array<{ status?: string }> } | undefined;
  const candidates = await readJson(path.join(root, ".openskill-kit", "preferences", "candidates", "pending.json")).catch(() => []) as unknown[];
  const workflowGraph = await readJson(path.join(root, ".openskill-kit", "workflows", "graph.json")).catch(() => undefined) as { nodes?: Array<{ status?: string }> } | undefined;
  const workflowCandidates = workflowGraph?.nodes?.filter((node) => node.status === "candidate" || node.status === "staged" || node.status === "conflict").length ?? 0;
  const preferenceCandidates = Array.isArray(candidates) ? candidates.length : 0;
  const signalCount = await countJsonl(path.join(root, ".openskill-kit", "signals", "normalized.jsonl"));
  const eventIndex = await readJson(path.join(root, ".openskill-kit", "events", "index.json")).catch(() => undefined) as { eventCount?: number } | undefined;
  const interactionImports = await readInteractionImportRuns(root).catch(() => []);
  const pluginStatus = await getCompiledPluginStatus(root);
  return {
    schemaVersion: "openskill-kit.status.v1",
    initialized: Boolean(config),
    projectRoot: root,
    projectId: config?.projectId,
    projectName: config?.projectName,
    eventCount: eventIndex?.eventCount ?? 0,
    signalCount,
    activePreferenceCount: graph?.nodes?.filter((node) => node.status === "active" || node.status === "locked").length ?? 0,
    stagedPreferenceCount: graph?.nodes?.filter((node) => node.status === "staged").length ?? 0,
    candidateCount: preferenceCandidates,
    activeWorkflowCount: workflowGraph?.nodes?.filter((node) => node.status === "active" || node.status === "locked").length ?? 0,
    stagedWorkflowCount: workflowGraph?.nodes?.filter((node) => node.status === "staged").length ?? 0,
    workflowCandidateCount: workflowCandidates,
    interactionImportCount: interactionImports.length,
    importedInteractionEventCount: interactionImports.reduce((sum, run) => sum + run.appendedEventCount, 0),
    blockedInteractionImportCount: interactionImports.filter((run) => run.status === "blocked").length,
    pendingReviewCount: preferenceCandidates + workflowCandidates,
    compiled: {
      contextPack: await exists(path.join(root, ".openskill-kit", "compiled", "context-pack.md")),
      projectBehaviorSkill: await exists(path.join(root, ".openskill-kit", "compiled", "skills", "project-behavior", "SKILL.md")),
      projectWorkflowsSkill: await exists(path.join(root, ".openskill-kit", "compiled", "skills", "project-workflows", "SKILL.md")),
      plugin: pluginStatus.ready,
      pluginStatus
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
  if (status.blockedInteractionImportCount > 0) nextActions.push("Inspect interactions imports; at least one import was blocked.");
  if (status.pendingReviewCount > 0) nextActions.push("Run review --queue, then accept or reject candidates and staged previews.");
  if (status.activePreferenceCount > 0 && (!status.compiled.contextPack || stale)) nextActions.push("Run compile to refresh behavior artifacts.");
  if (!status.compiled.plugin) nextActions.push("Run compile --target plugin to create an attachable coding-harness plugin bundle.");
  if (status.compiled.plugin && !(await hasHostMcpAttachment(root))) nextActions.push("Run agent attach-plugin --host generic-mcp --dry-run to preview host MCP attachment for the compiled plugin.");
  if (status.activePreferenceCount === 0 && status.pendingReviewCount === 0 && status.signalCount > 0) nextActions.push("Wait for stronger evidence or propose a semantic preference.");
  if (calibration) nextActions.push(`Calibration loaded: ${Object.keys(calibration.categories).length} categor${Object.keys(calibration.categories).length === 1 ? "y" : "ies"}, ${Object.keys(calibration.extractors).length} extractor(s), ${Object.keys(calibration.evalOutcomes).length} eval outcome(s).`);
  if (nextActions.length === 0) nextActions.push("Behavior layer current; keep collecting high-value events.");
  return {
    schemaVersion: "openskill-kit.status-explain.v1",
    status,
    nextActions,
    stale,
    calibration: calibration ? {
      path: calibrationPath,
      categories: calibration.categories,
      extractors: calibration.extractors,
      scopes: calibration.scopes,
      evidenceKinds: calibration.evidenceKinds,
      privacyClasses: calibration.privacyClasses,
      evalOutcomes: calibration.evalOutcomes
    } : undefined
  };
}

async function hasHostMcpAttachment(root: string): Promise<boolean> {
  for (const relative of [".mcp.json", path.join(".cursor", "mcp.json")]) {
    const file = path.join(root, relative);
    const parsed = await readJson(file).catch(() => undefined) as { mcpServers?: Record<string, { command?: string }> } | undefined;
    if (parsed?.mcpServers?.["openskill-kit"]?.command === "openskill-kit-mcp") return true;
  }
  return false;
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
