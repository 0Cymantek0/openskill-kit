import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createDefaultProjectConfig, ProjectConfigSchema, type ProjectConfig } from "../config/schema.js";
import { ensureModelRouting } from "../config/model-routing.js";
import { getCleanedLearnV2Paths } from "../learn-v2/paths.js";


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
  modelRoutingPath: string;
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
    const modelRouting = await ensureModelRouting(root, options.now ?? new Date());
    return { status: "exists", root, configPath, projectPath, gitignorePath, modelRoutingPath: modelRouting.path, config: existing };
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
  const modelRouting = await ensureModelRouting(root, options.now ?? new Date());
  return { status: existing ? "updated" : "created", root, configPath, projectPath, gitignorePath, modelRoutingPath: modelRouting.path, config };
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
  const { dirs } = getCleanedLearnV2Paths();
  const additionalDirs = [
    ".openskill-kit/evidence/cards",
    ".openskill-kit/preferences/active",
    ".openskill-kit/preferences/candidates",
    ".openskill-kit/preferences/conflicts",
    ".openskill-kit/workflows/active",
    ".openskill-kit/workflows/candidates",
    ".openskill-kit/workflows/mining",
    ".openskill-kit/compiled/skills",
    ".openskill-kit/compiled/hooks/scripts",
    ".openskill-kit/compiled/mcp",
    ".openskill-kit/compiled/plugin",
    ".openskill-kit/compiled/manifests/claude-rules",
    ".openskill-kit/model-routing/opencode-agents",
    ".openskill-kit/learn-v2/raw-vault/records",
    ".openskill-kit/learn-v2/raw-vault/blobs",
    ".openskill-kit/raw-vault/records",
    ".openskill-kit/reviews/patches",
    ".openskill-kit/installs",
    ".openskill-kit/sessions/summaries",
    ".openskill-kit/runtime",
    ".openskill-kit/evals/scenarios"
  ];

  const allDirs = [...new Set([...dirs, ...additionalDirs])].map((d) => d.replace(/^\.openskill-kit\//, ""));

  for (const dir of allDirs.sort()) {
    await fs.mkdir(path.join(root, ".openskill-kit", dir), { recursive: true });
  }
}

async function ensureGitignore(gitignorePath: string): Promise<void> {
  const { dirs, files } = getCleanedLearnV2Paths();
  const cleanDirs = dirs.map((d) => {
    const relative = d.replace(/^\.openskill-kit\//, "");
    return relative.endsWith("/") ? relative : `${relative}/`;
  });
  const cleanFiles = files.map((f) => f.replace(/^\.openskill-kit\//, ""));

  const otherIgnores = [
    "preferences/candidates/",
    "lock.json",
    "*.local.json",
    "**/*.local.json",
    ".*.lock",
    "**/.lock",
    "**/*.lock"
  ];

  const allIgnores = [...new Set([...cleanDirs, ...cleanFiles, ...otherIgnores])].sort();
  await fs.writeFile(gitignorePath, allIgnores.join("\n") + "\n", "utf8");
}
