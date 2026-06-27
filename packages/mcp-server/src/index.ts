#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  appendEvent,
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
  getAgentPluginAttachStatus,
  getAgentTaskContext,
  finishAgentTask,
  getCompiledPluginStatus,
  getAdaptiveStatus,
  assessOpenWorldVerifierQuality,
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
  readOpenWorldTask,
  readOpenWorldSourceIndex,
  readOpenWorldTrustCache,
  readRegistry,
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
  verifyProjectBehaviorPack,
  verifySkill,
  AgentPluginAttachHosts,
  CompileTargets,
  PreferenceCategories,
  SuggestedCompileTargets,
  type InstallTarget
} from "@openskill-kit/core";

const VERSION = "0.1.0";

const targetSchema = z.string().min(1);
const projectRootSchema = z.string().min(1).optional();
const topicSchema = z.string().min(1).max(200);
const skillPathSchema = z.string().min(1);
const evidenceFilesSchema = z.array(z.string().min(1)).default([]);
const evidenceUrlsSchema = z.array(z.string().url()).default([]);

export function createOpenSkillMcpServer(): McpServer {
  const server = new McpServer(
    { name: "openskill-kit-mcp", version: VERSION },
    {
      instructions:
        "Use OpenSkillKit tools to load project behavior, record safe local events, learn preference candidates, compile behavior artifacts, and install skills. Keep dryRun true unless user explicitly approves writes."
    }
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "osk_get_agent_task_context",
    {
      title: "OpenSkillKit Agent Task Context",
      description: "Return one-shot coding task context: route, relevant behavior, plugin health, review state, and next actions.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        query: z.string().optional(),
        paths: z.array(z.string()).default([]),
        changedFiles: z.array(z.string()).default([]),
        commands: z.array(z.string()).default([]),
        limit: z.number().int().min(1).max(20).default(8)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, query, paths, changedFiles, commands, limit }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await getAgentTaskContext({ projectRoot: root, query, paths, changedFiles, commands, limit }), root);
    }
  );

  server.registerTool(
    "osk_finish_agent_task",
    {
      title: "OpenSkillKit Finish Agent Task",
      description: "Record safe task completion evidence, run learning, write session summaries, and return review next actions.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        sessionId: z.string().min(1).default("agent-task"),
        summary: z.string().min(1).max(2000),
        outcome: z.enum(["completed", "accepted", "rejected", "edited"]).default("completed"),
        files: z.array(z.string().min(1)).default([]),
        commands: z.array(z.string().min(1)).default([]),
        commandStatus: z.enum(["pass", "fail", "blocked", "timeout", "unknown"]).default("unknown"),
        learn: z.boolean().default(true),
        compileSafe: z.boolean().default(false)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, sessionId, summary, outcome, files, commands, commandStatus, learn, compileSafe }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await finishAgentTask({ projectRoot: root, sessionId, summary, outcome, files, commands, commandStatus, learn, compileSafe }), root);
    }
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "osk_import_behavior_pack",
    {
      title: "OpenSkillKit Import Behavior Pack",
      description: "Plan or import a verified Project Behavior Pack. Hooks require explicit trust.",
      inputSchema: z.object({ projectRoot: projectRootSchema, packPath: z.string().min(1), dryRun: z.boolean().default(true), trustHooks: z.boolean().default(false), review: z.boolean().default(false), maxChangedFiles: z.number().int().min(0).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, packPath, dryRun, trustHooks, review, maxChangedFiles }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await importProjectBehaviorPack(root, resolvePath(packPath, root), { dryRun, trustHooks, review, maxChangedFiles }), root);
    }
  );

  server.registerTool(
    "osk_import_encrypted_behavior_pack",
    {
      title: "OpenSkillKit Import Encrypted Behavior Pack",
      description: "Decrypt and plan or import an encrypted Project Behavior Pack envelope.",
      inputSchema: z.object({ projectRoot: projectRootSchema, encryptedPath: z.string().min(1), passphrase: z.string().min(8), dryRun: z.boolean().default(true), trustHooks: z.boolean().default(false), review: z.boolean().default(false), maxChangedFiles: z.number().int().min(0).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, encryptedPath, passphrase, dryRun, trustHooks, review, maxChangedFiles }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await importEncryptedProjectBehaviorPack(root, resolvePath(encryptedPath, root), { passphrase, dryRun, trustHooks, review, maxChangedFiles }), root);
    }
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "osk_preview_plugin_attach",
    {
      title: "OpenSkillKit Preview Plugin Attach",
      description: "Compile the plugin if needed and preview host MCP config changes for an existing coding harness.",
      inputSchema: z.object({ projectRoot: projectRootSchema, host: z.enum(AgentPluginAttachHosts).default("generic-mcp") }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, host }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await attachAgentPlugin(root, { host, dryRun: true }), root);
    }
  );

  server.registerTool(
    "osk_apply_plugin_attach",
    {
      title: "OpenSkillKit Apply Plugin Attach",
      description: "Write host MCP config for the compiled OpenSkillKit plugin only after explicit approval.",
      inputSchema: z.object({ projectRoot: projectRootSchema, host: z.enum(AgentPluginAttachHosts).default("generic-mcp"), yes: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, host, yes }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await attachAgentPlugin(root, { host, dryRun: yes !== true, yes }), root);
    }
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "osk_openworld_execute_source_plan",
    {
      title: "OpenSkillKit OpenWorld Execute Source Plan",
      description: "Execute a leakage-audited OpenWorld source plan by ingesting recommended local sources and explicit vetted URLs.",
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
        dryRun: z.boolean().default(false),
        write: z.boolean().default(true)
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, taskId, planId, includeAvailable, maxLocalSources, includeAutonomousWeb, maxAutonomousWebSources, explicitWebSources, dryRun, write }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await executeOpenWorldResearchPlan(root, taskId, {
        planId,
        includeAvailable,
        maxLocalSources,
        includeAutonomousWeb,
        maxAutonomousWebSources,
        explicitWebSources,
        dryRun,
        write
      }), root);
    }
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "osk_openworld_hidden_oracle_harness",
    {
      title: "OpenSkillKit OpenWorld Hidden Oracle Harness",
      description: "Write a static denied-path harness report without reading hidden oracle contents or claiming benchmark proof.",
      inputSchema: z.object({
        projectRoot: projectRootSchema,
        taskId: z.string().min(1),
        suiteId: z.string().min(1).optional(),
        deniedPaths: z.array(z.string().min(1)).default([])
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, taskId, suiteId, deniedPaths }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await buildOpenWorldHiddenOracleHarness(root, taskId, { suiteId, deniedPaths }), root);
    }
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "openskill_doctor",
    {
      title: "OpenSkill Kit Doctor",
      description: "Check local environment and agent skill targets.",
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot }) => toolResult(await runDoctor(resolveProjectRoot(projectRoot)), resolveProjectRoot(projectRoot))
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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
