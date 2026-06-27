import { promises as fs } from "node:fs";
import path from "node:path";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";

export interface CompilePluginResult {
  schemaVersion: "openskill-kit.plugin.v1";
  pluginDir: string;
  manifestPath: string;
  files: string[];
}

interface AgentPluginManifest {
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
  files: string[];
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
