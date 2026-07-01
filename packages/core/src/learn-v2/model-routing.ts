import { promises as fs } from "node:fs";
import path from "node:path";
import { readOrCreateModelRouting, resolveModelRouting, type ModelRouteName, type ResolvedModelRoute } from "../config/model-routing.js";
import { writeJsonAtomic } from "../storage/atomic.js";

export const LearnV2ModelAgentRoles = [
  "evidence-summarizer",
  "concept-extractor",
  "contradiction-reviewer",
  "scope-inferencer",
  "declassification-reviewer",
  "eval-planner"
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
    agentFile: string;
    purpose: string;
    deterministicFallback: string;
  }>;
  artifacts: {
    routingJson: string;
    opencodeAgentsDir: string;
  };
}

const roleToRoute: Record<LearnV2ModelAgentRole, ModelRouteName> = {
  "evidence-summarizer": "learner",
  "concept-extractor": "learner",
  "contradiction-reviewer": "reviewer",
  "scope-inferencer": "reviewer",
  "declassification-reviewer": "reviewer",
  "eval-planner": "evaluator"
};

const rolePurpose: Record<LearnV2ModelAgentRole, string> = {
  "evidence-summarizer": "Summarize declassified episode evidence without copying raw local content into output artifacts.",
  "concept-extractor": "Propose behavior atoms from EpisodeLearningBundle JSON; every proposal must cite valid evidence ids.",
  "contradiction-reviewer": "Find conflicts, counterevidence, supersession candidates, and scope mismatches across concept cards.",
  "scope-inferencer": "Infer narrow path/task scopes and negative triggers for concept activation.",
  "declassification-reviewer": "Check proposed review/compile/eval artifacts for raw refs, local paths, secrets, and private identifiers.",
  "eval-planner": "Generate replay and extraction-golden checks for reviewed learn-v2 concepts."
};

export async function ensureLearnV2ModelRoutingArtifacts(projectRoot: string, now = new Date()): Promise<LearnV2ModelRoutingArtifact> {
  const root = path.resolve(projectRoot);
  const base = await readOrCreateModelRouting(root, now);
  const resolved = resolveModelRouting({ routing: base.routing, sourcePath: base.path, harness: base.routing.defaultHarness });
  const routingDir = path.join(root, ".openskill-kit", "model-routing");
  const agentsDir = path.join(routingDir, "opencode-agents");
  const routingJson = path.join(routingDir, "osk-model-routing.json");
  await fs.mkdir(agentsDir, { recursive: true });
  const agents = Object.fromEntries(await Promise.all(LearnV2ModelAgentRoles.map(async (role) => {
    const route = resolved.routes[roleToRoute[role]];
    const agentFile = path.join(agentsDir, `${role}.md`);
    await fs.writeFile(agentFile, renderAgentDefinition(role, route), "utf8");
    const relativeAgentFile = path.relative(root, agentFile).replace(/\\/g, "/");
    return [role, {
      ...route,
      agentFile: relativeAgentFile,
      purpose: rolePurpose[role],
      deterministicFallback: deterministicFallback(role)
    }];
  }))) as LearnV2ModelRoutingArtifact["agents"];
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
      opencodeAgentsDir: path.relative(root, agentsDir).replace(/\\/g, "/")
    }
  };
  await writeJsonAtomic(routingJson, artifact);
  return artifact;
}

function renderAgentDefinition(role: LearnV2ModelAgentRole, route: ResolvedModelRoute): string {
  return [
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
    `- Permissions profile: ${route.permissionsProfile ?? "read-only"}`,
    `- Max steps: ${route.maxSteps ?? "default"}`,
    "",
    `Fallback: ${deterministicFallback(role)}`,
    ""
  ].join("\n");
}

function deterministicFallback(role: LearnV2ModelAgentRole): string {
  if (role === "evidence-summarizer") return "Use local truncation, tool summaries, structural diff summaries, and token budget compression.";
  if (role === "concept-extractor") return "Use deterministic preference/correction/security/test/command extractors.";
  if (role === "contradiction-reviewer") return "Use polarity, scope, canonical-key overlap, and counterevidence ledger checks.";
  if (role === "scope-inferencer") return "Use path clusters, structural classes, task hints, and commands.";
  if (role === "declassification-reviewer") return "Use regex placeholder, raw-ref, secret, and local-path leak checks.";
  return "Use replay eval, extraction golden checks, leak checks, and token budget reports.";
}

