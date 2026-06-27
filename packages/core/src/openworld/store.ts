import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeFileAtomic, withFileLock } from "../storage/atomic.js";
import { assertOpenWorldArtifactPath } from "./leakage.js";
import {
  AnchorCardSchema,
  OpenWorldEvolutionRunSchema,
  OpenWorldLeakageAuditSchema,
  OpenWorldResearchPlanSchema,
  OpenWorldSourceSchema,
  OpenWorldSourceIndexSchema,
  OpenWorldTrustCacheSchema,
  OpenWorldTaskSchema,
  SkillPlanSchema,
  VirtualTestSuiteExecutionSchema,
  VirtualTestSuiteSchema,
  type AnchorCard,
  type OpenWorldEvolutionRun,
  type OpenWorldLeakageAudit,
  type OpenWorldResearchPlan,
  type OpenWorldSource,
  type OpenWorldSourceIndex,
  type OpenWorldTrustCache,
  type OpenWorldTask,
  type SkillPlan,
  type VirtualTestSuiteExecution,
  type VirtualTestSuite
} from "./schema.js";

export interface InitOpenWorldTaskInput {
  title: string;
  prompt: string;
  taskType?: string;
  languages?: string[];
  paths?: string[];
  forbiddenIdentifiers?: string[];
  forbiddenPaths?: string[];
  allowWeb?: boolean;
  now?: Date;
}

export interface OpenWorldTaskRecord {
  task: OpenWorldTask;
  taskDir: string;
  taskPath: string;
}

export async function initOpenWorldTask(projectRoot: string, input: InitOpenWorldTaskInput): Promise<OpenWorldTaskRecord> {
  const root = path.resolve(projectRoot);
  const now = input.now ?? new Date();
  const task = OpenWorldTaskSchema.parse({
    schemaVersion: "openskill-kit.openworld-task.v1",
    id: `owtask_${shortHash(`${input.title}:${input.prompt}:${now.toISOString()}`)}`,
    title: input.title,
    prompt: input.prompt,
    createdAt: now.toISOString(),
    status: "draft",
    taskType: input.taskType ?? "general",
    languages: input.languages ?? [],
    paths: input.paths ?? [],
    forbiddenIdentifiers: input.forbiddenIdentifiers ?? [],
    forbiddenPaths: input.forbiddenPaths ?? [],
    allowWeb: input.allowWeb ?? false
  });
  const taskPath = taskArtifactPath(root, task.id, "task.json");
  await writeOpenWorldJson(root, taskPath, task);
  return { task, taskDir: path.dirname(taskPath), taskPath };
}

export async function writeOpenWorldSource(projectRoot: string, source: OpenWorldSource): Promise<string> {
  const parsed = OpenWorldSourceSchema.parse(source);
  const sourcePath = await writeTaskArtifact(projectRoot, parsed.taskId, "sources", `${parsed.id}.json`, parsed);
  await updateOpenWorldSourceIndex(projectRoot, parsed);
  await updateOpenWorldTrustCache(projectRoot, parsed);
  return sourcePath;
}

export async function writeOpenWorldSourceContent(projectRoot: string, taskId: string, sourceId: string, content: string): Promise<string> {
  const root = path.resolve(projectRoot);
  const file = taskArtifactPath(root, taskId, "sources", "cache", `${sourceId}.txt`);
  await writeOpenWorldFile(root, file, content);
  return file;
}

export async function readOpenWorldSourceContent(projectRoot: string, taskId: string, sourceId: string): Promise<string> {
  const source = await readOpenWorldSource(projectRoot, taskId, sourceId).catch(() => undefined);
  const root = path.resolve(projectRoot);
  const sourcePath = source?.cachePath ?? source?.contentPath;
  if (sourcePath) return fs.readFile(path.isAbsolute(sourcePath) ? sourcePath : path.join(root, sourcePath), "utf8");
  return fs.readFile(taskArtifactPath(projectRoot, taskId, "sources", "cache", `${sourceId}.txt`), "utf8");
}

export async function readOpenWorldSource(projectRoot: string, taskId: string, sourceId: string): Promise<OpenWorldSource> {
  return OpenWorldSourceSchema.parse(JSON.parse(await fs.readFile(taskArtifactPath(projectRoot, taskId, "sources", `${sourceId}.json`), "utf8")));
}

export async function writeAnchorCard(projectRoot: string, anchor: AnchorCard): Promise<string> {
  const parsed = AnchorCardSchema.parse(anchor);
  return writeTaskArtifact(projectRoot, parsed.taskId, "anchors", `${parsed.id}.json`, parsed);
}

export async function writeVirtualTestSuite(projectRoot: string, suite: VirtualTestSuite): Promise<string> {
  const parsed = VirtualTestSuiteSchema.parse(suite);
  return writeTaskArtifact(projectRoot, parsed.taskId, "verifiers", `${parsed.id}.json`, parsed);
}

export async function readVirtualTestSuite(projectRoot: string, taskId: string, suiteId: string): Promise<VirtualTestSuite> {
  return VirtualTestSuiteSchema.parse(JSON.parse(await fs.readFile(taskArtifactPath(projectRoot, taskId, "verifiers", `${suiteId}.json`), "utf8")));
}

export async function writeVirtualTestSuiteExecution(projectRoot: string, execution: VirtualTestSuiteExecution): Promise<string> {
  const parsed = VirtualTestSuiteExecutionSchema.parse(execution);
  const filename = `${parsed.id}.json`;
  const file = taskArtifactPath(projectRoot, parsed.taskId, "verifiers", parsed.suiteId, "results", filename);
  await writeOpenWorldJson(projectRoot, file, parsed);
  return file;
}

export async function writeOpenWorldTaskTextArtifact(projectRoot: string, taskId: string, parts: string[], content: string): Promise<string> {
  const root = path.resolve(projectRoot);
  const file = taskArtifactPath(root, taskId, ...parts);
  await writeOpenWorldFile(root, file, content);
  return file;
}

export async function writeSkillPlan(projectRoot: string, plan: SkillPlan): Promise<string> {
  const parsed = SkillPlanSchema.parse(plan);
  return writeTaskArtifact(projectRoot, parsed.taskId, "plans", `${parsed.id}.json`, parsed);
}

export async function writeOpenWorldLeakageAudit(projectRoot: string, audit: OpenWorldLeakageAudit): Promise<string> {
  const parsed = OpenWorldLeakageAuditSchema.parse(audit);
  const taskId = parsed.taskId ?? "global";
  return writeTaskArtifact(projectRoot, taskId, "audits", `${parsed.id}.json`, parsed);
}

export async function writeOpenWorldResearchPlan(projectRoot: string, plan: OpenWorldResearchPlan): Promise<string> {
  const root = path.resolve(projectRoot);
  const parsed = OpenWorldResearchPlanSchema.parse(plan);
  const file = taskArtifactPath(root, parsed.taskId, "research", "plans", `${parsed.id}.json`);
  await writeOpenWorldJson(root, file, parsed);
  return file;
}

export async function writeOpenWorldEvolutionRun(projectRoot: string, run: OpenWorldEvolutionRun): Promise<string> {
  const root = path.resolve(projectRoot);
  const parsed = OpenWorldEvolutionRunSchema.parse(run);
  const file = path.join(root, ".openskill-kit", "evolution", "runs", parsed.id, "run.json");
  await writeOpenWorldJson(root, file, parsed);
  return file;
}

export async function readOpenWorldEvolutionRun(projectRoot: string, runId: string): Promise<OpenWorldEvolutionRun> {
  const root = path.resolve(projectRoot);
  const file = path.join(root, ".openskill-kit", "evolution", "runs", runId, "run.json");
  return OpenWorldEvolutionRunSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
}

export async function readOpenWorldTask(projectRoot: string, taskId: string): Promise<OpenWorldTask> {
  return OpenWorldTaskSchema.parse(JSON.parse(await fs.readFile(taskArtifactPath(projectRoot, taskId, "task.json"), "utf8")));
}

export async function readOpenWorldSourceIndex(projectRoot: string): Promise<OpenWorldSourceIndex> {
  const file = path.join(path.resolve(projectRoot), ".openskill-kit", "openworld", "source-index.json");
  return fs.readFile(file, "utf8")
    .then((text) => OpenWorldSourceIndexSchema.parse(JSON.parse(text)))
    .catch(() => OpenWorldSourceIndexSchema.parse({ schemaVersion: "openskill-kit.openworld-source-index.v1", updatedAt: new Date(0).toISOString(), entries: [] }));
}

export async function readOpenWorldTrustCache(projectRoot: string): Promise<OpenWorldTrustCache> {
  const file = path.join(path.resolve(projectRoot), ".openskill-kit", "openworld", "trust-cache.json");
  return fs.readFile(file, "utf8")
    .then((text) => OpenWorldTrustCacheSchema.parse(JSON.parse(text)))
    .catch(() => OpenWorldTrustCacheSchema.parse({ schemaVersion: "openskill-kit.openworld-trust-cache.v1", updatedAt: new Date(0).toISOString(), entries: {} }));
}

export function makeOpenWorldSource(input: Omit<OpenWorldSource, "schemaVersion" | "contentHash" | "retrievedAt"> & { content: string; retrievedAt?: Date }): OpenWorldSource {
  const kind = input.kind;
  const trust = scoreTrust(input.trust ?? { authority: 0.5, freshness: 0.5, independence: 0.5 });
  return OpenWorldSourceSchema.parse({
    ...input,
    schemaVersion: "openskill-kit.openworld-source.v2",
    sourceType: input.sourceType ?? kind,
    locator: input.locator ?? inferLocator(kind, input.uri),
    retrievedAt: (input.retrievedAt ?? new Date()).toISOString(),
    contentHash: sha256(input.content),
    cachePath: input.cachePath ?? input.contentPath,
    trust
  });
}

async function updateOpenWorldSourceIndex(projectRoot: string, source: OpenWorldSource): Promise<void> {
  const root = path.resolve(projectRoot);
  const file = path.join(root, ".openskill-kit", "openworld", "source-index.json");
  await withFileLock(path.join(root, ".openskill-kit", "openworld", ".source-index.lock"), async () => {
    const current = await readOpenWorldSourceIndex(root);
    const entries = current.entries.filter((entry) => entry.sourceId !== source.id);
    entries.push({
      sourceId: source.id,
      taskId: source.taskId,
      kind: source.kind,
      uri: source.uri,
      contentHash: source.contentHash,
      contentPath: source.contentPath,
      cachePath: source.cachePath,
      retrievedAt: source.retrievedAt,
      trustScore: source.trust.score ?? scoreTrust(source.trust).score ?? 0.5,
      privacyClass: source.privacyClass,
      leakageAuditId: source.leakageAuditId
    });
    await writeOpenWorldJson(root, file, OpenWorldSourceIndexSchema.parse({
      schemaVersion: "openskill-kit.openworld-source-index.v1",
      updatedAt: new Date().toISOString(),
      entries: entries.sort((a, b) => b.trustScore - a.trustScore || a.uri.localeCompare(b.uri))
    }));
  });
}

async function updateOpenWorldTrustCache(projectRoot: string, source: OpenWorldSource): Promise<void> {
  const root = path.resolve(projectRoot);
  const file = path.join(root, ".openskill-kit", "openworld", "trust-cache.json");
  await withFileLock(path.join(root, ".openskill-kit", "openworld", ".trust-cache.lock"), async () => {
    const current = await readOpenWorldTrustCache(root);
    const key = trustCacheKey(source);
    current.entries[key] = {
      key,
      sourceType: source.kind,
      locator: source.locator,
      trust: source.trust,
      assessedAt: new Date().toISOString()
    };
    await writeOpenWorldJson(root, file, OpenWorldTrustCacheSchema.parse({
      schemaVersion: "openskill-kit.openworld-trust-cache.v1",
      updatedAt: new Date().toISOString(),
      entries: current.entries
    }));
  });
}

function scoreTrust(trust: OpenWorldSource["trust"]): OpenWorldSource["trust"] {
  const score = Math.round((trust.authority * 0.45 + trust.freshness * 0.25 + trust.independence * 0.3) * 100) / 100;
  return { ...trust, score };
}

function inferLocator(kind: OpenWorldSource["kind"], uri: string): OpenWorldSource["locator"] {
  if (/^https?:\/\//i.test(uri)) return { url: uri };
  if (kind === "project-file" || kind === "local-doc" || kind === "package-docs") return { path: uri };
  return {};
}

function trustCacheKey(source: OpenWorldSource): string {
  return sha256(`${source.kind}:${source.uri}:${JSON.stringify(source.locator)}`).slice(0, 24);
}

function writeTaskArtifact(projectRoot: string, taskId: string, subdir: string, filename: string, value: unknown): Promise<string> {
  const root = path.resolve(projectRoot);
  const file = taskArtifactPath(root, taskId, subdir, filename);
  return writeOpenWorldJson(root, file, value).then(() => file);
}

async function writeOpenWorldJson(projectRoot: string, file: string, value: unknown): Promise<void> {
  await writeOpenWorldFile(projectRoot, file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeOpenWorldFile(projectRoot: string, file: string, value: string): Promise<void> {
  const target = assertOpenWorldArtifactPath(projectRoot, file);
  await withFileLock(path.join(path.dirname(target), ".write.lock"), async () => {
    await writeFileAtomic(target, value);
  });
}

function taskArtifactPath(projectRoot: string, taskId: string, ...parts: string[]): string {
  return path.join(path.resolve(projectRoot), ".openskill-kit", "openworld", "tasks", taskId, ...parts);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
