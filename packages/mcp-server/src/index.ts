#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  appendEvent,
  applyAmbientLabelReview,
  applyPreferenceReview,
  applyWorkflowReview,
  AGENT_PLUGIN_PROJECT_ROOT_ENV,
  attachAgentPlugin,
  compileBehaviorLayer,
  detectAgentEnvironment,
  draftSkill,
  evaluateSkill,
  explainPreference,
  explainPreferenceWithEvidence,
  exportProjectBehaviorPack,
  exportEncryptedProjectBehaviorPack,
  extractSignals,
  evolveSkill,
  explainAdaptiveStatus,
  getAgentPluginInstallProfile,
  getAgentPluginAttachStatus,
  getAgentTaskContext,
  finishAgentTask,
  getCompiledPluginStatus,
  getAdaptiveStatus,
  AnchorCardSchema,
  assessOpenWorldVerifierQuality,
  buildVirtualSuiteFromAnchors,
  buildOpenWorldRetrievalAdapters,
  executeOpenWorldResearchPlan,
  generateOpenWorldCandidateSkill,
  ingestLocalOpenWorldSource,
  ingestWebOpenWorldSource,
  planOpenWorldResearch,
  installAgentHooks,
  installInstructionManifests,
  uninstallInstructionManifests,
  initAdaptiveProject,
  importProjectBehaviorPack,
  importEncryptedProjectBehaviorPack,
  importInteractionSource,
  inspectGitLocalContext,
  planLearningSources,
  runLearningPlan,
  runRawLocalLearning,
  readLearnV2ConceptStore,
  readLearnV2ReviewQueue,
  applyLearnV2ConceptReview,
  applyLearnV2ModelProposalOutputs,
  activateLearnV2Concepts,
  compileLearnV2ConceptPreview,
  recordLearnV2ConceptOutcome,
  reconstructPersistedLearnV2Episodes,
  extractPersistedLearnV2Concepts,
  runPersistedLearnV2Eval,
  writeLearnV2ModelRequests,
  runLearnV2RawVaultMaintenance,
  readLearnV2PipelineObservabilityReport,
  explainInteractionImport,
  installSkill,
  listInteractionAdapters,
  inspectProjectBehaviorPack,
  loadSkillPackage,
  buildReviewQueue,
  buildOpenWorldEvalReport,
  buildOpenWorldHiddenOracleHarness,
  buildOpenWorldTaskReport,
  proposeSemanticPreference,
  mineWorkflowGraph,
  readPreferenceGraph,
  readProjectConfig,
  readWorkflowGraph,
  renderWorkflowGraph,
  readCalibrationReport,
  readInteractionImportRuns,
  readInteractionPool,
  readOpenWorldTask,
  readOpenWorldSourceIndex,
  readOpenWorldTrustCache,
  readRegistry,
  renderOskCommandsMarkdown,
  renderOskLearnMarkdown,
  promoteOpenWorldRunToReview,
  retrieveRelevantPreferences,
  routeBehavior,
  diffProjectBehaviorPacks,
  runAgentDoctor,
  runOpenWorldCandidateRepairLoop,
  runBehaviorEval,
  runBehaviorCompareEval,
  runExternalAgentEval,
  runDoctor,
  runFullDoctor,
  runOpenWorldDoctor,
  runOpenWorldRefinement,
  recordCommandTelemetry,
  runVirtualTestSuite,
  runLifecycleOnce,
  resetProjectState,
  pruneProjectState,
  archiveProjectState,
  compactProjectState,
  scanSkillPath,
  signProjectBehaviorPack,
  updatePreferenceGraph,
  validateMemoryIntegrity,
  verifyHarnessReadiness,
  verifyProjectBehaviorPack,
  verifySkill,
  AgentPluginAttachHosts,
  CompileTargets,
  DEFAULT_AGENT_PLUGIN_ATTACH_HOST,
  OPENSKILLKIT_MCP_PROFILE_ENV,
  PreferenceCategories,
  PUBLIC_MCP_PROFILE_TOOLS,
  SuggestedCompileTargets,
  type CommandTelemetryFamily,
  type InstallTarget,
  type OpenSkillMcpProfile
} from "@openskill-kit/core";

const VERSION = "0.1.0";

const targetSchema = z.string().min(1);
const projectRootSchema = z.string().min(1).optional();
const topicSchema = z.string().min(1).max(200);
const skillPathSchema = z.string().min(1);
const evidenceFilesSchema = z.array(z.string().min(1)).default([]);
const evidenceUrlsSchema = z.array(z.string().url()).default([]);
const statusInputSchema = z.object({ projectRoot: projectRootSchema, projectName: z.string().min(1).optional(), init: z.boolean().default(false) });
const taskContextInputSchema = z.object({
  projectRoot: projectRootSchema,
  query: z.string().optional(),
  paths: z.array(z.string()).default([]),
  changedFiles: z.array(z.string()).default([]),
  commands: z.array(z.string()).default([]),
  limit: z.number().int().min(1).max(20).default(8)
});
const taskFinishInputSchema = z.object({
  projectRoot: projectRootSchema,
  sessionId: z.string().min(1).default("agent-task"),
  summary: z.string().min(1).max(2000),
  outcome: z.enum(["completed", "accepted", "rejected", "edited"]).default("completed"),
  outcomeReason: z.string().min(1).max(500).optional(),
  files: z.array(z.string().min(1)).default([]),
  commands: z.array(z.string().min(1)).default([]),
  commandStatus: z.enum(["pass", "fail", "blocked", "timeout", "unknown"]).default("unknown"),
  proposedPatchHash: z.string().min(6).max(128).optional(),
  finalPatchHash: z.string().min(6).max(128).optional(),
  diffStats: z.object({
    added: z.number().int().min(0),
    removed: z.number().int().min(0),
    files: z.number().int().min(0)
  }).optional(),
  learn: z.boolean().default(true),
  compileSafe: z.boolean().default(false)
});

export function createOpenSkillMcpServer(options: { profile?: OpenSkillMcpProfile } = {}): McpServer {
  const profile = resolveMcpProfile(options.profile ?? process.env[OPENSKILLKIT_MCP_PROFILE_ENV]);
  const publicTools = new Set<string>(PUBLIC_MCP_PROFILE_TOOLS);
  const server = new McpServer(
    { name: "openskill-kit-mcp", version: VERSION },
    {
      instructions:
        `Use OpenSkillKit tools to load project behavior, record safe local events, learn preference candidates, compile behavior artifacts, and install skills. Current MCP profile: ${profile}. Keep dryRun true unless user explicitly approves writes.`
    }
  );
  const registerTool = ((name: string, ...args: unknown[]) => {
    if (profile === "public" && !publicTools.has(name)) return undefined;
    return (server.registerTool as unknown as (toolName: string, ...toolArgs: unknown[]) => unknown)(name, ...args);
  }) as typeof server.registerTool;

  registerTool(
    "osk_get_status",
    {
      title: "OpenSkillKit Status",
      description: "Return the public status facade: optional init, readiness, plugin health, proof boundary, and next actions.",
      inputSchema: statusInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, projectName, init }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "status", async () => {
        const initResult = init ? await initAdaptiveProject({ projectRoot: root, projectName }) : undefined;
        const status = await getAdaptiveStatus(root);
        const explanation = await explainAdaptiveStatus(root);
        const plugin = await getCompiledPluginStatus(root);
        return {
          schemaVersion: "openskill-kit.status-facade.v1",
          initResult,
          status,
          explanation,
          plugin,
          nextActions: [
            ...plugin.nextActions,
            ...(status.pendingReviewCount > 0 ? ["Review pending behavior before compiling or attaching the plugin."] : []),
            ...(status.activePreferenceCount > 0 && !status.compiled.contextPack ? ["Run `osk_compile_deploy` with action `compile` to refresh compiled behavior."] : [])
          ]
        };
      }), root);
    }
  );

  registerTool(
    "osk_bootstrap_session",
    {
      title: "OpenSkillKit Bootstrap Session",
      description: "Initialize or inspect the local Adaptive Skill Graph for this project.",
      inputSchema: z.object({ projectRoot: projectRootSchema, projectName: z.string().min(1).optional(), init: z.boolean().default(true) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, projectName, init }) => {
      const root = resolveProjectRoot(projectRoot);
      const result = init ? await initAdaptiveProject({ projectRoot: root, projectName }) : await getAdaptiveStatus(root);
      const status = await getAdaptiveStatus(root);
      const plugin = await getCompiledPluginStatus(root);
      return toolResult({
        schemaVersion: "openskill-kit.bootstrap-session.v1",
        initResult: result,
        status,
        plugin,
        nextActions: [
          ...plugin.nextActions,
          ...(status.pendingReviewCount > 0 ? ["Review pending behavior before compiling or attaching the plugin."] : []),
          ...(status.activePreferenceCount > 0 && !status.compiled.contextPack ? ["Run `osk_compile_behavior_layer` with target `plugin` to refresh compiled behavior."] : [])
        ]
      }, root);
    }
  );

  registerTool(
    "osk_explain_status",
    {
      title: "OpenSkillKit Explain Status",
      description: "Explain current adaptive state and next actions.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await explainAdaptiveStatus(root), root);
    }
  );

  registerTool(
    "osk_get_docs_help",
    {
      title: "OpenSkillKit Docs Help",
      description: "Return generated public command help and learning workflow help for harness routing.",
      inputSchema: z.object({ projectRoot: projectRootSchema, topic: z.enum(["commands", "learn", "all"]).default("commands") }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, topic }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "status", async () => {
        const commands = topic === "learn" ? undefined : renderOskCommandsMarkdown();
        const learn = topic === "commands" ? undefined : renderOskLearnMarkdown();
        return {
          schemaVersion: "openskill-kit.docs-help.v1",
          topic,
          commands,
          learn
        };
      }), root);
    }
  );

  registerTool(
    "osk_detect_environment",
    {
      title: "OpenSkillKit Detect Agent Environment",
      description: "Detect project and optional user agent surfaces as privacy-aware metadata.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        includeUserSurfaces: z.boolean().default(false),
        includeSensitivePreview: z.boolean().default(false)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, includeUserSurfaces, includeSensitivePreview }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await detectAgentEnvironment(root, { includeUserSurfaces, includeSensitivePreview }), root);
    }
  );

  registerTool(
    "osk_get_agent_surfaces",
    {
      title: "OpenSkillKit Agent Surfaces",
      description: "Return the last detected agent surfaces, running detection first if needed.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        refresh: z.boolean().default(false),
        includeUserSurfaces: z.boolean().default(false)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, refresh, includeUserSurfaces }) => {
      const root = resolveProjectRoot(projectRoot);
      if (refresh) return toolResult(await detectAgentEnvironment(root, { includeUserSurfaces }), root);
      const lastScanPath = path.join(root, ".openskill-kit", "detection", "last-scan.json");
      const existing = await import("node:fs/promises").then((fs) => fs.readFile(lastScanPath, "utf8").then(JSON.parse).catch(() => undefined));
      return toolResult(existing ?? await detectAgentEnvironment(root, { includeUserSurfaces }), root);
    }
  );

  registerTool(
    "osk_import_interaction_source",
    {
      title: "OpenSkillKit Import Interaction Source",
      description: "Preview or import a JSON/JSONL/text session export as redacted OpenSkillKit events. Dry-run is default unless yes is true.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        sourcePath: z.string().min(1),
        adapter: z.string().min(1).default("manual-import"),
        agentName: z.string().min(1).optional(),
        maxEvents: z.number().int().min(1).max(1000).default(200),
        allowDuplicate: z.boolean().default(false),
        yes: z.boolean().default(false)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, sourcePath, adapter, agentName, maxEvents, allowDuplicate, yes }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await importInteractionSource(root, sourcePath, {
        adapter,
        agentName,
        maxEvents,
        allowDuplicate,
        dryRun: yes !== true
      }), root);
    }
  );

  registerTool(
    "osk_list_interaction_adapters",
    {
      title: "OpenSkillKit List Interaction Adapters",
      description: "List supported cross-agent interaction import adapters, accepted formats, privacy policy, and status.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult({ schemaVersion: "openskill-kit.interaction-adapters.v1", adapters: listInteractionAdapters() }, root);
    }
  );

  registerTool(
    "osk_plan_learning_sources",
    {
      title: "OpenSkillKit Plan Learning Sources",
      description: "Plan safe, explicit, and blocked learning sources for /osk learn without importing raw memories, transcripts, prompts, diffs, or shell history.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        sourceMode: z.enum(["ask", "all-detected", "selected"]).default("ask"),
        selectedSourceIds: z.array(z.string().min(1)).default([])
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, sourceMode, selectedSourceIds }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "learn", () => planLearningSources(root, { sourceMode, selectedSourceIds })), root);
    }
  );

  registerTool(
    "osk_plan_learning_sources_v2",
    {
      title: "OpenSkillKit Learn v2 Source Plan",
      description: "Plan learning sources for Learn v2. Raw-local surfaces are explicit file inputs for osk_ingest_raw_evidence; this tool returns safe detected sources plus that raw-local policy boundary.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        sourceMode: z.enum(["ask", "all-detected", "selected"]).default("ask"),
        selectedSourceIds: z.array(z.string().min(1)).default([])
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, sourceMode, selectedSourceIds }) => {
      const root = resolveProjectRoot(projectRoot);
      const plan = await withMcpCommandTelemetry(root, "learn", () => planLearningSources(root, { sourceMode, selectedSourceIds }));
      return toolResult({
        schemaVersion: "openskill-kit.learn-v2.source-plan.v1",
        generatedAt: new Date().toISOString(),
        legacySourcePlan: plan,
        rawLocalSurfacePolicy: {
          selection: "explicit-files-only",
          ingestTool: "osk_ingest_raw_evidence",
          previewDefault: true,
          applyRequiresExplicitPreviewOnlyFalse: true,
          learnerInputBoundary: "raw-local-in-memory-declassified-artifacts",
          outputBoundary: "declassified-review-compile-eval-artifacts",
          modelBoundary: "opencode-host-sanitized-only-or-deterministic"
        },
        nextActions: [
          "Use osk_ingest_raw_evidence with explicit sourceFiles for raw-local Learn v2 ingestion.",
          "Keep previewOnly=true until user approves apply.",
          "Use osk_get_concept_review_queue after ingestion to inspect behavior-delta-first focus cards."
        ]
      }, root);
    }
  );

  registerTool(
    "osk_run_learning_plan",
    {
      title: "OpenSkillKit Run Learning Plan",
      description: "Run /osk learn from selected safe metadata and explicit import sources. Defaults to preview-only: parses sources transiently, shows candidate signal counts and behavior statements in plain English, and writes a receipt — without appending events or mutating the preference graph. Set previewOnly=false to apply (creates review candidates, not active behavior). Always run /osk review after applying.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        sourceMode: z.enum(["ask", "all-detected", "selected"]).default("selected"),
        selectedSourceIds: z.array(z.string().min(1)).default([]),
        previewOnly: z.boolean().default(true),
        maxEvents: z.number().int().min(1).max(1000).default(250),
        allowDuplicateImports: z.boolean().default(false)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, sourceMode, selectedSourceIds, previewOnly, maxEvents, allowDuplicateImports }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "learn", () => runLearningPlan(root, {
        sourceMode,
        selectedSourceIds,
        previewOnly,
        maxEvents,
        allowDuplicateImports
      })), root);
    }
  );

  registerTool(
    "osk_ingest_raw_evidence",
    {
      title: "OpenSkillKit Learn v2 Raw Evidence Ingest",
      description: "Run Learn v2 raw-local ingestion over explicit surface files. Defaults to preview-only; set previewOnly=false only after user approval.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        sourceFiles: z.array(z.string().min(1)).min(1),
        adapter: z.string().min(1).optional(),
        previewOnly: z.boolean().default(true),
        maxRawBytes: z.number().int().min(1).max(50_000_000).default(5_000_000),
        maxTurns: z.number().int().min(1).max(1000).default(500),
        allowDuplicateImports: z.boolean().default(false),
        modelMode: z.enum(["deterministic-only", "opencode-host-sanitized-only", "opencode-host-raw-allowed"]).default("deterministic-only"),
        learnV2GoldensPath: z.string().min(1).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, sourceFiles, adapter, previewOnly, maxRawBytes, maxTurns, allowDuplicateImports, modelMode, learnV2GoldensPath }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "learn", () => runRawLocalLearning(root, {
        sourceFiles: sourceFiles.map((file) => resolvePath(file, root)),
        adapter,
        previewOnly,
        maxRawBytes,
        maxTurns,
        allowDuplicateImports,
        modelMode,
        learnV2GoldensPath
      })), root);
    }
  );

  registerTool(
    "osk_get_concept_review_queue",
    {
      title: "OpenSkillKit Learn v2 Concept Review Queue",
      description: "Return the persisted Learn v2 behavior-delta-first concept review queue, including focus cards, appendix counts, conflict/drift summaries, and declassified snippets only.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(stripLearnV2RawRefs(await readLearnV2ReviewQueue(root)), root);
    }
  );

  registerTool(
    "osk_review_concepts",
    {
      title: "OpenSkillKit Learn v2 Concept Review",
      description: "Accept, reject, lock, demote, narrow, edit, merge, split, supersede, or bulk-review Learn v2 concept cards. Active concepts sync into compatibility graphs unless compileActive=false.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        accept: z.array(z.string().min(1)).default([]),
        reject: z.array(z.string().min(1)).default([]),
        lock: z.array(z.string().min(1)).default([]),
        demote: z.array(z.string().min(1)).default([]),
        markOneOff: z.array(z.string().min(1)).default([]),
        narrowScopes: z.array(z.object({
          id: z.string().min(1),
          paths: z.array(z.string().min(1)).optional(),
          taskTypes: z.array(z.string().min(1)).optional(),
          negativeTriggers: z.array(z.string().min(1)).optional()
        })).default([]),
        edits: z.array(z.object({
          id: z.string().min(1),
          title: z.string().optional(),
          canonicalBehavior: z.string().optional(),
          activationPhrases: z.array(z.string().min(1)).optional()
        })).default([]),
        addCounterevidence: z.array(z.object({
          id: z.string().min(1),
          evidenceId: z.string().min(1),
          reason: z.string().min(1)
        })).default([]),
        mergeConcepts: z.array(z.object({
          targetId: z.string().min(1),
          sourceIds: z.array(z.string().min(1)).min(1),
          title: z.string().min(1).optional(),
          canonicalBehavior: z.string().min(1).optional(),
          activationPhrases: z.array(z.string().min(1)).optional()
        })).default([]),
        splitConcepts: z.array(z.object({
          sourceId: z.string().min(1),
          atomIds: z.array(z.string().min(1)).min(1),
          title: z.string().min(1).optional(),
          canonicalBehavior: z.string().min(1).optional(),
          paths: z.array(z.string().min(1)).optional(),
          taskTypes: z.array(z.string().min(1)).optional(),
          activationPhrases: z.array(z.string().min(1)).optional()
        })).default([]),
        supersedeConcepts: z.array(z.object({
          supersededId: z.string().min(1),
          supersededById: z.string().min(1),
          reason: z.string().min(1).optional()
        })).default([]),
        autoPolicy: z.boolean().default(false),
        bulkSafe: z.enum(["accept-low-risk", "reject-one-off", "mark-superseded"]).optional(),
        compileActive: z.boolean().default(true)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, ...options }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "review", () => applyLearnV2ConceptReview(root, options)), root);
    }
  );

  registerTool(
    "osk_compile_concepts",
    {
      title: "OpenSkillKit Learn v2 Concept Compile Preview",
      description: "Compile active Learn v2 concepts into compatibility preference/workflow outputs and declassification report preview.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      const config = await readProjectConfig(root);
      const store = await readLearnV2ConceptStore(root);
      return toolResult(await compileLearnV2ConceptPreview(root, config, store.cards, new Date()), root);
    }
  );

  registerTool(
    "osk_prepare_learn_v2_model_requests",
    {
      title: "OpenSkillKit Learn v2 Model Request Preparation",
      description: "Write prompt-safe episode bundles and concept-extraction prompts for OpenCode-configured agents. Does not call a provider.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await writeLearnV2ModelRequests(root), root);
    }
  );

  registerTool(
    "osk_apply_learn_v2_model_outputs",
    {
      title: "OpenSkillKit Learn v2 Model Output Apply",
      description: "Validate OpenCode-routed model JSON outputs against stored Learn v2 episodes and merge accepted atoms into candidate concepts.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        outputPaths: z.array(z.string().min(1)).min(1)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, outputPaths }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "learn", () => applyLearnV2ModelProposalOutputs(root, outputPaths.map((file) => resolvePath(file, root)))), root);
    }
  );

  registerTool(
    "osk_activate_learn_v2_concepts",
    {
      title: "OpenSkillKit Learn v2 Concept Activation",
      description: "Score reviewed Learn v2 concepts for the current task using deterministic lexical, path, command, task-type, and negative-trigger matching.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        query: z.string().optional(),
        paths: z.array(z.string().min(1)).default([]),
        commands: z.array(z.string().min(1)).default([]),
        taskTypes: z.array(z.string().min(1)).default([]),
        negativeSignals: z.array(z.string().min(1)).default([]),
        includeCandidates: z.boolean().default(false),
        limit: z.number().int().min(1).max(50).default(8)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, ...query }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await activateLearnV2Concepts(root, query), root);
    }
  );

  registerTool(
    "osk_record_learn_v2_concept_outcome",
    {
      title: "OpenSkillKit Learn v2 Concept Outcome",
      description: "Record local outcome telemetry for a Learn v2 concept activation without storing raw prompts, paths, or commands.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        conceptId: z.string().min(1),
        outcome: z.enum(["helpful", "ignored", "wrong", "harmful", "superseded"]),
        activationScore: z.number().min(0).max(1).optional(),
        query: z.string().optional(),
        taskId: z.string().optional(),
        paths: z.array(z.string().min(1)).default([]),
        commands: z.array(z.string().min(1)).default([]),
        reason: z.string().max(500).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, ...input }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "learn", () => recordLearnV2ConceptOutcome(root, input)), root);
    }
  );

  registerTool(
    "osk_get_learn_v2_vault_status",
    {
      title: "OpenSkillKit Learn v2 Vault Maintenance",
      description: "Return Learn v2 raw vault budget status and optionally garbage-collect expired unpinned raw blobs.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        gc: z.boolean().default(false),
        maxHotBytes: z.number().int().min(1).default(50_000_000)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, gc, maxHotBytes }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await runLearnV2RawVaultMaintenance(root, { gc, maxHotBytes }), root);
    }
  );

  registerTool(
    "osk_get_learn_v2_observability",
    {
      title: "OpenSkillKit Learn v2 Observability",
      description: "Return the latest declassified Learn v2 pipeline observability report, or a specific report path. Raw refs, source paths, raw prompts, and raw diffs are not included.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        reportPath: z.string().min(1).optional()
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, reportPath }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "status", () => readLearnV2PipelineObservabilityReport(root, reportPath)), root);
    }
  );

  registerTool(
    "osk_reconstruct_episodes",
    {
      title: "OpenSkillKit Learn v2 Episode Reconstruction",
      description: "Rebuild Learn v2 task episodes from persisted declassified analysis frames and refresh model request artifacts.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "learn", () => reconstructPersistedLearnV2Episodes(root)), root);
    }
  );

  registerTool(
    "osk_extract_concepts",
    {
      title: "OpenSkillKit Learn v2 Concept Extraction",
      description: "Extract deterministic behavior atoms and concept cards from the persisted Learn v2 episode store.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "learn", () => extractPersistedLearnV2Concepts(root)), root);
    }
  );

  registerTool(
    "osk_run_learn_v2_eval",
    {
      title: "OpenSkillKit Learn v2 Eval",
      description: "Run Learn v2 eval from persisted episode and concept stores, optionally with extraction golden scenarios.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        goldensPath: z.string().min(1).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, goldensPath }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "learn", () => runPersistedLearnV2Eval(root, { goldensPath })), root);
    }
  );

  registerTool(
    "osk_list_interaction_imports",
    {
      title: "OpenSkillKit List Interaction Imports",
      description: "List previous interaction import run summaries without raw source content.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult({ schemaVersion: "openskill-kit.interaction-import-runs.v1", runs: await readInteractionImportRuns(root) }, root);
    }
  );

  registerTool(
    "osk_explain_interaction_import",
    {
      title: "OpenSkillKit Explain Interaction Import",
      description: "Explain one interaction import run without reading raw source content.",
      inputSchema: z.object({ projectRoot: projectRootSchema, runId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, runId }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await explainInteractionImport(root, runId), root);
    }
  );

  registerTool(
    "osk_get_interaction_pool",
    {
      title: "OpenSkillKit Interaction Pool",
      description: "Return normalized interaction metadata records without raw session/export content.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await readInteractionPool(root), root);
    }
  );

  registerTool(
    "osk_get_git_local_context",
    {
      title: "OpenSkillKit Git Local Context",
      description: "Return metadata-only local git branch, changed files, aggregate diff stats, and recent commits without raw diffs.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        maxChangedFiles: z.number().int().min(1).max(500).default(80),
        maxRecentCommits: z.number().int().min(0).max(50).default(5)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, maxChangedFiles, maxRecentCommits }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await inspectGitLocalContext(root, { maxChangedFiles, maxRecentCommits }), root);
    }
  );

  registerTool(
    "osk_get_context_pack",
    {
      title: "OpenSkillKit Context Pack",
      description: "Return compiled project behavior context pack status and content.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      const contextPath = path.join(root, ".openskill-kit", "compiled", "context-pack.md");
      const text = await import("node:fs/promises").then((fs) => fs.readFile(contextPath, "utf8").catch(() => ""));
      return toolResult({ path: contextPath, content: text }, root);
    }
  );

  registerTool(
    "osk_get_relevant_preferences",
    {
      title: "OpenSkillKit Relevant Preferences",
      description: "Return compact ranked active preferences with relevance reasons.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        query: z.string().optional(),
        paths: z.array(z.string()).default([]),
        categories: z.array(z.enum(PreferenceCategories)).default([]),
        limit: z.number().int().min(1).max(50).default(12)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, query, paths, categories, limit }) => {
      const root = resolveProjectRoot(projectRoot);
      const bundle = await retrieveRelevantPreferences({ projectRoot: root, query, paths, categories, limit });
      return toolResult({ ...bundle, nodes: bundle.items.map((item) => item.node) }, root);
    }
  );

  registerTool(
    "osk_route_behavior",
    {
      title: "OpenSkillKit Route Behavior",
      description: "Plan whether a task should use local behavior, project evidence, review, or OpenWorld research.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        query: z.string().optional(),
        paths: z.array(z.string()).default([]),
        changedFiles: z.array(z.string()).default([]),
        commands: z.array(z.string()).default([])
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, query, paths, changedFiles, commands }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await routeBehavior({ projectRoot: root, query, paths, changedFiles, commands }), root);
    }
  );

  registerTool(
    "osk_get_task_context",
    {
      title: "OpenSkillKit Task Context",
      description: "Return the public task-start facade: route, relevant behavior, plugin health, review state, and next actions.",
      inputSchema: taskContextInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, query, paths, changedFiles, commands, limit }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "task", () => getAgentTaskContext({ projectRoot: root, query, paths, changedFiles, commands, limit })), root);
    }
  );

  registerTool(
    "osk_get_agent_task_context",
    {
      title: "OpenSkillKit Agent Task Context",
      description: "Return one-shot coding task context: route, relevant behavior, plugin health, review state, and next actions.",
      inputSchema: taskContextInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, query, paths, changedFiles, commands, limit }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await getAgentTaskContext({ projectRoot: root, query, paths, changedFiles, commands, limit }), root);
    }
  );

  registerTool(
    "osk_finish_task",
    {
      title: "OpenSkillKit Finish Task",
      description: "Record public task-end evidence, run learning, write session summaries, and return review next actions.",
      inputSchema: taskFinishInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, sessionId, summary, outcome, outcomeReason, files, commands, commandStatus, proposedPatchHash, finalPatchHash, diffStats, learn, compileSafe }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "task", () => finishAgentTask({ projectRoot: root, sessionId, summary, outcome, outcomeReason, files, commands, commandStatus, proposedPatchHash, finalPatchHash, diffStats, learn, compileSafe })), root);
    }
  );

  registerTool(
    "osk_finish_agent_task",
    {
      title: "OpenSkillKit Finish Agent Task",
      description: "Record safe task completion evidence, run learning, write session summaries, and return review next actions.",
      inputSchema: taskFinishInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, sessionId, summary, outcome, outcomeReason, files, commands, commandStatus, proposedPatchHash, finalPatchHash, diffStats, learn, compileSafe }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await finishAgentTask({ projectRoot: root, sessionId, summary, outcome, outcomeReason, files, commands, commandStatus, proposedPatchHash, finalPatchHash, diffStats, learn, compileSafe }), root);
    }
  );

  registerTool(
    "osk_record_event",
    {
      title: "OpenSkillKit Record Event",
      description: "Record one redacted local lifecycle event.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        sessionId: z.string().min(1).default("mcp-session"),
        eventType: z.enum(["session-start", "instructions-loaded", "user-prompt-submit", "assistant-message", "pre-tool-use", "post-tool-use", "post-tool-use-failure", "file-changed", "task-created", "task-completed", "permission-denied", "user-accepted", "user-rejected", "user-edited", "test-result", "review-comment", "session-end"]),
        intent: z.string().optional(),
        normalized: z.record(z.string(), z.unknown()).default({}),
        files: z.array(z.object({ path: z.string(), action: z.enum(["read", "write", "edit", "delete", "rename", "unknown"]).default("unknown") })).default([]),
        commands: z.array(z.object({ command: z.string(), args: z.array(z.string()).default([]), status: z.enum(["pass", "fail", "blocked", "timeout", "unknown"]).default("unknown"), exitCode: z.number().nullable().optional() })).default([])
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, sessionId, eventType, intent, normalized, files, commands }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await appendEvent(root, { sessionId, eventType, intent, source: { adapter: "mcp" }, normalized, files, commands }), root);
    }
  );

  registerTool(
    "osk_learn_from_session",
    {
      title: "OpenSkillKit Learn From Session",
      description: "Extract signals and update preference candidates from recorded events.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      const signals = await extractSignals(root);
      const graph = await updatePreferenceGraph(root);
      return toolResult({ signals, graph }, root);
    }
  );

  registerTool(
    "osk_compile_behavior_layer",
    {
      title: "OpenSkillKit Compile Behavior Layer",
      description: "Compile active behavior into context pack, skill, hooks, and MCP config.",
      inputSchema: z.object({ projectRoot: projectRootSchema, targets: z.array(z.enum(CompileTargets)).optional(), includeStagedPreview: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, targets, includeStagedPreview }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await compileBehaviorLayer(root, { targets, includeStagedPreview }), root);
    }
  );

  registerTool(
    "osk_explain_preference",
    {
      title: "OpenSkillKit Explain Preference",
      description: "Explain one preference node and its evidence.",
      inputSchema: z.object({ projectRoot: projectRootSchema, id: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, id }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await explainPreference(root, id), root);
    }
  );

  registerTool(
    "osk_get_preference_evidence",
    {
      title: "OpenSkillKit Preference Evidence",
      description: "Return one preference with sanitized evidence cards.",
      inputSchema: z.object({ projectRoot: projectRootSchema, id: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, id }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await explainPreferenceWithEvidence(root, id), root);
    }
  );

  registerTool(
    "osk_propose_preference",
    {
      title: "OpenSkillKit Propose Preference",
      description: "Submit a structured semantic preference proposal from a host agent session.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        sessionId: z.string().min(1),
        statement: z.string().min(8),
        category: z.enum(PreferenceCategories),
        scope: z.object({
          level: z.enum(["project", "path", "directory", "package", "language", "task", "user", "global"]),
          paths: z.array(z.string()).default([])
        }),
        evidence: z.array(z.object({ eventId: z.string().min(1), quote: z.string().optional(), file: z.string().optional(), command: z.string().optional() })).min(1),
        counterevidence: z.array(z.object({ eventId: z.string().min(1), quote: z.string().optional(), reason: z.string().optional() })).default([]),
        confidence: z.number().min(0).max(1),
        risk: z.enum(["low", "medium", "high"]).default("medium"),
        suggestedCompileTargets: z.array(z.enum(SuggestedCompileTargets)).default(["context-pack", "agent-skills"])
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, ...proposal }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await proposeSemanticPreference(root, { schemaVersion: "openskill-kit.semantic-proposal.v1", ...proposal }), root);
    }
  );

  registerTool(
    "osk_get_review_queue",
    {
      title: "OpenSkillKit Review Queue",
      description: "Write and return rich learning review queue artifacts.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await buildReviewQueue(root), root);
    }
  );

  registerTool(
    "osk_review_behavior",
    {
      title: "OpenSkillKit Review Behavior",
      description: "Facade for behavior review: read queue by default, or apply explicit review actions.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        action: z.enum(["queue", "apply"]).default("queue"),
        activate: z.array(z.string().min(1)).default([]),
        reject: z.array(z.string().min(1)).default([]),
        lock: z.array(z.string().min(1)).default([]),
        demote: z.array(z.string().min(1)).default([]),
        promote: z.array(z.string().min(1)).default([]),
        promoteGlobal: z.array(z.string().min(1)).default([]),
        activateAll: z.boolean().default(false),
        workflowActivate: z.array(z.string().min(1)).default([]),
        workflowReject: z.array(z.string().min(1)).default([]),
        workflowLock: z.array(z.string().min(1)).default([]),
        workflowDemote: z.array(z.string().min(1)).default([]),
        workflowActivateAll: z.boolean().default(false),
        approveCommandLabels: z.array(z.object({ hash: z.string().min(1), label: z.string().min(1).max(200) })).default([]),
        approvePathLabels: z.array(z.object({ hash: z.string().min(1), label: z.string().min(1).max(200) })).default([]),
        rejectCommandLabels: z.array(z.string().min(1)).default([]),
        rejectPathLabels: z.array(z.string().min(1)).default([])
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, action, workflowActivate, workflowReject, workflowLock, workflowDemote, workflowActivateAll, approveCommandLabels, approvePathLabels, rejectCommandLabels, rejectPathLabels, ...options }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "review", async () => {
        if (action === "queue") return buildReviewQueue(root);
        const preferences = await applyPreferenceReview(root, options);
        const hasWorkflowAction = workflowActivate.length > 0
          || workflowReject.length > 0
          || workflowLock.length > 0
          || workflowDemote.length > 0
          || workflowActivateAll;
        const workflows = hasWorkflowAction
          ? await applyWorkflowReview(root, {
            activate: workflowActivate,
            reject: workflowReject,
            lock: workflowLock,
            demote: workflowDemote,
            activateAll: workflowActivateAll
          })
          : undefined;
        const hasLabelAction = approveCommandLabels.length > 0 || approvePathLabels.length > 0 || rejectCommandLabels.length > 0 || rejectPathLabels.length > 0;
        const labels = hasLabelAction
          ? await applyAmbientLabelReview(root, {
            approveCommand: approveCommandLabels,
            approvePath: approvePathLabels,
            rejectCommand: rejectCommandLabels,
            rejectPath: rejectPathLabels
          })
          : undefined;
        return { preferences, workflows, labels };
      }), root);
    }
  );

  registerTool(
    "osk_apply_review_actions",
    {
      title: "OpenSkillKit Apply Review Actions",
      description: "Apply structured review decisions for preferences and workflow candidates.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        activate: z.array(z.string().min(1)).default([]),
        reject: z.array(z.string().min(1)).default([]),
        lock: z.array(z.string().min(1)).default([]),
        demote: z.array(z.string().min(1)).default([]),
        promote: z.array(z.string().min(1)).default([]),
        promoteGlobal: z.array(z.string().min(1)).default([]),
        activateAll: z.boolean().default(false),
        workflowActivate: z.array(z.string().min(1)).default([]),
        workflowReject: z.array(z.string().min(1)).default([]),
        workflowLock: z.array(z.string().min(1)).default([]),
        workflowDemote: z.array(z.string().min(1)).default([]),
        workflowActivateAll: z.boolean().default(false),
        edits: z.array(z.object({
          id: z.string().min(1),
          title: z.string().optional(),
          statement: z.string().optional(),
          category: z.enum(PreferenceCategories).optional(),
          scope: z.object({
            level: z.enum(["project", "path", "directory", "package", "language", "task", "user", "global"]),
            paths: z.array(z.string()).default([])
          }).optional(),
          confidence: z.number().min(0).max(1).optional(),
          polarity: z.enum(["positive", "negative", "neutral"]).optional()
        })).default([]),
        merges: z.array(z.object({
          targetId: z.string().min(1),
          sourceIds: z.array(z.string().min(1)).min(1),
          statement: z.string().optional()
        })).default([]),
        splits: z.array(z.object({
          id: z.string().min(1),
          statements: z.array(z.string().min(8)).min(2)
        })).default([])
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, workflowActivate, workflowReject, workflowLock, workflowDemote, workflowActivateAll, ...options }) => {
      const root = resolveProjectRoot(projectRoot);
      const preferences = await applyPreferenceReview(root, options);
      const hasWorkflowAction = workflowActivate.length > 0
        || workflowReject.length > 0
        || workflowLock.length > 0
        || workflowDemote.length > 0
        || workflowActivateAll;
      const workflows = hasWorkflowAction
        ? await applyWorkflowReview(root, {
          activate: workflowActivate,
          reject: workflowReject,
          lock: workflowLock,
          demote: workflowDemote,
          activateAll: workflowActivateAll
        })
        : undefined;
      return toolResult(workflows ? { preferences, workflows } : preferences, root);
    }
  );

  registerTool(
    "osk_get_behavior_manifest",
    {
      title: "OpenSkillKit Behavior Manifest",
      description: "Return generated AGENTS/CLAUDE manifest paths and content.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      const fs = await import("node:fs/promises");
      const agentsPath = path.join(root, ".openskill-kit", "compiled", "manifests", "AGENTS.md");
      const claudePath = path.join(root, ".openskill-kit", "compiled", "manifests", "CLAUDE.md");
      return toolResult({
        agentsPath,
        claudePath,
        agents: await fs.readFile(agentsPath, "utf8").catch(() => ""),
        claude: await fs.readFile(claudePath, "utf8").catch(() => "")
      }, root);
    }
  );

  registerTool(
    "osk_preview_manifest_install",
    {
      title: "OpenSkillKit Preview Manifest Install",
      description: "Preview managed AGENTS.md, CLAUDE.md, and path rules installation.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await installInstructionManifests(root, { dryRun: true }), root);
    }
  );

  registerTool(
    "osk_apply_manifest_install",
    {
      title: "OpenSkillKit Apply Manifest Install",
      description: "Install managed AGENTS.md, CLAUDE.md, and path rules when yes is true.",
      inputSchema: z.object({ projectRoot: projectRootSchema, yes: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, yes }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await installInstructionManifests(root, { dryRun: yes !== true, yes }), root);
    }
  );

  registerTool(
    "osk_preview_manifest_uninstall",
    {
      title: "OpenSkillKit Preview Manifest Uninstall",
      description: "Preview removing managed AGENTS.md, CLAUDE.md, and generated path rules.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await uninstallInstructionManifests(root, { dryRun: true }), root);
    }
  );

  registerTool(
    "osk_apply_manifest_uninstall",
    {
      title: "OpenSkillKit Apply Manifest Uninstall",
      description: "Remove managed AGENTS.md, CLAUDE.md, and generated path rules when yes is true.",
      inputSchema: z.object({ projectRoot: projectRootSchema, yes: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, yes }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await uninstallInstructionManifests(root, { dryRun: yes !== true, yes }), root);
    }
  );

  registerTool(
    "osk_validate_memory_candidate",
    {
      title: "OpenSkillKit Validate Memory Candidate",
      description: "Run memory integrity validation over current graph preferences.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await validateMemoryIntegrity(root), root);
    }
  );

  registerTool(
    "osk_get_calibration_report",
    {
      title: "OpenSkillKit Calibration Report",
      description: "Return review-outcome reliability by category and extractor.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await readCalibrationReport(root).catch(() => ({
        schemaVersion: "openskill-kit.calibration.v1",
        updatedAt: new Date(0).toISOString(),
        categories: {},
        extractors: {},
        scopes: {},
        evidenceKinds: {},
        privacyClasses: {},
        evalOutcomes: {}
      })), root);
    }
  );

  registerTool(
    "osk_export_behavior_pack",
    {
      title: "OpenSkillKit Export Behavior Pack",
      description: "Export reviewed project behavior without private event logs.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await exportProjectBehaviorPack(root), root);
    }
  );

  registerTool(
    "osk_pack_behavior",
    {
      title: "OpenSkillKit Pack Behavior",
      description: "Facade for safe behavior pack export, verify, inspect, diff, and staged import.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        action: z.enum(["export", "verify", "inspect", "diff", "import"]).default("export"),
        packPath: z.string().min(1).optional(),
        otherPackPath: z.string().min(1).optional(),
        dryRun: z.boolean().default(true),
        yes: z.boolean().default(false),
        trustHooks: z.boolean().default(false),
        review: z.boolean().default(false),
        maxChangedFiles: z.number().int().min(0).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, action, packPath, otherPackPath, dryRun, yes, trustHooks, review, maxChangedFiles }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "pack", async () => {
        if (action === "export") return exportProjectBehaviorPack(root);
        if (!packPath) throw new Error("packPath required for verify, inspect, diff, or import.");
        const resolvedPack = resolvePath(packPath, root);
        if (action === "verify") return verifyProjectBehaviorPack(resolvedPack);
        if (action === "inspect") return inspectProjectBehaviorPack(resolvedPack);
        if (action === "diff") {
          if (!otherPackPath) throw new Error("otherPackPath required for diff.");
          return diffProjectBehaviorPacks(resolvedPack, resolvePath(otherPackPath, root));
        }
        if (dryRun === false && yes !== true) throw new Error("osk_pack_behavior import requires yes=true when dryRun=false.");
        return importProjectBehaviorPack(root, resolvedPack, { dryRun, trustHooks, review, maxChangedFiles });
      }), root);
    }
  );

  registerTool(
    "osk_export_encrypted_behavior_pack",
    {
      title: "OpenSkillKit Export Encrypted Behavior Pack",
      description: "Export an encrypted privacy-safe Project Behavior Pack envelope.",
      inputSchema: z.object({ projectRoot: projectRootSchema, passphrase: z.string().min(8), outputPath: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, passphrase, outputPath }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await exportEncryptedProjectBehaviorPack(root, { passphrase, outputPath: outputPath ? resolvePath(outputPath, root) : undefined }), root);
    }
  );

  registerTool(
    "osk_verify_behavior_pack",
    {
      title: "OpenSkillKit Verify Behavior Pack",
      description: "Verify pack manifest, privacy flags, and file hashes.",
      inputSchema: z.object({ projectRoot: projectRootSchema, packPath: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, packPath }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await verifyProjectBehaviorPack(resolvePath(packPath, root)), root);
    }
  );

  registerTool(
    "osk_inspect_behavior_pack",
    {
      title: "OpenSkillKit Inspect Behavior Pack",
      description: "Inspect pack manifest, privacy flags, and signature state.",
      inputSchema: z.object({ projectRoot: projectRootSchema, packPath: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, packPath }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await inspectProjectBehaviorPack(resolvePath(packPath, root)), root);
    }
  );

  registerTool(
    "osk_diff_behavior_pack",
    {
      title: "OpenSkillKit Diff Behavior Pack",
      description: "Diff two Project Behavior Packs by manifest hashes.",
      inputSchema: z.object({ projectRoot: projectRootSchema, leftPackPath: z.string().min(1), rightPackPath: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, leftPackPath, rightPackPath }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await diffProjectBehaviorPacks(resolvePath(leftPackPath, root), resolvePath(rightPackPath, root)), root);
    }
  );

  registerTool(
    "osk_sign_behavior_pack",
    {
      title: "OpenSkillKit Sign Behavior Pack",
      description: "Sign a Project Behavior Pack with a local Ed25519 key.",
      inputSchema: z.object({ projectRoot: projectRootSchema, packPath: z.string().min(1), keyDir: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, packPath, keyDir }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await signProjectBehaviorPack(resolvePath(packPath, root), keyDir ? resolvePath(keyDir, root) : undefined), root);
    }
  );

  registerTool(
    "osk_import_behavior_pack",
    {
      title: "OpenSkillKit Import Behavior Pack",
      description: "Plan or import a verified Project Behavior Pack. Writes require yes=true when dryRun=false. Hooks require explicit trust.",
      inputSchema: z.object({ projectRoot: projectRootSchema, packPath: z.string().min(1), dryRun: z.boolean().default(true), yes: z.boolean().default(false), trustHooks: z.boolean().default(false), review: z.boolean().default(false), maxChangedFiles: z.number().int().min(0).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, packPath, dryRun, yes, trustHooks, review, maxChangedFiles }) => {
      const root = resolveProjectRoot(projectRoot);
      if (dryRun === false && yes !== true) throw new Error("osk_import_behavior_pack requires yes=true when dryRun=false.");
      return toolResult(await importProjectBehaviorPack(root, resolvePath(packPath, root), { dryRun, trustHooks, review, maxChangedFiles }), root);
    }
  );

  registerTool(
    "osk_import_encrypted_behavior_pack",
    {
      title: "OpenSkillKit Import Encrypted Behavior Pack",
      description: "Decrypt and plan or import an encrypted Project Behavior Pack envelope. Writes require yes=true when dryRun=false.",
      inputSchema: z.object({ projectRoot: projectRootSchema, encryptedPath: z.string().min(1), passphrase: z.string().min(8), dryRun: z.boolean().default(true), yes: z.boolean().default(false), trustHooks: z.boolean().default(false), review: z.boolean().default(false), maxChangedFiles: z.number().int().min(0).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, encryptedPath, passphrase, dryRun, yes, trustHooks, review, maxChangedFiles }) => {
      const root = resolveProjectRoot(projectRoot);
      if (dryRun === false && yes !== true) throw new Error("osk_import_encrypted_behavior_pack requires yes=true when dryRun=false.");
      return toolResult(await importEncryptedProjectBehaviorPack(root, resolvePath(encryptedPath, root), { passphrase, dryRun, trustHooks, review, maxChangedFiles }), root);
    }
  );

  registerTool(
    "osk_run_eval",
    {
      title: "OpenSkillKit Eval",
      description: "Run the public eval facade: deterministic replay, baseline compare, or explicit external-agent eval.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        mode: z.enum(["replay", "compare", "external-agent"]).default("replay"),
        scenariosPath: z.string().optional(),
        agentCommand: z.string().optional(),
        agentArgs: z.array(z.string()).default([]),
        dryRun: z.boolean().default(true),
        timeoutMs: z.number().int().min(1000).max(300000).default(30000)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, mode, scenariosPath, agentCommand, agentArgs, dryRun, timeoutMs }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "eval", async () => {
        const report = mode === "compare"
          ? await runBehaviorCompareEval({ projectRoot: root, scenariosPath })
          : mode === "external-agent"
            ? await runExternalAgentEval({ projectRoot: root, scenariosPath, agentCommand, agentArgs, dryRun, timeoutMs })
            : await runBehaviorEval({ projectRoot: root, scenariosPath });
        return {
          schemaVersion: "openskill-kit.eval-facade.v1",
          mode,
          report
        };
      }), root);
    }
  );

  registerTool(
    "osk_run_behavior_eval",
    {
      title: "OpenSkillKit Behavior Eval",
      description: "Run deterministic behavior adherence evals over compiled artifacts.",
      inputSchema: z.object({ projectRoot: projectRootSchema, scenariosPath: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, scenariosPath }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await runBehaviorEval({ projectRoot: root, scenariosPath }), root);
    }
  );

  registerTool(
    "osk_run_agent_ab_eval",
    {
      title: "OpenSkillKit Agent A/B Eval Preview",
      description: "Compare baseline replay against OpenSkillKit-enabled behavior for the same scenarios.",
      inputSchema: z.object({ projectRoot: projectRootSchema, scenariosPath: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, scenariosPath }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await runBehaviorCompareEval({ projectRoot: root, scenariosPath }), root);
    }
  );

  registerTool(
    "osk_run_external_agent_eval",
    {
      title: "OpenSkillKit External Agent Eval",
      description: "Write external-agent eval prompts or execute an explicit agent command without a shell.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        scenariosPath: z.string().optional(),
        agentCommand: z.string().optional(),
        agentArgs: z.array(z.string()).default([]),
        dryRun: z.boolean().default(true),
        timeoutMs: z.number().int().min(1000).max(300000).default(30000)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, scenariosPath, agentCommand, agentArgs, dryRun, timeoutMs }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await runExternalAgentEval({ projectRoot: root, scenariosPath, agentCommand, agentArgs, dryRun, timeoutMs }), root);
    }
  );

  registerTool(
    "osk_agent_doctor",
    {
      title: "OpenSkillKit Agent Doctor",
      description: "Check local agent hook readiness.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await runAgentDoctor(root), root);
    }
  );

  registerTool(
    "osk_install_agent_hooks",
    {
      title: "OpenSkillKit Install Agent Hooks",
      description: "Plan or install generated lifecycle hook config for a local agent target.",
      inputSchema: z.object({ projectRoot: projectRootSchema, target: z.enum(["project", "global"]), dryRun: z.boolean().default(true), yes: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, target, dryRun, yes }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await installAgentHooks({ projectRoot: root, target, dryRun, yes }), root);
    }
  );

  registerTool(
    "osk_preview_plugin_attach",
    {
      title: "OpenSkillKit Preview Plugin Attach",
      description: "Compile the plugin if needed and preview OpenCode-first host MCP config changes for an existing coding harness.",
      inputSchema: z.object({ projectRoot: projectRootSchema, host: z.enum(AgentPluginAttachHosts).default(DEFAULT_AGENT_PLUGIN_ATTACH_HOST) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, host }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await attachAgentPlugin(root, { host, dryRun: true }), root);
    }
  );

  registerTool(
    "osk_apply_plugin_attach",
    {
      title: "OpenSkillKit Apply Plugin Attach",
      description: "Write OpenCode-first host MCP config for the compiled OpenSkillKit plugin only after explicit approval.",
      inputSchema: z.object({ projectRoot: projectRootSchema, host: z.enum(AgentPluginAttachHosts).default(DEFAULT_AGENT_PLUGIN_ATTACH_HOST), yes: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, host, yes }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await attachAgentPlugin(root, { host, dryRun: yes !== true, yes }), root);
    }
  );

  registerTool(
    "osk_compile_deploy",
    {
      title: "OpenSkillKit Compile Deploy",
      description: "Facade for compile and preview/apply harness attachment.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        action: z.enum(["compile", "deploy"]).default("compile"),
        targets: z.array(z.enum(CompileTargets)).optional(),
        includeStagedPreview: z.boolean().default(false),
        host: z.enum(AgentPluginAttachHosts).default("opencode"),
        includeHooks: z.boolean().default(true),
        includeManifests: z.boolean().default(true),
        apply: z.boolean().default(false),
        yes: z.boolean().default(false)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, action, targets, includeStagedPreview, host, includeHooks, includeManifests, apply, yes }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, action === "deploy" ? "deploy" : "compile", async () => {
        const compile = await compileBehaviorLayer(root, { targets: targets ?? ["plugin"], includeStagedPreview });
        const deployApproved = apply && yes;
        const attachment = action === "deploy"
          ? await attachAgentPlugin(root, { host, dryRun: !deployApproved, yes: deployApproved })
          : undefined;
        const hooks = action === "deploy" && includeHooks
          ? await installAgentHooks({ projectRoot: root, target: "project", dryRun: !deployApproved, yes: deployApproved })
          : undefined;
        const manifests = action === "deploy" && includeManifests
          ? await installInstructionManifests(root, { target: "project", dryRun: !deployApproved, yes: deployApproved })
          : undefined;
        const deploymentMessages = [
          ...(attachment?.messages.map((message) => `Attachment: ${message}`) ?? []),
          ...(hooks?.messages.map((message) => `Hooks: ${message}`) ?? []),
          ...(manifests?.messages.map((message) => `Instruction manifests: ${message}`) ?? [])
        ];
        return {
          schemaVersion: "openskill-kit.compile-deploy.v1",
          action,
          compile,
          attachment,
          hooks,
          manifests,
          nextActions: deploymentMessages.length
            ? deploymentMessages
            : ["Run with action `deploy` to preview harness attachment after reviewing compiled artifacts."]
        };
      }), root);
    }
  );

  registerTool(
    "osk_get_plugin_attach_status",
    {
      title: "OpenSkillKit Plugin Attach Status",
      description: "Return host MCP attachment health for the compiled OpenSkillKit plugin.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await getAgentPluginAttachStatus(root), root);
    }
  );

  registerTool(
    "osk_get_plugin_install_profile",
    {
      title: "OpenSkillKit Plugin Install Profile",
      description: "Return the machine-readable install profile for attaching OpenSkillKit to an existing coding harness.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await getAgentPluginInstallProfile(root), root);
    }
  );

  registerTool(
    "osk_run_lifecycle_once",
    {
      title: "OpenSkillKit Run Lifecycle Once",
      description: "Summarize recent events, learn high-value signals, update graph, and optionally compile safe active behavior.",
      inputSchema: z.object({ projectRoot: projectRootSchema, maxEvents: z.number().int().min(1).max(5000).default(250), compileSafe: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, maxEvents, compileSafe }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await runLifecycleOnce({ projectRoot: root, maxEvents, compileSafe }), root);
    }
  );

  registerTool(
    "osk_mine_workflows",
    {
      title: "OpenSkillKit Mine Workflows",
      description: "Mine repeated project command/test sequences into review-safe Workflow Graph candidates.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        minOccurrences: z.number().int().min(2).max(20).default(2),
        maxSequenceLength: z.number().int().min(2).max(12).default(6)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, minOccurrences, maxSequenceLength }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await mineWorkflowGraph({ projectRoot: root, minOccurrences, maxSequenceLength }), root);
    }
  );

  registerTool(
    "osk_get_workflow_graph",
    {
      title: "OpenSkillKit Workflow Graph",
      description: "Return current Workflow Graph and Markdown summary.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      const config = await readProjectConfig(root);
      const graph = await readWorkflowGraph(root, config.projectId, new Date());
      return toolResult({ graph, markdown: renderWorkflowGraph(graph) }, root);
    }
  );

  registerTool(
    "osk_reset_state",
    {
      title: "OpenSkillKit Reset State",
      description: "Plan or reset selected local adaptive state.",
      inputSchema: z.object({ projectRoot: projectRootSchema, scopes: z.array(z.enum(["events", "signals", "reviews", "runtime", "compiled", "installs"])).default(["events", "signals", "reviews", "runtime"]), yes: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    },
    async ({ projectRoot, scopes, yes }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await resetProjectState(root, scopes, { yes }), root);
    }
  );

  registerTool(
    "osk_prune_state",
    {
      title: "OpenSkillKit Prune State",
      description: "Plan or prune old local run artifacts.",
      inputSchema: z.object({ projectRoot: projectRootSchema, keepRuns: z.number().int().min(0).max(1000).default(5), yes: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    },
    async ({ projectRoot, keepRuns, yes }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await pruneProjectState(root, { keepRuns, yes }), root);
    }
  );

  registerTool(
    "osk_archive_state",
    {
      title: "OpenSkillKit Archive State",
      description: "Plan or archive private event, signal, review, and runtime state.",
      inputSchema: z.object({ projectRoot: projectRootSchema, yes: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    },
    async ({ projectRoot, yes }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await archiveProjectState(root, { yes }), root);
    }
  );

  registerTool(
    "osk_compact_state",
    {
      title: "OpenSkillKit Compact State",
      description: "Write compact project state summary.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await compactProjectState(root), root);
    }
  );

  registerTool(
    "osk_run_full_doctor",
    {
      title: "OpenSkillKit Full Doctor",
      description: "Check environment plus adaptive config, hooks, MCP config, registry, pack, and graph freshness.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await runFullDoctor(root), root);
    }
  );

  registerTool(
    "osk_openworld_doctor",
    {
      title: "OpenSkillKit OpenWorld Doctor",
      description: "Explain which OpenWorld capabilities are real today and which remain scaffolded or missing.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await runOpenWorldDoctor(root), root);
    }
  );

  registerTool(
    "osk_run_openworld_workflow",
    {
      title: "OpenSkillKit OpenWorld Workflow",
      description: "Facade for research, evolve, verifier quality, reports, and promotion review.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        action: z.enum(["research", "evolve", "verifier-quality", "eval-report", "task-report", "promote-review"]).default("research"),
        taskId: z.string().min(1).optional(),
        query: z.string().optional(),
        paths: z.array(z.string().min(1)).default([]),
        suiteId: z.string().min(1).optional(),
        candidateSkillId: z.string().min(1).optional(),
        runId: z.string().min(1).optional(),
        sandboxMode: z.enum(["local-process", "docker"]).default("local-process"),
        dockerImage: z.string().min(1).optional(),
        maxRounds: z.number().int().min(1).max(5).default(3),
        timeoutMs: z.number().int().min(1000).max(300000).default(30000),
        write: z.boolean().default(true)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, action, taskId, query, paths, suiteId, candidateSkillId, runId, sandboxMode, dockerImage, maxRounds, timeoutMs, write }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, action === "research" ? "research" : action === "evolve" ? "evolve" : "verify", async () => {
        if (action === "eval-report") {
          if (!runId) throw new Error("runId required for eval-report.");
          return buildOpenWorldEvalReport(root, runId);
        }
        if (action === "task-report" || action === "promote-review" || action === "research") {
          if (!taskId) throw new Error("taskId required for this OpenWorld action.");
        }
        if (action === "task-report") return buildOpenWorldTaskReport(root, taskId!);
        if (action === "promote-review") {
          if (!runId) throw new Error("runId required for promote-review.");
          return promoteOpenWorldRunToReview(root, runId, { dryRun: true });
        }
        if (action === "research") return planOpenWorldResearch(root, taskId!, { query, paths, write });
        if (!taskId || !suiteId) throw new Error("taskId and suiteId required for evolve or verifier-quality.");
        if (action === "verifier-quality") return assessOpenWorldVerifierQuality(root, taskId, suiteId, { write });
        return runOpenWorldRefinement(root, taskId, suiteId, { candidateSkillId, sandboxMode, dockerImage, maxRounds, timeoutMs });
      }), root);
    }
  );

  registerTool(
    "osk_verify_behavior",
    {
      title: "OpenSkillKit Verify Behavior",
      description: "Facade for memory integrity, plugin integrity, doctor checks, and optional OpenWorld verifier quality.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1).optional(),
        suiteId: z.string().min(1).optional(),
        write: z.boolean().default(true)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, taskId, suiteId, write }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await withMcpCommandTelemetry(root, "verify", async () => {
        const memory = await validateMemoryIntegrity(root);
        const plugin = await getCompiledPluginStatus(root);
        const harness = await verifyHarnessReadiness(root);
        const doctor = await runFullDoctor(root).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
        const openWorld = taskId && suiteId
          ? await assessOpenWorldVerifierQuality(root, taskId, suiteId, { write })
          : await runOpenWorldDoctor(root).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
        return {
          schemaVersion: "openskill-kit.verify-behavior.v1",
          memory,
          plugin,
          harness,
          doctor,
          openWorld,
          hiddenOracleProof: false,
          proofLevel: taskId && suiteId ? "artifact-verifier" : "local-integrity"
        };
      }), root);
    }
  );

  registerTool(
    "osk_openworld_source_plan",
    {
      title: "OpenSkillKit OpenWorld Source Plan",
      description: "Plan leakage-audited local source candidates and sanitized OpenWorld research queries before ingesting sources.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1),
        query: z.string().optional(),
        paths: z.array(z.string().min(1)).default([]),
        maxCandidates: z.number().int().min(1).max(25).default(8),
        maxFilesScanned: z.number().int().min(1).max(1000).default(250),
        includeAutonomousWebCandidates: z.boolean().default(true),
        write: z.boolean().default(true)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, taskId, query, paths, maxCandidates, maxFilesScanned, includeAutonomousWebCandidates, write }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await planOpenWorldResearch(root, taskId, { query, paths, maxCandidates, maxFilesScanned, includeAutonomousWebCandidates, write }), root);
    }
  );

  registerTool(
    "osk_openworld_retrieval_adapters",
    {
      title: "OpenSkillKit OpenWorld Retrieval Adapters",
      description: "List OpenWorld retrieval adapters, allow-web gates, network policy, limits, and safeguards for a task.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1)
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, taskId }) => {
      const root = resolveProjectRoot(projectRoot);
      const task = await readOpenWorldTask(root, taskId);
      return toolResult({ schemaVersion: "openskill-kit.openworld-retrieval-adapters.v1", taskId: task.id, adapters: buildOpenWorldRetrievalAdapters(task) }, root);
    }
  );

  registerTool(
    "osk_openworld_ingest_source",
    {
      title: "OpenSkillKit OpenWorld Ingest Source",
      description: "Ingest a project-local file or explicit web source for an OpenWorld task with leakage and trust gates.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1),
        file: z.string().min(1).optional(),
        url: z.string().url().optional(),
        title: z.string().optional(),
        content: z.string().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, taskId, file, url, title, content }) => {
      const root = resolveProjectRoot(projectRoot);
      if (file && url) throw new Error("Pass file or url, not both.");
      if (file) return toolResult(await ingestLocalOpenWorldSource(root, taskId, file), root);
      if (url) return toolResult(await ingestWebOpenWorldSource(root, taskId, { url, title, content }), root);
      throw new Error("file or url required.");
    }
  );

  registerTool(
    "osk_openworld_execute_source_plan",
    {
      title: "OpenSkillKit OpenWorld Execute Source Plan",
      description: "Preview or execute a leakage-audited OpenWorld source plan. Writes require yes=true when dryRun=false.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1),
        planId: z.string().min(1).optional(),
        includeAvailable: z.boolean().default(false),
        maxLocalSources: z.number().int().min(0).max(25).default(5),
        includeAutonomousWeb: z.boolean().default(false),
        maxAutonomousWebSources: z.number().int().min(0).max(10).default(3),
        explicitWebSources: z.array(z.object({
          url: z.string().url(),
          title: z.string().optional(),
          content: z.string().optional(),
          timeoutMs: z.number().int().min(1000).max(120000).optional(),
          maxBytes: z.number().int().min(1000).max(2000000).optional()
        })).default([]),
        dryRun: z.boolean().default(true),
        yes: z.boolean().default(false),
        write: z.boolean().default(true)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, taskId, planId, includeAvailable, maxLocalSources, includeAutonomousWeb, maxAutonomousWebSources, explicitWebSources, dryRun, yes, write }) => {
      const root = resolveProjectRoot(projectRoot);
      if (dryRun === false && yes !== true) throw new Error("osk_openworld_execute_source_plan requires yes=true when dryRun=false.");
      return toolResult(await executeOpenWorldResearchPlan(root, taskId, {
        planId,
        includeAvailable,
        maxLocalSources,
        includeAutonomousWeb,
        maxAutonomousWebSources,
        explicitWebSources,
        dryRun: dryRun !== false,
        write
      }), root);
    }
  );

  registerTool(
    "osk_openworld_sources",
    {
      title: "OpenSkillKit OpenWorld Sources",
      description: "Return OpenWorld source index and trust cache.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult({ index: await readOpenWorldSourceIndex(root), trust: await readOpenWorldTrustCache(root) }, root);
    }
  );

  registerTool(
    "osk_openworld_build_verifier",
    {
      title: "OpenSkillKit OpenWorld Build Verifier",
      description: "Build a leakage-audited visible/holdout virtual verifier suite from Anchor Card ids.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1),
        anchorIds: z.array(z.string().min(1)).min(1)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, taskId, anchorIds }) => {
      const root = resolveProjectRoot(projectRoot);
      const fs = await import("node:fs/promises");
      const anchors = await Promise.all(anchorIds.map(async (anchorId) => {
        const file = path.join(root, ".openskill-kit", "openworld", "tasks", taskId, "anchors", `${anchorId}.json`);
        return AnchorCardSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
      }));
      return toolResult(await buildVirtualSuiteFromAnchors(root, taskId, anchors), root);
    }
  );

  registerTool(
    "osk_openworld_run_verifier",
    {
      title: "OpenSkillKit OpenWorld Run Verifier",
      description: "Run a generated OpenWorld visible or holdout virtual verifier suite in local-process or opt-in Docker sandbox mode.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1),
        suiteId: z.string().min(1),
        split: z.enum(["visible", "holdout", "all"]).default("visible"),
        sandboxMode: z.enum(["local-process", "docker"]).default("local-process"),
        dockerImage: z.string().min(1).optional(),
        timeoutMs: z.number().int().min(1000).max(300000).default(30000)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, taskId, suiteId, split, sandboxMode, dockerImage, timeoutMs }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await runVirtualTestSuite(root, taskId, suiteId, { split, sandboxMode, dockerImage, timeoutMs }), root);
    }
  );

  registerTool(
    "osk_openworld_candidate_skill",
    {
      title: "OpenSkillKit OpenWorld Candidate Skill",
      description: "Generate a review-only OpenWorld candidate skill from Anchor Cards.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1),
        anchorIds: z.array(z.string().min(1)).min(1),
        suiteIds: z.array(z.string().min(1)).default([]),
        name: z.string().min(1).optional(),
        write: z.boolean().default(true)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, taskId, anchorIds, suiteIds, name, write }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await generateOpenWorldCandidateSkill(root, taskId, { anchorIds, suiteIds, name, write }), root);
    }
  );

  registerTool(
    "osk_openworld_repair_candidate",
    {
      title: "OpenSkillKit OpenWorld Repair Candidate",
      description: "Run a local-process or opt-in Docker sandbox repair loop for a review-only OpenWorld candidate skill revision.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1),
        candidateSkillId: z.string().min(1),
        suiteId: z.string().min(1).optional(),
        failureType: z.enum(["missing-knowledge", "verifier-bug", "source-conflict", "skill-failure", "sandbox-error", "leakage", "overfit-risk", "unknown"]).optional(),
        notes: z.array(z.string().min(1)).default([]),
        sandboxMode: z.enum(["local-process", "docker"]).default("local-process"),
        dockerImage: z.string().min(1).optional(),
        maxRounds: z.number().int().min(1).max(5).default(1),
        timeoutMs: z.number().int().min(1000).max(300000).default(30000)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, taskId, candidateSkillId, suiteId, failureType, notes, sandboxMode, dockerImage, maxRounds, timeoutMs }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await runOpenWorldCandidateRepairLoop(root, taskId, {
        candidateSkillId,
        suiteId,
        failureType,
        notes,
        sandboxMode,
        dockerImage,
        maxRounds,
        timeoutMs
      }), root);
    }
  );

  registerTool(
    "osk_openworld_verifier_quality",
    {
      title: "OpenSkillKit OpenWorld Verifier Quality",
      description: "Score an OpenWorld verifier suite for traceability, determinism, holdout coverage, and leakage metadata.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1),
        suiteId: z.string().min(1),
        write: z.boolean().default(true)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, taskId, suiteId, write }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await assessOpenWorldVerifierQuality(root, taskId, suiteId, { write }), root);
    }
  );

  registerTool(
    "osk_openworld_refine",
    {
      title: "OpenSkillKit OpenWorld Refine",
      description: "Run bounded visible verifier refinement and a final holdout check, then write an OpenWorld EvolutionRun.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1),
        suiteId: z.string().min(1),
        candidateSkillId: z.string().min(1).optional(),
        sandboxMode: z.enum(["local-process", "docker"]).default("local-process"),
        dockerImage: z.string().min(1).optional(),
        maxRounds: z.number().int().min(1).max(5).default(3),
        timeoutMs: z.number().int().min(1000).max(300000).default(30000)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, taskId, suiteId, candidateSkillId, sandboxMode, dockerImage, maxRounds, timeoutMs }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await runOpenWorldRefinement(root, taskId, suiteId, { candidateSkillId, sandboxMode, dockerImage, maxRounds, timeoutMs }), root);
    }
  );

  registerTool(
    "osk_openworld_eval_report",
    {
      title: "OpenSkillKit OpenWorld Eval Report",
      description: "Write a leakage-aware OpenWorld eval report for an EvolutionRun without claiming hidden-oracle proof.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        runId: z.string().min(1)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, runId }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await buildOpenWorldEvalReport(root, runId), root);
    }
  );

  registerTool(
    "osk_openworld_hidden_oracle_harness",
    {
      title: "OpenSkillKit OpenWorld Hidden Oracle Harness",
      description: "Write a static denied-path harness report without reading hidden oracle contents or claiming benchmark proof.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1),
        suiteId: z.string().min(1).optional(),
        deniedPaths: z.array(z.string().min(1)).default([]),
        benchmarkName: z.string().min(1).optional(),
        benchmarkResultPath: z.string().min(1).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, taskId, suiteId, deniedPaths, benchmarkName, benchmarkResultPath }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await buildOpenWorldHiddenOracleHarness(root, taskId, { suiteId, deniedPaths, benchmarkName, benchmarkResultPath }), root);
    }
  );

  registerTool(
    "osk_openworld_task_report",
    {
      title: "OpenSkillKit OpenWorld Task Report",
      description: "Collect sources, anchors, verifier suites, runs, eval reports, and next actions for one OpenWorld task.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1),
        write: z.boolean().default(false)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, taskId, write }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await buildOpenWorldTaskReport(root, taskId, { write }), root);
    }
  );

  registerTool(
    "osk_openworld_promote_review",
    {
      title: "OpenSkillKit OpenWorld Promote To Review",
      description: "Create a review-only semantic preference proposal from a passed OpenWorld run. Does not activate behavior.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        runId: z.string().min(1),
        statement: z.string().min(8).optional(),
        category: z.enum(PreferenceCategories).optional(),
        dryRun: z.boolean().default(false)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, runId, statement, category, dryRun }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await promoteOpenWorldRunToReview(root, runId, { statement, category, dryRun }), root);
    }
  );

  registerTool(
    "openskill_doctor",
    {
      title: "OpenSkill Kit Doctor",
      description: "Check local environment and agent skill targets.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => toolResult(await runDoctor(resolveProjectRoot(projectRoot)), resolveProjectRoot(projectRoot))
  );

  registerTool(
    "openskill_draft",
    {
      title: "OpenSkill Kit Draft",
      description: "Draft a deterministic local skill package for a topic.",
      inputSchema: z.object({ topic: topicSchema, projectRoot: projectRootSchema, noLlm: z.boolean().default(true), evidenceFiles: evidenceFilesSchema, evidenceUrls: evidenceUrlsSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ topic, projectRoot, noLlm, evidenceFiles, evidenceUrls }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await draftSkill({ topic, projectRoot: root, noLlm, evidenceFiles, evidenceUrls }), root);
    }
  );

  registerTool(
    "openskill_evolve",
    {
      title: "OpenSkill Kit Evolve",
      description: "Draft and verify a skill through the local evolution loop.",
      inputSchema: z.object({
        topic: topicSchema,
        projectRoot: projectRootSchema,
        noLlm: z.boolean().default(true),
        evidenceFiles: evidenceFilesSchema,
        evidenceUrls: evidenceUrlsSchema,
        maxRounds: z.number().int().min(1).max(5).default(3),
        runRepoChecks: z.boolean().default(false)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ topic, projectRoot, noLlm, evidenceFiles, evidenceUrls, maxRounds, runRepoChecks }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await evolveSkill({ topic, projectRoot: root, noLlm, evidenceFiles, evidenceUrls, maxRounds, runRepoChecks }), root);
    }
  );

  registerTool(
    "openskill_audit",
    {
      title: "OpenSkill Kit Audit",
      description: "Run the safety scanner against a skill package.",
      inputSchema: z.object({ skillPath: skillPathSchema, projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ skillPath, projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await scanSkillPath(resolvePath(skillPath, root)), root);
    }
  );

  registerTool(
    "openskill_test",
    {
      title: "OpenSkill Kit Test",
      description: "Run verifier pack checks against a skill package.",
      inputSchema: z.object({ skillPath: skillPathSchema, projectRoot: projectRootSchema, runRepoChecks: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ skillPath, projectRoot, runRepoChecks }) => {
      const root = resolveProjectRoot(projectRoot);
      const absoluteSkillPath = resolvePath(skillPath, root);
      const reportDir = path.join(root, ".openskill-kit", "reports", path.basename(absoluteSkillPath));
      return toolResult(await verifySkill(absoluteSkillPath, reportDir, undefined, { runRepoChecks }), root);
    }
  );

  registerTool(
    "openskill_evaluate",
    {
      title: "OpenSkill Kit Evaluate",
      description: "Write a leakage-aware evaluation report for a skill package.",
      inputSchema: z.object({ skillPath: skillPathSchema, projectRoot: projectRootSchema, runRepoChecks: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ skillPath, projectRoot, runRepoChecks }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await evaluateSkill(resolvePath(skillPath, root), { runRepoChecks }), root);
    }
  );

  registerTool(
    "openskill_install",
    {
      title: "OpenSkill Kit Install",
      description: "Plan or perform skill installation into local agent skill targets.",
      inputSchema: z.object({
        skillPath: skillPathSchema,
        target: targetSchema,
        projectRoot: projectRootSchema,
        dryRun: z.boolean().default(true),
        yes: z.boolean().default(false),
        allowCriticalRisk: z.boolean().default(false)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ skillPath, target, projectRoot, dryRun, yes, allowCriticalRisk }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(
        await installSkill({
          skillPath: resolvePath(skillPath, root),
          target: normalizeInstallTarget(target),
          projectRoot: root,
          dryRun,
          yes,
          allowCriticalRisk
        }),
        root
      );
    }
  );

  registerTool(
    "openskill_list",
    {
      title: "OpenSkill Kit List",
      description: "List local openskill-kit registry entries.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await readRegistry(root), root);
    }
  );

  registerTool(
    "openskill_inspect",
    {
      title: "OpenSkill Kit Inspect",
      description: "Inspect a skill package by path.",
      inputSchema: z.object({ skillPath: skillPathSchema, projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ skillPath, projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await loadSkillPackage(resolvePath(skillPath, root)), root);
    }
  );

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = createOpenSkillMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function resolveProjectRoot(value: string | undefined): string {
  return path.resolve(value ?? process.env[AGENT_PLUGIN_PROJECT_ROOT_ENV] ?? process.cwd());
}

function resolveMcpProfile(value: string | undefined): OpenSkillMcpProfile {
  return value === "advanced" ? "advanced" : "public";
}

function resolvePath(value: string, projectRoot: string): string {
  return path.resolve(projectRoot, value);
}

function normalizeInstallTarget(value: string): InstallTarget {
  const legacyProject = ["open", "code-project"].join("");
  const legacyGlobal = ["open", "code-global"].join("");
  const normalized = value === legacyProject ? "local-project" : value === legacyGlobal ? "local-global" : value;
  if (normalized === "local-project" || normalized === "local-global" || normalized === "agents-project" || normalized === "agents-global") return normalized;
  throw new Error(`Invalid target: ${value}`);
}

async function withMcpCommandTelemetry<T>(
  projectRoot: string,
  family: CommandTelemetryFamily,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    await recordMcpCommandTelemetry(projectRoot, family, "success", startedAt);
    return result;
  } catch (error) {
    await recordMcpCommandTelemetry(projectRoot, family, "failure", startedAt);
    throw error;
  }
}

async function recordMcpCommandTelemetry(
  projectRoot: string,
  family: CommandTelemetryFamily,
  status: "success" | "failure",
  startedAt: number
): Promise<void> {
  const configExists = await fs.stat(path.join(projectRoot, ".openskill-kit", "config.json")).then(() => true).catch(() => false);
  if (!configExists) return;
  await recordCommandTelemetry(projectRoot, {
    surface: "mcp",
    family,
    status,
    durationMs: Date.now() - startedAt
  }).catch(() => undefined);
}

function toolResult(data: unknown, projectRoot: string): CallToolResult {
  const sanitized = sanitizeForOutput(data, projectRoot);
  return {
    content: [{ type: "text", text: JSON.stringify(sanitized, null, 2) }],
    structuredContent: { result: sanitized }
  };
}

function sanitizeForOutput(value: unknown, projectRoot: string): unknown {
  if (typeof value === "string") return sanitizeText(value, projectRoot);
  if (Array.isArray(value)) return value.map((item) => sanitizeForOutput(item, projectRoot));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeForOutput(nested, projectRoot)]));
  }
  return value;
}

function stripLearnV2RawRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLearnV2RawRefs);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "rawRef" && key !== "rawRefs")
        .map(([key, nested]) => [key, stripLearnV2RawRefs(nested)])
    );
  }
  return value;
}

function sanitizeText(value: string, projectRoot: string): string {
  const roots = [projectRoot, path.normalize(projectRoot), process.cwd(), path.normalize(process.cwd()), os.homedir(), path.normalize(os.homedir())];
  return roots.reduce((current, root) => {
    const replacement = root === os.homedir() || root === path.normalize(os.homedir()) ? "~" : ".";
    return current.replaceAll(root, replacement);
  }, value);
}

if (isDirectRun()) {
  startStdioServer().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isDirectRun(): boolean {
  if (!process.argv[1]) return false;
  const invoked = path.basename(process.argv[1]);
  return invoked === "index.ts" || invoked === "index.js" || invoked === "openskill-kit-mcp.cjs";
}
