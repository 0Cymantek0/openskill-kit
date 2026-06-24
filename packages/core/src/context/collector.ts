import { promises as fs } from "node:fs";
import path from "node:path";

export interface ContextLimits {
  maxFiles: number;
  maxCharsPerFile: number;
  maxTotalChars: number;
}

export interface CollectedFile {
  path: string;
  chars: number;
  snippet: string;
}

export interface RepoContext {
  root: string;
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  frameworks: string[];
  scripts: Record<string, string>;
  configFiles: string[];
  existingSkillDirs: string[];
  files: CollectedFile[];
  warnings: string[];
}

const defaultLimits: ContextLimits = {
  maxFiles: 30,
  maxCharsPerFile: 2000,
  maxTotalChars: 25000
};

const excludedDirs = new Set(["node_modules", "dist", "build", ".git", ".next", "coverage", ".openskill-kit", "tmp"]);
const excludedFiles = [/^\.env(\.|$)/, /package-lock\.json$/, /pnpm-lock\.yaml$/, /yarn\.lock$/, /bun\.lockb?$/];

export async function collectRepoContext(rootInput: string, limits: ContextLimits = defaultLimits): Promise<RepoContext> {
  const root = path.resolve(rootInput);
  const warnings: string[] = [];
  const packageJson = await readJsonIfExists(path.join(root, "package.json"));
  const packageData = objectOrEmpty(packageJson);
  const scriptsValue = packageData.scripts;
  const scripts = typeof scriptsValue === "object" && scriptsValue ? scriptsValue as Record<string, string> : {};
  const dependencies = {
    ...objectOrEmpty(packageData.dependencies),
    ...objectOrEmpty(packageData.devDependencies)
  };
  const files = await collectTextFiles(root, limits, warnings);
  return {
    root: ".",
    packageManager: await detectPackageManager(root),
    frameworks: detectFrameworks(dependencies),
    scripts,
    configFiles: await findConfigFiles(root),
    existingSkillDirs: await findSkillDirs(root),
    files,
    warnings
  };
}

async function detectPackageManager(root: string): Promise<RepoContext["packageManager"]> {
  if (await exists(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(root, "yarn.lock"))) return "yarn";
  if (await exists(path.join(root, "bun.lock")) || await exists(path.join(root, "bun.lockb"))) return "bun";
  if (await exists(path.join(root, "package-lock.json"))) return "npm";
  if (await exists(path.join(root, "package.json"))) return "npm";
  return "unknown";
}

function detectFrameworks(dependencies: Record<string, unknown>): string[] {
  const names = Object.keys(dependencies);
  const matches = [
    "next",
    "react",
    "vue",
    "svelte",
    "vitest",
    "jest",
    "typescript",
    "express",
    "fastify",
    "payload"
  ].filter((name) => names.includes(name));
  return matches.sort();
}

async function findConfigFiles(root: string): Promise<string[]> {
  const names = [
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "vitest.config.ts",
    "next.config.js",
    "next.config.ts",
    "README.md",
    "CONTRIBUTING.md"
  ];
  const found: string[] = [];
  for (const name of names) {
    if (await exists(path.join(root, name))) found.push(name);
  }
  return found;
}

async function findSkillDirs(root: string): Promise<string[]> {
  const legacyLocalSkillsDir = [".open", "code", "/skills"].join("");
  const dirs = [".local-agent/skills", ".agents/skills", legacyLocalSkillsDir];
  const found: string[] = [];
  for (const dir of dirs) {
    if (await exists(path.join(root, dir))) found.push(dir);
  }
  return found;
}

async function collectTextFiles(root: string, limits: ContextLimits, warnings: string[]): Promise<CollectedFile[]> {
  const candidates: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (candidates.length >= limits.maxFiles) return;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (candidates.length >= limits.maxFiles) return;
      if (entry.name.startsWith(".") && entry.name !== ".agents" && entry.name !== ".local-agent" && entry.name !== [".open", "code"].join("")) {
        continue;
      }
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) await walk(full);
      } else if (isContextFile(entry.name) && !excludedFiles.some((pattern) => pattern.test(entry.name))) {
        candidates.push(rel);
      }
    }
  }
  await walk(root);
  let total = 0;
  const result: CollectedFile[] = [];
  for (const rel of candidates.sort()) {
    if (total >= limits.maxTotalChars) break;
    const full = path.join(root, rel);
    const text = await fs.readFile(full, "utf8").catch(() => "");
    const remaining = limits.maxTotalChars - total;
    const snippet = text.slice(0, Math.min(limits.maxCharsPerFile, remaining));
    total += snippet.length;
    if (text.length > snippet.length) warnings.push(`Truncated ${rel} to ${snippet.length} chars`);
    result.push({ path: rel, chars: text.length, snippet });
  }
  return result;
}

function isContextFile(name: string): boolean {
  return /(\.md|\.json|\.ts|\.tsx|\.js|\.jsx|\.mjs|\.cjs|\.yaml|\.yml)$/.test(name);
}

async function readJsonIfExists(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
