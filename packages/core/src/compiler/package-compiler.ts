import { createHash } from "node:crypto";
import path from "node:path";
import { compileContextPack } from "./context-pack.js";
import { compileHookAdapter } from "./hook-compiler.js";
import { compileInstructionManifests } from "./instruction-compiler.js";
import { compileAgentPlugin } from "./plugin-compiler.js";
import { compilePolicyArtifacts } from "./policy-compiler.js";
import { compileBehaviorSkills } from "./skill-compiler.js";
import { compileStagedPreview } from "./staged-preview.js";
import { readProjectConfig } from "../events/store.js";
import { CompileTargets, PUBLIC_MCP_PROFILE_TOOLS, normalizeCompileTargets, type CompileTarget } from "../schema/constants.js";
import { readPreferenceGraph } from "../preferences/graph.js";
import { validateMemoryIntegrity, writeMemoryIntegrityReport } from "../preferences/integrity.js";
import { renderPreferenceGraphMarkdown } from "../preferences/render.js";
import { withFileLock, writeJsonAtomic } from "../storage/atomic.js";
import { readLearnV2ConceptStore } from "../learn-v2/store.js";
import { declassificationReport } from "../learn-v2/index.js";
import type { LearnV2ConceptCard } from "../learn-v2/schemas.js";

export interface CompileBehaviorLayerResult {
  schemaVersion: "openskill-kit.compile.v1";
  compiledTargets: CompileTarget[];
  skippedTargets: CompileTarget[];
  contextPackPath?: string;
  skillPaths: string[];
  hooksPath?: string;
  manifestPaths: string[];
  mcpConfigPath?: string;
  mcpDescriptorPath?: string;
  mcpDescriptorHashPath?: string;
  mcpResourcePath?: string;
  pluginManifestPath?: string;
  policyArtifactPaths: string[];
  graphMarkdownPath?: string;
  integrityReportPath: string;
  stagedPreviewPath?: string;
}

export interface CompileBehaviorLayerOptions {
  targets?: CompileTarget[];
  includeStagedPreview?: boolean;
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
    const mcp = targetSet.has("mcp-resources") ? await compileMcpConfig(root, contextPack?.contextPackPath) : undefined;
    const plugin = targetSet.has("plugin") ? await compileAgentPlugin(root) : undefined;
    const stagedPreview = options.includeStagedPreview === true ? await compileStagedPreview(root) : undefined;
    return {
      schemaVersion: "openskill-kit.compile.v1",
      compiledTargets: [...targetSet].sort(),
      skippedTargets: CompileTargets.filter((target) => !targetSet.has(target)),
      contextPackPath: contextPack?.contextPackPath,
      skillPaths: skills.skillPaths,
      hooksPath: hooks?.hooksPath,
      manifestPaths: manifests ? [manifests.agentsPath, manifests.claudePath, ...manifests.rulePaths] : [],
      mcpConfigPath: mcp?.configPath,
      mcpDescriptorPath: mcp?.descriptorPath,
      mcpDescriptorHashPath: mcp?.hashPath,
      mcpResourcePath: mcp?.resourcePath,
      pluginManifestPath: plugin?.manifestPath,
      policyArtifactPaths: policy ? [policy.pathMapPath, policy.commandPolicyPath, policy.reviewChecklistPath, policy.commandPolicyJsonPath] : [],
      graphMarkdownPath,
      integrityReportPath,
      stagedPreviewPath: stagedPreview?.previewPath
    };
  });
}

interface CompileMcpConfigResult {
  configPath: string;
  descriptorPath: string;
  hashPath: string;
  resourcePath: string;
}

interface McpToolDescriptor {
  name: string;
  category: string;
  writeRisk: "read-only" | "local-write" | "approval-required";
  approvalRequired: boolean;
}

interface CompiledConceptResource {
  uri: string;
  name: string;
  title: string;
  mimeType: "application/json";
  annotations: {
    audience: ["assistant"];
    priority: number;
    lastModified: string;
  };
  concept: {
    id: string;
    behavior: string;
    behaviorDelta: string;
    scope: {
      level: LearnV2ConceptCard["scope"]["level"];
      paths: string[];
      taskTypes: string[];
      negativeTriggers: string[];
    };
    activation: LearnV2ConceptCard["activation"];
    confidence: number;
    risk: LearnV2ConceptCard["risk"];
    status: "active" | "locked";
    evidenceCount: number;
    sourceReliability: number;
  };
  privacy: {
    class: "project-private";
    rawRefsExported: false;
    rationale: string;
  };
}

const MCP_TOOL_DESCRIPTORS: McpToolDescriptor[] = [
  descriptor("osk_bootstrap_session", "bootstrap", "local-write"),
  descriptor("osk_get_status", "status", "local-write"),
  descriptor("osk_explain_status", "status", "read-only"),
  descriptor("osk_detect_environment", "detection", "local-write"),
  descriptor("osk_get_agent_surfaces", "detection", "local-write"),
  descriptor("osk_import_interaction_source", "interactions", "approval-required", true),
  descriptor("osk_list_interaction_adapters", "interactions", "read-only"),
  descriptor("osk_list_interaction_imports", "interactions", "read-only"),
  descriptor("osk_explain_interaction_import", "interactions", "read-only"),
  descriptor("osk_get_interaction_pool", "interactions", "read-only"),
  descriptor("osk_get_git_local_context", "interactions", "read-only"),
  descriptor("osk_plan_learning_sources", "learning", "local-write"),
  descriptor("osk_plan_learning_sources_v2", "learning", "local-write"),
  descriptor("osk_run_learning_plan", "learning", "approval-required", true),
  descriptor("osk_ingest_raw_evidence", "learning", "approval-required", true),
  descriptor("osk_get_concept_review_queue", "learning", "read-only"),
  descriptor("osk_review_concepts", "review", "approval-required", true),
  descriptor("osk_compile_concepts", "compile", "local-write"),
  descriptor("osk_prepare_learn_v2_model_requests", "learning", "local-write"),
  descriptor("osk_prepare_learn_v2_scope_requests", "learning", "local-write"),
  descriptor("osk_prepare_learn_v2_contradiction_requests", "learning", "local-write"),
  descriptor("osk_prepare_learn_v2_eval_requests", "eval", "local-write"),
  descriptor("osk_execute_learn_v2_model_requests", "learning", "approval-required", true),
  descriptor("osk_apply_learn_v2_model_outputs", "learning", "approval-required", true),
  descriptor("osk_apply_learn_v2_scope_outputs", "learning", "approval-required", true),
  descriptor("osk_apply_learn_v2_contradiction_outputs", "learning", "approval-required", true),
  descriptor("osk_apply_learn_v2_eval_outputs", "eval", "local-write"),
  descriptor("osk_activate_learn_v2_concepts", "retrieval", "read-only"),
  descriptor("osk_record_learn_v2_concept_outcome", "learning", "local-write"),
  descriptor("osk_get_learn_v2_vault_status", "maintenance", "local-write"),
  descriptor("osk_get_learn_v2_observability", "status", "read-only"),
  descriptor("osk_reconstruct_episodes", "learning", "local-write"),
  descriptor("osk_extract_concepts", "learning", "local-write"),
  descriptor("osk_run_learn_v2_eval", "eval", "local-write"),
  descriptor("osk_get_context_pack", "retrieval", "read-only"),
  descriptor("osk_get_relevant_preferences", "retrieval", "read-only"),
  descriptor("osk_route_behavior", "routing", "read-only"),
  descriptor("osk_get_agent_task_context", "routing", "local-write"),
  descriptor("osk_get_task_context", "routing", "local-write"),
  descriptor("osk_finish_agent_task", "observation", "local-write"),
  descriptor("osk_finish_task", "observation", "local-write"),
  descriptor("osk_record_event", "observation", "local-write"),
  descriptor("osk_learn_from_session", "learning", "local-write"),
  descriptor("osk_compile_behavior_layer", "compile", "local-write"),
  descriptor("osk_explain_preference", "retrieval", "read-only"),
  descriptor("osk_get_preference_evidence", "retrieval", "read-only"),
  descriptor("osk_propose_preference", "review", "local-write"),
  descriptor("osk_get_review_queue", "review", "local-write"),
  descriptor("osk_review_behavior", "review", "approval-required", true),
  descriptor("osk_apply_review_actions", "review", "approval-required", true),
  descriptor("osk_get_behavior_manifest", "manifests", "read-only"),
  descriptor("osk_preview_manifest_install", "manifests", "local-write"),
  descriptor("osk_apply_manifest_install", "manifests", "approval-required", true),
  descriptor("osk_preview_manifest_uninstall", "manifests", "local-write"),
  descriptor("osk_apply_manifest_uninstall", "manifests", "approval-required", true),
  descriptor("osk_validate_memory_candidate", "safety", "read-only"),
  descriptor("osk_get_calibration_report", "status", "read-only"),
  descriptor("osk_export_behavior_pack", "packs", "local-write"),
  descriptor("osk_export_encrypted_behavior_pack", "packs", "local-write"),
  descriptor("osk_sign_behavior_pack", "packs", "approval-required", true),
  descriptor("osk_verify_behavior_pack", "packs", "read-only"),
  descriptor("osk_inspect_behavior_pack", "packs", "read-only"),
  descriptor("osk_diff_behavior_pack", "packs", "read-only"),
  descriptor("osk_import_behavior_pack", "packs", "approval-required", true),
  descriptor("osk_import_encrypted_behavior_pack", "packs", "approval-required", true),
  descriptor("osk_run_eval", "eval", "local-write"),
  descriptor("osk_run_behavior_eval", "eval", "local-write"),
  descriptor("osk_run_agent_ab_eval", "eval", "local-write"),
  descriptor("osk_run_external_agent_eval", "eval", "approval-required", true),
  descriptor("osk_agent_doctor", "doctor", "read-only"),
  descriptor("osk_install_agent_hooks", "hooks", "approval-required", true),
  descriptor("osk_preview_plugin_attach", "plugin", "local-write"),
  descriptor("osk_apply_plugin_attach", "plugin", "approval-required", true),
  descriptor("osk_compile_deploy", "plugin", "approval-required", true),
  descriptor("osk_get_plugin_attach_status", "plugin", "read-only"),
  descriptor("osk_get_plugin_install_profile", "plugin", "read-only"),
  descriptor("osk_run_lifecycle_once", "lifecycle", "local-write"),
  descriptor("osk_mine_workflows", "workflows", "local-write"),
  descriptor("osk_get_workflow_graph", "workflows", "read-only"),
  descriptor("osk_run_full_doctor", "doctor", "read-only"),
  descriptor("osk_openworld_doctor", "openworld", "read-only"),
  descriptor("osk_run_openworld_workflow", "openworld", "local-write"),
  descriptor("osk_verify_behavior", "verification", "local-write"),
  descriptor("osk_openworld_source_plan", "openworld", "local-write"),
  descriptor("osk_openworld_ingest_source", "openworld", "local-write"),
  descriptor("osk_openworld_execute_source_plan", "openworld", "local-write"),
  descriptor("osk_openworld_sources", "openworld", "read-only"),
  descriptor("osk_openworld_candidate_skill", "openworld", "local-write"),
  descriptor("osk_openworld_run_verifier", "openworld", "local-write"),
  descriptor("osk_openworld_verifier_quality", "openworld", "local-write"),
  descriptor("osk_openworld_refine", "openworld", "local-write"),
  descriptor("osk_openworld_eval_report", "openworld", "local-write"),
  descriptor("osk_openworld_hidden_oracle_harness", "openworld", "local-write"),
  descriptor("osk_openworld_task_report", "openworld", "local-write"),
  descriptor("osk_openworld_promote_review", "openworld", "approval-required", true),
  descriptor("osk_pack_behavior", "packs", "approval-required", true),
  descriptor("osk_get_docs_help", "docs", "read-only"),
  descriptor("osk_reset_state", "maintenance", "approval-required", true),
  descriptor("osk_prune_state", "maintenance", "approval-required", true),
  descriptor("osk_archive_state", "maintenance", "approval-required", true),
  descriptor("osk_compact_state", "maintenance", "local-write")
];

async function compileMcpConfig(root: string, contextPackPath?: string): Promise<CompileMcpConfigResult> {
  const mcpDir = path.join(root, ".openskill-kit", "compiled", "mcp");
  const descriptorPath = path.join(mcpDir, "descriptors.json");
  const publicDescriptorPath = path.join(mcpDir, "descriptors.public.json");
  const profilePath = path.join(mcpDir, "profiles.json");
  const hashPath = path.join(mcpDir, "descriptor-hashes.json");
  const resourcePath = path.join(mcpDir, "resources", "learn-v2-concepts.json");
  const mcpConfigPath = path.join(root, ".openskill-kit", "compiled", "mcp", "server-config.json");
  const conceptResources = await compileLearnV2ConceptResources(root);
  const descriptors = {
    schemaVersion: "openskill-kit.mcp-descriptors.v1",
    server: "openskill-kit-mcp",
    profile: "advanced",
    tools: MCP_TOOL_DESCRIPTORS
  };
  const publicDescriptors = {
    schemaVersion: "openskill-kit.mcp-descriptors.v1",
    server: "openskill-kit-mcp",
    profile: "public",
    tools: MCP_TOOL_DESCRIPTORS.filter((tool) => PUBLIC_MCP_PROFILE_TOOLS.includes(tool.name as typeof PUBLIC_MCP_PROFILE_TOOLS[number]))
  };
  const profiles = {
    schemaVersion: "openskill-kit.mcp-profiles.v1",
    defaultProfile: "public",
    profiles: {
      public: PUBLIC_MCP_PROFILE_TOOLS,
      advanced: ["*"]
    }
  };
  const toolHashes = Object.fromEntries(MCP_TOOL_DESCRIPTORS.map((tool) => [tool.name, sha256Stable(tool)]));
  const descriptorHash = sha256Stable(descriptors);
  const publicDescriptorHash = sha256Stable(publicDescriptors);
  const profileHash = sha256Stable(profiles);
  const resourceHash = sha256Stable(conceptResources);
  await writeJsonAtomic(descriptorPath, descriptors);
  await writeJsonAtomic(publicDescriptorPath, publicDescriptors);
  await writeJsonAtomic(profilePath, profiles);
  await writeJsonAtomic(resourcePath, conceptResources);
  await writeJsonAtomic(hashPath, {
    schemaVersion: "openskill-kit.mcp-descriptor-hashes.v1",
    algorithm: "sha256",
    descriptors: "descriptors.json",
    publicDescriptors: "descriptors.public.json",
    profiles: "profiles.json",
    descriptorsHash: descriptorHash,
    publicDescriptorsHash: publicDescriptorHash,
    profilesHash: profileHash,
    resources: "resources/learn-v2-concepts.json",
    resourceHash,
    tools: toolHashes,
    approvalRequiredTools: MCP_TOOL_DESCRIPTORS.filter((tool) => tool.approvalRequired).map((tool) => tool.name)
  });
  await writeJsonAtomic(mcpConfigPath, {
    schemaVersion: "openskill-kit.mcp-config.v1",
    server: "openskill-kit-mcp",
    tools: MCP_TOOL_DESCRIPTORS.map((tool) => tool.name),
    defaultProfile: "public",
    profiles: "profiles.json",
    descriptors: "descriptors.json",
    publicDescriptors: "descriptors.public.json",
    descriptorHashes: "descriptor-hashes.json",
    descriptorsHash: descriptorHash,
    publicDescriptorsHash: publicDescriptorHash,
    profilesHash: profileHash,
    resources: {
      learnV2Concepts: "resources/learn-v2-concepts.json",
      learnV2ConceptsHash: resourceHash
    },
    contextPack: contextPackPath ? path.relative(root, contextPackPath).replace(/\\/g, "/") : undefined
  });
  return { configPath: mcpConfigPath, descriptorPath, hashPath, resourcePath };
}

async function compileLearnV2ConceptResources(root: string): Promise<{
  schemaVersion: "openskill-kit.mcp.learn-v2-concept-resources.v1";
  generatedAt: string;
  resources: CompiledConceptResource[];
}> {
  const now = new Date().toISOString();
  const config = await readProjectConfig(root);
  const store = await readLearnV2ConceptStore(root).catch(() => undefined);
  const active = (store?.cards ?? []).filter((card) => card.status === "active" || card.status === "locked");

  const report = declassificationReport(active, [], [], { root, config });
  if (report.status === "fail") {
    throw new Error(`Compile-time declassification checks failed for active concepts. Issues detected: ${report.issues.join(", ")}`);
  }

  return {
    schemaVersion: "openskill-kit.mcp.learn-v2-concept-resources.v1",
    generatedAt: now,
    resources: active.map((card) => conceptResource(card, now))
  };
}

function conceptResource(card: LearnV2ConceptCard, generatedAt: string): CompiledConceptResource {
  return {
    uri: `openskill-kit://learn-v2/concepts/${encodeURIComponent(card.id)}`,
    name: `learn-v2 concept ${card.id}`,
    title: card.title,
    mimeType: "application/json",
    annotations: {
      audience: ["assistant"],
      priority: Number(Math.min(1, Math.max(0.1, card.confidence)).toFixed(2)),
      lastModified: card.lifecycle.updatedAt || generatedAt
    },
    concept: {
      id: card.id,
      behavior: card.canonicalBehavior,
      behaviorDelta: card.behaviorDelta,
      scope: {
        level: card.scope.level,
        paths: card.scope.paths,
        taskTypes: card.scope.taskTypes,
        negativeTriggers: card.scope.negativeTriggers
      },
      activation: card.activation,
      confidence: card.confidence,
      risk: card.risk,
      status: card.status === "locked" ? "locked" : "active",
      evidenceCount: card.evidenceIds.length,
      sourceReliability: card.sourceReliability
    },
    privacy: {
      class: "project-private",
      rawRefsExported: false,
      rationale: "Compiled from reviewed Learn v2 concept card. Raw refs, raw vault paths, and raw evidence content are excluded."
    }
  };
}

function descriptor(name: string, category: string, writeRisk: McpToolDescriptor["writeRisk"], approvalRequired = false): McpToolDescriptor {
  return { name, category, writeRisk, approvalRequired };
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
