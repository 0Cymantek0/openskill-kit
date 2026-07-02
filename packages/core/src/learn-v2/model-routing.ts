import { promises as fs } from "node:fs";
import path from "node:path";
import {
  OpenCodePermissionProfiles,
  type OpenCodePermissionMap,
  readOrCreateModelRouting,
  resolveModelRouting,
  type ModelRouteName,
  type OpenCodePermissionProfileName,
  type OpenCodePermissionRule,
  type ResolvedModelRoute
} from "../config/model-routing.js";
import { writeJsonAtomic } from "../storage/atomic.js";

export const LearnV2ModelAgentRoles = [
  "evidence-summarizer",
  "concept-extractor",
  "contradiction-reviewer",
  "scope-inferencer",
  "declassification-reviewer",
  "eval-planner",
  "publish-export-auditor"
] as const;
export type LearnV2ModelAgentRole = typeof LearnV2ModelAgentRoles[number];

export interface LearnV2ModelRoutingArtifact {
  schemaVersion: "openskill-kit.learn-v2.model-routing.v1";
  generatedAt: string;
  sourceRoutingPath: string;
  policy: {
    ownedProvider: false;
    executionBoundary: "opencode-configured-agent-or-deterministic";
    rawEvidenceToRemoteModels: false;
  };
  agents: Record<LearnV2ModelAgentRole, ResolvedModelRoute & {
    opencodeAgentId: string;
    agentFile: string;
    purpose: string;
    deterministicFallback: string;
    permissionsProfile: OpenCodePermissionProfileName;
  }>;
  artifacts: {
    routingJson: string;
    opencodeAgentsDir: string;
    opencodeAgentIndex: string;
  };
}

const roleToRoute: Record<LearnV2ModelAgentRole, ModelRouteName> = {
  "evidence-summarizer": "learner",
  "concept-extractor": "learner",
  "contradiction-reviewer": "reviewer",
  "scope-inferencer": "reviewer",
  "declassification-reviewer": "reviewer",
  "eval-planner": "evaluator",
  "publish-export-auditor": "reviewer"
};

const rolePurpose: Record<LearnV2ModelAgentRole, string> = {
  "evidence-summarizer": "Summarize declassified episode evidence without copying raw local content into output artifacts.",
  "concept-extractor": "Propose behavior atoms from EpisodeLearningBundle JSON; every proposal must cite valid evidence ids.",
  "contradiction-reviewer": "Find conflicts, counterevidence, supersession candidates, and scope mismatches across concept cards.",
  "scope-inferencer": "Infer narrow path/task scopes and negative triggers for concept activation.",
  "declassification-reviewer": "Check proposed review/compile/eval artifacts for raw refs, local paths, secrets, and private identifiers.",
  "eval-planner": "Generate replay and extraction-golden checks for reviewed learn-v2 concepts.",
  "publish-export-auditor": "Review compiled/exportable behavior artifacts for unsupported rules, stale concepts, unsafe command policies, raw evidence leaks, local identity leaks, and share-boundary privacy risks."
};

export async function ensureLearnV2ModelRoutingArtifacts(projectRoot: string, now = new Date()): Promise<LearnV2ModelRoutingArtifact> {
  const root = path.resolve(projectRoot);
  const base = await readOrCreateModelRouting(root, now);
  const resolved = resolveModelRouting({ routing: base.routing, sourcePath: base.path, harness: base.routing.defaultHarness });
  const routingDir = path.join(root, ".openskill-kit", "model-routing");
  const agentsDir = path.join(routingDir, "opencode-agents");
  const routingJson = path.join(routingDir, "osk-model-routing.json");
  const agentIndexPath = path.join(agentsDir, "agents.json");
  await fs.rm(agentsDir, { recursive: true, force: true });
  await fs.mkdir(agentsDir, { recursive: true });
  const agents = Object.fromEntries(await Promise.all(LearnV2ModelAgentRoles.map(async (role) => {
    const route = resolved.routes[roleToRoute[role]];
    const opencodeAgentId = learnV2OpenCodeAgentId(role);
    const permissionsProfile = route.permissionsProfile ?? "read-only";
    const agentFile = path.join(agentsDir, `${opencodeAgentId}.md`);
    await fs.writeFile(agentFile, renderAgentDefinition(role, route, permissionsProfile), "utf8");
    const relativeAgentFile = path.relative(root, agentFile).replace(/\\/g, "/");
    return [role, {
      ...route,
      opencodeAgentId,
      agentFile: relativeAgentFile,
      purpose: rolePurpose[role],
      deterministicFallback: deterministicFallback(role),
      permissionsProfile
    }];
  }))) as LearnV2ModelRoutingArtifact["agents"];
  await writeJsonAtomic(agentIndexPath, {
    schemaVersion: "openskill-kit.learn-v2.opencode-agent-index.v1",
    generatedAt: now.toISOString(),
    sourceRoutingPath: path.relative(root, base.path).replace(/\\/g, "/"),
    boundary: {
      execution: "OpenCode host runs generated agents; OSK writes prompt-safe files and validates returned JSON.",
      rawEvidenceToRemoteModels: false,
      modelOutputsTrusted: false
    },
    agents: Object.fromEntries(Object.entries(agents).map(([role, agent]) => [role, {
      opencodeAgentId: agent.opencodeAgentId,
      agentFile: agent.agentFile,
      route: agent.route,
      model: agent.model,
      maxSteps: agent.maxSteps,
      reasoningEffort: agent.reasoningEffort,
      permissionsProfile: agent.permissionsProfile,
      purpose: agent.purpose
    }]))
  });
  const artifact: LearnV2ModelRoutingArtifact = {
    schemaVersion: "openskill-kit.learn-v2.model-routing.v1",
    generatedAt: now.toISOString(),
    sourceRoutingPath: path.relative(root, base.path).replace(/\\/g, "/"),
    policy: {
      ownedProvider: false,
      executionBoundary: "opencode-configured-agent-or-deterministic",
      rawEvidenceToRemoteModels: false
    },
    agents,
    artifacts: {
      routingJson: path.relative(root, routingJson).replace(/\\/g, "/"),
      opencodeAgentsDir: path.relative(root, agentsDir).replace(/\\/g, "/"),
      opencodeAgentIndex: path.relative(root, agentIndexPath).replace(/\\/g, "/")
    }
  };
  await writeJsonAtomic(routingJson, artifact);
  return artifact;
}

function renderAgentDefinition(role: LearnV2ModelAgentRole, route: ResolvedModelRoute, permissionsProfile: OpenCodePermissionProfileName): string {
  return [
    "---",
    `description: ${JSON.stringify(rolePurpose[role])}`,
    `model: ${route.model}`,
    route.temperature === undefined ? undefined : `temperature: ${route.temperature}`,
    route.topP === undefined ? undefined : `top_p: ${route.topP}`,
    route.maxSteps === undefined ? undefined : `steps: ${route.maxSteps}`,
    route.reasoningEffort === undefined ? undefined : `reasoningEffort: ${route.reasoningEffort}`,
    "mode: subagent",
    ...renderOpenCodePermission(OpenCodePermissionProfiles[permissionsProfile]),
    "---",
    "",
    `# OSK Learn v2 ${role}`,
    "",
    `Purpose: ${rolePurpose[role]}`,
    "",
    "Boundary:",
    "- Use only OpenCode-configured model routing and permissions.",
    "- Treat model output as untrusted proposal data.",
    "- Do not copy raw local evidence, raw refs, secrets, absolute local paths, or private identifiers into output artifacts.",
    "- Deterministic extraction remains the fallback when model routing is unavailable or unsafe.",
    "",
    "Route:",
    `- Harness: ${route.harness}`,
    `- Model: ${route.model}`,
    `- Reasoning effort: ${route.reasoningEffort ?? "default"}`,
    `- Permissions profile: ${permissionsProfile}`,
    `- Max steps: ${route.maxSteps ?? "default"}`,
    "",
    `Fallback: ${deterministicFallback(role)}`,
    ""
  ].join("\n");
}

function learnV2OpenCodeAgentId(role: LearnV2ModelAgentRole): string {
  return `osk-learn-v2-${role}`;
}

function renderOpenCodePermission(permission: OpenCodePermissionMap): string[] {
  const lines = ["permission:"];
  for (const [name, rule] of Object.entries(permission)) {
    if (typeof rule === "string") {
      lines.push(`  ${name}: ${rule}`);
      continue;
    }
    lines.push(`  ${name}:`);
    for (const [pattern, value] of Object.entries(rule as Record<string, OpenCodePermissionRule>)) {
      lines.push(`    ${JSON.stringify(pattern)}: ${value}`);
    }
  }
  return lines;
}

function deterministicFallback(role: LearnV2ModelAgentRole): string {
  if (role === "evidence-summarizer") return "Use local truncation, tool summaries, structural diff summaries, and token budget compression.";
  if (role === "concept-extractor") return "Use deterministic preference/correction/security/test/command extractors.";
  if (role === "contradiction-reviewer") return "Use polarity, scope, canonical-key overlap, and counterevidence ledger checks.";
  if (role === "scope-inferencer") return "Use path clusters, structural classes, task hints, and commands.";
  if (role === "declassification-reviewer") return "Use regex placeholder, raw-ref, secret, and local-path leak checks.";
  if (role === "publish-export-auditor") return "Use behavior pack publish audit scanners, compiled-output hygiene checks, concept quality gates, and manifest privacy checks.";
  return "Use replay eval, extraction golden checks, leak checks, and token budget reports.";
}
