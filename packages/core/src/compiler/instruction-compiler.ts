import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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
  status: "planned" | "installed" | "uninstalled" | "blocked";
  target: "project";
  dryRun: boolean;
  files: Array<{
    source: string;
    destination: string;
    action: "create" | "update" | "delete" | "unchanged" | "blocked";
    preview?: string;
    diff?: string;
    issue?: string;
  }>;
  receiptPath?: string;
  messages: string[];
}

type ManifestPlanFile = InstallInstructionManifestsResult["files"][number];
interface InstructionManifestReceipt {
  schemaVersion: string;
  files?: Array<{ destination?: string; action?: string }>;
}

export async function compileInstructionManifests(projectRoot: string): Promise<CompileInstructionManifestsResult> {
  const root = path.resolve(projectRoot);
  const graph = await readPreferenceGraph(root);
  const active = graph.nodes.filter((node) => node.status === "active" || node.status === "locked");
  const sourceGraphHash = sha256(JSON.stringify(active.map((node) => ({ id: node.id, statement: node.statement, status: node.status, confidence: node.confidence, scope: node.scope }))));
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
    sourceGraphHash,
    files: [
      path.relative(root, agentsPath).replace(/\\/g, "/"),
      path.relative(root, claudePath).replace(/\\/g, "/"),
      ...rulePaths.map((file) => path.relative(root, file).replace(/\\/g, "/"))
    ],
    managedBlock: { start: MANAGED_BLOCK_START, end: MANAGED_BLOCK_END, hashAlgorithm: "sha256" }
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
  const blocked = planned.filter((file) => file.action === "blocked");
  if (blocked.length) {
    return {
      schemaVersion: "openskill-kit.instruction-manifest-install.v1",
      status: "blocked",
      target,
      dryRun: true,
      files: planned,
      messages: blocked.map((file) => `blocked ${path.relative(root, file.destination).replace(/\\/g, "/")}: ${file.issue ?? "managed block integrity check failed"}`)
    };
  }
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
    sourceGraphHash: await readCompiledManifestGraphHash(root),
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

export async function uninstallInstructionManifests(
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
  const planned = await planManifestUninstall(root);
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
    assertInsideRoot(root, file.destination);
    if (file.action === "delete") await fs.rm(file.destination, { force: true });
    else if (file.preview !== undefined) await writeFileAtomic(file.destination, file.preview);
  }
  await removeEmptyRuleDir(path.join(root, ".claude", "rules"));
  const receiptPath = path.join(root, ".openskill-kit", "installs", `instruction-manifests-uninstall-${Date.now()}.json`);
  await writeJsonAtomic(receiptPath, {
    schemaVersion: "openskill-kit.instruction-manifest-uninstall-receipt.v1",
    uninstalledAt: new Date().toISOString(),
    target,
    rollbackOf: await latestManifestReceipt(root),
    files: planned.map((file) => ({
      destination: path.relative(root, file.destination).replace(/\\/g, "/"),
      action: file.action
    }))
  });
  return {
    schemaVersion: "openskill-kit.instruction-manifest-install.v1",
    status: "uninstalled",
    target,
    dryRun: false,
    files: planned,
    receiptPath,
    messages: planned.map((file) => `${file.action} ${path.relative(root, file.destination).replace(/\\/g, "/")}`)
  };
}

async function planManagedBlockInstall(source: string, destination: string): Promise<ManifestPlanFile> {
  const block = (await fs.readFile(source, "utf8")).trimEnd();
  const existing = await fs.readFile(destination, "utf8").catch(() => undefined);
  const integrity = validateManagedBlock(existing);
  if (integrity.status === "fail") {
    return {
      source,
      destination,
      action: "blocked",
      issue: integrity.message,
      diff: unifiedDiff(destination, existing ?? "", existing ?? "")
    };
  }
  const next = mergeManagedBlock(existing, block);
  return {
    source,
    destination,
    action: existing === undefined ? "create" : existing === next ? "unchanged" : "update",
    preview: next,
    diff: unifiedDiff(destination, existing ?? "", next)
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
      action: existing === undefined ? "create" as const : existing === sourceText ? "unchanged" as const : "update" as const,
      diff: unifiedDiff(destination, existing ?? "", sourceText)
    };
  }));
}

async function planManifestUninstall(root: string): Promise<ManifestPlanFile[]> {
  const ruleFiles = await installedRuleDestinations(root);
  const plans: ManifestPlanFile[] = [
    await planManagedBlockRemoval(path.join(root, "AGENTS.md")),
    await planManagedBlockRemoval(path.join(root, "CLAUDE.md")),
    ...await Promise.all(ruleFiles.map(async (destination) => {
      assertInsideRoot(root, destination);
      const existing = await fs.readFile(destination, "utf8").catch(() => undefined);
      return {
        source: destination,
        destination,
        action: existing === undefined ? "unchanged" as const : "delete" as const,
        preview: undefined,
        diff: unifiedDiff(destination, existing ?? "", "")
      };
    }))
  ];
  return plans.filter((file) => file.action !== "unchanged" || file.diff);
}

async function planManagedBlockRemoval(destination: string): Promise<ManifestPlanFile> {
  const existing = await fs.readFile(destination, "utf8").catch(() => undefined);
  const next = removeManagedBlock(existing);
  return {
    source: destination,
    destination,
    action: existing === undefined || existing === next ? "unchanged" : "update",
    preview: next,
    diff: unifiedDiff(destination, existing ?? "", next ?? "")
  };
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

function validateManagedBlock(existing: string | undefined): { status: "pass" | "fail"; message?: string } {
  if (!existing) return { status: "pass" };
  const starts = indexesOf(existing, MANAGED_BLOCK_START);
  const ends = indexesOf(existing, MANAGED_BLOCK_END);
  if (starts.length === 0 && ends.length === 0) return { status: "pass" };
  if (starts.length !== 1 || ends.length !== 1 || ends[0]! <= starts[0]!) return { status: "fail", message: "Corrupt OpenSkillKit managed block markers" };
  const block = existing.slice(starts[0]!, ends[0]! + MANAGED_BLOCK_END.length);
  const parsed = parseManagedBlockHash(block);
  if (!parsed) return { status: "pass" };
  const actual = sha256(parsed.body);
  return actual === parsed.expected
    ? { status: "pass" }
    : { status: "fail", message: `OpenSkillKit managed block hash mismatch: expected ${parsed.expected}, got ${actual}` };
}

function parseManagedBlockHash(block: string): { expected: string; body: string } | undefined {
  const lines = block.split(/\r?\n/);
  const meta = lines.find((line) => line.startsWith("<!-- openskill-kit:meta "));
  const match = /body-sha256=([a-f0-9]{64})/.exec(meta ?? "");
  if (!match) return undefined;
  const metaIndex = lines.findIndex((line) => line === meta);
  const endIndex = lines.findIndex((line) => line === MANAGED_BLOCK_END);
  if (metaIndex < 0 || endIndex < 0 || endIndex <= metaIndex) return undefined;
  return { expected: match[1]!, body: `${lines.slice(metaIndex + 1, endIndex).join("\n")}\n` };
}

function removeManagedBlock(existing: string | undefined): string | undefined {
  if (existing === undefined) return undefined;
  const start = existing.indexOf(MANAGED_BLOCK_START);
  const end = existing.indexOf(MANAGED_BLOCK_END);
  if (start < 0 || end <= start) return existing;
  const afterEnd = end + MANAGED_BLOCK_END.length;
  const before = existing.slice(0, start).replace(/\s+$/, "\n");
  const after = existing.slice(afterEnd).replace(/^\s+/, "");
  const next = `${before}${after}`;
  return next.trim().length ? (next.endsWith("\n") ? next : `${next}\n`) : "";
}

async function installedRuleDestinations(root: string): Promise<string[]> {
  const fromReceipt: Array<{ destination?: string; action?: string }> = await latestManifestReceipt(root).then((receipt) => receipt?.files ?? []).catch(() => []);
  const receiptRules = fromReceipt
    .map((file: { destination?: string }) => file.destination)
    .filter((value: unknown): value is string => typeof value === "string" && value.startsWith(".claude/rules/"))
    .map((rel) => path.join(root, rel));
  if (receiptRules.length) return [...new Set(receiptRules)].sort();
  const compiledRules = await listFiles(path.join(root, ".openskill-kit", "compiled", "manifests", "claude-rules"));
  return compiledRules.map((file) => path.join(root, ".claude", "rules", path.basename(file))).sort();
}

async function latestManifestReceipt(root: string): Promise<InstructionManifestReceipt | undefined> {
  const dir = path.join(root, ".openskill-kit", "installs");
  const files = await fs.readdir(dir).catch(() => []);
  const receipts = files
    .filter((file) => /^instruction-manifests-\d+\.json$/.test(file))
    .sort()
    .reverse();
  const latest = receipts[0];
  if (!latest) return undefined;
  return JSON.parse(await fs.readFile(path.join(dir, latest), "utf8")) as InstructionManifestReceipt;
}

async function removeEmptyRuleDir(dir: string): Promise<void> {
  const entries = await fs.readdir(dir).catch(() => []);
  if (entries.length === 0) await fs.rmdir(dir).catch(() => undefined);
}

function unifiedDiff(file: string, before: string, after: string): string {
  if (before === after) return "";
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const out = [`--- ${file}`, `+++ ${file}`];
  for (const line of beforeLines) if (line.length) out.push(`-${line}`);
  for (const line of afterLines) if (line.length) out.push(`+${line}`);
  return out.join("\n");
}

function assertInsideRoot(root: string, target: string): void {
  const relative = path.relative(root, path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing to write outside project root: ${target}`);
}

function renderAgentsManifest(nodes: PreferenceNode[]): string {
  const body = [
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
  if (!nodes.length) body.push("No active OpenSkillKit preferences yet.");
  for (const node of nodes.sort(sortNodes).slice(0, 12)) {
    body.push(`- ${scopeLabel(node)}: ${node.statement} (confidence ${node.confidence})`);
  }
  body.push("");
  return ["# AGENTS.md instructions", "", wrapManagedBlock(body.join("\n"))].join("\n");
}

function renderClaudeManifest(rulePaths: string[]): string {
  const body = [
    "## OpenSkillKit Project Behavior",
    "",
    "Read `.openskill-kit/compiled/context-pack.md` and apply only behavior relevant to the current task and files.",
    "For path-specific conventions, use these generated rule files:",
    ""
  ];
  if (!rulePaths.length) body.push("- No path-scoped rules generated yet.");
  else for (const rulePath of rulePaths) body.push(`- @${rulePath}`);
  body.push("");
  return ["# CLAUDE.md", "", wrapManagedBlock(body.join("\n"))].join("\n");
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

function wrapManagedBlock(body: string): string {
  const normalized = body.endsWith("\n") ? body : `${body}\n`;
  return [
    MANAGED_BLOCK_START,
    `<!-- openskill-kit:meta generator=0.1.0 body-sha256=${sha256(normalized)} -->`,
    normalized.trimEnd(),
    MANAGED_BLOCK_END,
    ""
  ].join("\n");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function indexesOf(value: string, pattern: string): number[] {
  const out: number[] = [];
  let index = value.indexOf(pattern);
  while (index >= 0) {
    out.push(index);
    index = value.indexOf(pattern, index + pattern.length);
  }
  return out;
}

async function readCompiledManifestGraphHash(root: string): Promise<string | undefined> {
  const manifestPath = path.join(root, ".openskill-kit", "compiled", "manifests", "manifest.json");
  return fs.readFile(manifestPath, "utf8")
    .then((text) => JSON.parse(text).sourceGraphHash as string | undefined)
    .catch(() => undefined);
}
