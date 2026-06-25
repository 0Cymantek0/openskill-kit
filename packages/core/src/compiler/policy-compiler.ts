import path from "node:path";
import { readPreferenceGraph } from "../preferences/graph.js";
import type { PreferenceNode } from "../preferences/schema.js";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";

export interface CompilePolicyArtifactsResult {
  schemaVersion: "openskill-kit.policy-artifacts.v1";
  pathMapPath: string;
  commandPolicyPath: string;
  reviewChecklistPath: string;
}

export async function compilePolicyArtifacts(projectRoot: string): Promise<CompilePolicyArtifactsResult> {
  const root = path.resolve(projectRoot);
  const graph = await readPreferenceGraph(root);
  const active = graph.nodes.filter((node) => node.status === "active" || node.status === "locked");
  const pathMapPath = path.join(root, ".openskill-kit", "compiled", "behavior", "path-map.json");
  const commandPolicyPath = path.join(root, ".openskill-kit", "compiled", "behavior", "command-policy.md");
  const reviewChecklistPath = path.join(root, ".openskill-kit", "compiled", "behavior", "review-checklist.md");
  await writeJsonAtomic(pathMapPath, renderPathMap(active));
  await writeFileAtomic(commandPolicyPath, renderCommandPolicy(active));
  await writeFileAtomic(reviewChecklistPath, renderReviewChecklist(active));
  return { schemaVersion: "openskill-kit.policy-artifacts.v1", pathMapPath, commandPolicyPath, reviewChecklistPath };
}

function renderPathMap(nodes: PreferenceNode[]) {
  const paths: Record<string, Array<{ id: string; statement: string; category: string; confidence: number }>> = {};
  for (const node of nodes) {
    for (const scopePath of node.scope.paths) {
      paths[scopePath] = [...(paths[scopePath] ?? []), {
        id: node.id,
        statement: node.statement,
        category: node.category,
        confidence: node.confidence
      }];
    }
  }
  return {
    schemaVersion: "openskill-kit.path-map.v1",
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)))
  };
}

function renderCommandPolicy(nodes: PreferenceNode[]): string {
  const commandNodes = nodes.filter((node) => node.category === "tooling" || node.category === "testing" || /command|script|npm|test|build|lint|typecheck/i.test(node.statement));
  const lines = ["# Command Policy", ""];
  if (commandNodes.length === 0) lines.push("No active command policy yet.", "");
  for (const node of commandNodes.sort(sortNodes)) lines.push(`- ${node.statement} (confidence ${node.confidence})`);
  lines.push("");
  return lines.join("\n");
}

function renderReviewChecklist(nodes: PreferenceNode[]): string {
  const checklistNodes = nodes.filter((node) => ["security", "testing", "workflow", "api", "api-design", "command-policy", "review-policy"].includes(node.category) || node.polarity === "negative");
  const lines = ["# Review Checklist", ""];
  if (checklistNodes.length === 0) lines.push("No active review checklist items yet.", "");
  for (const node of checklistNodes.sort(sortNodes)) lines.push(`- [ ] ${node.statement} (confidence ${node.confidence})`);
  lines.push("");
  return lines.join("\n");
}

function sortNodes(a: PreferenceNode, b: PreferenceNode): number {
  return a.category.localeCompare(b.category) || b.confidence - a.confidence || a.title.localeCompare(b.title);
}
