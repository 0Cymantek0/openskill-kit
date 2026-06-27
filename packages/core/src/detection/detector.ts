import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { MANAGED_BLOCK_END, MANAGED_BLOCK_START } from "../compiler/instruction-compiler.js";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";
import { AgentEnvironmentDetectionReportSchema, AgentSurfaceSchema, type AgentDetectionIssue, type AgentEnvironmentDetectionReport, type AgentSurface } from "./schema.js";

export interface DetectAgentEnvironmentOptions {
  includeUserSurfaces?: boolean;
  includeSensitivePreview?: boolean;
  homeDir?: string;
  now?: Date;
}

interface SurfaceSpec {
  adapter: AgentSurface["adapter"];
  surfaceType: AgentSurface["surfaceType"];
  scope: AgentSurface["scope"];
  target: string;
  readPolicy: AgentSurface["readPolicy"];
  writePolicy: AgentSurface["writePolicy"];
  privacyRisk: AgentSurface["privacyRisk"];
  confidence?: number;
  notes?: string[];
}

const SKIP_DIRS = new Set([".git", ".openskill-kit", "node_modules", "dist", "coverage", "tmp"]);

export async function detectAgentEnvironment(projectRootInput: string, options: DetectAgentEnvironmentOptions = {}): Promise<AgentEnvironmentDetectionReport> {
  const projectRoot = path.resolve(projectRootInput);
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const detectedAt = (options.now ?? new Date()).toISOString();
  const surfaces: AgentSurface[] = [];

  for (const spec of await projectSurfaceSpecs(projectRoot)) {
    const surface = await surfaceFromSpec(projectRoot, spec, detectedAt, options);
    if (surface) surfaces.push(surface);
  }

  if (options.includeUserSurfaces === true) {
    for (const spec of userSurfaceSpecs(homeDir)) {
      const surface = await surfaceFromSpec(projectRoot, spec, detectedAt, options);
      if (surface) surfaces.push(surface);
    }
  }

  const issues = detectSurfaceIssues(surfaces);
  const report = AgentEnvironmentDetectionReportSchema.parse({
    schemaVersion: "openskill-kit.agent-environment-detection.v1",
    projectRoot,
    detectedAt,
    includeUserSurfaces: options.includeUserSurfaces === true,
    includeSensitivePreview: options.includeSensitivePreview === true,
    surfaces: surfaces.sort((a, b) => a.adapter.localeCompare(b.adapter) || a.path.localeCompare(b.path)),
    summary: summarize(surfaces, issues),
    issues,
    nextActions: nextActionsForDetection(surfaces, issues),
    artifacts: {}
  });

  return writeDetectionArtifacts(projectRoot, report);
}

async function projectSurfaceSpecs(projectRoot: string): Promise<SurfaceSpec[]> {
  const specs: SurfaceSpec[] = [
    instruction(projectRoot, "AGENTS.md", "agents-md", "managed-block", ["Common project instruction surface."]),
    instruction(projectRoot, "AGENTS.override.md", "agents-md", "never", ["Override file detected; OpenSkillKit will not write it by default."]),
    instruction(projectRoot, "CLAUDE.md", "claude-code", "managed-block", ["Claude project memory surface."]),
    instruction(projectRoot, ".claude/CLAUDE.md", "claude-code", "managed-block", ["Claude project memory surface."]),
    instruction(projectRoot, "CLAUDE.local.md", "claude-code", "never", ["Local Claude memory is personal; preview/import only."]),
    mcpConfig(projectRoot, ".claude/settings.json", "mcp", ["Claude Code project settings; review MCP servers before attaching OpenSkillKit."]),
    config(projectRoot, ".mcp.json", "mcp", ["Project MCP config."]),
    config(projectRoot, ".cursor/mcp.json", "mcp", ["Cursor MCP config."]),
    configFile(projectRoot, "opencode.json", "opencode", ["OpenCode project config; attachment remains project-local and preview-first."]),
    configFile(projectRoot, ".codex/config.toml", "codex", ["Project Codex config; detected for harness awareness, never parsed as JSON."]),
    config(projectRoot, "continue/config.json", "mcp", ["Continue project config; review MCP server entries before attaching OpenSkillKit."]),
    configFile(projectRoot, ".cursorrules", "cursor", ["Legacy Cursor rules; adapter write support remains preview-only."]),
    configFile(projectRoot, ".windsurfrules", "other", ["Detected editor-agent rules; write support remains preview-only."]),
    generated(projectRoot, ".openskill-kit/compiled/context-pack.md", "compiled-artifact"),
    generated(projectRoot, ".openskill-kit/compiled/mcp/server-config.json", "mcp-config"),
    generated(projectRoot, ".openskill-kit/compiled/plugin/plugin.json", "compiled-artifact"),
    generated(projectRoot, ".openskill-kit/compiled/plugin/.agent-plugin/plugin.json", "compiled-artifact"),
    generated(projectRoot, ".openskill-kit/compiled/plugin/.mcp.json", "mcp-config"),
    generated(projectRoot, ".openskill-kit/compiled/plugin/commands/commands.json", "compiled-artifact"),
    generated(projectRoot, ".openskill-kit/compiled/plugin/commands/osk.md", "compiled-artifact"),
    generated(projectRoot, ".openskill-kit/compiled/plugin/commands/families.json", "compiled-artifact"),
    generated(projectRoot, ".openskill-kit/compiled/plugin/opencode/model-routing.json", "compiled-artifact"),
    generated(projectRoot, ".openskill-kit/compiled/plugin/opencode/plugins/openskillkit.ts", "compiled-artifact"),
    hook(projectRoot, ".agents/hooks/openskill-kit.json", "project"),
    hook(projectRoot, ".openskill-kit/compiled/hooks/hooks.json", "project")
  ];

  specs.push(...(await nestedInstructionSpecs(projectRoot)));
  specs.push(...(await filesInDir(projectRoot, ".claude/rules", "claude-code", "rule-file", "safe-read", "generated-only", "medium")));
  specs.push(...(await filesInDir(projectRoot, ".cursor/rules", "cursor", "rule-file", "safe-read", "preview-only", "medium")));
  specs.push(...(await filesInDir(projectRoot, ".opencode/commands", "opencode", "rule-file", "safe-read", "generated-only", "medium")));
  specs.push(...(await filesInDir(projectRoot, ".opencode/agents", "opencode", "rule-file", "safe-read", "generated-only", "medium")));
  specs.push(...(await filesInDir(projectRoot, ".opencode/plugins", "opencode", "hook-config", "safe-read", "explicit-apply", "medium")));
  specs.push(...(await filesInDir(projectRoot, ".openskill-kit/compiled/plugin/opencode/commands", "openskill-kit", "compiled-artifact", "safe-read", "generated-only", "low")));
  specs.push(...(await filesInDir(projectRoot, ".openskill-kit/compiled/plugin/opencode/agents", "openskill-kit", "compiled-artifact", "safe-read", "generated-only", "low")));
    specs.push(...(await skillSpecs(projectRoot, ".agents/skills", "project")));
  specs.push(...(await skillSpecs(projectRoot, ".claude/skills", "project")));
  specs.push(...(await skillSpecs(projectRoot, ".codex/skills", "project")));
  specs.push(...(await interactionExportSpecs(projectRoot)));
  specs.push(directory(projectRoot, ".roo", "other", "rule-directory", "preview-only", "medium", "project", "metadata-only", ["Roo project rules/config directory; metadata-only until an explicit adapter is added."]));
  specs.push(directory(projectRoot, ".openskill-kit/compiled/skills", "openskill-kit", "skill-directory", "generated-only", "low"));
  return specs;
}

function userSurfaceSpecs(homeDir: string): SurfaceSpec[] {
  return [
    instruction(homeDir, ".codex/AGENTS.md", "codex", "explicit-apply", ["User Codex instructions; metadata-only by default."], "user", "metadata-only", "high"),
    instruction(homeDir, ".codex/AGENTS.override.md", "codex", "never", ["User Codex override; never write by default."], "user", "metadata-only", "high"),
    configFile(homeDir, ".codex/config.toml", "codex", ["User Codex config; metadata-only by default."], "user", "metadata-only", "never", "high"),
    directory(homeDir, ".codex/memories", "codex", "memory-store", "never", "high", "user", "metadata-only", ["Codex memories detected as metadata only; never imported silently."]),
    instruction(homeDir, ".claude/CLAUDE.md", "claude-code", "explicit-apply", ["User Claude memory; metadata-only by default."], "user", "metadata-only", "high"),
    directory(homeDir, ".agents/skills", "skills", "skill-directory", "explicit-apply", "medium", "user", "metadata-only"),
    directory(homeDir, ".config/local-agent/skills", "skills", "skill-directory", "explicit-apply", "medium", "user", "metadata-only")
  ];
}

async function nestedInstructionSpecs(projectRoot: string): Promise<SurfaceSpec[]> {
  const files = await findNamedFiles(projectRoot, new Set(["AGENTS.md", "AGENTS.override.md"]));
  return files
    .filter((file) => path.relative(projectRoot, file).replace(/\\/g, "/") !== "AGENTS.md" && path.relative(projectRoot, file).replace(/\\/g, "/") !== "AGENTS.override.md")
    .map((file) => ({
      adapter: "agents-md" as const,
      surfaceType: path.basename(file) === "AGENTS.override.md" ? "override-file" as const : "instruction-file" as const,
      scope: "project" as const,
      target: file,
      readPolicy: "safe-read" as const,
      writePolicy: path.basename(file) === "AGENTS.override.md" ? "never" as const : "preview-only" as const,
      privacyRisk: "medium" as const,
      confidence: 0.92,
      notes: ["Nested instruction surface; closer file may override root behavior."]
    }));
}

async function filesInDir(projectRoot: string, relativeDir: string, adapter: AgentSurface["adapter"], surfaceType: AgentSurface["surfaceType"], readPolicy: AgentSurface["readPolicy"], writePolicy: AgentSurface["writePolicy"], privacyRisk: AgentSurface["privacyRisk"]): Promise<SurfaceSpec[]> {
  const dir = path.join(projectRoot, relativeDir);
  const files = await listFiles(dir);
  return files.map((file) => ({ adapter, surfaceType, scope: "project", target: file, readPolicy, writePolicy, privacyRisk, confidence: 0.86, notes: [`Detected under ${relativeDir}.`] }));
}

async function skillSpecs(projectRoot: string, relativeDir: string, scope: AgentSurface["scope"]): Promise<SurfaceSpec[]> {
  const dir = path.join(projectRoot, relativeDir);
  const files = await findNamedFiles(dir, new Set(["SKILL.md", "skill.md"]));
  return files.map((file) => ({
    adapter: "skills" as const,
    surfaceType: "skill" as const,
    scope,
    target: file,
    readPolicy: "safe-read" as const,
    writePolicy: file.includes(`${path.sep}.openskill-kit${path.sep}`) ? "generated-only" as const : "explicit-apply" as const,
    privacyRisk: "medium" as const,
    confidence: 0.9,
    notes: ["Skill manifest detected; third-party skills are not modified in place."]
  }));
}

async function interactionExportSpecs(projectRoot: string): Promise<SurfaceSpec[]> {
  const files = await listFiles(projectRoot);
  return files
    .filter((file) => {
      const relative = path.relative(projectRoot, file).replace(/\\/g, "/");
      if (relative.startsWith(".openskill-kit/")) return false;
      if (/^\.codex-log\/.+\.(?:jsonl?|txt|md)$/i.test(relative)) return true;
      return /(?:^|\/)(?:session|conversation|transcript|chat|codex-session)[-_].+\.(?:jsonl?|txt|md)$/i.test(relative);
    })
    .slice(0, 40)
    .map((file) => ({
      adapter: file.includes(`${path.sep}.codex-log${path.sep}`) ? "codex" as const : "other" as const,
      surfaceType: "interaction-export" as const,
      scope: "project" as const,
      target: file,
      readPolicy: "explicit-import" as const,
      writePolicy: "never" as const,
      privacyRisk: "high" as const,
      confidence: 0.74,
      notes: ["Possible session/export file; preview with interactions import before appending redacted events."]
    }));
}

async function surfaceFromSpec(projectRoot: string, spec: SurfaceSpec, detectedAt: string, options: DetectAgentEnvironmentOptions): Promise<AgentSurface | undefined> {
  const stat = await fs.stat(spec.target).catch(() => undefined);
  if (!stat) return undefined;
  const directory = stat.isDirectory();
  const allowContentRead = spec.readPolicy === "safe-read" && spec.scope === "project" && !directory;
  const content = allowContentRead || options.includeSensitivePreview === true && !directory
    ? await fs.readFile(spec.target, "utf8").catch(() => undefined)
    : undefined;
  const childCount = directory ? await countChildren(spec.target) : undefined;
  const mcpMetadata = spec.surfaceType === "mcp-config" && content ? inspectMcpConfigContent(content) : {};
  const relativePath = path.isAbsolute(projectRoot)
    ? path.relative(projectRoot, spec.target).replace(/\\/g, "/")
    : undefined;
  return AgentSurfaceSchema.parse({
    schemaVersion: "openskill-kit.agent-surface.v1",
    id: `surface_${shortHash(`${spec.adapter}:${spec.target}`)}`,
    detectedAt,
    adapter: spec.adapter,
    surfaceType: spec.surfaceType,
    scope: spec.scope,
    path: spec.target,
    relativePath: relativePath && !relativePath.startsWith("..") ? relativePath : undefined,
    exists: true,
    readPolicy: spec.readPolicy,
    writePolicy: spec.writePolicy,
    privacyRisk: spec.privacyRisk,
    confidence: spec.confidence ?? 0.8,
    metadata: {
      byteCount: stat.size,
      lineCount: content ? content.split(/\r?\n/).length : undefined,
      mtime: stat.mtime.toISOString(),
      managedBlockPresent: content ? content.includes(MANAGED_BLOCK_START) && content.includes(MANAGED_BLOCK_END) : undefined,
      oskGenerated: content ? /openskill-kit/i.test(content) : spec.target.includes(`${path.sep}.openskill-kit${path.sep}`),
      directory,
      childCount,
      ...mcpMetadata
    },
    notes: spec.notes ?? []
  });
}

async function writeDetectionArtifacts(projectRoot: string, report: AgentEnvironmentDetectionReport): Promise<AgentEnvironmentDetectionReport> {
  const dir = path.join(projectRoot, ".openskill-kit", "detection");
  const reportWithArtifacts = AgentEnvironmentDetectionReportSchema.parse({
    ...report,
    artifacts: {
      surfacesPath: path.join(dir, "surfaces.json"),
      lastScanPath: path.join(dir, "last-scan.json"),
      reportPath: path.join(dir, "reports", "environment.md")
    }
  });
  await writeJsonAtomic(reportWithArtifacts.artifacts.surfacesPath!, reportWithArtifacts.surfaces);
  await writeJsonAtomic(reportWithArtifacts.artifacts.lastScanPath!, reportWithArtifacts);
  await writeFileAtomic(reportWithArtifacts.artifacts.reportPath!, renderDetectionMarkdown(reportWithArtifacts));
  return reportWithArtifacts;
}

function renderDetectionMarkdown(report: AgentEnvironmentDetectionReport): string {
  const lines = [
    "# OpenSkillKit Agent Environment Detection",
    "",
    `Project: ${report.projectRoot}`,
    `Detected at: ${report.detectedAt}`,
    "",
    "## Summary",
    "",
    `- Total surfaces: ${report.summary.total}`,
    `- Managed-block writable: ${report.summary.writableManagedBlocks}`,
    `- Preview-only: ${report.summary.previewOnly}`,
    `- Metadata-only: ${report.summary.metadataOnly}`,
    `- High privacy risk: ${report.summary.highPrivacyRisk}`,
    `- Issues: ${report.summary.issueCount} (${report.summary.warningCount} warning, ${report.summary.blockedCount} block)`,
    "",
    "## Surfaces",
    ""
  ];
  if (!report.surfaces.length) lines.push("No agent surfaces detected.", "");
  for (const surface of report.surfaces) {
    lines.push(`- ${surface.adapter} ${surface.surfaceType} ${surface.scope}: \`${surface.relativePath ?? surface.path}\``);
    lines.push(`  - read: ${surface.readPolicy}; write: ${surface.writePolicy}; privacy: ${surface.privacyRisk}; confidence: ${surface.confidence}`);
    if (surface.metadata.managedBlockPresent !== undefined) lines.push(`  - managed block: ${surface.metadata.managedBlockPresent ? "yes" : "no"}`);
    for (const note of surface.notes) lines.push(`  - ${note}`);
  }
  lines.push("", "## Issues", "");
  if (!report.issues.length) lines.push("No detection issues.", "");
  for (const issue of report.issues) {
    lines.push(`- [${issue.severity}] ${issue.message}`);
    lines.push(`  - recommendation: ${issue.recommendation}`);
  }
  lines.push("", "## Next Actions", "");
  for (const action of report.nextActions) lines.push(`- ${action}`);
  lines.push("");
  return lines.join("\n");
}

function summarize(surfaces: AgentSurface[], issues: AgentDetectionIssue[]): AgentEnvironmentDetectionReport["summary"] {
  return {
    total: surfaces.length,
    byAdapter: countBy(surfaces, (surface) => surface.adapter),
    bySurfaceType: countBy(surfaces, (surface) => surface.surfaceType),
    writableManagedBlocks: surfaces.filter((surface) => surface.writePolicy === "managed-block").length,
    previewOnly: surfaces.filter((surface) => surface.writePolicy === "preview-only").length,
    metadataOnly: surfaces.filter((surface) => surface.readPolicy === "metadata-only").length,
    highPrivacyRisk: surfaces.filter((surface) => surface.privacyRisk === "high").length,
    issueCount: issues.length,
    warningCount: issues.filter((issue) => issue.severity === "warn").length,
    blockedCount: issues.filter((issue) => issue.severity === "block").length
  };
}

function detectSurfaceIssues(surfaces: AgentSurface[]): AgentDetectionIssue[] {
  const issues: AgentDetectionIssue[] = [];
  const interactionExports = surfaces.filter((surface) => surface.surfaceType === "interaction-export");
  if (interactionExports.length) {
    issues.push({
      id: "interaction-export-explicit-import",
      severity: "warn",
      surfaceIds: interactionExports.map((surface) => surface.id),
      message: `${interactionExports.length} possible session/export file(s) detected.`,
      recommendation: "Use interactions import dry-run first; import only redacted events with explicit approval."
    });
  }
  const overrides = surfaces.filter((surface) => surface.surfaceType === "override-file");
  if (overrides.length) {
    issues.push({
      id: "override-instruction-surface",
      severity: "warn",
      surfaceIds: overrides.map((surface) => surface.id),
      message: `${overrides.length} override instruction surface(s) detected.`,
      recommendation: "Do not write override files automatically; keep OpenSkillKit output in managed project blocks."
    });
  }
  const hooks = surfaces.filter((surface) => surface.surfaceType === "hook-config");
  if (hooks.length) {
    issues.push({
      id: "hook-execution-surface",
      severity: "warn",
      surfaceIds: hooks.map((surface) => surface.id),
      message: `${hooks.length} hook config surface(s) can affect command execution.`,
      recommendation: "Preview hook manifests and require explicit install approval with receipts."
    });
  }
  const userPrivate = surfaces.filter((surface) => surface.scope === "user" && surface.privacyRisk === "high");
  if (userPrivate.length) {
    issues.push({
      id: "user-private-metadata-only",
      severity: "info",
      surfaceIds: userPrivate.map((surface) => surface.id),
      message: `${userPrivate.length} high-risk user surface(s) detected as metadata-only.`,
      recommendation: "Keep user memories/configs out of project imports unless a user explicitly previews and approves them."
    });
  }
  const writableInstructions = surfaces.filter((surface) => surface.surfaceType === "instruction-file" && surface.writePolicy === "managed-block");
  if (!writableInstructions.length) {
    issues.push({
      id: "no-managed-instruction-target",
      severity: "info",
      surfaceIds: [],
      message: "No managed-block project instruction target detected.",
      recommendation: "Run compile and preview manifest install before adding any project instruction file."
    });
  }
  const mcpConfigs = surfaces.filter((surface) => surface.surfaceType === "mcp-config" && surface.adapter === "mcp");
  if (mcpConfigs.length) {
    issues.push({
      id: "mcp-config-review",
      severity: "info",
      surfaceIds: mcpConfigs.map((surface) => surface.id),
      message: `${mcpConfigs.length} MCP config surface(s) detected.`,
      recommendation: "Review MCP server commands and permissions before applying generated config changes."
    });
  }
  const invalidMcpConfigs = mcpConfigs.filter((surface) => surface.metadata.mcpConfigValid === false);
  if (invalidMcpConfigs.length) {
    issues.push({
      id: "mcp-config-invalid-json",
      severity: "block",
      surfaceIds: invalidMcpConfigs.map((surface) => surface.id),
      message: `${invalidMcpConfigs.length} MCP config surface(s) could not be parsed as JSON.`,
      recommendation: "Fix invalid JSON before running `openskill-kit agent attach-plugin --yes`; OpenSkillKit will not overwrite unreadable host config."
    });
  }
  const pluginCompiled = surfaces.some((surface) => surface.adapter === "openskill-kit" && surface.relativePath === ".openskill-kit/compiled/plugin/plugin.json");
  const hostMcpConfigs = mcpConfigs.filter((surface) => surface.scope === "project");
  const attachedConfigs = hostMcpConfigs.filter((surface) => surface.metadata.openskillKitAttached === true);
  const conflictingConfigs = hostMcpConfigs.filter((surface) => surface.metadata.openskillKitAttached === false && surface.metadata.openskillKitCommand);
  if (pluginCompiled && !attachedConfigs.length) {
    issues.push({
      id: "plugin-not-attached-to-host-mcp",
      severity: "info",
      surfaceIds: hostMcpConfigs.map((surface) => surface.id),
      message: "Compiled OpenSkillKit plugin exists, but no project host MCP config is attached to `openskill-kit-mcp`.",
      recommendation: "Run `openskill-kit agent attach-plugin --host generic-mcp --dry-run`, review the diff, then apply with `--yes` if desired."
    });
  }
  if (conflictingConfigs.length) {
    issues.push({
      id: "plugin-mcp-command-conflict",
      severity: "warn",
      surfaceIds: conflictingConfigs.map((surface) => surface.id),
      message: `${conflictingConfigs.length} MCP config surface(s) define openskill-kit with a nonstandard command.`,
      recommendation: "Review the existing openskill-kit MCP command before applying generated attachment config."
    });
  }
  const remoteMcpConfigs = hostMcpConfigs.filter((surface) => (surface.metadata.mcpRemoteServerCount ?? 0) > 0);
  if (remoteMcpConfigs.length) {
    issues.push({
      id: "mcp-remote-server-review",
      severity: "warn",
      surfaceIds: remoteMcpConfigs.map((surface) => surface.id),
      message: `${remoteMcpConfigs.length} MCP config surface(s) include remote server definitions.`,
      recommendation: "Review remote MCP servers separately; OpenSkillKit attachment should remain local stdio by default."
    });
  }
  return issues;
}

function nextActionsForDetection(surfaces: AgentSurface[], issues: AgentDetectionIssue[]): string[] {
  const actions = new Set<string>();
  if (issues.some((issue) => issue.id === "interaction-export-explicit-import")) actions.add("Run `openskill-kit interactions import <file>` without `--yes` to preview redacted events.");
  if (surfaces.some((surface) => surface.writePolicy === "managed-block")) actions.add("Run `openskill-kit agent install-manifests --target project --dry-run` before writing managed instruction blocks.");
  if (surfaces.some((surface) => surface.surfaceType === "hook-config")) actions.add("Run `openskill-kit agent doctor` and preview hook install before enabling hooks.");
  if (surfaces.some((surface) => surface.adapter === "mcp")) actions.add("Inspect existing MCP config before applying generated OpenSkillKit MCP config.");
  if (surfaces.some((surface) => surface.surfaceType === "config-file" && surface.scope === "project")) actions.add("Review project harness config files before choosing generated plugin attach target.");
  if (issues.some((issue) => issue.id === "plugin-not-attached-to-host-mcp")) actions.add("Run `openskill-kit agent attach-plugin --host generic-mcp --dry-run` to preview host MCP attachment.");
  if (issues.some((issue) => issue.id === "mcp-config-invalid-json")) actions.add("Fix invalid host MCP JSON before applying plugin attachment.");
  if (!actions.size) actions.add("Run `openskill-kit compile` after reviewing active behavior.");
  return [...actions];
}

function inspectMcpConfigContent(content: string): Partial<AgentSurface["metadata"]> {
  try {
    const parsed = JSON.parse(content) as { mcpServers?: Record<string, unknown> };
    const servers = parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.mcpServers && typeof parsed.mcpServers === "object" && !Array.isArray(parsed.mcpServers)
      ? parsed.mcpServers
      : {};
    const names = Object.keys(servers).sort();
    const openskillKitServer = isRecord(servers["openskill-kit"]) ? servers["openskill-kit"] : undefined;
    const command = typeof openskillKitServer?.command === "string" ? openskillKitServer.command : undefined;
    const remoteCount = Object.values(servers).filter((server) => {
      if (!isRecord(server)) return false;
      const url = typeof server.url === "string" ? server.url : undefined;
      const transport = typeof server.transport === "string" ? server.transport : undefined;
      return Boolean(url) || transport === "http" || transport === "sse";
    }).length;
    return {
      mcpConfigValid: true,
      mcpServerNames: names,
      openskillKitAttached: command === "openskill-kit-mcp",
      openskillKitCommand: command,
      mcpRemoteServerCount: remoteCount
    };
  } catch {
    return {
      mcpConfigValid: false,
      mcpIssue: "Invalid JSON"
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function countBy<T>(items: T[], fn: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[fn(item)] = (out[fn(item)] ?? 0) + 1;
  return out;
}

function instruction(root: string, relative: string, adapter: AgentSurface["adapter"], writePolicy: AgentSurface["writePolicy"], notes: string[] = [], scope: AgentSurface["scope"] = "project", readPolicy: AgentSurface["readPolicy"] = "safe-read", privacyRisk: AgentSurface["privacyRisk"] = "medium"): SurfaceSpec {
  return { adapter, surfaceType: relative.endsWith("override.md") ? "override-file" : "instruction-file", scope, target: path.join(root, relative), readPolicy, writePolicy, privacyRisk, confidence: 0.92, notes };
}

function config(root: string, relative: string, adapter: AgentSurface["adapter"], notes: string[] = [], scope: AgentSurface["scope"] = "project", readPolicy: AgentSurface["readPolicy"] = "safe-read", writePolicy: AgentSurface["writePolicy"] = "preview-only", privacyRisk: AgentSurface["privacyRisk"] = "medium"): SurfaceSpec {
  return { adapter, surfaceType: "mcp-config", scope, target: path.join(root, relative), readPolicy, writePolicy, privacyRisk, confidence: 0.86, notes };
}

function mcpConfig(root: string, relative: string, adapter: AgentSurface["adapter"], notes: string[] = [], scope: AgentSurface["scope"] = "project", readPolicy: AgentSurface["readPolicy"] = "safe-read", writePolicy: AgentSurface["writePolicy"] = "preview-only", privacyRisk: AgentSurface["privacyRisk"] = "medium"): SurfaceSpec {
  return config(root, relative, adapter, notes, scope, readPolicy, writePolicy, privacyRisk);
}

function configFile(root: string, relative: string, adapter: AgentSurface["adapter"], notes: string[] = [], scope: AgentSurface["scope"] = "project", readPolicy: AgentSurface["readPolicy"] = "safe-read", writePolicy: AgentSurface["writePolicy"] = "preview-only", privacyRisk: AgentSurface["privacyRisk"] = "medium"): SurfaceSpec {
  return { adapter, surfaceType: "config-file", scope, target: path.join(root, relative), readPolicy, writePolicy, privacyRisk, confidence: 0.82, notes };
}

function generated(root: string, relative: string, surfaceType: AgentSurface["surfaceType"]): SurfaceSpec {
  return { adapter: "openskill-kit", surfaceType, scope: "project", target: path.join(root, relative), readPolicy: "safe-read", writePolicy: "generated-only", privacyRisk: "low", confidence: 0.98, notes: ["OpenSkillKit generated artifact."] };
}

function hook(root: string, relative: string, scope: AgentSurface["scope"]): SurfaceSpec {
  return { adapter: "hooks", surfaceType: "hook-config", scope, target: path.join(root, relative), readPolicy: "safe-read", writePolicy: "explicit-apply", privacyRisk: "medium", confidence: 0.88, notes: ["Hook config can affect command execution; explicit approval required."] };
}

function directory(root: string, relative: string, adapter: AgentSurface["adapter"], surfaceType: AgentSurface["surfaceType"], writePolicy: AgentSurface["writePolicy"], privacyRisk: AgentSurface["privacyRisk"], scope: AgentSurface["scope"] = "project", readPolicy: AgentSurface["readPolicy"] = "metadata-only", notes: string[] = []): SurfaceSpec {
  return { adapter, surfaceType, scope, target: path.join(root, relative), readPolicy, writePolicy, privacyRisk, confidence: 0.8, notes };
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}

async function findNamedFiles(root: string, names: Set<string>): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (names.has(entry.name)) out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}

async function countChildren(dir: string): Promise<number> {
  return fs.readdir(dir).then((entries) => entries.length).catch(() => 0);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
