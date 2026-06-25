import { promises as fs } from "node:fs";
import path from "node:path";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";

export interface CompilePluginResult {
  schemaVersion: "openskill-kit.plugin.v1";
  pluginDir: string;
  manifestPath: string;
  files: string[];
}

export async function compileAgentPlugin(projectRoot: string): Promise<CompilePluginResult> {
  const root = path.resolve(projectRoot);
  const pluginDir = path.join(root, ".openskill-kit", "compiled", "plugin");
  const manifestPath = path.join(pluginDir, "plugin.json");
  await writeJsonAtomic(manifestPath, {
    schemaVersion: "openskill-kit.plugin.v1",
    name: "openskillkit-project-behavior",
    description: "Project-local Active Behavior Layer compiled by OpenSkillKit.",
    mcp: "mcp/server-config.json",
    skills: await compiledSkillRefs(root),
    hooks: "hooks/hooks.json"
  });
  await writeFileAtomic(path.join(pluginDir, "README.md"), [
    "# OpenSkillKit Agent Plugin",
    "",
    "Attach this plugin from the project root. It exposes the compiled Active Behavior Layer, local MCP metadata, and hook adapter files.",
    "",
    "Private event logs and raw signals are not included in this plugin output.",
    ""
  ].join("\n"));
  await copyIfExists(path.join(root, ".openskill-kit", "compiled", "skills"), path.join(pluginDir, "skills"));
  await copyIfExists(path.join(root, ".openskill-kit", "compiled", "behavior"), path.join(pluginDir, "behavior"));
  await copyIfExists(path.join(root, ".openskill-kit", "compiled", "hooks"), path.join(pluginDir, "hooks"));
  await copyIfExists(path.join(root, ".openskill-kit", "compiled", "mcp"), path.join(pluginDir, "mcp"));
  const files = await listFiles(pluginDir);
  return { schemaVersion: "openskill-kit.plugin.v1", pluginDir, manifestPath, files };
}

async function compiledSkillRefs(root: string): Promise<string[]> {
  const skillsDir = path.join(root, ".openskill-kit", "compiled", "skills");
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => `skills/${entry.name}`).sort();
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
