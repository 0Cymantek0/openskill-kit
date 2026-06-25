import { promises as fs } from "node:fs";
import path from "node:path";
import { readPreferenceGraph } from "../preferences/graph.js";
import type { PreferenceNode } from "../preferences/schema.js";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";

export const MANAGED_BLOCK_START = "<!-- BEGIN MANAGED BY OPENSKILL-KIT -->";
export const MANAGED_BLOCK_END = "<!-- END MANAGED BY OPENSKILL-KIT -->";

export interface CompileInstructionManifestsResult {
  schemaVersion: "openskill-kit.instruction-manifests.v1";
  manifestDir: string;
  agentsPath: string;
  claudePath: string;
  claudeRulesDir: string;
  rulePaths: string[];
}

export interface InstallInstructionManifestsResult {
  schemaVersion: "openskill-kit.instruction-manifest-install.v1";
  status: "planned" | "installed" | "blocked";
  target: "project";
  dryRun: boolean;
  files: Array<{
    source: string;
    destination: string;
    action: "create" | "update" | "unchanged";
    preview?: string;
  }>;
  receiptPath?: string;
  messages: string[];
}

export async function compileInstructionManifests(projectRoot: string): Promise<CompileInstructionManifestsResult> {
  const root = path.resolve(projectRoot);
  const graph = await readPreferenceGraph(root);
  const active = graph.nodes.filter((node) => node.status === "active" || node.status === "locked");
  const manifestDir = path.join(root, ".openskill-kit", "compiled", "manifests");
  const claudeRulesDir = path.join(manifestDir, "claude-rules");
  await fs.rm(claudeRulesDir, { recursive: true, force: true });
  const agentsPath = path.join(manifestDir, "AGENTS.md");
  const claudePath = path.join(manifestDir, "CLAUDE.md");
  await writeFileAtomic(agentsPath, renderAgentsManifest(active));
  const rulePaths = await writeClaudeRules(claudeRulesDir, active);
  await writeFileAtomic(claudePath, renderClaudeManifest(rulePaths.map((file) => path.relative(manifestDir, file).replace(/\\/g, "/"))));
  await writeJsonAtomic(path.join(manifestDir, "manifest.json"), {
    schemaVersion: "openskill-kit.instruction-manifests.v1",
    generatedAt: new Date().toISOString(),
    files: [
      path.relative(root, agentsPath).replace(/\\/g, "/"),
      path.relative(root, claudePath).replace(/\\/g, "/"),
      ...rulePaths.map((file) => path.relative(root, file).replace(/\\/g, "/"))
    ],
    managedBlock: { start: MANAGED_BLOCK_START, end: MANAGED_BLOCK_END }
  });
  return { schemaVersion: "openskill-kit.instruction-manifests.v1", manifestDir, agentsPath, claudePath, claudeRulesDir, rulePaths };
}

export async function installInstructionManifests(
  projectRoot: string,
  options: { target?: "project"; dryRun?: boolean; yes?: boolean } = {}
): Promise<InstallInstructionManifestsResult> {
  const root = path.resolve(projectRoot);
  const target = options.target ?? "project";
  if (target !== "project") {
    return {
      schemaVersion: "openskill-kit.instruction-manifest-install.v1",
      status: "blocked",
      target,
      dryRun: options.dryRun !== false,
      files: [],
      messages: [`Unsupported manifest target: ${target}`]
    };
  }
  const compiled = await compileInstructionManifests(root);
  const planned = [
    await planManagedBlockInstall(compiled.agentsPath, path.join(root, "AGENTS.md")),
    await planManagedBlockInstall(compiled.claudePath, path.join(root, "CLAUDE.md")),
    ...await planDirectoryInstall(compiled.claudeRulesDir, path.join(root, ".claude", "rules"))
  ];
  const dryRun = options.dryRun !== false || options.yes !== true;
  if (dryRun) {
    return {
      schemaVersion: "openskill-kit.instruction-manifest-install.v1",
      status: "planned",
      target,
      dryRun: true,
      files: planned,
      messages: planned.map((file) => `${file.action} ${path.relative(root, file.destination).replace(/\\/g, "/")}`)
    };
  }
  for (const file of planned) {
    await fs.mkdir(path.dirname(file.destination), { recursive: true });
    if (file.preview !== undefined) await writeFileAtomic(file.destination, file.preview);
    else await fs.copyFile(file.source, file.destination);
  }
  const receiptPath = path.join(root, ".openskill-kit", "installs", `instruction-manifests-${Date.now()}.json`);
  await writeJsonAtomic(receiptPath, {
    schemaVersion: "openskill-kit.instruction-manifest-install-receipt.v1",
    installedAt: new Date().toISOString(),
    target,
    files: planned.map((file) => ({
      destination: path.relative(root, file.destination).replace(/\\/g, "/"),
      action: file.action
    }))
  });
  return {
    schemaVersion: "openskill-kit.instruction-manifest-install.v1",
    status: "installed",
    target,
    dryRun: false,
    files: planned,
    receiptPath,
    messages: planned.map((file) => `${file.action} ${path.relative(root, file.destination).replace(/\\/g, "/")}`)
  };
}

async function planManagedBlockInstall(source: string, destination: string): Promise<InstallInstructionManifestsResult["files"][number]> {
  const block = (await fs.readFile(source, "utf8")).trimEnd();
  const existing = await fs.readFile(destination, "utf8").catch(() => undefined);
  const next = mergeManagedBlock(existing, block);
  return {
    source,
    destination,
    action: existing === undefined ? "create" : existing === next ? "unchanged" : "update",
    preview: next
  };
}

async function planDirectoryInstall(sourceDir: string, destinationDir: string): Promise<InstallInstructionManifestsResult["files"]> {
  const files = await listFiles(sourceDir);
  return Promise.all(files.map(async (source) => {
    const destination = path.join(destinationDir, path.relative(sourceDir, source));
    const sourceText = await fs.readFile(source, "utf8");
    const existing = await fs.readFile(destination, "utf8").catch(() => undefined);
    return {
      source,
      destination,
      action: existing === undefined ? "create" as const : existing === sourceText ? "unchanged" as const : "update" as const
    };
  }));
}

function mergeManagedBlock(existing: string | undefined, managedBlock: string): string {
  const block = `${managedBlock}\n`;
  if (!existing || existing.trim().length === 0) return block;
  const start = existing.indexOf(MANAGED_BLOCK_START);
  const end = existing.indexOf(MANAGED_BLOCK_END);
  if (start >= 0 && end > start) {
    const afterEnd = end + MANAGED_BLOCK_END.length;
    return `${existing.slice(0, start)}${block}${existing.slice(afterEnd).replace(/^\r?\n/, "")}`;
  }
  return existing.endsWith("\n") ? `${existing}\n${block}` : `${existing}\n\n${block}`;
}

function renderAgentsManifest(nodes: PreferenceNode[]): string {
  const lines = [
    "# AGENTS.md instructions",
    "",
    MANAGED_BLOCK_START,
    "## OpenSkillKit Project Behavior",
    "",
    "Load project behavior from `.openskill-kit/compiled/context-pack.md` before coding, review, docs, testing, or maintenance work in this repository.",
    "Use `.openskill-kit/compiled/skills/project-behavior/SKILL.md` when deeper procedure is needed.",
    "Retrieve task/path-specific preferences through the OpenSkillKit MCP tools when available.",
    "Do not expose raw events, raw prompts, raw diffs, private evidence blobs, or secrets in responses or generated artifacts.",
    "When direct user instruction conflicts with active behavior, follow the user and record safe evidence for later review.",
    "",
    "### Active Behavior Summary",
    ""
  ];
  if (!nodes.length) lines.push("No active OpenSkillKit preferences yet.");
  for (const node of nodes.sort(sortNodes).slice(0, 12)) {
    lines.push(`- ${scopeLabel(node)}: ${node.statement} (confidence ${node.confidence})`);
  }
  lines.push("", MANAGED_BLOCK_END, "");
  return lines.join("\n");
}

function renderClaudeManifest(rulePaths: string[]): string {
  const lines = [
    "# CLAUDE.md",
    "",
    MANAGED_BLOCK_START,
    "## OpenSkillKit Project Behavior",
    "",
    "Read `.openskill-kit/compiled/context-pack.md` and apply only behavior relevant to the current task and files.",
    "For path-specific conventions, use these generated rule files:",
    ""
  ];
  if (!rulePaths.length) lines.push("- No path-scoped rules generated yet.");
  else for (const rulePath of rulePaths) lines.push(`- @${rulePath}`);
  lines.push("", MANAGED_BLOCK_END, "");
  return lines.join("\n");
}

async function writeClaudeRules(dir: string, nodes: PreferenceNode[]): Promise<string[]> {
  const scoped = nodes.filter((node) => node.scope.paths.length > 0);
  const groups = new Map<string, PreferenceNode[]>();
  for (const node of scoped) {
    for (const scopePath of node.scope.paths) {
      groups.set(scopePath, [...(groups.get(scopePath) ?? []), node]);
    }
  }
  const out: string[] = [];
  for (const [scopePath, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.join(dir, `${slug(scopePath)}.md`);
    const lines = [
      `# OpenSkillKit Rule: ${scopePath}`,
      "",
      `Applies to: \`${scopePath}\``,
      "",
      ...group.sort(sortNodes).map((node) => `- ${node.statement} (confidence ${node.confidence})`),
      ""
    ];
    await writeFileAtomic(file, lines.join("\n"));
    out.push(file);
  }
  return out;
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}

function scopeLabel(node: PreferenceNode): string {
  return node.scope.paths.length ? `${node.scope.level}:${node.scope.paths.join(",")}` : node.scope.level;
}

function sortNodes(a: PreferenceNode, b: PreferenceNode): number {
  return b.confidence - a.confidence || a.category.localeCompare(b.category) || a.title.localeCompare(b.title);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "project";
}
