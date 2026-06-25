import path from "node:path";
import { readProjectConfig } from "../events/store.js";
import { readPreferenceGraph } from "../preferences/graph.js";
import { writeFileAtomic } from "../storage/atomic.js";
import type { PreferenceNode } from "../preferences/schema.js";

export interface CompileContextPackResult {
  schemaVersion: "openskill-kit.context-pack.v1";
  contextPackPath: string;
  activePreferenceCount: number;
  bytes: number;
}

export async function compileContextPack(projectRoot: string): Promise<CompileContextPackResult> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  const graph = await readPreferenceGraph(root);
  const active = graph.nodes.filter((node) => node.status === "active" || node.status === "locked");
  const body = renderContextPack(config.projectName, active);
  const contextPackPath = path.join(root, ".openskill-kit", "compiled", "context-pack.md");
  await writeFileAtomic(contextPackPath, body);
  return { schemaVersion: "openskill-kit.context-pack.v1", contextPackPath, activePreferenceCount: active.length, bytes: Buffer.byteLength(body) };
}

export function renderContextPack(projectName: string, nodes: PreferenceNode[]): string {
  const lines = [
    "# OpenSkillKit Context Pack",
    "",
    `Project: ${projectName}`,
    "",
    "Use this compact Active Behavior Layer during project work. Each item is evidence-backed in `.openskill-kit/preferences/graph.json`.",
    ""
  ];
  const grouped = groupByCategory(nodes);
  if (nodes.length === 0) {
    lines.push("No active preferences yet. Use repository scripts and existing conventions.", "");
  }
  for (const [category, categoryNodes] of grouped) {
    lines.push(`## ${titleCase(category)}`, "");
    for (const node of categoryNodes) {
      const scope = node.scope.paths.length ? ` Paths: ${node.scope.paths.slice(0, 5).join(", ")}.` : "";
      const strength = node.strength ? ` Strength: ${node.strength}.` : "";
      lines.push(`- ${node.statement}.${scope} Confidence: ${node.confidence}.${strength}`);
    }
    lines.push("");
  }
  lines.push("## Safety", "", "- Do not expose raw private prompts, secrets, or local-only evidence in generated output.", "- Prefer verified repository commands before declaring work complete.", "");
  return lines.join("\n");
}

function groupByCategory(nodes: PreferenceNode[]): Map<string, PreferenceNode[]> {
  const groups = new Map<string, PreferenceNode[]>();
  for (const node of nodes.sort((a, b) => a.category.localeCompare(b.category) || b.confidence - a.confidence || a.title.localeCompare(b.title))) {
    groups.set(node.category, [...(groups.get(node.category) ?? []), node]);
  }
  return groups;
}

function titleCase(value: string): string {
  return value.replace(/(^|-)([a-z])/g, (_match, prefix: string, letter: string) => `${prefix ? " " : ""}${letter.toUpperCase()}`);
}
