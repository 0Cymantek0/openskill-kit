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

export interface AgentPluginAttachStatus {
  schemaVersion: "openskill-kit.agent-plugin-attach-status.v1";
  attached: boolean;
  hosts: AgentPluginHostAttachStatus[];
  receiptCount: number;
  latestReceiptPath?: string;
  nextActions: string[];
}

export interface AgentPluginHostAttachStatus {
  host: AgentPluginAttachHost;
  destination: string;
  status: "attached" | "missing" | "invalid-json" | "needs-root-binding" | "wrong-command" | "descriptor-drift";
  command?: string;
  projectRootBound: boolean;
  pluginVersion?: string;
  attachedDescriptorHash?: string;
  currentDescriptorHash?: string;
  issue?: string;
}

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

interface AttachReceipt {
  attachedAt?: string;
  host?: AgentPluginAttachHost;
  pluginVersion?: string;
  pluginDescriptorsHash?: string;
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
    pluginVersion: plugin.manifest?.version,
    pluginDescriptorsHash: plugin.mcpDescriptorsHash,
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

export async function getAgentPluginAttachStatus(projectRoot: string): Promise<AgentPluginAttachStatus> {
  const root = path.resolve(projectRoot);
  const receipts = await listAttachReceipts(root);
  const plugin = await getCompiledPluginStatus(root);
  const hosts = await Promise.all(AgentPluginAttachHosts.map(async (host) => inspectHostAttach(root, host, plugin, receipts)));
  const drifted = hosts.filter((host) => host.status === "descriptor-drift");
  const attached = drifted.length === 0 && hosts.some((host) => host.status === "attached");
  const nextActions = drifted.length
    ? [
      "Compiled plugin descriptors changed after host attachment; re-run `openskill-kit agent attach-plugin --host generic-mcp --dry-run` and apply after review.",
      "Restart or refresh the coding harness MCP server after re-attaching so tool descriptors match the compiled plugin."
    ]
    : attached
    ? ["Plugin host attachment is ready; MCP tools can use the bound project root without per-call projectRoot arguments."]
    : [
      "Run `openskill-kit agent attach-plugin --host generic-mcp --dry-run` to preview host MCP attachment.",
      "Apply with `--yes` only after reviewing the project-local MCP config diff."
    ];
  return {
    schemaVersion: "openskill-kit.agent-plugin-attach-status.v1",
    attached,
    hosts,
    receiptCount: receipts.length,
    latestReceiptPath: receipts[0]?.path,
    nextActions
  };
}

function hostConfigTargets(root: string, host: AgentPluginAttachHost): string[] {
  if (host === "cursor") return [path.join(root, ".cursor", "mcp.json")];
  return [path.join(root, ".mcp.json")];
}

async function inspectHostAttach(root: string, host: AgentPluginAttachHost, plugin: CompiledPluginStatus, receipts: Array<{ path: string; receipt: AttachReceipt }>): Promise<AgentPluginHostAttachStatus> {
  const destination = hostConfigTargets(root, host)[0]!;
  const existing = await fs.readFile(destination, "utf8").catch(() => undefined);
  if (existing === undefined) return { host, destination, status: "missing", projectRootBound: false, issue: "Host MCP config missing" };
  let parsed: McpConfig;
  try {
    parsed = JSON.parse(existing) as McpConfig;
  } catch {
    return { host, destination, status: "invalid-json", projectRootBound: false, issue: "Host MCP config is not valid JSON" };
  }
  const server = isRecord(parsed.mcpServers) && isRecord(parsed.mcpServers["openskill-kit"])
    ? parsed.mcpServers["openskill-kit"]
    : undefined;
  const command = typeof server?.command === "string" ? server.command : undefined;
  const env = isRecord(server?.env) ? server.env : {};
  const projectRootBound = env[AGENT_PLUGIN_PROJECT_ROOT_ENV] === root;
  if (command !== "openskill-kit-mcp") {
    return {
      host,
      destination,
      status: "wrong-command",
      command,
      projectRootBound,
      issue: command ? "openskill-kit MCP server command is not openskill-kit-mcp" : "openskill-kit MCP server entry missing"
    };
  }
  if (!projectRootBound) {
    return {
      host,
      destination,
      status: "needs-root-binding",
      command,
      projectRootBound,
      issue: `${AGENT_PLUGIN_PROJECT_ROOT_ENV} is not bound to this project`
    };
  }
  const receipt = receipts.find((item) => item.receipt.host === host);
  const attachedDescriptorHash = typeof receipt?.receipt.pluginDescriptorsHash === "string" ? receipt.receipt.pluginDescriptorsHash : undefined;
  const currentDescriptorHash = plugin.mcpDescriptorsHash;
  const pluginVersion = typeof receipt?.receipt.pluginVersion === "string" ? receipt.receipt.pluginVersion : plugin.manifest?.version;
  if (attachedDescriptorHash && currentDescriptorHash && attachedDescriptorHash !== currentDescriptorHash) {
    return {
      host,
      destination,
      status: "descriptor-drift",
      command,
      projectRootBound,
      pluginVersion,
      attachedDescriptorHash,
      currentDescriptorHash,
      issue: "Host attachment receipt descriptor hash differs from current compiled plugin descriptors"
    };
  }
  return { host, destination, status: "attached", command, projectRootBound, pluginVersion, attachedDescriptorHash, currentDescriptorHash };
}

async function listAttachReceipts(root: string): Promise<Array<{ path: string; receipt: AttachReceipt }>> {
  const dir = path.join(root, ".openskill-kit", "installs");
  const entries = await fs.readdir(dir).catch(() => []);
  const receiptFiles = entries.filter((entry) => /^plugin-attach-.+\.json$/.test(entry)).map((entry) => path.join(dir, entry));
  const receipts = await Promise.all(receiptFiles.map(async (file) => ({
    path: file,
    receipt: await readJson<AttachReceipt>(file).catch((): AttachReceipt => ({}))
  })));
  return receipts.sort((left, right) => String(right.receipt.attachedAt ?? "").localeCompare(String(left.receipt.attachedAt ?? "")));
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
      hostCompatibility: [],
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

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
