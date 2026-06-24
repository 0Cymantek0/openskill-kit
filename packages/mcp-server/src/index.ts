#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  appendEvent,
  compileBehaviorLayer,
  draftSkill,
  evaluateSkill,
  explainPreference,
  exportProjectBehaviorPack,
  extractSignals,
  evolveSkill,
  getAdaptiveStatus,
  initAdaptiveProject,
  importProjectBehaviorPack,
  installSkill,
  loadSkillPackage,
  readPreferenceGraph,
  readRegistry,
  runBehaviorEval,
  runDoctor,
  scanSkillPath,
  signProjectBehaviorPack,
  updatePreferenceGraph,
  verifyProjectBehaviorPack,
  verifySkill,
  type InstallTarget
} from "@openskill-kit/core";

const VERSION = "0.1.0";

const targetSchema = z.enum(["opencode-project", "opencode-global", "agents-project", "agents-global"]);
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
      return toolResult(result, root);
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
      description: "Return active preferences, optionally filtered by query text.",
      inputSchema: z.object({ projectRoot: projectRootSchema, query: z.string().optional(), limit: z.number().int().min(1).max(50).default(12) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ projectRoot, query, limit }) => {
      const root = resolveProjectRoot(projectRoot);
      const graph = await readPreferenceGraph(root);
      const words = new Set((query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
      const nodes = graph.nodes
        .filter((node) => node.status === "active" || node.status === "locked")
        .map((node) => ({ node, score: relevance(node.statement, words) + node.confidence }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((item) => item.node);
      return toolResult({ nodes }, root);
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
      inputSchema: z.object({ projectRoot: projectRootSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await compileBehaviorLayer(root), root);
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
      inputSchema: z.object({ projectRoot: projectRootSchema, packPath: z.string().min(1), dryRun: z.boolean().default(true), trustHooks: z.boolean().default(false) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ projectRoot, packPath, dryRun, trustHooks }) => {
      const root = resolveProjectRoot(projectRoot);
      return toolResult(await importProjectBehaviorPack(root, resolvePath(packPath, root), { dryRun, trustHooks }), root);
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
      description: "Plan or perform skill installation into OpenCode or agents skill targets.",
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
          target: target as InstallTarget,
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
  return path.resolve(value ?? process.cwd());
}

function resolvePath(value: string, projectRoot: string): string {
  return path.resolve(projectRoot, value);
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

function relevance(statement: string, words: Set<string>): number {
  if (words.size === 0) return 0;
  const lower = statement.toLowerCase();
  let score = 0;
  for (const word of words) if (lower.includes(word)) score += 0.1;
  return score;
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
