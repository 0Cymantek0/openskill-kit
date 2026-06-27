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
    commands: string;
    commandGuide: string;
    installGuides: string;
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

export interface AgentPluginCommand {
  command: string;
  aliases: string[];
  description: string;
  mcpTool?: string;
  cli: string;
  readOnly: boolean;
  approvalRequired: boolean;
  fallback: "cli";
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
    commands: manifest.commands
  });
  await writeFileAtomic(path.join(pluginDir, "commands", "osk.md"), renderCommandGuide(manifest));
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
    compatibility: ["agent-plugin", "mcp-stdio", "agents-md", "codex", "claude-code"],
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
      mcpDescriptorHashes: "mcp/descriptor-hashes.json",
      mcpServer: {
        command: "openskill-kit-mcp",
        transport: "stdio",
        workingDirectory: "."
      },
      hooks: "hooks/hooks.json",
      behavior: "behavior"
    },
    commands: pluginCommands(),
    install: {
      defaultMode: "attach",
      steps: [
        "Attach this directory as a local plugin from the project root.",
        "Read the matching file under `install-guides/` for Codex, Claude Code, Cursor, or generic MCP hosts.",
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

async function pluginSkillRefs(pluginDir: string): Promise<string[]> {
  const skillsDir = path.join(pluginDir, "skills");
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => `skills/${entry.name}`).sort();
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
      file: "codex.md",
      title: "Codex Attach Guide",
      host: "Codex",
      steps: [
        "Attach this directory as a local plugin when the harness supports plugin directories.",
        "Keep `AGENTS.md` behavior managed through `openskill-kit agent install-manifests --target project --dry-run` before applying.",
        "Use `.mcp.json` or equivalent Codex MCP config to start `openskill-kit-mcp` from the project root.",
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
  return [
    command("/osk init", ["openskill init", "bootstrap openskill"], "Initialize or bootstrap project behavior state and report plugin readiness.", "osk_bootstrap_session", "openskill-kit init && openskill-kit status", false, false),
    command("/osk status", ["osk status", "openskill status"], "Show learned behavior, compiled artifacts, plugin readiness, and next actions.", "osk_bootstrap_session", "openskill-kit status", true, false),
    command("/osk context", ["osk task context", "openskill context"], "Return route plan, relevant behavior, plugin health, review state, and next actions for the current coding task.", "osk_get_agent_task_context", "openskill-kit context --query \"<task>\"", false, false),
    command("/osk finish task", ["osk task done", "openskill finish task"], "Record safe task outcome evidence, run learning, write session summaries, and return review next actions.", "osk_finish_agent_task", "openskill-kit finish-task --summary \"<safe summary>\"", false, false),
    command("/osk import adapters", ["osk adapters", "openskill import adapters"], "List supported cross-agent import adapters, accepted formats, privacy policy, and adapter status.", "osk_list_interaction_adapters", "openskill-kit interactions adapters", true, false),
    command("/osk import session", ["osk import transcript", "openskill import session"], "Preview or import a cross-agent session/export file as redacted local events; applying requires explicit approval.", "osk_import_interaction_source", "openskill-kit interactions import <path>", false, true),
    command("/osk import review", ["osk import review comments", "openskill import review"], "Preview or import a local review-comment file as redacted review feedback events; applying requires explicit approval.", "osk_import_interaction_source", "openskill-kit interactions import-review <path>", false, true),
    command("/osk import terminal", ["osk import terminal history", "openskill import terminal"], "Preview or import an explicit terminal history file as allowlisted command metadata only; applying requires explicit approval.", "osk_import_interaction_source", "openskill-kit interactions import-terminal <path>", false, true),
    command("/osk session imports", ["osk imports", "openskill imports"], "List previous interaction import runs without raw source content.", "osk_list_interaction_imports", "openskill-kit interactions imports", true, false),
    command("/osk explain import", ["osk import explain", "openskill explain import"], "Explain one interaction import receipt, privacy state, and learning next actions without reading raw source content.", "osk_explain_interaction_import", "openskill-kit interactions explain <run-id>", true, false),
    command("/osk interaction pool", ["osk interactions pool", "openskill interaction pool"], "List normalized cross-agent interaction metadata records without raw source content.", "osk_get_interaction_pool", "openskill-kit interactions pool", true, false),
    command("/osk git context", ["osk git", "openskill git context"], "Inspect local branch, changed files, aggregate diff stats, and recent commits without raw diffs or file contents.", "osk_get_git_local_context", "openskill-kit interactions git-context", true, false),
    command("/osk learn from this session", ["osk learn", "learn this session"], "Extract candidate preferences from captured local events after user approval for any import source.", "osk_learn_from_session", "openskill-kit learn", false, false),
    command("/osk explain why you learned this", ["osk explain", "explain preference"], "Explain a learned preference through sanitized evidence cards.", "osk_explain_preference", "openskill-kit explain <preference-id>", true, false),
    command("/osk review pending behavior", ["osk review", "review behavior"], "Open the review queue for candidate behavior before activation.", "osk_get_review_queue", "openskill-kit review", false, false),
    command("/osk update skills", ["osk compile skills", "update project skills"], "Compile project-scoped skills from active behavior.", "osk_compile_behavior_layer", "openskill-kit compile --target agent-skills", false, false),
    command("/osk update AGENTS.md", ["osk update agents", "compile project rules"], "Preview managed AGENTS/CLAUDE instruction updates.", "osk_compile_behavior_layer", "openskill-kit compile --target project-rules", false, false),
    command("/osk install hooks", ["osk hooks", "install openskill hooks"], "Preview or install local hooks; requires explicit user approval before enabling execution.", "osk_install_agent_hooks", "openskill-kit hooks install --dry-run", false, true),
    command("/osk attach plugin", ["osk attach", "attach openskill plugin"], "Preview host MCP config needed to attach this plugin to an existing coding harness; applying requires explicit approval.", "osk_preview_plugin_attach", "openskill-kit agent attach-plugin --host generic-mcp --dry-run", false, false),
    command("/osk plugin health", ["osk plugin status", "openskill plugin health"], "Show host attachment health for the compiled plugin, including root binding, invalid JSON, and command conflicts.", "osk_get_plugin_attach_status", "openskill-kit agent plugin-status", true, false),
    command("/osk run behavior eval", ["osk eval", "behavior eval"], "Run local behavior replay/evaluation gates and return artifact paths.", "osk_run_behavior_eval", "openskill-kit eval", false, false),
    command("/osk openworld doctor", ["osk ow doctor", "openskill openworld doctor"], "Show which OpenWorld capabilities are real today and which remain unproven.", "osk_openworld_doctor", "openskill-kit openworld doctor", true, false),
    command("/osk openworld source plan", ["osk ow source plan", "openskill openworld source plan"], "Plan leakage-audited local and explicit web source candidates for an OpenWorld task.", "osk_openworld_source_plan", "openskill-kit openworld source-plan --task-id <task-id>", false, false),
    command("/osk openworld build verifier", ["osk ow build verifier", "openskill openworld build verifier"], "Build a leakage-audited visible/holdout verifier suite from Anchor Cards, preserving manual-review anchors and traceable local file assertions.", undefined, "openskill-kit openworld build-verifier --task-id <task-id> --anchor-id <anchor-id>", false, false),
    command("/osk openworld verifier quality", ["osk ow verifier quality", "openskill openworld verifier quality"], "Score a generated OpenWorld verifier suite for traceability, determinism, holdout coverage, source trust, and leakage metadata.", "osk_openworld_verifier_quality", "openskill-kit openworld verifier-quality --task-id <task-id> --suite-id <suite-id>", true, false),
    command("/osk openworld run verifier", ["osk ow run verifier", "openskill openworld run verifier"], "Run a generated OpenWorld verifier split through local-process or opt-in Docker sandbox mode and write execution results.", "osk_openworld_run_verifier", "openskill-kit openworld run-verifier --task-id <task-id> --suite-id <suite-id> --split visible", false, false),
    command("/osk openworld refine", ["osk ow refine", "openskill openworld refine"], "Run bounded visible verifier refinement and final holdout check for a candidate skill.", "osk_openworld_refine", "openskill-kit openworld refine --task-id <task-id> --suite-id <suite-id> --candidate-id <candidate-id>", false, false),
    command("/osk openworld report", ["osk ow report", "openskill openworld report"], "Render task evidence, sources, anchors, verifier runs, eval reports, and remaining proof gaps.", "osk_openworld_task_report", "openskill-kit openworld report --task-id <task-id> --write", false, false),
    command("/osk openworld promote review", ["osk ow promote review", "openskill openworld promote review"], "Create a review-only proposal from a passed OpenWorld run; it never activates behavior directly.", "osk_openworld_promote_review", "openskill-kit openworld promote-review --run-id <run-id> --dry-run", false, true),
    command("/osk evolve this skill", ["osk evolve", "evolve skill"], "Draft, verify, and evaluate a reusable skill from local evidence.", undefined, "openskill-kit evolve \"<topic>\" --no-llm", false, false),
    command("/osk sync project behavior pack", ["osk pack", "sync behavior pack"], "Export or import behavior packs only through review, verification, and trust gates.", "osk_export_behavior_pack", "openskill-kit pack export", false, true)
  ];
}

function command(commandText: string, aliases: string[], description: string, mcpTool: string | undefined, cli: string, readOnly: boolean, approvalRequired: boolean): AgentPluginCommand {
  return {
    command: commandText,
    aliases,
    description,
    mcpTool,
    cli,
    readOnly,
    approvalRequired,
    fallback: "cli"
  };
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
    `- MCP descriptor hashes: \`${manifest.entrypoints.mcpDescriptorHashes}\``,
    `- MCP server: \`${manifest.entrypoints.mcpServer.command}\` (${manifest.entrypoints.mcpServer.transport})`,
    `- Hooks: \`${manifest.entrypoints.hooks}\``,
    `- Behavior artifacts: \`${manifest.entrypoints.behavior}\``,
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
