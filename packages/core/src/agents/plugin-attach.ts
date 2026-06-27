import { promises as fs } from "node:fs";
import path from "node:path";
import { compileBehaviorLayer } from "../compiler/package-compiler.js";
import { getCompiledPluginStatus, type CompiledPluginStatus } from "../compiler/plugin-compiler.js";
import { writeJsonAtomic } from "../storage/atomic.js";

export const AgentPluginAttachHosts = ["codex", "claude-code", "cursor", "generic-mcp"] as const;
export type AgentPluginAttachHost = typeof AgentPluginAttachHosts[number];
export const AGENT_PLUGIN_PROJECT_ROOT_ENV = "OPENSKILLKIT_PROJECT_ROOT";

export interface AgentPluginAttachResult {
  schemaVersion: "openskill-kit.agent-plugin-attach.v1";
  status: "planned" | "attached" | "blocked";
  host: AgentPluginAttachHost;
  dryRun: boolean;
  plugin: CompiledPluginStatus;
  files: AgentPluginAttachFile[];
  receiptPath?: string;
  messages: string[];
}

export interface AgentPluginAttachFile {
  destination: string;
  action: "create" | "update" | "unchanged" | "blocked";
  preview?: unknown;
  diff?: string;
  issue?: string;
}

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function attachAgentPlugin(
  projectRoot: string,
  options: { host?: AgentPluginAttachHost; dryRun?: boolean; yes?: boolean } = {}
): Promise<AgentPluginAttachResult> {
  const root = path.resolve(projectRoot);
  const host = options.host ?? "generic-mcp";
  if (!AgentPluginAttachHosts.includes(host)) {
    return blocked(root, host, undefined, [`Unsupported attach host: ${host}`]);
  }
  await compileBehaviorLayer(root, { targets: ["plugin"] });
  const plugin = await getCompiledPluginStatus(root);
  if (!plugin.ready) {
    return blocked(root, host, plugin, [`Plugin is not ready: ${[...plugin.missing, ...plugin.integrityIssues].join(", ")}`]);
  }
  const files = await Promise.all(hostConfigTargets(root, host).map((destination) => planMcpConfig(destination, plugin.mcpServerCommand, root)));
  const blockedFiles = files.filter((file) => file.action === "blocked");
  if (blockedFiles.length) {
    return {
      schemaVersion: "openskill-kit.agent-plugin-attach.v1",
      status: "blocked",
      host,
      dryRun: true,
      plugin,
      files,
      messages: blockedFiles.map((file) => `blocked ${path.relative(root, file.destination).replace(/\\/g, "/")}: ${file.issue ?? "cannot update host config"}`)
    };
  }
  const dryRun = options.dryRun !== false || options.yes !== true;
  if (dryRun) {
    return {
      schemaVersion: "openskill-kit.agent-plugin-attach.v1",
      status: "planned",
      host,
      dryRun: true,
      plugin,
      files,
      messages: [
        `Plugin ready at ${path.relative(root, plugin.pluginDir).replace(/\\/g, "/")}`,
        ...files.map((file) => `${file.action} ${path.relative(root, file.destination).replace(/\\/g, "/")}`),
        "Re-run with `--yes` to write host MCP config."
      ]
    };
  }
  for (const file of files) {
    assertInsideRoot(root, file.destination);
    if (file.preview !== undefined) await writeJsonAtomic(file.destination, file.preview);
  }
  const receiptPath = path.join(root, ".openskill-kit", "installs", `plugin-attach-${host}-${Date.now()}.json`);
  await writeJsonAtomic(receiptPath, {
    schemaVersion: "openskill-kit.agent-plugin-attach-receipt.v1",
    attachedAt: new Date().toISOString(),
    host,
    pluginDir: path.relative(root, plugin.pluginDir).replace(/\\/g, "/"),
    files: files.map((file) => ({
      destination: path.relative(root, file.destination).replace(/\\/g, "/"),
      action: file.action
    }))
  });
  return {
    schemaVersion: "openskill-kit.agent-plugin-attach.v1",
    status: "attached",
    host,
    dryRun: false,
    plugin,
    files,
    receiptPath,
    messages: files.map((file) => `${file.action} ${path.relative(root, file.destination).replace(/\\/g, "/")}`)
  };
}

function hostConfigTargets(root: string, host: AgentPluginAttachHost): string[] {
  if (host === "cursor") return [path.join(root, ".cursor", "mcp.json")];
  return [path.join(root, ".mcp.json")];
}

async function planMcpConfig(destination: string, command: string, projectRoot: string): Promise<AgentPluginAttachFile> {
  const existing = await fs.readFile(destination, "utf8").catch(() => undefined);
  let parsed: McpConfig = {};
  if (existing?.trim()) {
    try {
      parsed = JSON.parse(existing) as McpConfig;
    } catch {
      return {
        destination,
        action: "blocked",
        issue: "Existing MCP config is not valid JSON",
        diff: unifiedDiff(destination, existing, existing)
      };
    }
  }
  const before = existing ?? "";
  const next: McpConfig = {
    ...parsed,
    mcpServers: {
      ...(isRecord(parsed.mcpServers) ? parsed.mcpServers : {}),
      "openskill-kit": {
        command,
        env: {
          [AGENT_PLUGIN_PROJECT_ROOT_ENV]: projectRoot
        }
      }
    }
  };
  const after = `${JSON.stringify(next, null, 2)}\n`;
  return {
    destination,
    action: existing === undefined ? "create" : before === after ? "unchanged" : "update",
    preview: next,
    diff: unifiedDiff(destination, before, after)
  };
}

function blocked(root: string, host: AgentPluginAttachHost, plugin: CompiledPluginStatus | undefined, messages: string[]): AgentPluginAttachResult {
  return {
    schemaVersion: "openskill-kit.agent-plugin-attach.v1",
    status: "blocked",
    host,
    dryRun: true,
    plugin: plugin ?? {
      schemaVersion: "openskill-kit.compiled-plugin-status.v1",
      ready: false,
      pluginDir: path.join(root, ".openskill-kit", "compiled", "plugin"),
      manifestPath: path.join(root, ".openskill-kit", "compiled", "plugin", "plugin.json"),
      agentPluginManifestPath: path.join(root, ".openskill-kit", "compiled", "plugin", ".agent-plugin", "plugin.json"),
      mcpAttachmentPath: path.join(root, ".openskill-kit", "compiled", "plugin", ".mcp.json"),
      mcpDescriptorPath: path.join(root, ".openskill-kit", "compiled", "plugin", "mcp", "descriptors.json"),
      mcpDescriptorHashPath: path.join(root, ".openskill-kit", "compiled", "plugin", "mcp", "descriptor-hashes.json"),
      commandMapPath: path.join(root, ".openskill-kit", "compiled", "plugin", "commands", "commands.json"),
      commandGuidePath: path.join(root, ".openskill-kit", "compiled", "plugin", "commands", "osk.md"),
      installGuidesPath: path.join(root, ".openskill-kit", "compiled", "plugin", "install-guides"),
      mcpServerCommand: "openskill-kit-mcp",
      commands: [],
      skills: [],
      capabilities: [],
      approvalGates: [],
      privacyExclusions: [],
      missing: ["plugin.json"],
      integrityIssues: [],
      nextActions: ["Run `openskill-kit compile --target plugin` before attaching."]
    },
    files: [],
    messages
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
