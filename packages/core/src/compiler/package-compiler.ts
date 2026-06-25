import path from "node:path";
import { compileContextPack } from "./context-pack.js";
import { compileHookAdapter } from "./hook-compiler.js";
import { compileInstructionManifests } from "./instruction-compiler.js";
import { compileAgentPlugin } from "./plugin-compiler.js";
import { compilePolicyArtifacts } from "./policy-compiler.js";
import { compileBehaviorSkills } from "./skill-compiler.js";
import { readProjectConfig } from "../events/store.js";
import { CompileTargets, normalizeCompileTargets, type CompileTarget } from "../schema/constants.js";
import { readPreferenceGraph } from "../preferences/graph.js";
import { validateMemoryIntegrity, writeMemoryIntegrityReport } from "../preferences/integrity.js";
import { renderPreferenceGraphMarkdown } from "../preferences/render.js";
import { withFileLock, writeJsonAtomic } from "../storage/atomic.js";

export interface CompileBehaviorLayerResult {
  schemaVersion: "openskill-kit.compile.v1";
  compiledTargets: CompileTarget[];
  skippedTargets: CompileTarget[];
  contextPackPath?: string;
  skillPaths: string[];
  hooksPath?: string;
  manifestPaths: string[];
  mcpConfigPath?: string;
  pluginManifestPath?: string;
  policyArtifactPaths: string[];
  graphMarkdownPath?: string;
  integrityReportPath: string;
}

export interface CompileBehaviorLayerOptions {
  targets?: CompileTarget[];
}

export async function compileBehaviorLayer(projectRoot: string, options: CompileBehaviorLayerOptions = {}): Promise<CompileBehaviorLayerResult> {
  const root = path.resolve(projectRoot);
  return withFileLock(path.join(root, ".openskill-kit", "compiled", ".compile.lock"), async () => {
    const config = await readProjectConfig(root);
    const requestedTargets = normalizeCompileTargets(options.targets ?? config.compileTargets);
    const targetSet = expandTargets(requestedTargets);
    const graph = await readPreferenceGraph(root);
    const integrityReport = await validateMemoryIntegrity(root, graph.nodes, config);
    const integrityReportPath = await writeMemoryIntegrityReport(root, integrityReport);
    const contextPack = targetSet.has("context-pack") ? await compileContextPack(root) : undefined;
    const skills = targetSet.has("agent-skills") ? await compileBehaviorSkills(root) : { skillPaths: [] };
    const hooks = targetSet.has("hooks") ? await compileHookAdapter(root) : undefined;
    const graphMarkdownPath = shouldRenderGraphMarkdown(targetSet) ? await renderPreferenceGraphMarkdown(root, graph) : undefined;
    const policy = shouldCompilePolicy(targetSet) ? await compilePolicyArtifacts(root) : undefined;
    const manifests = targetSet.has("project-rules") ? await compileInstructionManifests(root) : undefined;
    const mcpConfigPath = targetSet.has("mcp-resources") ? await compileMcpConfig(root, contextPack?.contextPackPath) : undefined;
    const plugin = targetSet.has("plugin") ? await compileAgentPlugin(root) : undefined;
    return {
      schemaVersion: "openskill-kit.compile.v1",
      compiledTargets: [...targetSet].sort(),
      skippedTargets: CompileTargets.filter((target) => !targetSet.has(target)),
      contextPackPath: contextPack?.contextPackPath,
      skillPaths: skills.skillPaths,
      hooksPath: hooks?.hooksPath,
      manifestPaths: manifests ? [manifests.agentsPath, manifests.claudePath, ...manifests.rulePaths] : [],
      mcpConfigPath,
      pluginManifestPath: plugin?.manifestPath,
      policyArtifactPaths: policy ? [policy.pathMapPath, policy.commandPolicyPath, policy.reviewChecklistPath] : [],
      graphMarkdownPath,
      integrityReportPath
    };
  });
}

async function compileMcpConfig(root: string, contextPackPath?: string): Promise<string> {
  const mcpConfigPath = path.join(root, ".openskill-kit", "compiled", "mcp", "server-config.json");
  await writeJsonAtomic(mcpConfigPath, {
    schemaVersion: "openskill-kit.mcp-config.v1",
    server: "openskill-kit-mcp",
    tools: [
      "osk_bootstrap_session",
      "osk_explain_status",
      "osk_get_context_pack",
      "osk_get_relevant_preferences",
      "osk_record_event",
      "osk_learn_from_session",
      "osk_compile_behavior_layer",
      "osk_explain_preference",
      "osk_get_preference_evidence",
      "osk_propose_preference",
      "osk_get_review_queue",
      "osk_apply_review_actions",
      "osk_get_behavior_manifest",
      "osk_preview_manifest_install",
      "osk_apply_manifest_install",
      "osk_validate_memory_candidate",
      "osk_get_calibration_report",
      "osk_export_behavior_pack",
      "osk_sign_behavior_pack",
      "osk_verify_behavior_pack",
      "osk_inspect_behavior_pack",
      "osk_diff_behavior_pack",
      "osk_import_behavior_pack",
      "osk_run_behavior_eval",
      "osk_agent_doctor",
      "osk_install_agent_hooks",
      "osk_run_lifecycle_once",
      "osk_run_full_doctor",
      "osk_reset_state",
      "osk_prune_state",
      "osk_archive_state",
      "osk_compact_state"
    ],
    contextPack: contextPackPath ? path.relative(root, contextPackPath).replace(/\\/g, "/") : undefined
  });
  return mcpConfigPath;
}

function expandTargets(targets: CompileTarget[]): Set<CompileTarget> {
  const set = new Set<CompileTarget>(targets);
  if (set.has("plugin")) {
    set.add("agent-skills");
    set.add("hooks");
    set.add("mcp-resources");
    set.add("project-rules");
  }
  if (set.has("mcp-resources")) set.add("context-pack");
  if (set.size === 0) for (const target of CompileTargets) set.add(target);
  return set;
}

function shouldCompilePolicy(targets: Set<CompileTarget>): boolean {
  return targets.has("project-rules") || targets.has("plugin") || targets.has("agent-skills");
}

function shouldRenderGraphMarkdown(targets: Set<CompileTarget>): boolean {
  return targets.has("context-pack") || targets.has("agent-skills") || targets.has("mcp-resources") || targets.has("project-rules") || targets.has("plugin");
}
