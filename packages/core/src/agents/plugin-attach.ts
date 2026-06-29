import { promises as fs } from "node:fs";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser/lib/esm/main.js";
import { compileBehaviorLayer } from "../compiler/package-compiler.js";
import { getCompiledPluginStatus, type AgentPluginInstallProfile, type CompiledPluginStatus } from "../compiler/plugin-compiler.js";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";

export const AgentPluginAttachHosts = ["opencode", "codex", "claude-code", "cursor", "generic-mcp"] as const;
export type AgentPluginAttachHost = typeof AgentPluginAttachHosts[number];
export const AGENT_PLUGIN_PROJECT_ROOT_ENV = "OPENSKILLKIT_PROJECT_ROOT";
export const DEFAULT_AGENT_PLUGIN_ATTACH_HOST: AgentPluginAttachHost = "opencode";
const OPENCODE_PLUGIN_PATH = ".opencode/plugins/openskillkit.ts";

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
  defaultHost: AgentPluginAttachHost;
  defaultHostReady: boolean;
  defaultHostStatus: AgentPluginHostAttachStatus;
  hosts: AgentPluginHostAttachStatus[];
  receiptCount: number;
  latestReceiptPath?: string;
  nextActions: string[];
}

export interface AgentPluginInstallProfileStatus {
  schemaVersion: "openskill-kit.agent-plugin-install-profile-status.v1";
  ready: boolean;
  profile?: AgentPluginInstallProfile;
  attachment: AgentPluginAttachStatus;
  plugin: Pick<CompiledPluginStatus, "ready" | "pluginDir" | "manifestPath" | "mcpServerCommand" | "mcpDescriptorsHash" | "missing" | "integrityIssues" | "nextActions">;
  nextActions: string[];
}

export interface AgentPluginHostAttachStatus {
  host: AgentPluginAttachHost;
  destination: string;
  status: "attached" | "missing" | "invalid-json" | "needs-root-binding" | "wrong-command" | "plugin-missing" | "descriptor-drift";
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

interface HostConfigTarget {
  destination: string;
  format: "json-mcp" | "codex-toml" | "opencode-json" | "copy";
  source?: string;
}

export async function attachAgentPlugin(
  projectRoot: string,
  options: { host?: AgentPluginAttachHost; dryRun?: boolean; yes?: boolean } = {}
): Promise<AgentPluginAttachResult> {
  const root = path.resolve(projectRoot);
  const host = options.host ?? DEFAULT_AGENT_PLUGIN_ATTACH_HOST;
  if (!AgentPluginAttachHosts.includes(host)) {
    return blocked(root, host, undefined, [`Unsupported attach host: ${host}`]);
  }
  await compileBehaviorLayer(root, { targets: ["plugin"] });
  const plugin = await getCompiledPluginStatus(root);
  if (!plugin.ready) {
    return blocked(root, host, plugin, [`Plugin is not ready: ${[...plugin.missing, ...plugin.integrityIssues].join(", ")}`]);
  }
  const files = await Promise.all(hostConfigTargets(root, host, plugin.pluginDir).map((target) => planHostConfig(target, plugin.mcpServerCommand, root)));
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
    if (typeof file.preview === "string") await writeFileAtomic(file.destination, file.preview);
    else if (file.preview !== undefined) await writeJsonAtomic(file.destination, file.preview);
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
  const defaultHostStatus = hosts.find((host) => host.host === DEFAULT_AGENT_PLUGIN_ATTACH_HOST) ?? hosts[0]!;
  const defaultHostReady = defaultHostStatus.status === "attached";
  const attached = drifted.length === 0 && hosts.some((host) => host.status === "attached");
  const nextActions = drifted.length
    ? [
      `Compiled plugin descriptors changed after host attachment; re-run \`openskill-kit agent attach-plugin --host ${DEFAULT_AGENT_PLUGIN_ATTACH_HOST} --dry-run\` or the drifted host and apply after review.`,
      "Restart or refresh the coding harness MCP server after re-attaching so tool descriptors match the compiled plugin."
    ]
    : defaultHostReady
    ? [`Primary ${DEFAULT_AGENT_PLUGIN_ATTACH_HOST} attachment is ready; MCP tools can use the bound project root without per-call projectRoot arguments.`]
    : attached
    ? [
      `A non-default host is attached, but primary ${DEFAULT_AGENT_PLUGIN_ATTACH_HOST} status is ${defaultHostStatus.status}${defaultHostStatus.issue ? `: ${defaultHostStatus.issue}` : ""}.`,
      `Run \`openskill-kit agent attach-plugin --host ${DEFAULT_AGENT_PLUGIN_ATTACH_HOST} --dry-run\` to preview the primary OpenCode attachment.`
    ]
    : [
      `Run \`openskill-kit agent attach-plugin --host ${DEFAULT_AGENT_PLUGIN_ATTACH_HOST} --dry-run\` to preview OpenCode-first host attachment.`,
      "Apply with `--yes` only after reviewing the project-local MCP config diff."
    ];
  return {
    schemaVersion: "openskill-kit.agent-plugin-attach-status.v1",
    attached,
    defaultHost: DEFAULT_AGENT_PLUGIN_ATTACH_HOST,
    defaultHostReady,
    defaultHostStatus,
    hosts,
    receiptCount: receipts.length,
    latestReceiptPath: receipts[0]?.path,
    nextActions
  };
}

export async function getAgentPluginInstallProfile(projectRoot: string): Promise<AgentPluginInstallProfileStatus> {
  const plugin = await getCompiledPluginStatus(projectRoot);
  const attachment = await getAgentPluginAttachStatus(projectRoot);
  const ready = plugin.ready && Boolean(plugin.installProfile);
  const nextActions = ready
    ? [
      "Use installProfile.firstCall before reading learned behavior.",
      "Start installProfile.mcp.command with stdio and bind OPENSKILLKIT_PROJECT_ROOT to the absolute project root.",
      "Route /osk commands through installProfile.commandRouting.map and keep approvalRequiredTools behind explicit user approval.",
      attachment.attached ? "Host attachment is ready; existing coding harnesses can call MCP tools through the configured server." : "Preview and apply a hostConfig entry before relying on MCP in this harness."
    ]
    : [
      ...plugin.nextActions,
      "Run `openskill-kit compile --target plugin` to generate plugin.json.installProfile."
    ];
  return {
    schemaVersion: "openskill-kit.agent-plugin-install-profile-status.v1",
    ready,
    profile: plugin.installProfile,
    attachment,
    plugin: {
      ready: plugin.ready,
      pluginDir: plugin.pluginDir,
      manifestPath: plugin.manifestPath,
      mcpServerCommand: plugin.mcpServerCommand,
      mcpDescriptorsHash: plugin.mcpDescriptorsHash,
      missing: plugin.missing,
      integrityIssues: plugin.integrityIssues,
      nextActions: plugin.nextActions
    },
    nextActions
  };
}

function hostConfigTargets(root: string, host: AgentPluginAttachHost, pluginDir?: string): HostConfigTarget[] {
  if (host === "opencode") {
    const configPath = existsSync(path.join(root, "opencode.jsonc")) && !existsSync(path.join(root, "opencode.json"))
      ? "opencode.jsonc"
      : "opencode.json";
    const generated = pluginDir ? [
      ...copyTargets(root, pluginDir, "opencode/commands", ".opencode/commands"),
      ...copyTargets(root, pluginDir, "opencode/agents", ".opencode/agents"),
      ...copyTargets(root, pluginDir, "opencode/skills", ".opencode/skills"),
      ...copyTargets(root, pluginDir, "opencode/plugins", ".opencode/plugins"),
      ...copyTargets(root, pluginDir, "opencode/model-routing.json", ".opencode/model-routing.json")
    ] : [];
    return [{ destination: path.join(root, configPath), format: "opencode-json" }, ...generated];
  }
  if (host === "codex") return [{ destination: path.join(root, ".codex", "config.toml"), format: "codex-toml" }];
  if (host === "cursor") return [{ destination: path.join(root, ".cursor", "mcp.json"), format: "json-mcp" }];
  return [{ destination: path.join(root, ".mcp.json"), format: "json-mcp" }];
}

function copyTargets(root: string, pluginDir: string, sourceRelative: string, destinationRelative: string): HostConfigTarget[] {
  const source = path.join(pluginDir, sourceRelative);
  if (!existsSync(source)) return [];
  if (statSync(source).isFile()) {
    return [{ source, destination: path.join(root, destinationRelative), format: "copy" }];
  }
  const out: HostConfigTarget[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push({
        source: full,
        destination: path.join(root, destinationRelative, path.relative(source, full)),
        format: "copy"
      });
    }
  };
  walk(source);
  return out;
}

async function inspectHostAttach(root: string, host: AgentPluginAttachHost, plugin: CompiledPluginStatus, receipts: Array<{ path: string; receipt: AttachReceipt }>): Promise<AgentPluginHostAttachStatus> {
  const target = hostConfigTargets(root, host)[0]!;
  const destination = target.destination;
  const existing = await fs.readFile(destination, "utf8").catch(() => undefined);
  if (existing === undefined) return { host, destination, status: "missing", projectRootBound: false, issue: "Host MCP config missing" };
  if (target.format === "codex-toml") return inspectAttachedServer(root, host, destination, parseCodexTomlMcpServer(existing, root), plugin, receipts);
  if (target.format === "opencode-json") return inspectOpenCodeConfig(root, host, destination, existing, plugin, receipts);
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
  return inspectAttachedServer(root, host, destination, { command, projectRootBound: env[AGENT_PLUGIN_PROJECT_ROOT_ENV] === root, serverPresent: Boolean(server) }, plugin, receipts);
}

function inspectAttachedServer(
  root: string,
  host: AgentPluginAttachHost,
  destination: string,
  server: { command?: string; projectRootBound: boolean; serverPresent?: boolean },
  plugin: CompiledPluginStatus,
  receipts: Array<{ path: string; receipt: AttachReceipt }>
): AgentPluginHostAttachStatus {
  const command = server.command;
  const projectRootBound = server.projectRootBound;
  if (server.serverPresent === false) {
    return {
      host,
      destination,
      status: "missing",
      command,
      projectRootBound,
      issue: "openskill-kit MCP server entry missing"
    };
  }
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

async function planHostConfig(target: HostConfigTarget, command: string, projectRoot: string): Promise<AgentPluginAttachFile> {
  if (target.format === "codex-toml") return planCodexTomlConfig(target.destination, command, projectRoot);
  if (target.format === "opencode-json") return planOpenCodeConfig(target.destination, command, projectRoot);
  if (target.format === "copy") return planCopyFile(target);
  return planMcpConfig(target.destination, command, projectRoot);
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

async function planOpenCodeConfig(destination: string, command: string, projectRoot: string): Promise<AgentPluginAttachFile> {
  const existing = await fs.readFile(destination, "utf8").catch(() => undefined);
  let parsed: Record<string, unknown> = {};
  if (existing?.trim()) {
    const parsedConfig = parseOpenCodeConfig(existing);
    if (parsedConfig.errors.length) {
      return {
        destination,
        action: "blocked",
        issue: existingOpenCodeIssue(destination, parsedConfig.errors),
        diff: unifiedDiff(destination, existing, existing)
      };
    }
    parsed = parsedConfig.value;
  }
  const before = existing ?? "";
  const currentMcp = isRecord(parsed.mcp) ? parsed.mcp : {};
  const pluginList = openCodePluginList(parsed.plugin);
  if (pluginList.issue) {
    return {
      destination,
      action: "blocked",
      issue: pluginList.issue,
      diff: unifiedDiff(destination, before, before)
    };
  }
  const plugin = pluginList.items.includes(OPENCODE_PLUGIN_PATH) ? pluginList.items : [...pluginList.items, OPENCODE_PLUGIN_PATH];
  const mcp = {
    ...currentMcp,
    "openskill-kit": {
      type: "local",
      command: [command],
      enabled: true,
      environment: {
        [AGENT_PLUGIN_PROJECT_ROOT_ENV]: projectRoot
      }
    }
  };
  const next: Record<string, unknown> = { ...parsed, plugin, mcp };
  const after = existing === undefined
    ? `${JSON.stringify(next, null, 2)}\n`
    : applyOpenCodeJsoncEdits(existing, [
      { path: ["plugin"], value: plugin },
      { path: ["mcp"], value: mcp }
    ]);
  return {
    destination,
    action: existing === undefined ? "create" : before === after ? "unchanged" : "update",
    preview: existing === undefined ? next : after,
    diff: unifiedDiff(destination, before, after)
  };
}

async function planCopyFile(target: HostConfigTarget): Promise<AgentPluginAttachFile> {
  if (!target.source) return { destination: target.destination, action: "blocked", issue: "Missing generated source file" };
  const existing = await fs.readFile(target.destination, "utf8").catch(() => undefined);
  const next = await fs.readFile(target.source, "utf8");
  return {
    destination: target.destination,
    action: existing === undefined ? "create" : existing === next ? "unchanged" : "update",
    preview: next,
    diff: unifiedDiff(target.destination, existing ?? "", next)
  };
}

function parseOpenCodeConfig(text: string): { value: Record<string, unknown>; errors: ParseError[] } {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  return { value: isRecord(parsed) ? parsed : {}, errors };
}

function applyOpenCodeJsoncEdits(text: string, edits: Array<{ path: Array<string | number>; value: unknown }>): string {
  return edits.reduce((current, edit) => applyEdits(current, modify(current, edit.path, edit.value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  })), text);
}

function existingOpenCodeIssue(destination: string, errors: ParseError[]): string {
  const format = destination.endsWith(".jsonc") ? "JSONC" : "JSON";
  return `Existing OpenCode config is not valid ${format}: ${errors.map((error) => `error ${error.error} at offset ${error.offset}`).join(", ")}`;
}

function inspectOpenCodeConfig(
  root: string,
  host: AgentPluginAttachHost,
  destination: string,
  existing: string,
  plugin: CompiledPluginStatus,
  receipts: Array<{ path: string; receipt: AttachReceipt }>
): AgentPluginHostAttachStatus {
  let parsed: Record<string, unknown>;
  const parsedConfig = parseOpenCodeConfig(existing);
  if (parsedConfig.errors.length) {
    return { host, destination, status: "invalid-json", projectRootBound: false, issue: existingOpenCodeIssue(destination, parsedConfig.errors) };
  }
  parsed = parsedConfig.value;
  const mcp = isRecord(parsed.mcp) ? parsed.mcp : {};
  const server = isRecord(mcp["openskill-kit"]) ? mcp["openskill-kit"] : undefined;
  const commandValue = server?.command;
  const command = Array.isArray(commandValue) && typeof commandValue[0] === "string"
    ? commandValue[0]
    : typeof commandValue === "string"
      ? commandValue
      : undefined;
  const environment = isRecord(server?.environment) ? server.environment : {};
  const attached = inspectAttachedServer(root, host, destination, { command, projectRootBound: environment[AGENT_PLUGIN_PROJECT_ROOT_ENV] === root, serverPresent: Boolean(server) }, plugin, receipts);
  if (attached.status !== "attached") return attached;
  const pluginList = openCodePluginList(parsed.plugin);
  if (pluginList.issue || !pluginList.items.includes(OPENCODE_PLUGIN_PATH)) {
    return {
      ...attached,
      status: "plugin-missing",
      issue: pluginList.issue ?? `OpenCode plugin list missing ${OPENCODE_PLUGIN_PATH}`
    };
  }
  return attached;
}

async function planCodexTomlConfig(destination: string, command: string, projectRoot: string): Promise<AgentPluginAttachFile> {
  const existing = await fs.readFile(destination, "utf8").catch(() => undefined);
  const before = existing ?? "";
  const section = renderCodexTomlMcpSection(command, projectRoot);
  const after = replaceCodexTomlMcpSection(before, section);
  return {
    destination,
    action: existing === undefined ? "create" : before === after ? "unchanged" : "update",
    preview: after,
    diff: unifiedDiff(destination, before, after)
  };
}

function renderCodexTomlMcpSection(command: string, projectRoot: string): string {
  return [
    '[mcp_servers."openskill-kit"]',
    `command = ${tomlString(command)}`,
    `env = { ${AGENT_PLUGIN_PROJECT_ROOT_ENV} = ${tomlString(projectRoot)} }`
  ].join("\n");
}

function replaceCodexTomlMcpSection(existing: string, section: string): string {
  const normalized = existing.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const start = lines.findIndex(isCodexOskMcpHeader);
  if (start === -1) {
    const prefix = normalized.trimEnd();
    return `${prefix ? `${prefix}\n\n` : ""}${section}\n`;
  }
  let end = start + 1;
  while (end < lines.length && (!isTomlTableHeader(lines[end]!) || isCodexOskMcpNestedHeader(lines[end]!))) end += 1;
  const next = [
    ...lines.slice(0, start),
    ...section.split("\n"),
    ...lines.slice(end)
  ].join("\n").replace(/\n*$/, "\n");
  return next;
}

function parseCodexTomlMcpServer(content: string, projectRoot: string): { command?: string; projectRootBound: boolean } {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex(isCodexOskMcpHeader);
  if (start === -1) return { projectRootBound: false };
  let end = start + 1;
  while (end < lines.length && (!isTomlTableHeader(lines[end]!) || isCodexOskMcpNestedHeader(lines[end]!))) end += 1;
  const section = lines.slice(start + 1, end).join("\n");
  const commandMatch = section.match(/^\s*command\s*=\s*("(?:\\.|[^"])*")\s*$/m);
  return {
    command: commandMatch ? parseTomlString(commandMatch[1]!) : undefined,
    projectRootBound: section.includes(`${AGENT_PLUGIN_PROJECT_ROOT_ENV} = ${tomlString(projectRoot)}`)
  };
}

function isTomlTableHeader(line: string): boolean {
  return /^\s*\[/.test(line);
}

function isCodexOskMcpHeader(line: string): boolean {
  return /^\s*\[mcp_servers\.(?:"openskill-kit"|openskill-kit)\]\s*$/.test(line);
}

function isCodexOskMcpNestedHeader(line: string): boolean {
  return /^\s*\[mcp_servers\.(?:"openskill-kit"|openskill-kit)\.[^\]]+\]\s*$/.test(line);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function parseTomlString(value: string): string | undefined {
  try {
    return JSON.parse(value) as string;
  } catch {
    return undefined;
  }
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

function openCodePluginList(value: unknown): { items: string[]; issue?: string } {
  if (value === undefined) return { items: [] };
  if (typeof value === "string") return { items: [value] };
  if (!Array.isArray(value)) return { items: [], issue: "Existing OpenCode plugin config must be a string or string array." };
  if (!value.every((item) => typeof item === "string")) return { items: [], issue: "Existing OpenCode plugin array contains non-string entries." };
  return { items: [...new Set(value)] };
}
