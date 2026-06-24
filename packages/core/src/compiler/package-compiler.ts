import path from "node:path";
import { compileContextPack } from "./context-pack.js";
import { compileHookAdapter } from "./hook-compiler.js";
import { compileAgentPlugin } from "./plugin-compiler.js";
import { compileBehaviorSkills } from "./skill-compiler.js";
import { readPreferenceGraph } from "../preferences/graph.js";
import { renderPreferenceGraphMarkdown } from "../preferences/render.js";
import { withFileLock, writeJsonAtomic } from "../storage/atomic.js";

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
  return withFileLock(path.join(root, ".openskill-kit", "compiled", ".compile.lock"), async () => {
    const contextPack = await compileContextPack(root);
    const skills = await compileBehaviorSkills(root);
    const hooks = await compileHookAdapter(root);
    const graph = await readPreferenceGraph(root);
    const graphMarkdownPath = await renderPreferenceGraphMarkdown(root, graph);
    const mcpConfigPath = path.join(root, ".openskill-kit", "compiled", "mcp", "server-config.json");
    await writeJsonAtomic(mcpConfigPath, {
      schemaVersion: "openskill-kit.mcp-config.v1",
      server: "openskill-kit-mcp",
      tools: [
        "osk_bootstrap_session",
        "osk_get_context_pack",
        "osk_get_relevant_preferences",
        "osk_record_event",
        "osk_learn_from_session",
        "osk_compile_behavior_layer",
        "osk_explain_preference",
        "osk_export_behavior_pack",
        "osk_sign_behavior_pack",
        "osk_verify_behavior_pack",
        "osk_import_behavior_pack",
        "osk_run_behavior_eval",
        "osk_agent_doctor",
        "osk_install_agent_hooks",
        "osk_run_lifecycle_once"
      ],
      contextPack: path.relative(root, contextPack.contextPackPath).replace(/\\/g, "/")
    });
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
  });
}
