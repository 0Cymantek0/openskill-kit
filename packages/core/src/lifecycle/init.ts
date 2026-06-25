import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createDefaultProjectConfig, ProjectConfigSchema, type ProjectConfig } from "../config/schema.js";

export interface InitProjectOptions {
  projectRoot: string;
  projectName?: string;
  force?: boolean;
  now?: Date;
}

export interface InitProjectResult {
  status: "created" | "exists" | "updated";
  root: string;
  configPath: string;
  projectPath: string;
  gitignorePath: string;
  config: ProjectConfig;
}

export async function initAdaptiveProject(options: InitProjectOptions): Promise<InitProjectResult> {
  const root = path.resolve(options.projectRoot);
  const oskRoot = path.join(root, ".openskill-kit");
  const configPath = path.join(oskRoot, "config.json");
  const projectPath = path.join(oskRoot, "project.json");
  const gitignorePath = path.join(oskRoot, ".gitignore");
  const existing = await readConfigIfExists(configPath);
  if (existing && !options.force) {
    await ensureAdaptiveDirectories(root);
    await ensureGitignore(gitignorePath);
    return { status: "exists", root, configPath, projectPath, gitignorePath, config: existing };
  }
  const createdAt = (options.now ?? new Date()).toISOString();
  const projectName = options.projectName ?? await inferProjectName(root);
  const config = createDefaultProjectConfig({
    projectId: existing?.projectId ?? createProjectId(root, projectName),
    projectName,
    createdAt: existing?.createdAt ?? createdAt
  });
  await ensureAdaptiveDirectories(root);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
  await fs.writeFile(projectPath, JSON.stringify({
    schemaVersion: "openskill-kit.project.v1",
    projectId: config.projectId,
    projectName: config.projectName,
    createdAt: config.createdAt
  }, null, 2), "utf8");
  await ensureGitignore(gitignorePath);
  return { status: existing ? "updated" : "created", root, configPath, projectPath, gitignorePath, config };
}

async function readConfigIfExists(configPath: string): Promise<ProjectConfig | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    if (parsed.schemaVersion === "openskill-kit.config.v1") return ProjectConfigSchema.parse(parsed);
    return undefined;
  } catch {
    return undefined;
  }
}

async function inferProjectName(root: string): Promise<string> {
  const packageJson = await fs.readFile(path.join(root, "package.json"), "utf8").then((text) => JSON.parse(text)).catch(() => undefined);
  return typeof packageJson?.name === "string" && packageJson.name.length > 0 ? packageJson.name : path.basename(root);
}

function createProjectId(root: string, projectName: string): string {
  return `osk_${createHash("sha256").update(`${root}:${projectName}`).digest("hex").slice(0, 16)}`;
}

async function ensureAdaptiveDirectories(root: string): Promise<void> {
  for (const dir of [
    "events",
    "signals",
    "evidence/cards",
    "evidence/blobs",
    "preferences/active",
    "preferences/candidates",
    "preferences/conflicts",
    "compiled/skills",
    "compiled/hooks/scripts",
    "compiled/mcp",
    "compiled/plugin",
    "compiled/manifests/claude-rules",
    "reviews/patches",
    "installs",
    "sessions/summaries",
    "runtime",
    "evals/scenarios",
    "evals/runs",
    "reports"
  ]) {
    await fs.mkdir(path.join(root, ".openskill-kit", dir), { recursive: true });
  }
}

async function ensureGitignore(gitignorePath: string): Promise<void> {
  const body = [
    "events/",
    "evidence/blobs/",
    "signals/",
    "preferences/candidates/",
    "reviews/",
    "evals/runs/",
    "reports/",
    "lock.json",
    "*.local.json",
    "**/*.local.json",
    ""
  ].join("\n");
  await fs.writeFile(gitignorePath, body, "utf8");
}
