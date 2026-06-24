#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  draftSkill,
  evaluateSkill,
  evolveSkill,
  installSkill,
  loadSkillPackage,
  readRegistry,
  runDoctor,
  scanSkillPath,
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
        "Use openskill-kit tools to draft, verify, audit, and install coding-agent skills. Default to local deterministic mode. Keep dryRun true unless user explicitly approves writes."
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
