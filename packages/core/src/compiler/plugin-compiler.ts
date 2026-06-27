import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { OSK_PUBLIC_COMMAND_FAMILIES, pluginCommandProjections, type OskCommandFamily } from "../commands/families.js";
import { readOrCreateModelRouting, resolveModelRouting, type ModelRouteName, type ResolvedModelRouting } from "../config/model-routing.js";
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
  hostCompatibility: AgentPluginHostCompatibility[];
  capabilities: string[];
  skills: string[];
  entrypoints: {
    skillDirectory: string;
    commands: string;
    commandGuide: string;
    installGuides: string;
    mcpConfig: string;
    mcpDescriptors: string;
    mcpPublicDescriptors: string;
    mcpProfiles: string;
    mcpDescriptorHashes: string;
    mcpServer: {
      command: string;
      transport: "stdio";
      workingDirectory: string;
    };
    hooks: string;
    behavior: string;
  };
  installProfile: AgentPluginInstallProfile;
  commands: AgentPluginCommand[];
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

export interface AgentPluginInstallProfile {
  schemaVersion: "openskill-kit.agent-plugin-install-profile.v1";
  mode: "local-project-plugin";
  pluginDirectory: string;
  firstCall: {
    mcpTool: string;
    cliFallback: string;
  };
  mcp: {
    serverName: string;
    command: string;
    transport: "stdio";
    workingDirectory: string;
    requiredEnv: Record<string, string>;
    configFile: string;
    descriptors: string;
    publicDescriptors: string;
    profiles: string;
    defaultProfile: "public" | "advanced";
    descriptorHashes: string;
  };
  commandRouting: {
    map: string;
    guide: string;
    prefer: "mcp";
    fallback: "cli";
  };
  approvalRequiredTools: string[];
  readOnlyFirstTools: string[];
  attach: {
    previewCli: string;
    applyCli: string;
    statusCli: string;
  };
  hostConfig: Array<{
    host: AgentPluginHostCompatibility["host"];
    configPath: string;
    configFormat: "codex-toml" | "mcp-json" | "opencode-json";
    supportLevel: AgentPluginHostCompatibility["supportLevel"];
    previewCli: string;
    applyCli: string;
    statusCli: string;
  }>;
}

export interface AgentPluginCommand {
  command: string;
  aliases: string[];
  description: string;
  mcpTool?: string;
  cli: string;
  readOnly: boolean;
  approvalRequired: boolean;
  fallback: "cli";
  visibility?: string;
  familyId?: string;
}

export interface AgentPluginHostCompatibility {
  host: "opencode" | "codex" | "claude-code" | "cursor" | "generic-mcp";
  supportLevel: "supported" | "preview";
  requires: string[];
  configPath: string;
  instructionSurface: string;
  notes: string[];
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
  commandMapPath: string;
  commandGuidePath: string;
  installGuidesPath: string;
  mcpServerCommand: string;
  mcpDescriptorsHash?: string;
  manifest?: AgentPluginManifest;
  commands: AgentPluginCommand[];
  skills: string[];
  capabilities: string[];
  hostCompatibility: AgentPluginHostCompatibility[];
  installProfile?: AgentPluginInstallProfile;
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
  await fs.rm(pluginDir, { recursive: true, force: true });
  await copyIfExists(path.join(root, ".openskill-kit", "compiled", "skills"), path.join(pluginDir, "skills"));
  await copyIfExists(path.join(root, ".openskill-kit", "compiled", "behavior"), path.join(pluginDir, "behavior"));
  await copyIfExists(path.join(root, ".openskill-kit", "compiled", "hooks"), path.join(pluginDir, "hooks"));
  await copyIfExists(path.join(root, ".openskill-kit", "compiled", "mcp"), path.join(pluginDir, "mcp"));
  const manifest = await buildManifest(pluginDir);
  await writeJsonAtomic(path.join(pluginDir, "commands", "commands.json"), {
    schemaVersion: "openskill-kit.command-map.v1",
    routing: "prefer MCP tools when available; otherwise run the CLI fallback from the project root",
    publicFamilyCount: OSK_PUBLIC_COMMAND_FAMILIES.length,
    commands: manifest.commands
  });
  await writeFileAtomic(path.join(pluginDir, "commands", "osk.md"), renderCommandGuide(manifest));
  await writeJsonAtomic(path.join(pluginDir, "commands", "families.json"), {
    schemaVersion: "openskill-kit.command-families.v1",
    publicFamilyCount: OSK_PUBLIC_COMMAND_FAMILIES.length,
    families: OSK_PUBLIC_COMMAND_FAMILIES
  });
  const modelRouting = await readOrCreateModelRouting(root);
  const resolvedModelRouting = resolveModelRouting({
    routing: modelRouting.routing,
    sourcePath: path.relative(root, modelRouting.path).replace(/\\/g, "/"),
    harness: "opencode"
  });
  await writeJsonAtomic(path.join(pluginDir, "model-routing.resolved.json"), resolvedModelRouting);
  await writeOpenCodeArtifacts(pluginDir, OSK_PUBLIC_COMMAND_FAMILIES, resolvedModelRouting);
  for (const guide of pluginInstallGuides()) {
    await writeFileAtomic(path.join(pluginDir, "install-guides", guide.file), renderInstallGuide(guide));
  }
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
  const commandMapPath = path.join(pluginDir, "commands", "commands.json");
  const commandGuidePath = path.join(pluginDir, "commands", "osk.md");
  const installGuidesPath = path.join(pluginDir, "install-guides");
  const manifest = await readJson<AgentPluginManifest>(manifestPath).catch(() => undefined);
  const agentManifest = await readJson<AgentPluginManifest>(agentPluginManifestPath).catch(() => undefined);
  const mcpAttachment = await readJson<{ mcpServers?: Record<string, { command?: string }> }>(mcpAttachmentPath).catch(() => undefined);
  const mcpHashes = await readJson<{ descriptorsHash?: string }>(mcpDescriptorHashPath).catch(() => undefined);
  const mcpDescriptors = await readJson<unknown>(mcpDescriptorPath).catch(() => undefined);
  const mcpPublicDescriptors = await readJson<unknown>(path.join(pluginDir, "mcp", "descriptors.public.json")).catch(() => undefined);
  const mcpProfiles = await readJson<unknown>(path.join(pluginDir, "mcp", "profiles.json")).catch(() => undefined);
  const commandMap = await readJson<{ commands?: AgentPluginCommand[] }>(commandMapPath).catch(() => undefined);
  const commandGuideExists = await exists(commandGuidePath);
  const guideFiles = pluginInstallGuides().map((guide) => path.join(installGuidesPath, guide.file));
  const missingGuides = (await Promise.all(guideFiles.map(async (file, index) => await exists(file) ? undefined : `install-guides/${pluginInstallGuides()[index]!.file}`))).filter(Boolean) as string[];
  const mcpServerConfigExists = await exists(path.join(pluginDir, "mcp", "server-config.json"));
  const missing = [
    ...(manifest ? [] : ["plugin.json"]),
    ...(agentManifest ? [] : [".agent-plugin/plugin.json"]),
    ...(mcpAttachment ? [] : [".mcp.json"]),
    ...(!manifest?.skills?.length ? ["skills"] : []),
    ...(mcpServerConfigExists ? [] : ["mcp/server-config.json"]),
    ...(mcpDescriptors ? [] : ["mcp/descriptors.json"]),
    ...(mcpPublicDescriptors ? [] : ["mcp/descriptors.public.json"]),
    ...(mcpProfiles ? [] : ["mcp/profiles.json"]),
    ...(mcpHashes ? [] : ["mcp/descriptor-hashes.json"]),
    ...(commandMap?.commands?.length ? [] : ["commands/commands.json"]),
    ...(commandGuideExists ? [] : ["commands/osk.md"]),
    ...missingGuides
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
    commandMapPath,
    commandGuidePath,
    installGuidesPath,
    mcpServerCommand: mcpAttachment?.mcpServers?.["openskill-kit"]?.command ?? manifest?.entrypoints.mcpServer.command ?? "openskill-kit-mcp",
    mcpDescriptorsHash: mcpHashes?.descriptorsHash ?? manifest?.integrity.descriptorsHash,
    manifest,
    commands: commandMap?.commands ?? manifest?.commands ?? [],
    skills: manifest?.skills ?? [],
    capabilities: manifest?.capabilities ?? [],
    hostCompatibility: manifest?.hostCompatibility ?? [],
    installProfile: manifest?.installProfile,
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
        "Check `plugin.hostCompatibility` for the target harness requirements before applying host config.",
        "Open `install-guides/` for the target harness before writing any host config.",
        "Map `/osk ...` requests through `commands/commands.json`; prefer MCP tools and use CLI fallbacks only when MCP is unavailable.",
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
    compatibility: ["agent-plugin", "mcp-stdio", "agents-md", "opencode", "codex", "claude-code"],
    hostCompatibility: pluginHostCompatibility(),
    capabilities: [
      "project-behavior-retrieval",
      "evidence-backed-preferences",
      "managed-instruction-preview",
      "local-mcp-tools",
      "explicit-hook-install",
      "behavior-pack-review",
      "openworld-review-promotion"
    ],
    skills: await pluginSkillRefs(pluginDir),
    entrypoints: {
      skillDirectory: "skills",
      commands: "commands/commands.json",
      commandGuide: "commands/osk.md",
      installGuides: "install-guides",
      mcpConfig: "mcp/server-config.json",
      mcpDescriptors: "mcp/descriptors.json",
      mcpPublicDescriptors: "mcp/descriptors.public.json",
      mcpProfiles: "mcp/profiles.json",
      mcpDescriptorHashes: "mcp/descriptor-hashes.json",
      mcpServer: {
        command: "openskill-kit-mcp",
        transport: "stdio",
        workingDirectory: "."
      },
      hooks: "hooks/hooks.json",
      behavior: "behavior"
    },
    installProfile: buildInstallProfile(pluginHostCompatibility()),
    commands: pluginCommands(),
    install: {
      defaultMode: "attach",
      steps: [
        "Attach this directory as a local plugin from the project root.",
        "Read the matching file under `install-guides/` for OpenCode, Codex, Claude Code, Cursor, or generic MCP hosts.",
        "Load `skills/` as repository-scoped skills.",
        "Map `/osk ...` requests using `commands/commands.json`; prefer MCP tools and fall back to CLI commands.",
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

function buildInstallProfile(hostCompatibility: AgentPluginHostCompatibility[]): AgentPluginInstallProfile {
  return {
    schemaVersion: "openskill-kit.agent-plugin-install-profile.v1",
    mode: "local-project-plugin",
    pluginDirectory: ".openskill-kit/compiled/plugin",
    firstCall: {
      mcpTool: "osk_bootstrap_session",
      cliFallback: "openskill-kit status --json"
    },
    mcp: {
      serverName: "openskill-kit",
      command: "openskill-kit-mcp",
      transport: "stdio",
      workingDirectory: ".",
      requiredEnv: {
        OPENSKILLKIT_PROJECT_ROOT: "<absolute project root>"
      },
      configFile: ".mcp.json",
      descriptors: "mcp/descriptors.json",
      publicDescriptors: "mcp/descriptors.public.json",
      profiles: "mcp/profiles.json",
      defaultProfile: "public",
      descriptorHashes: "mcp/descriptor-hashes.json"
    },
    commandRouting: {
      map: "commands/commands.json",
      guide: "commands/osk.md",
      prefer: "mcp",
      fallback: "cli"
    },
    approvalRequiredTools: pluginCommands().filter((item) => item.approvalRequired && item.mcpTool).map((item) => item.mcpTool!),
    readOnlyFirstTools: ["osk_bootstrap_session", "osk_detect_environment", "osk_get_plugin_attach_status", "osk_get_plugin_install_profile", "osk_get_agent_task_context"],
    attach: {
      previewCli: "openskill-kit agent attach-plugin --host generic-mcp --dry-run",
      applyCli: "openskill-kit agent attach-plugin --host generic-mcp --yes",
      statusCli: "openskill-kit agent plugin-status --json"
    },
    hostConfig: hostCompatibility.map((host) => ({
      host: host.host,
      configPath: host.configPath,
      configFormat: host.host === "codex" ? "codex-toml" : host.host === "opencode" ? "opencode-json" : "mcp-json",
      supportLevel: host.supportLevel,
      previewCli: `openskill-kit agent attach-plugin --host ${host.host} --dry-run`,
      applyCli: `openskill-kit agent attach-plugin --host ${host.host} --yes`,
      statusCli: "openskill-kit agent plugin-status --json"
    }))
  };
}

async function pluginSkillRefs(pluginDir: string): Promise<string[]> {
  const skillsDir = path.join(pluginDir, "skills");
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => `skills/${entry.name}`).sort();
}

function pluginHostCompatibility(): AgentPluginHostCompatibility[] {
  return [
    {
      host: "opencode",
      supportLevel: "supported",
      requires: ["project `.opencode/commands` support", "project `.opencode/plugins` support", "project `.opencode/skills` support", "stdio MCP client support", "agent/subagent config support"],
      configPath: "opencode.json",
      instructionSurface: ".opencode/commands, .opencode/skills, .opencode/agents, .opencode/plugins, AGENTS.md",
      notes: [
        "Primary launch target; full feature set lives here first.",
        "OpenSkillKit writes project-local OpenCode config only after dry-run preview."
      ]
    },
    {
      host: "codex",
      supportLevel: "supported",
      requires: ["stdio MCP client support", "project-local `.codex/config.toml` support", "repository AGENTS.md instruction surface"],
      configPath: ".codex/config.toml",
      instructionSurface: "AGENTS.md",
      notes: ["Use project-local config first; never import user Codex memories unless the user supplies an explicit export file."]
    },
    {
      host: "claude-code",
      supportLevel: "supported",
      requires: ["stdio MCP client support", "project-local MCP config support", "project CLAUDE.md or project skill/rule loading"],
      configPath: ".mcp.json",
      instructionSurface: "CLAUDE.md and .claude/rules/",
      notes: ["Preview project rules before applying; user-level Claude memory is not a plugin target."]
    },
    {
      host: "cursor",
      supportLevel: "preview",
      requires: ["Cursor MCP server config support", "project-local `.cursor/mcp.json` support", "manual confirmation for Cursor rule format"],
      configPath: ".cursor/mcp.json",
      instructionSurface: ".cursor/rules/",
      notes: ["Cursor rule formats can vary; OpenSkillKit writes MCP config only through attach preview/apply."]
    },
    {
      host: "generic-mcp",
      supportLevel: "supported",
      requires: ["stdio MCP client support", "working directory or OPENSKILLKIT_PROJECT_ROOT bound to the project root"],
      configPath: ".mcp.json",
      instructionSurface: "skills/ and commands/commands.json",
      notes: ["Call osk_bootstrap_session first and compare descriptor hashes before trusting tool descriptors."]
    }
  ];
}

interface PluginInstallGuide {
  file: string;
  title: string;
  host: string;
  steps: string[];
  notes: string[];
}

function pluginInstallGuides(): PluginInstallGuide[] {
  return [
    {
      file: "opencode.md",
      title: "OpenCode Attach Guide",
      host: "OpenCode",
      steps: [
        "Compile the plugin with `openskill-kit compile --target plugin`.",
        "Review generated `.opencode/commands`, `.opencode/skills`, `.opencode/agents`, and `.opencode/plugins` under the compiled plugin.",
        "Use `openskill-kit agent attach-plugin --host opencode --dry-run` to preview the MCP entry in `opencode.json` and copied `.opencode/*` project files.",
        "Apply with `--yes` only after reviewing the diff, then restart OpenCode.",
        "Run `/osk status` before relying on learned behavior."
      ],
      notes: [
        "OpenCode is the primary full-feature target for command files, skills, learner subagent, project plugin hooks, and MCP.",
        "OpenSkillKit preserves the user's `plugin` list; generated project plugins are copied into `.opencode/plugins` instead of injected into `opencode.json`.",
        "Generated hooks store metadata only by default and never raw prompts or raw diffs."
      ]
    },
    {
      file: "codex.md",
      title: "Codex Attach Guide",
      host: "Codex",
      steps: [
        "Attach this directory as a local plugin when the harness supports plugin directories.",
        "Keep `AGENTS.md` behavior managed through `openskill-kit agent install-manifests --target project --dry-run` before applying.",
        "Use `openskill-kit agent attach-plugin --host codex --dry-run` to preview the project `.codex/config.toml` MCP section.",
        "Route `/osk ...` phrases through `commands/commands.json`."
      ],
      notes: [
        "Do not import Codex memories or user-level instructions unless the user explicitly asks.",
        "Project `AGENTS.md` remains the safest shared instruction surface."
      ]
    },
    {
      file: "claude-code.md",
      title: "Claude Code Attach Guide",
      host: "Claude Code",
      steps: [
        "Load `skills/` or install the project behavior skill where Claude Code can read project skills.",
        "Preview `CLAUDE.md` and `.claude/rules/` with `openskill-kit agent install-manifests --target project --dry-run` before applying.",
        "Configure MCP to run `openskill-kit-mcp` from the project root.",
        "Route `/osk ...` phrases through `commands/commands.json`."
      ],
      notes: [
        "Never edit user-level Claude memory silently.",
        "Hooks stay preview-only until the user approves install."
      ]
    },
    {
      file: "cursor.md",
      title: "Cursor Attach Guide",
      host: "Cursor",
      steps: [
        "Use `.mcp.json` or Cursor MCP config to start `openskill-kit-mcp` from the project root.",
        "Treat `.cursor/rules` as preview-only unless the user confirms the desired rule format.",
        "Read `commands/commands.json` to map `/osk ...` phrases to MCP tools or CLI fallback.",
        "Use `openskill-kit detect --json` before writing any existing Cursor config."
      ],
      notes: [
        "Cursor rule formats can vary by project; do not overwrite existing rules automatically.",
        "Keep OpenSkillKit generated behavior under the compiled plugin until user approves integration."
      ]
    },
    {
      file: "generic-mcp.md",
      title: "Generic MCP Attach Guide",
      host: "Generic MCP client",
      steps: [
        "Register `openskill-kit-mcp` as a stdio MCP server with working directory set to the project root.",
        "Call `osk_bootstrap_session` first.",
        "Check `plugin.ready`, `plugin.integrityIssues`, and `plugin.missing` before trusting generated artifacts.",
        "Use `commands/commands.json` for `/osk ...` intent mapping."
      ],
      notes: [
        "Compare descriptor hashes before trusting tools.",
        "Approval-required tools must stay behind explicit user confirmation."
      ]
    }
  ];
}

function pluginCommands(): AgentPluginCommand[] {
  return pluginCommandProjections().map((item) => ({ ...item }));
}

async function writeOpenCodeArtifacts(pluginDir: string, families: OskCommandFamily[], modelRouting: ResolvedModelRouting): Promise<void> {
  const root = path.join(pluginDir, "opencode");
  const commandDir = path.join(root, "commands");
  const agentDir = path.join(root, "agents");
  const skillDir = path.join(root, "skills");
  const pluginDirOut = path.join(root, "plugins");
  for (const family of families) {
    await writeFileAtomic(path.join(commandDir, family.commandFile), renderOpenCodeCommand(family));
  }
  const agents = openCodeAgents(modelRouting);
  for (const agent of agents) {
    await writeFileAtomic(path.join(agentDir, `${agent.id}.md`), renderOpenCodeAgent(agent));
  }
  for (const skill of openCodeSkills()) {
    await writeFileAtomic(path.join(skillDir, skill.id, "SKILL.md"), renderOpenCodeSkill(skill));
  }
  await writeFileAtomic(path.join(pluginDirOut, "openskillkit.ts"), renderOpenCodePlugin());
  await writeJsonAtomic(path.join(root, "model-routing.json"), {
    schemaVersion: "openskill-kit.model-routing.v1",
    defaultAgent: "osk-router",
    source: modelRouting.sourcePath,
    safety: modelRouting.safety,
    agents: Object.fromEntries(agents.map((agent) => [agent.id, {
      mode: "subagent",
      model: agent.model,
      route: agent.route,
      temperature: agent.temperature,
      maxSteps: agent.maxSteps,
      reasoningEffort: agent.reasoningEffort,
      fallbackModels: agent.fallbackModels,
      permissionsProfile: agent.permissionsProfile,
      permissions: agent.permissions
    }]))
  });
}

function renderOpenCodeCommand(family: OskCommandFamily): string {
  const agent = family.subagents[0] ?? "osk-router";
  return [
    "---",
    `description: ${JSON.stringify(family.oneLine)}`,
    `agent: ${agent}`,
    "subtask: true",
    "---",
    "",
    `# ${family.publicCommand}`,
    "",
    family.userIntent,
    "",
    "## First Call",
    "",
    family.mcpTool
      ? `Call MCP tool \`${family.mcpTool}\` first. If MCP unavailable, run \`${family.cli}\` from project root.`
      : `Run \`${family.cli}\` from project root.`,
    family.mcpTool?.startsWith("osk_run_openworld_workflow") ? `Use action \`${family.id}\` for this command family.` : undefined,
    family.mcpTool === "osk_compile_deploy" ? `Use action \`${family.id}\` for this command family.` : undefined,
    family.mcpTool === "osk_pack_behavior" ? "Use action `export` unless the user asks to verify, inspect, diff, or import a pack." : undefined,
    family.mcpTool === "osk_review_behavior" ? "Use action `queue` unless the user explicitly asks to apply review decisions." : undefined,
    "",
    "## Workflow",
    "",
    ...family.workflowSteps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Safety",
    "",
    `Approval required: ${family.approvalRequired ? "yes" : "no"}.`,
    ...family.neverReads.map((item) => `- Never read ${item}.`),
    ...family.neverWrites.map((item) => `- Never write ${item}.`),
    "",
    "## Return",
    "",
    family.outputSummary,
    ""
  ].filter((line): line is string => line !== undefined).join("\n");
}

interface OpenCodeAgentSpec {
  id: string;
  route: ModelRouteName;
  description: string;
  model: string;
  fallbackModels: string[];
  reasoningEffort?: string;
  temperature?: number;
  maxSteps?: number;
  permissionsProfile?: string;
  permissions: Record<string, "allow" | "ask" | "deny">;
}

function openCodeAgents(modelRouting: ResolvedModelRouting): OpenCodeAgentSpec[] {
  const withRoute = (route: ModelRouteName, id: string, description: string, permissions: OpenCodeAgentSpec["permissions"]): OpenCodeAgentSpec => {
    const modelRoute = modelRouting.routes[route];
    return agent(id, route, description, modelRoute.model, permissions, modelRoute);
  };
  return [
    withRoute("router", "osk-router", "Route OSK commands, read status, and keep context compact.", { read: "allow", list: "allow", grep: "allow", edit: "deny", bash: "deny", question: "ask", webfetch: "deny", websearch: "deny" }),
    withRoute("learner", "osk-learner", "Plan explicit learning sources and run review-gated learning.", { read: "allow", list: "allow", grep: "allow", edit: "deny", bash: "ask", question: "allow", webfetch: "deny", websearch: "deny" }),
    withRoute("reviewer", "osk-reviewer", "Explain and apply behavior review decisions.", { read: "allow", list: "allow", grep: "allow", edit: "deny", bash: "ask", question: "allow", webfetch: "deny", websearch: "deny" }),
    withRoute("researcher", "osk-researcher", "Plan OpenWorld sources and anchors under leakage policy.", { read: "allow", list: "allow", grep: "allow", edit: "deny", bash: "ask", question: "ask", webfetch: "ask", websearch: "deny" }),
    withRoute("evolver", "osk-evolver", "Generate and refine review-only candidate skills.", { read: "allow", list: "allow", grep: "allow", edit: "deny", bash: "ask", question: "ask", webfetch: "deny", websearch: "deny" }),
    withRoute("verifier", "osk-verifier", "Run integrity, privacy, verifier, and proof-boundary checks.", { read: "allow", list: "allow", grep: "allow", edit: "deny", bash: "ask", question: "ask", webfetch: "deny", websearch: "deny" }),
    withRoute("evaluator", "osk-evaluator", "Run replay and external-agent eval workflows.", { read: "allow", list: "allow", grep: "allow", edit: "deny", bash: "ask", question: "ask", webfetch: "deny", websearch: "deny" }),
    withRoute("docs", "osk-docs", "Polish generated OSK documentation with approval for docs edits.", { read: "allow", list: "allow", grep: "allow", edit: "ask", bash: "ask", question: "ask", webfetch: "deny", websearch: "deny" })
  ];
}

function agent(id: string, route: ModelRouteName, description: string, model: string, permissions: OpenCodeAgentSpec["permissions"], modelRoute: ResolvedModelRouting["routes"][ModelRouteName]): OpenCodeAgentSpec {
  return {
    id,
    route,
    description,
    model,
    fallbackModels: modelRoute.fallbackModels,
    reasoningEffort: modelRoute.reasoningEffort,
    temperature: modelRoute.temperature,
    maxSteps: modelRoute.maxSteps,
    permissionsProfile: modelRoute.permissionsProfile,
    permissions
  };
}

function renderOpenCodeAgent(agentSpec: OpenCodeAgentSpec): string {
  return [
    "---",
    `description: ${JSON.stringify(agentSpec.description)}`,
    `model: ${agentSpec.model}`,
    agentSpec.temperature === undefined ? undefined : `temperature: ${agentSpec.temperature}`,
    agentSpec.maxSteps === undefined ? undefined : `steps: ${agentSpec.maxSteps}`,
    agentSpec.reasoningEffort === undefined ? undefined : `reasoning: ${agentSpec.reasoningEffort}`,
    "mode: subagent",
    "permissions:",
    ...Object.entries(agentSpec.permissions).map(([key, value]) => `  ${key}: ${value}`),
    "---",
    "",
    `# ${agentSpec.id}`,
    "",
    agentSpec.description,
    "",
    `Model route: ${agentSpec.route}.`,
    agentSpec.permissionsProfile ? `Permissions profile: ${agentSpec.permissionsProfile}.` : undefined,
    "Use OSK MCP facade tools first. Keep imports, host writes, sandbox runs, and behavior activation behind the approval gates described by the command file.",
    "Never store raw prompts, raw diffs, secrets, user/global memories, or hidden benchmark answers.",
    ""
  ].filter((line): line is string => line !== undefined).join("\n");
}

interface OpenCodeSkillSpec {
  id: string;
  description: string;
  whenToUse: string;
  workflow: string[];
  safety: string[];
}

function openCodeSkills(): OpenCodeSkillSpec[] {
  return [
    {
      id: "osk-operating-manual",
      description: "Route OpenSkillKit command families, MCP calls, and CLI fallbacks safely.",
      whenToUse: "Use for any `/osk ...` request, plugin attach decision, command-family routing, or OSK readiness question.",
      workflow: [
        "Call `osk_bootstrap_session` first when MCP is available.",
        "Route public requests through `commands/commands.json` and the 12 command families.",
        "Use CLI fallbacks only when MCP is unavailable.",
        "Keep deploy/apply operations preview-first until the user approves."
      ],
      safety: [
        "Do not read raw prompts, raw diffs, global memories, shell history, transcripts, or hidden oracle files silently.",
        "Do not activate learned behavior without `/osk review`."
      ]
    },
    {
      id: "osk-learning",
      description: "Plan and run preview-first OpenSkillKit learning from explicit safe sources.",
      whenToUse: "Use for `/osk learn`, interaction import previews, current-session learning, review-note learning, terminal-history files, or git metadata learning.",
      workflow: [
        "List candidate learning sources and their privacy risk.",
        "Ask the user which source to use unless the command already selected one.",
        "Preview imports before apply.",
        "Return a digest with events, signals, candidate preferences, and review next actions."
      ],
      safety: [
        "Explicit imports require approval before events are appended.",
        "Learning produces candidate or staged behavior only; review decides activation."
      ]
    },
    {
      id: "osk-review-gate",
      description: "Keep OpenSkillKit behavior activation behind evidence review.",
      whenToUse: "Use for `/osk review`, behavior activation, rejection, edit, merge, split, workflow decisions, and OpenWorld promotion review.",
      workflow: [
        "Read the review queue and evidence cards.",
        "Explain risk, confidence, and compile impact before action.",
        "Apply only the requested review action.",
        "Recommend `/osk compile` after accepted behavior changes."
      ],
      safety: [
        "Do not treat candidate skills or OpenWorld promotions as active behavior.",
        "Do not merge or activate conflicting behavior without explicit review."
      ]
    },
    {
      id: "osk-openworld",
      description: "Run OpenSkill-style research, evolution, verifier, and proof-boundary workflows.",
      whenToUse: "Use for `/osk research`, `/osk evolve`, `/osk verify`, OpenWorld source plans, anchors, verifier suites, refinement, reports, and promotion proposals.",
      workflow: [
        "Start with leakage checks and source planning.",
        "Use Source Cards and Anchor Cards for provenance.",
        "Run verifier quality and refinement before promotion.",
        "Report proof level and next review action clearly."
      ],
      safety: [
        "Artifact-verifier success is not hidden-oracle benchmark proof.",
        "Do not read denied oracle paths or hidden benchmark answers."
      ]
    }
  ];
}

function renderOpenCodeSkill(skill: OpenCodeSkillSpec): string {
  return [
    "---",
    `name: ${skill.id}`,
    `description: ${skill.description}`,
    "---",
    "",
    `# ${skill.id}`,
    "",
    "## When to use",
    skill.whenToUse,
    "",
    "## Workflow",
    ...skill.workflow.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Safety",
    ...skill.safety.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function renderOpenCodePlugin(): string {
  return [
    "import { App } from \"opencode\";",
    "",
    "export const OpenSkillKitPlugin = async ({ app }: { app: App }) => {",
    "  const emit = async (eventType: string, metadata: Record<string, unknown>) => {",
    "    // Metadata-only by default. Raw prompts, raw diffs, tool output, and secrets stay out.",
    "    app.log?.info?.(\"openskill-kit\", { eventType, metadata });",
    "  };",
    "",
    "  app.on?.(\"session.created\", async (event: unknown) => emit(\"session-start\", safe(event)));",
    "  app.on?.(\"tool.execute.before\", async (event: unknown) => emit(\"pre-tool-use\", safe(event)));",
    "  app.on?.(\"tool.execute.after\", async (event: unknown) => emit(\"post-tool-use\", safe(event)));",
    "  app.on?.(\"file.edited\", async (event: unknown) => emit(\"file-changed\", safe(event)));",
    "  app.on?.(\"permission.asked\", async (event: unknown) => emit(\"permission-request\", safe(event)));",
    "  app.on?.(\"permission.replied\", async (event: unknown) => emit(\"permission-decision\", safe(event)));",
    "  app.on?.(\"session.diff\", async (event: unknown) => emit(\"diff-stats\", safe(event)));",
    "  app.on?.(\"session.idle\", async (event: unknown) => emit(\"finish-task-suggestion\", safe(event)));",
    "  app.on?.(\"tui.command.execute\", async (event: unknown) => emit(\"command-intent\", safe(event)));",
    "};",
    "",
    "function safe(event: unknown): Record<string, unknown> {",
    "  if (!event || typeof event !== \"object\") return {};",
    "  const source = event as Record<string, unknown>;",
    "  const out: Record<string, unknown> = {};",
    "  for (const key of [\"id\", \"type\", \"tool\", \"command\", \"path\", \"status\", \"decision\", \"timestamp\"]) {",
    "    if (key in source) out[key] = source[key];",
    "  }",
    "  return out;",
    "}",
    "",
    "export default OpenSkillKitPlugin;",
    ""
  ].join("\n");
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
    `- Command map: \`${manifest.entrypoints.commands}\``,
    `- Command guide: \`${manifest.entrypoints.commandGuide}\``,
    `- Install guides: \`${manifest.entrypoints.installGuides}\``,
    `- MCP config: \`${manifest.entrypoints.mcpConfig}\``,
    `- MCP descriptors: \`${manifest.entrypoints.mcpDescriptors}\``,
    `- MCP public descriptors: \`${manifest.entrypoints.mcpPublicDescriptors}\``,
    `- MCP profiles: \`${manifest.entrypoints.mcpProfiles}\``,
    `- MCP descriptor hashes: \`${manifest.entrypoints.mcpDescriptorHashes}\``,
    `- MCP server: \`${manifest.entrypoints.mcpServer.command}\` (${manifest.entrypoints.mcpServer.transport})`,
    `- Hooks: \`${manifest.entrypoints.hooks}\``,
    `- Behavior artifacts: \`${manifest.entrypoints.behavior}\``,
    `- Install profile: \`${manifest.installProfile.schemaVersion}\``,
    "",
    "## Install Profile",
    "",
    `- Plugin directory: \`${manifest.installProfile.pluginDirectory}\``,
    `- First MCP call: \`${manifest.installProfile.firstCall.mcpTool}\``,
    `- CLI fallback: \`${manifest.installProfile.firstCall.cliFallback}\``,
    `- MCP server: \`${manifest.installProfile.mcp.serverName}\` -> \`${manifest.installProfile.mcp.command}\``,
    `- MCP default profile: \`${manifest.installProfile.mcp.defaultProfile}\``,
    `- Required env: \`${Object.keys(manifest.installProfile.mcp.requiredEnv).join(", ")}\``,
    `- Command routing: \`${manifest.installProfile.commandRouting.map}\``,
    `- Attach preview: \`${manifest.installProfile.attach.previewCli}\``,
    "",
    "## Host Attach Matrix",
    "",
    ...manifest.installProfile.hostConfig.flatMap((host) => [
      `- ${host.host} (${host.supportLevel}, ${host.configFormat})`,
      `  - Config: \`${host.configPath}\``,
      `  - Preview: \`${host.previewCli}\``,
      `  - Apply: \`${host.applyCli}\``,
      `  - Status: \`${host.statusCli}\``
    ]),
    "",
    "## Commands",
    "",
    "Treat `/osk ...` phrases as harness intents. Prefer the mapped MCP tool when available; otherwise run the CLI fallback from the project root.",
    "",
    ...manifest.commands.map((item) => `- \`${item.command}\` -> ${item.mcpTool ? `MCP \`${item.mcpTool}\`, ` : ""}fallback \`${item.cli}\`${item.approvalRequired ? " (approval required)" : ""}`),
    "",
    "## Host Guides",
    "",
    ...pluginInstallGuides().map((guide) => `- ${guide.host}: \`install-guides/${guide.file}\``),
    "",
    "## Host Compatibility",
    "",
    ...manifest.hostCompatibility.flatMap((host) => [
      `- ${host.host} (${host.supportLevel})`,
      `  - Config: \`${host.configPath}\``,
      `  - Instructions: \`${host.instructionSurface}\``,
      `  - Requires: ${host.requires.join("; ")}`
    ]),
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

function renderInstallGuide(guide: PluginInstallGuide): string {
  return [
    `# ${guide.title}`,
    "",
    `Host: ${guide.host}`,
    "",
    "## Steps",
    "",
    ...guide.steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Safety Notes",
    "",
    ...guide.notes.map((note) => `- ${note}`),
    "",
    "## Required First Call",
    "",
    "Call `osk_bootstrap_session` before using learned behavior. If MCP is unavailable, run `openskill-kit status --json` from the project root.",
    ""
  ].join("\n");
}

function renderCommandGuide(manifest: AgentPluginManifest): string {
  return [
    "# OpenSkillKit Command Map",
    "",
    "When a user writes an `/osk ...` phrase, treat it as an intent for this plugin. Prefer MCP because it returns structured status and readiness data. If MCP is unavailable, run the CLI fallback from the project root.",
    "",
    "Do not enable hooks, write global instructions, import private interactions, or import behavior packs without explicit user approval.",
    "OpenWorld routes are review-only unless an explicit review action later activates behavior; they do not prove hidden-oracle benchmark performance.",
    "",
    "## Commands",
    "",
    ...manifest.commands.flatMap((item) => [
      `### ${item.command}`,
      "",
      item.description,
      "",
      `- MCP tool: \`${item.mcpTool ?? "none; use CLI fallback"}\``,
      `- CLI fallback: \`${item.cli}\``,
      `- Read-only: \`${item.readOnly ? "yes" : "no"}\``,
      `- Explicit approval required: \`${item.approvalRequired ? "yes" : "no"}\``,
      ""
    ])
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
