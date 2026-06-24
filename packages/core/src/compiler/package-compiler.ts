import { promises as fs } from "node:fs";
import path from "node:path";
import { compileContextPack } from "./context-pack.js";
import { compileHookAdapter } from "./hook-compiler.js";
import { compileAgentPlugin } from "./plugin-compiler.js";
import { compileBehaviorSkills } from "./skill-compiler.js";
import { readPreferenceGraph } from "../preferences/graph.js";
import { renderPreferenceGraphMarkdown } from "../preferences/render.js";

export interface CompileBehaviorLayerResult {
  schemaVersion: "openskill-kit.compile.v1";
  contextPackPath: string;
  skillPaths: string[];
  hooksPath: string;
  mcpConfigPath: string;
  pluginManifestPath: string;
  graphMarkdownPath: string;
}

export async function compileBehaviorLayer(projectRoot: string): Promise<CompileBehaviorLayerResult> {
  const root = path.resolve(projectRoot);
  const contextPack = await compileContextPack(root);
  const skills = await compileBehaviorSkills(root);
  const hooks = await compileHookAdapter(root);
  const graph = await readPreferenceGraph(root);
  const graphMarkdownPath = await renderPreferenceGraphMarkdown(root, graph);
  const mcpConfigPath = path.join(root, ".openskill-kit", "compiled", "mcp", "server-config.json");
  await fs.mkdir(path.dirname(mcpConfigPath), { recursive: true });
  await fs.writeFile(mcpConfigPath, JSON.stringify({
    schemaVersion: "openskill-kit.mcp-config.v1",
    server: "openskill-kit-mcp",
    tools: [
      "osk_bootstrap_session",
      "osk_get_context_pack",
      "osk_get_relevant_preferences",
      "osk_record_event",
      "osk_learn_from_session",
      "osk_compile_behavior_layer",
      "osk_explain_preference"
    ],
    contextPack: path.relative(root, contextPack.contextPackPath).replace(/\\/g, "/")
  }, null, 2), "utf8");
  const plugin = await compileAgentPlugin(root);
  return {
    schemaVersion: "openskill-kit.compile.v1",
    contextPackPath: contextPack.contextPackPath,
    skillPaths: skills.skillPaths,
    hooksPath: hooks.hooksPath,
    mcpConfigPath,
    pluginManifestPath: plugin.manifestPath,
    graphMarkdownPath
  };
}
