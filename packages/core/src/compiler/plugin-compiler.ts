import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";

export interface CompilePluginResult {
  schemaVersion: "openskill-kit.plugin.v1";
  pluginDir: string;
  manifestPath: string;
  files: string[];
}

export interface AgentPluginManifest {
  schemaVersion: "openskill-kit.agent-plugin.v1";
  name: string;
  version: string;
  displayName: string;
  description: string;
  generatedBy: "openskill-kit";
  generatedAt: string;
  compatibility: string[];
  capabilities: string[];
  skills: string[];
  entrypoints: {
    skillDirectory: string;
    mcpConfig: string;
    mcpDescriptors: string;
    mcpDescriptorHashes: string;
    mcpServer: {
      command: string;
      transport: "stdio";
      workingDirectory: string;
    };
    hooks: string;
    behavior: string;
  };
  install: {
    defaultMode: "attach";
    steps: string[];
    requiresExplicitApproval: string[];
  };
  privacy: {
    localFirst: true;
    excludes: string[];
    neverIncludes: string[];
    notes: string[];
  };
  integrity: {
    algorithm: "sha256";
    descriptorHashes: string;
    descriptorsHash?: string;
  };
  files: string[];
}

export interface CompiledPluginStatus {
  schemaVersion: "openskill-kit.compiled-plugin-status.v1";
  ready: boolean;
  pluginDir: string;
  manifestPath: string;
  agentPluginManifestPath: string;
  mcpAttachmentPath: string;
  mcpDescriptorPath: string;
  mcpDescriptorHashPath: string;
  mcpServerCommand: string;
  mcpDescriptorsHash?: string;
  manifest?: AgentPluginManifest;
  skills: string[];
  capabilities: string[];
  approvalGates: string[];
  privacyExclusions: string[];
  missing: string[];
  integrityIssues: string[];
  nextActions: string[];
}

export async function compileAgentPlugin(projectRoot: string): Promise<CompilePluginResult> {
  const root = path.resolve(projectRoot);
  const pluginDir = path.join(root, ".openskill-kit", "compiled", "plugin");
  const manifestPath = path.join(pluginDir, "plugin.json");
  await copyIfExists(path.join(root, ".openskill-kit", "compiled", "skills"), path.join(pluginDir, "skills"));
  await copyIfExists(path.join(root, ".openskill-kit", "compiled", "behavior"), path.join(pluginDir, "behavior"));
  await copyIfExists(path.join(root, ".openskill-kit", "compiled", "hooks"), path.join(pluginDir, "hooks"));
  await copyIfExists(path.join(root, ".openskill-kit", "compiled", "mcp"), path.join(pluginDir, "mcp"));
  const manifest = await buildManifest(pluginDir);
  await writeFileAtomic(path.join(pluginDir, "README.md"), renderReadme(manifest));
  await writeJsonAtomic(path.join(pluginDir, ".mcp.json"), buildMcpAttachmentConfig());
  manifest.files = [...new Set([...(await listFiles(pluginDir)).filter((file) => file !== "plugin.json"), ".agent-plugin/plugin.json"])].sort();
  await writeJsonAtomic(manifestPath, manifest);
  await writeJsonAtomic(path.join(pluginDir, ".agent-plugin", "plugin.json"), manifest);
  const files = await listFiles(pluginDir);
  return { schemaVersion: "openskill-kit.plugin.v1", pluginDir, manifestPath, files };
}

export async function getCompiledPluginStatus(projectRoot: string): Promise<CompiledPluginStatus> {
  const root = path.resolve(projectRoot);
  const pluginDir = path.join(root, ".openskill-kit", "compiled", "plugin");
  const manifestPath = path.join(pluginDir, "plugin.json");
  const agentPluginManifestPath = path.join(pluginDir, ".agent-plugin", "plugin.json");
  const mcpAttachmentPath = path.join(pluginDir, ".mcp.json");
  const mcpDescriptorPath = path.join(pluginDir, "mcp", "descriptors.json");
  const mcpDescriptorHashPath = path.join(pluginDir, "mcp", "descriptor-hashes.json");
  const manifest = await readJson<AgentPluginManifest>(manifestPath).catch(() => undefined);
  const agentManifest = await readJson<AgentPluginManifest>(agentPluginManifestPath).catch(() => undefined);
  const mcpAttachment = await readJson<{ mcpServers?: Record<string, { command?: string }> }>(mcpAttachmentPath).catch(() => undefined);
  const mcpHashes = await readJson<{ descriptorsHash?: string }>(mcpDescriptorHashPath).catch(() => undefined);
  const mcpDescriptors = await readJson<unknown>(mcpDescriptorPath).catch(() => undefined);
  const mcpServerConfigExists = await exists(path.join(pluginDir, "mcp", "server-config.json"));
  const missing = [
    ...(manifest ? [] : ["plugin.json"]),
    ...(agentManifest ? [] : [".agent-plugin/plugin.json"]),
    ...(mcpAttachment ? [] : [".mcp.json"]),
    ...(!manifest?.skills?.length ? ["skills"] : []),
    ...(mcpServerConfigExists ? [] : ["mcp/server-config.json"]),
    ...(mcpDescriptors ? [] : ["mcp/descriptors.json"]),
    ...(mcpHashes ? [] : ["mcp/descriptor-hashes.json"])
  ];
  const actualDescriptorsHash = mcpDescriptors ? sha256Stable(mcpDescriptors) : undefined;
  const integrityIssues = [
    ...(manifest && agentManifest && stableJson(manifest) !== stableJson(agentManifest) ? [".agent-plugin/plugin.json does not match plugin.json"] : []),
    ...(manifest?.integrity.descriptorsHash && mcpHashes?.descriptorsHash && manifest.integrity.descriptorsHash !== mcpHashes.descriptorsHash ? ["plugin.json descriptor hash does not match mcp/descriptor-hashes.json"] : []),
    ...(actualDescriptorsHash && mcpHashes?.descriptorsHash && actualDescriptorsHash !== mcpHashes.descriptorsHash ? ["mcp/descriptors.json hash does not match mcp/descriptor-hashes.json"] : [])
  ];
  return {
    schemaVersion: "openskill-kit.compiled-plugin-status.v1",
    ready: missing.length === 0 && integrityIssues.length === 0,
    pluginDir,
    manifestPath,
    agentPluginManifestPath,
    mcpAttachmentPath,
    mcpDescriptorPath,
    mcpDescriptorHashPath,
    mcpServerCommand: mcpAttachment?.mcpServers?.["openskill-kit"]?.command ?? manifest?.entrypoints.mcpServer.command ?? "openskill-kit-mcp",
    mcpDescriptorsHash: mcpHashes?.descriptorsHash ?? manifest?.integrity.descriptorsHash,
    manifest,
    skills: manifest?.skills ?? [],
    capabilities: manifest?.capabilities ?? [],
    approvalGates: manifest?.install.requiresExplicitApproval ?? [],
    privacyExclusions: manifest?.privacy.excludes ?? [],
    missing,
    integrityIssues,
    nextActions: missing.length
      ? ["Run `openskill-kit compile --target plugin` before attaching OpenSkillKit to a coding harness."]
      : integrityIssues.length
        ? ["Re-run `openskill-kit compile --target plugin`; compiled plugin integrity check failed."]
      : [
        "Attach `.openskill-kit/compiled/plugin/` as the local plugin directory.",
        "Start `openskill-kit-mcp` from the project root when the harness supports MCP.",
        "Keep hooks, global instruction writes, interaction imports, and behavior pack imports behind explicit approval."
      ]
  };
}

async function buildManifest(pluginDir: string): Promise<AgentPluginManifest> {
  const filesBeforeManifest = await listFiles(pluginDir);
  return {
    schemaVersion: "openskill-kit.agent-plugin.v1",
    name: "openskillkit-project-behavior",
    version: "0.1.0",
    displayName: "OpenSkillKit Project Behavior",
    description: "Attachable local-first behavior layer for existing coding harnesses.",
    generatedBy: "openskill-kit",
    generatedAt: new Date().toISOString(),
    compatibility: ["agent-plugin", "mcp-stdio", "agents-md", "codex", "claude-code"],
    capabilities: [
      "project-behavior-retrieval",
      "evidence-backed-preferences",
      "managed-instruction-preview",
      "local-mcp-tools",
      "explicit-hook-install",
      "behavior-pack-review"
    ],
    skills: await pluginSkillRefs(pluginDir),
    entrypoints: {
      skillDirectory: "skills",
      mcpConfig: "mcp/server-config.json",
      mcpDescriptors: "mcp/descriptors.json",
      mcpDescriptorHashes: "mcp/descriptor-hashes.json",
      mcpServer: {
        command: "openskill-kit-mcp",
        transport: "stdio",
        workingDirectory: "."
      },
      hooks: "hooks/hooks.json",
      behavior: "behavior"
    },
    install: {
      defaultMode: "attach",
      steps: [
        "Attach this directory as a local plugin from the project root.",
        "Load `skills/` as repository-scoped skills.",
        "Start `openskill-kit-mcp` with stdio from the project root when the harness supports MCP.",
        "Preview hooks and managed instruction files before applying them."
      ],
      requiresExplicitApproval: [
        "writing global/user agent instructions",
        "enabling hooks or command execution",
        "importing interaction exports or private memories",
        "installing behavior packs from another project"
      ]
    },
    privacy: {
      localFirst: true,
      excludes: [
        ".openskill-kit/events/",
        ".openskill-kit/interactions/",
        ".openskill-kit/signals/",
        ".openskill-kit/evidence/blobs/",
        ".openskill-kit/reviews/",
        ".openskill-kit/evals/runs/",
        ".openskill-kit/private-vault/"
      ],
      neverIncludes: [
        "raw prompts",
        "raw diffs",
        "secrets",
        "user/global memories",
        "hidden benchmark answers"
      ],
      notes: [
        "Generated plugin artifacts are shareable only after normal leak checks and review.",
        "Private workflow evidence stays in project state and is not copied into this plugin output."
      ]
    },
    integrity: {
      algorithm: "sha256",
      descriptorHashes: "mcp/descriptor-hashes.json",
      descriptorsHash: await readJson<{ descriptorsHash?: string }>(path.join(pluginDir, "mcp", "descriptor-hashes.json")).then((value) => value.descriptorsHash).catch(() => undefined)
    },
    files: filesBeforeManifest.filter((file) => file !== "plugin.json").sort()
  };
}

async function pluginSkillRefs(pluginDir: string): Promise<string[]> {
  const skillsDir = path.join(pluginDir, "skills");
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => `skills/${entry.name}`).sort();
}

function renderReadme(manifest: AgentPluginManifest): string {
  return [
    "# OpenSkillKit Agent Plugin",
    "",
    manifest.description,
    "",
    "## Attach",
    "",
    ...manifest.install.steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Entrypoints",
    "",
    `- Skills: \`${manifest.entrypoints.skillDirectory}\``,
    `- MCP config: \`${manifest.entrypoints.mcpConfig}\``,
    `- MCP descriptors: \`${manifest.entrypoints.mcpDescriptors}\``,
    `- MCP descriptor hashes: \`${manifest.entrypoints.mcpDescriptorHashes}\``,
    `- MCP server: \`${manifest.entrypoints.mcpServer.command}\` (${manifest.entrypoints.mcpServer.transport})`,
    `- Hooks: \`${manifest.entrypoints.hooks}\``,
    `- Behavior artifacts: \`${manifest.entrypoints.behavior}\``,
    "",
    "## Approval Gates",
    "",
    ...manifest.install.requiresExplicitApproval.map((item) => `- ${item}`),
    "",
    "## Privacy",
    "",
    "This bundle excludes private event logs, raw signals, raw prompts, raw diffs, review queues, and private evidence blobs.",
    "",
    "Never attach hidden benchmark answers, secrets, user/global memories, or raw interaction exports through this plugin.",
    ""
  ].join("\n");
}

function buildMcpAttachmentConfig(): unknown {
  return {
    mcpServers: {
      "openskill-kit": {
        command: "openskill-kit-mcp"
      }
    }
  };
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  }
  await walk(root);
  return out.sort();
}

async function copyIfExists(source: string, destination: string): Promise<void> {
  try {
    await fs.cp(source, destination, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(() => true).catch(() => false);
}

function sha256Stable(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
