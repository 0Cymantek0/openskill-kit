import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { SkillManifestSchema, type SkillPackage, type ValidationIssue } from "./schema.js";

export interface ParsedSkillMarkdown {
  manifest: unknown;
  body: string;
}

export function parseSkillMarkdown(markdown: string): ParsedSkillMarkdown {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
    throw new Error("SKILL.md must start with YAML frontmatter");
  }
  const normalized = markdown.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new Error("SKILL.md frontmatter is not closed");
  }
  const rawFrontmatter = normalized.slice(4, end);
  const body = normalized.slice(end + 5).trimStart();
  return {
    manifest: YAML.parse(rawFrontmatter),
    body
  };
}

export async function loadSkillPackage(skillPath: string): Promise<SkillPackage> {
  const root = await resolveSkillRoot(skillPath);
  const skillFile = path.join(root, "SKILL.md");
  const markdown = await fs.readFile(skillFile, "utf8");
  const parsed = parseSkillMarkdown(markdown);
  const manifest = SkillManifestSchema.parse(parsed.manifest);
  const files = await listPackageFiles(root);
  return {
    root,
    manifest,
    body: parsed.body,
    files
  };
}

export async function validateSkillPackage(skillPath: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  try {
    const pkg = await loadSkillPackage(skillPath);
    const folderName = path.basename(pkg.root);
    if (pkg.manifest.name !== folderName) {
      issues.push({
        code: "name-folder-mismatch",
        message: `Skill name '${pkg.manifest.name}' must match folder '${folderName}'`,
        severity: "error",
        path: pkg.root
      });
    }
    if (!pkg.body.includes("When to use")) {
      issues.push({
        code: "missing-when-to-use",
        message: "SKILL.md should include a 'When to use' section",
        severity: "warning",
        path: path.join(pkg.root, "SKILL.md")
      });
    }
    if (!pkg.body.includes("When not to use")) {
      issues.push({
        code: "missing-when-not-to-use",
        message: "SKILL.md should include a 'When not to use' section",
        severity: "warning",
        path: path.join(pkg.root, "SKILL.md")
      });
    }
    issues.push(...await findBrokenLocalLinks(pkg));
  } catch (error) {
    issues.push({
      code: "invalid-skill",
      message: error instanceof Error ? error.message : String(error),
      severity: "error",
      path: skillPath
    });
  }
  return issues;
}

async function resolveSkillRoot(skillPath: string): Promise<string> {
  const stat = await fs.stat(skillPath);
  if (stat.isDirectory()) return path.resolve(skillPath);
  if (path.basename(skillPath) === "SKILL.md") return path.dirname(path.resolve(skillPath));
  throw new Error("Skill path must be a skill directory or SKILL.md file");
}

async function listPackageFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(path.relative(root, full));
    }
  }
  await walk(root);
  return files.sort();
}

async function findBrokenLocalLinks(pkg: SkillPackage): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const linkPattern = /\[[^\]]+\]\((?!https?:|mailto:|#)([^)]+)\)/g;
  const skillFile = path.join(pkg.root, "SKILL.md");
  const markdown = await fs.readFile(skillFile, "utf8");
  for (const match of markdown.matchAll(linkPattern)) {
    const target = match[1]?.split("#")[0];
    if (!target) continue;
    const resolved = path.resolve(pkg.root, target);
    if (!resolved.startsWith(pkg.root)) {
      issues.push({
        code: "link-outside-skill",
        message: `Local link points outside skill package: ${target}`,
        severity: "error",
        path: skillFile
      });
      continue;
    }
    try {
      await fs.stat(resolved);
    } catch {
      issues.push({
        code: "broken-local-link",
        message: `Local link target does not exist: ${target}`,
        severity: "error",
        path: skillFile
      });
    }
  }
  return issues;
}
