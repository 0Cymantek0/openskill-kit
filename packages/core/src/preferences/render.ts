import { promises as fs } from "node:fs";
import path from "node:path";
import type { PreferenceGraph, PreferenceNode } from "./schema.js";

export async function renderPreferenceGraphMarkdown(projectRoot: string, graph: PreferenceGraph): Promise<string> {
  const active = graph.nodes.filter((node) => node.status === "active" || node.status === "locked");
  const byCategory = groupByCategory(active);
  const lines = ["# Adaptive Skill Graph", "", `Project: ${graph.projectId}`, "", "## Active Behavior Layer", ""];
  if (active.length === 0) lines.push("No active preferences yet.", "");
  for (const [category, nodes] of byCategory) {
    lines.push(`### ${titleCase(category)}`, "");
    for (const node of nodes) lines.push(`- ${node.statement} (confidence ${node.confidence})`);
    lines.push("");
  }
  if (graph.conflicts.length) {
    lines.push("## Conflicts", "");
    for (const conflict of graph.conflicts) lines.push(`- ${conflict.reason}: ${conflict.nodeIds.join(", ")}`);
    lines.push("");
  }
  const markdown = lines.join("\n");
  const graphMd = path.join(projectRoot, ".openskill-kit", "preferences", "graph.md");
  await fs.mkdir(path.dirname(graphMd), { recursive: true });
  await fs.writeFile(graphMd, markdown, "utf8");
  await writeActiveFacetFiles(projectRoot, byCategory);
  return graphMd;
}

function groupByCategory(nodes: PreferenceNode[]): Map<string, PreferenceNode[]> {
  const groups = new Map<string, PreferenceNode[]>();
  for (const node of nodes.sort((a, b) => a.category.localeCompare(b.category) || b.confidence - a.confidence || a.title.localeCompare(b.title))) {
    groups.set(node.category, [...(groups.get(node.category) ?? []), node]);
  }
  return groups;
}

async function writeActiveFacetFiles(projectRoot: string, groups: Map<string, PreferenceNode[]>): Promise<void> {
  const dir = path.join(projectRoot, ".openskill-kit", "preferences", "active");
  await fs.mkdir(dir, { recursive: true });
  const index = ["# Active Behavior Layer", ""];
  for (const [category, nodes] of groups) {
    const body = [`# ${titleCase(category)} Preferences`, "", ...nodes.map((node) => `- ${node.statement} (confidence ${node.confidence})`), ""].join("\n");
    await fs.writeFile(path.join(dir, `${category}.md`), body, "utf8");
    index.push(`- [${titleCase(category)}](${category}.md): ${nodes.length}`);
  }
  await fs.writeFile(path.join(dir, "index.md"), index.join("\n") + "\n", "utf8");
}

function titleCase(value: string): string {
  return value.replace(/(^|-)([a-z])/g, (_match, prefix: string, letter: string) => `${prefix ? " " : ""}${letter.toUpperCase()}`);
}
