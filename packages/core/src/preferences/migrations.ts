import { PreferenceGraphSchema, type PreferenceGraph } from "./schema.js";
import { CompileTargets } from "../schema/constants.js";

export function migratePreferenceGraph(input: unknown): PreferenceGraph {
  const value = input as Record<string, unknown>;
  if (value?.schemaVersion === "openskill-kit.preference-graph.v1") {
    const nodes = Array.isArray(value.nodes) ? value.nodes.map(upgradeNode) : [];
    return PreferenceGraphSchema.parse({ ...value, nodes });
  }
  throw new Error(`Unsupported OpenSkillKit preference graph schema version: ${String(value?.schemaVersion ?? "missing")}`);
}

function upgradeNode(input: unknown): unknown {
  const node = input as Record<string, any>;
  if (!node || typeof node !== "object") return input;
  return {
    ...node,
    schemaVersion: "openskill-kit.preference-node.v2",
    strength: node.strength ?? inferStrength(node),
    exceptions: node.exceptions ?? [],
    privacy: node.privacy ?? inferPrivacy(node),
    compileTargets: node.compileTargets ?? inferCompileTargets(node),
    lifecycle: node.lifecycle ?? {
      state: node.status === "active" || node.status === "locked" ? "active" : node.status === "rejected" ? "deprecated" : "candidate",
      reviewedAt: node.status === "active" || node.status === "locked" || node.status === "rejected" ? node.updatedAt : undefined,
      promotedAt: node.scope?.level === "user" || node.scope?.level === "global" ? node.updatedAt : undefined
    }
  };
}

function inferStrength(node: Record<string, any>): "must" | "should" | "may" | "must-not" {
  const statement = String(node.statement ?? "").toLowerCase();
  if (node.polarity === "negative" || statement.startsWith("do not") || statement.startsWith("never")) return "must-not";
  if (node.status === "locked" || /\b(always|must|required)\b/.test(statement)) return "must";
  if ((node.confidence ?? 0) < 0.55) return "may";
  return "should";
}

function inferPrivacy(node: Record<string, any>): { class: "project-private" | "user-private" | "global-private" | "shareable"; rationale: string } {
  if (node.scope?.level === "global") return { class: "global-private", rationale: "Global preference requires explicit review before sharing." };
  if (node.scope?.level === "user") return { class: "user-private", rationale: "User preference should stay private unless exported intentionally." };
  return { class: "project-private", rationale: "Project behavior can include local conventions and evidence references." };
}

function inferCompileTargets(node: Record<string, any>): string[] {
  const targets = new Set<string>(["context-pack", "agent-skills", "mcp-resources"]);
  if (node.scope?.paths?.length) targets.add("project-rules");
  if (["testing", "tooling", "command-policy"].includes(node.category)) targets.add("hooks");
  if (["testing", "security", "workflow", "api", "api-design", "command-policy", "review-policy"].includes(node.category) || node.polarity === "negative") targets.add("project-rules");
  return CompileTargets.filter((target) => targets.has(target));
}
