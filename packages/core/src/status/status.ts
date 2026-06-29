import { promises as fs } from "node:fs";
import path from "node:path";
import { readCalibrationReport, type CalibrationReport } from "../preferences/calibration.js";
import { getCompiledPluginStatus, type CompiledPluginStatus } from "../compiler/plugin-compiler.js";
import { readProjectConfig } from "../events/store.js";
import { readInteractionImportRuns } from "../interactions/importer.js";
import { getAgentPluginAttachStatus, type AgentPluginAttachStatus } from "../agents/plugin-attach.js";

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
  operations: OperationsStatusSummary;
  openWorld: OpenWorldStatusSummary;
  compiled: {
    contextPack: boolean;
    projectBehaviorSkill: boolean;
    projectWorkflowsSkill: boolean;
    plugin: boolean;
    pluginStatus: CompiledPluginStatus;
    pluginAttachment: AgentPluginAttachStatus;
  };
}

export interface OperationsStatusSummary {
  learn: {
    receiptPresent: boolean;
    latest?: {
      applied: boolean;
      previewOnly: boolean;
      sourceIds: string[];
      selectedSourceCount: number;
      eventsRead: number;
      eventsAppended: number;
      signalsExtracted: number;
      reviewRequired: boolean;
      nextCommand?: string;
    };
  };
  installs: {
    receiptCount: number;
    latest?: {
      path: string;
      schemaVersion?: string;
      kind: string;
      at?: string;
    };
  };
  evals: {
    runCount: number;
    latest?: {
      path: string;
      status?: string;
      scenarioCount?: number;
      passCount?: number;
    };
  };
  packs: {
    projectPackReady: boolean;
    manifestPath?: string;
    fileCount: number;
    encryptedPackPresent: boolean;
  };
}

export interface OpenWorldStatusSummary {
  taskCount: number;
  sourceCount: number;
  evolutionRunCount: number;
  evalReportCount: number;
  hiddenOracleHarnessCount: number;
  latest?: {
    taskId?: string;
    runId?: string;
    reportId?: string;
    status?: string;
    proofLevel: string;
    hiddenOracleProof: boolean;
    generatedAt?: string;
  };
  proofBoundary: {
    hiddenOracleProof: false;
    message: string;
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
  const pluginAttachment = await getAgentPluginAttachStatus(root);
  const openWorld = await summarizeOpenWorldStatus(root);
  const operations = await summarizeOperationsStatus(root);
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
    operations,
    openWorld,
    compiled: {
      contextPack: await exists(path.join(root, ".openskill-kit", "compiled", "context-pack.md")),
      projectBehaviorSkill: await exists(path.join(root, ".openskill-kit", "compiled", "skills", "project-behavior", "SKILL.md")),
      projectWorkflowsSkill: await exists(path.join(root, ".openskill-kit", "compiled", "skills", "project-workflows", "SKILL.md")),
      plugin: pluginStatus.ready,
      pluginStatus,
      pluginAttachment
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
  if (status.operations.learn.latest && !status.operations.learn.latest.applied) nextActions.push("Latest learning run is preview-only; apply selected safe sources only after reviewing the preview.");
  if (status.pendingReviewCount > 0) nextActions.push("Run review --queue, then accept or reject candidates and staged previews.");
  if (status.openWorld.taskCount > 0) {
    const proof = status.openWorld.latest?.proofLevel ?? "not-proof";
    nextActions.push(`OpenWorld proof boundary: ${proof}; hiddenOracleProof=${status.openWorld.proofBoundary.hiddenOracleProof}.`);
  }
  if (status.activePreferenceCount > 0 && (!status.compiled.contextPack || stale)) nextActions.push("Run compile to refresh behavior artifacts.");
  if (!status.compiled.plugin) nextActions.push("Run compile --target plugin to create an attachable coding-harness plugin bundle.");
  if (status.compiled.plugin && (!status.compiled.pluginAttachment.attached || !status.compiled.pluginAttachment.defaultHostReady)) nextActions.push(...status.compiled.pluginAttachment.nextActions);
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

async function summarizeOperationsStatus(root: string): Promise<OperationsStatusSummary> {
  const latestLearnReceipt = await readJson(path.join(root, ".openskill-kit", "reviews", "learn-receipt.json")).catch(() => undefined);
  const installReceipts = await readReceiptSummaries(path.join(root, ".openskill-kit", "installs"));
  const evalReports = await readEvalReportSummaries(root);
  const latestEval = evalReports[0];
  const packManifest = await readJson(path.join(root, ".openskill-kit", "compiled", "project-behavior-pack", "manifest.json")).catch(() => undefined);
  const packManifestRecord = isRecord(packManifest) ? packManifest : undefined;
  return {
    learn: {
      receiptPresent: isRecord(latestLearnReceipt),
      latest: summarizeLearnReceipt(latestLearnReceipt)
    },
    installs: {
      receiptCount: installReceipts.length,
      latest: installReceipts[0]
    },
    evals: {
      runCount: evalReports.length,
      latest: latestEval
    },
    packs: {
      projectPackReady: packManifestRecord?.schemaVersion === "openskill-kit.project-pack.v1",
      manifestPath: packManifestRecord ? normalizeRelative(root, path.join(root, ".openskill-kit", "compiled", "project-behavior-pack", "manifest.json")) : undefined,
      fileCount: Array.isArray(packManifestRecord?.files) ? packManifestRecord.files.length : 0,
      encryptedPackPresent: await exists(path.join(root, ".openskill-kit", "sync", "project-behavior-pack.enc.json"))
    }
  };
}

function summarizeLearnReceipt(value: unknown): OperationsStatusSummary["learn"]["latest"] | undefined {
  if (!isRecord(value) || value.schemaVersion !== "openskill-kit.learn-receipt.v1") return undefined;
  const sourceIdsFromArray = Array.isArray(value.sourceIds)
    ? value.sourceIds.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const sourceIds = sourceIdsFromArray.length
    ? sourceIdsFromArray
    : stringValue(value.source)?.split(",").map((item) => item.trim()).filter((item) => item.length) ?? [];
  const applied = value.applied === true;
  return {
    applied,
    previewOnly: value.previewOnly === true || !applied,
    sourceIds,
    selectedSourceCount: numberValue(value.selectedSourceCount) ?? sourceIds.length,
    eventsRead: numberValue(value.eventsRead) ?? 0,
    eventsAppended: numberValue(value.eventsAppended) ?? 0,
    signalsExtracted: numberValue(value.signalsExtracted) ?? 0,
    reviewRequired: value.reviewRequired !== false,
    nextCommand: stringValue(value.nextCommand)
  };
}

async function readReceiptSummaries(root: string): Promise<Array<NonNullable<OperationsStatusSummary["installs"]["latest"]>>> {
  const files = (await listFiles(root)).filter((file) => file.endsWith(".json"));
  const summaries = await Promise.all(files.map(async (file) => {
    const full = path.join(root, file);
    const json = await readJson(full).catch(() => undefined);
    const stat = await fs.stat(full).catch(() => undefined);
    const record = isRecord(json) ? json : {};
    return {
      path: normalizeRelative(path.dirname(path.dirname(root)), full),
      schemaVersion: stringValue(record.schemaVersion),
      kind: receiptKind(stringValue(record.schemaVersion), file),
      at: receiptTimestamp(record) ?? stat?.mtime.toISOString()
    };
  }));
  return summaries.sort((left, right) => String(right.at ?? "").localeCompare(String(left.at ?? "")));
}

async function readEvalReportSummaries(root: string): Promise<Array<NonNullable<OperationsStatusSummary["evals"]["latest"]>>> {
  const reports = await readJsonFiles(path.join(root, ".openskill-kit", "evals", "runs"), (file) => file.endsWith("behavior-eval.json") || file.endsWith("behavior-compare.json"));
  return reports
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((report) => ({
      path: normalizeRelative(root, stringValue(isRecord(report.artifacts) ? report.artifacts.json : undefined) ?? ""),
      status: stringValue(report.status),
      scenarioCount: numberValue(report.scenarioCount),
      passCount: numberValue(report.passCount)
    }))
    .sort((left, right) => right.path.localeCompare(left.path));
}

function receiptKind(schemaVersion: string | undefined, file: string): string {
  if (schemaVersion?.includes("agent-plugin-attach")) return "plugin-attach";
  if (schemaVersion?.includes("instruction-manifest-install")) return "instruction-manifest-install";
  if (schemaVersion?.includes("instruction-manifest-uninstall")) return "instruction-manifest-uninstall";
  if (schemaVersion?.includes("install-receipt")) return "skill-install";
  if (file.includes("plugin-attach-")) return "plugin-attach";
  if (file.includes("instruction-manifests-")) return "instruction-manifest";
  return "install";
}

function receiptTimestamp(record: Record<string, unknown>): string | undefined {
  return stringValue(record.attachedAt)
    ?? stringValue(record.installedAt)
    ?? stringValue(record.uninstalledAt)
    ?? stringValue(record.timestamp);
}

async function summarizeOpenWorldStatus(root: string): Promise<OpenWorldStatusSummary> {
  const openWorldRoot = path.join(root, ".openskill-kit", "openworld");
  const tasksDir = path.join(openWorldRoot, "tasks");
  const taskDirs = await fs.readdir(tasksDir, { withFileTypes: true }).catch(() => []);
  const taskIds = taskDirs.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const sourceIndex = await readJson(path.join(openWorldRoot, "source-index.json")).catch(() => undefined) as { entries?: unknown[] } | undefined;
  const reports = await readJsonFiles(path.join(tasksDir), (file) => file.endsWith(".json") && file.includes(`${path.sep}reports${path.sep}`));
  const evalReports = reports.filter((item): item is Record<string, unknown> => isRecord(item) && item.schemaVersion === "openskill-kit.openworld-eval-report.v1");
  const harnesses = reports.filter((item): item is Record<string, unknown> => isRecord(item) && item.schemaVersion === "openskill-kit.openworld-hidden-oracle-harness.v1");
  const runs = await readJsonFiles(path.join(root, ".openskill-kit", "evolution", "runs"), (file) => file.endsWith(`${path.sep}run.json`));
  const evolutionRuns = runs.filter((item): item is Record<string, unknown> => isRecord(item) && item.schemaVersion === "openskill-kit.evolution-run.v1");
  const latestEval = evalReports.sort((left, right) => String(right.generatedAt ?? "").localeCompare(String(left.generatedAt ?? "")))[0];
  const latestRun = evolutionRuns.sort((left, right) => String(right.completedAt ?? right.startedAt ?? "").localeCompare(String(left.completedAt ?? left.startedAt ?? "")))[0];
  return {
    taskCount: taskIds.length,
    sourceCount: Array.isArray(sourceIndex?.entries) ? sourceIndex.entries.length : 0,
    evolutionRunCount: evolutionRuns.length,
    evalReportCount: evalReports.length,
    hiddenOracleHarnessCount: harnesses.length,
    latest: latestEval ? {
      taskId: stringValue(latestEval.taskId),
      runId: stringValue(latestEval.runId),
      reportId: stringValue(latestEval.id),
      status: stringValue(latestEval.status),
      proofLevel: stringValue(latestEval.proofLevel) ?? "not-proof",
      hiddenOracleProof: latestEval.hiddenOracleProof === true,
      generatedAt: stringValue(latestEval.generatedAt)
    } : latestRun ? {
      taskId: stringValue(latestRun.taskId),
      runId: stringValue(latestRun.id),
      status: stringValue(latestRun.status),
      proofLevel: "not-proof",
      hiddenOracleProof: false,
      generatedAt: stringValue(latestRun.completedAt) ?? stringValue(latestRun.startedAt)
    } : undefined,
    proofBoundary: {
      hiddenOracleProof: false,
      message: "OpenWorld status reports artifact evidence only; hidden-oracle benchmark proof remains false unless an external isolated benchmark result is imported."
    }
  };
}

async function readJsonFiles(root: string, include: (file: string) => boolean): Promise<unknown[]> {
  const files = await listFiles(root);
  const selected = files.filter(include);
  return Promise.all(selected.map((file) => readJson(file).catch(() => undefined))).then((items) => items.filter((item) => item !== undefined));
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(file);
    return [file];
  }));
  return nested.flat();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeRelative(root: string, file: string): string {
  if (!file) return "";
  return path.relative(root, file).replace(/\\/g, "/");
}
