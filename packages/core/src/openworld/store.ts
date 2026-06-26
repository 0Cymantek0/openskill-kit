import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeFileAtomic, withFileLock } from "../storage/atomic.js";
import { assertOpenWorldArtifactPath } from "./leakage.js";
import {
  AnchorCardSchema,
  OpenWorldEvolutionRunSchema,
  OpenWorldLeakageAuditSchema,
  OpenWorldSourceSchema,
  OpenWorldTaskSchema,
  SkillPlanSchema,
  VirtualTestSuiteSchema,
  type AnchorCard,
  type OpenWorldEvolutionRun,
  type OpenWorldLeakageAudit,
  type OpenWorldSource,
  type OpenWorldTask,
  type SkillPlan,
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
  return writeTaskArtifact(projectRoot, parsed.taskId, "sources", `${parsed.id}.json`, parsed);
}

export async function writeOpenWorldSourceContent(projectRoot: string, taskId: string, sourceId: string, content: string): Promise<string> {
  const root = path.resolve(projectRoot);
  const file = taskArtifactPath(root, taskId, "sources", `${sourceId}.content.txt`);
  await writeOpenWorldFile(root, file, content);
  return file;
}

export async function readOpenWorldSourceContent(projectRoot: string, taskId: string, sourceId: string): Promise<string> {
  return fs.readFile(taskArtifactPath(projectRoot, taskId, "sources", `${sourceId}.content.txt`), "utf8");
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

export async function writeSkillPlan(projectRoot: string, plan: SkillPlan): Promise<string> {
  const parsed = SkillPlanSchema.parse(plan);
  return writeTaskArtifact(projectRoot, parsed.taskId, "plans", `${parsed.id}.json`, parsed);
}

export async function writeOpenWorldLeakageAudit(projectRoot: string, audit: OpenWorldLeakageAudit): Promise<string> {
  const parsed = OpenWorldLeakageAuditSchema.parse(audit);
  const taskId = parsed.taskId ?? "global";
  return writeTaskArtifact(projectRoot, taskId, "audits", `${parsed.id}.json`, parsed);
}

export async function writeOpenWorldEvolutionRun(projectRoot: string, run: OpenWorldEvolutionRun): Promise<string> {
  const root = path.resolve(projectRoot);
  const parsed = OpenWorldEvolutionRunSchema.parse(run);
  const file = path.join(root, ".openskill-kit", "evolution", "runs", parsed.id, "run.json");
  await writeOpenWorldJson(root, file, parsed);
  return file;
}

export async function readOpenWorldTask(projectRoot: string, taskId: string): Promise<OpenWorldTask> {
  return OpenWorldTaskSchema.parse(JSON.parse(await fs.readFile(taskArtifactPath(projectRoot, taskId, "task.json"), "utf8")));
}

export function makeOpenWorldSource(input: Omit<OpenWorldSource, "schemaVersion" | "contentHash" | "retrievedAt"> & { content: string; retrievedAt?: Date }): OpenWorldSource {
  return OpenWorldSourceSchema.parse({
    ...input,
    schemaVersion: "openskill-kit.openworld-source.v1",
    retrievedAt: (input.retrievedAt ?? new Date()).toISOString(),
    contentHash: sha256(input.content)
  });
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
