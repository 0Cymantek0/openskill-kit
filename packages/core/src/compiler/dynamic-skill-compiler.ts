import path from "node:path";
import type { PreferenceNode } from "../preferences/schema.js";
import { writeFileAtomic } from "../storage/atomic.js";

export interface CompileDynamicSkillShardsResult {
  schemaVersion: "openskill-kit.dynamic-skills.v1";
  skillPaths: string[];
}

export async function compileDynamicSkillShards(skillsDir: string, nodes: PreferenceNode[]): Promise<CompileDynamicSkillShardsResult> {
  const groups = groupShardNodes(nodes);
  const skillPaths: string[] = [];
  for (const [category, categoryNodes] of groups) {
    const skillName = `project-${category}`;
    const skillDir = path.join(skillsDir, skillName);
    await writeFileAtomic(path.join(skillDir, "SKILL.md"), renderShardSkill(skillName, category, categoryNodes));
    await writeFileAtomic(path.join(skillDir, "references", "preferences.md"), renderShardReference(category, categoryNodes));
    skillPaths.push(skillDir);
  }
  return { schemaVersion: "openskill-kit.dynamic-skills.v1", skillPaths };
}

function groupShardNodes(nodes: PreferenceNode[]): Map<string, PreferenceNode[]> {
  const groups = new Map<string, PreferenceNode[]>();
  for (const node of nodes.filter((item) => item.category !== "general")) {
    groups.set(node.category, [...(groups.get(node.category) ?? []), node]);
  }
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function renderShardSkill(skillName: string, category: string, nodes: PreferenceNode[]): string {
  const title = titleCase(category);
  return [
    "---",
    `name: ${skillName}`,
    `description: ${JSON.stringify(`Apply ${title} project behavior from OpenSkillKit when task context matches ${category}.`)}`,
    "metadata:",
    "  source: openskill-kit",
    "  dynamicShard: true",
    `  category: ${JSON.stringify(category)}`,
    "---",
    "",
    `# ${title} Project Behavior`,
    "",
    "## When to use",
    "",
    `Use this skill when task intent, files, review scope, or command policy touches ${category} behavior in this repository.`,
    "",
    "## When not to use",
    "",
    "Do not load this shard for unrelated tasks. Prefer the smallest relevant behavior set.",
    "",
    "## Operating Rules",
    "",
    "- Load `references/preferences.md` before applying this category's behavior.",
    "- Apply path-scoped preferences only to matching files or directories.",
    "- If this shard conflicts with direct user instruction, follow the user and record safe evidence.",
    "- Keep raw prompts, raw diffs, private event logs, and secrets out of output.",
    "",
    "## Active Preferences",
    "",
    ...nodes.sort(sortNodes).map((node) => `- ${scopeLabel(node)}: ${node.statement} (confidence ${node.confidence})`),
    ""
  ].join("\n");
}

function renderShardReference(category: string, nodes: PreferenceNode[]): string {
  const lines = [`# ${titleCase(category)} Preferences`, ""];
  for (const node of nodes.sort(sortNodes)) {
    lines.push(`## ${node.title}`, "", `- ID: ${node.id}`, `- Scope: ${scopeLabel(node)}`, `- Confidence: ${node.confidence}`, `- Statement: ${node.statement}`, `- Evidence cards: ${node.evidence.flatMap((item) => item.cardIds ?? []).join(", ") || "none"}`, "");
  }
  return lines.join("\n");
}

function scopeLabel(node: PreferenceNode): string {
  return node.scope.paths.length ? `${node.scope.level}:${node.scope.paths.join(",")}` : node.scope.level;
}

function sortNodes(a: PreferenceNode, b: PreferenceNode): number {
  return b.confidence - a.confidence || a.title.localeCompare(b.title);
}

function titleCase(value: string): string {
  return value.replace(/(^|-)([a-z])/g, (_match, prefix: string, letter: string) => `${prefix ? " " : ""}${letter.toUpperCase()}`);
}
