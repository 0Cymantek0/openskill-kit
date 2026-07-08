import path from "node:path";
import type { PreferenceNode } from "../preferences/schema.js";
import { writeFileAtomic } from "../storage/atomic.js";
import { readLearnV2SkillOntologyMemoryStore, type LearnV2SkillOntologyMemoryStore } from "../learn-v2/skill-ontology-memory.js";
import type { LearnV2SkillNamespaceCandidate } from "../learn-v2/schemas.js";

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

export async function compileLearnV2OntologySkillShards(
  projectRoot: string,
  skillsDir: string,
  nodes: PreferenceNode[],
  now = new Date()
): Promise<CompileDynamicSkillShardsResult> {
  const ontology = await readLearnV2SkillOntologyMemoryStore(projectRoot, now);
  const activeByCardId = activeNodesByEvidenceCardId(nodes);
  const skillPaths: string[] = [];
  for (const namespace of ontology.namespaces.sort(sortNamespaces)) {
    if (namespace.status === "dormant") continue;
    const namespaceNodes = uniqueNodes(namespace.conceptIds.flatMap((conceptId) => activeByCardId.get(conceptId) ?? []));
    if (!namespaceNodes.length) continue;
    const skillName = `project-${slugify(namespace.label)}`;
    const skillDir = path.join(skillsDir, skillName);
    const operations = ontology.operations.filter((operation) =>
      operation.namespaceIds.includes(namespace.id) &&
      operation.status === "needs-review"
    );
    await writeFileAtomic(path.join(skillDir, "SKILL.md"), renderOntologySkill(skillName, namespace, namespaceNodes, operations.length));
    await writeFileAtomic(path.join(skillDir, "references", "namespace.md"), renderOntologyReference(namespace, namespaceNodes, ontology));
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

function activeNodesByEvidenceCardId(nodes: PreferenceNode[]): Map<string, PreferenceNode[]> {
  const byCardId = new Map<string, PreferenceNode[]>();
  for (const node of nodes) {
    for (const cardId of node.evidence.flatMap((item) => item.cardIds ?? [])) {
      byCardId.set(cardId, [...(byCardId.get(cardId) ?? []), node]);
    }
  }
  return byCardId;
}

function renderOntologySkill(
  skillName: string,
  namespace: LearnV2SkillNamespaceCandidate,
  nodes: PreferenceNode[],
  reviewOperationCount: number
): string {
  const description = `Apply learned ${namespace.label} behavior from OpenSkillKit when task context matches this namespace.`;
  return [
    "---",
    `name: ${skillName}`,
    `description: ${JSON.stringify(description)}`,
    "metadata:",
    "  source: openskill-kit",
    "  learnV2OntologyShard: true",
    `  namespaceId: ${JSON.stringify(namespace.id)}`,
    `  namespaceLabel: ${JSON.stringify(namespace.label)}`,
    "---",
    "",
    `# ${namespace.label}`,
    "",
    "## When to use",
    "",
    `Use this skill when task intent, files, components, commands, or review scope match learned ${namespace.label} behavior in this repository.`,
    "",
    "## When not to use",
    "",
    "- Do not use for unrelated work or when direct user instruction overrides learned behavior.",
    "- Do not apply candidate concepts; this shard contains reviewed active behavior only.",
    "",
    "## Operating Rules",
    "",
    "- Load `references/namespace.md` before applying namespace-specific behavior.",
    "- Prefer the narrowest matching active behavior and respect path scope, exceptions, and negative triggers.",
    "- Treat needs-review ontology operations as organization hints only; do not merge, split, or broaden behavior without review.",
    "- Keep raw prompts, raw diffs, local evidence refs, private paths, and secrets out of output.",
    "",
    "## Namespace Signals",
    "",
    ...(namespace.representativeSignals.length ? namespace.representativeSignals.map((signal) => `- ${signal}`) : ["- No representative signals recorded."]),
    "",
    "## Active Behavior",
    "",
    ...nodes.sort(sortNodes).map((node) => `- ${scopeLabel(node)}: ${node.statement}${inlineActivationDetails(node)} (confidence ${node.confidence})`),
    "",
    "## Review State",
    "",
    `- Namespace status: ${namespace.status}`,
    `- Ontology operations needing review: ${reviewOperationCount}`,
    ""
  ].join("\n");
}

function renderOntologyReference(
  namespace: LearnV2SkillNamespaceCandidate,
  nodes: PreferenceNode[],
  ontology: LearnV2SkillOntologyMemoryStore
): string {
  const operations = ontology.operations.filter((operation) => operation.namespaceIds.includes(namespace.id));
  const lines = [
    `# ${namespace.label} Namespace`,
    "",
    `- Namespace ID: ${namespace.id}`,
    `- Status: ${namespace.status}`,
    `- Confidence: ${namespace.confidence}`,
    `- Hierarchy: ${namespace.hierarchyPath.join(" > ") || namespace.label}`,
    `- Concept count: ${namespace.conceptIds.length}`,
    `- Signals: ${namespace.representativeSignals.join(", ") || "none"}`,
    "",
    "## Active Behavior",
    ""
  ];
  for (const node of nodes.sort(sortNodes)) {
    lines.push(
      `### ${node.title}`,
      "",
      `- ID: ${node.id}`,
      `- Scope: ${scopeLabel(node)}`,
      `- Confidence: ${node.confidence}`,
      `- Strength: ${node.strength ?? "should"}`,
      `- Statement: ${node.statement}`,
      `- Apply when: ${node.conditions?.appliesWhen?.join("; ") || "none"}`,
      `- Do not apply when: ${node.conditions?.doesNotApplyWhen?.join("; ") || "none"}`,
      `- Activation phrases: ${node.activation?.phrases?.join(", ") || "none"}`,
      `- Activation paths: ${node.activation?.pathGlobs?.join(", ") || "none"}`,
      `- Preferred commands: ${node.activation?.commands?.join(", ") || "none"}`,
      `- Negative triggers: ${node.activation?.negativeTriggers?.join(", ") || node.exceptions?.join(", ") || "none"}`,
      `- Exceptions: ${node.exceptions?.join(", ") || "none"}`,
      `- Evidence cards: ${node.evidence.flatMap((item) => item.cardIds ?? []).join(", ") || "none"}`,
      ""
    );
  }
  lines.push("## Ontology Operations", "");
  if (!operations.length) lines.push("No ontology operations recorded for this namespace.", "");
  for (const operation of operations.sort(sortOperations)) {
    lines.push(`- ${operation.operation}: status=${operation.status}; confidence=${operation.confidence}; concepts=${operation.conceptIds.length}; hint=${operation.reviewHint}`);
  }
  lines.push("", "## Privacy", "", "- This compiled shard includes reviewed/declassified active behavior only.", "- Raw vault refs, raw local paths, raw prompts, raw diffs, and model request/response contents are not included.", "");
  return lines.join("\n");
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
    ...nodes.sort(sortNodes).map((node) => `- ${scopeLabel(node)}: ${node.statement}${inlineActivationDetails(node)} (confidence ${node.confidence})`),
    ""
  ].join("\n");
}

function renderShardReference(category: string, nodes: PreferenceNode[]): string {
  const lines = [`# ${titleCase(category)} Preferences`, ""];
  for (const node of nodes.sort(sortNodes)) {
    lines.push(`## ${node.title}`, "", `- ID: ${node.id}`, `- Scope: ${scopeLabel(node)}`, `- Confidence: ${node.confidence}`, `- Strength: ${node.strength ?? "should"}`, `- Statement: ${node.statement}`, `- Compile targets: ${node.compileTargets?.join(", ") || "context-pack, agent-skills"}`, `- Evidence cards: ${node.evidence.flatMap((item) => item.cardIds ?? []).join(", ") || "none"}`, "");
  }
  return lines.join("\n");
}

function scopeLabel(node: PreferenceNode): string {
  return node.scope.paths.length ? `${node.scope.level}:${node.scope.paths.join(",")}` : node.scope.level;
}

function inlineActivationDetails(node: PreferenceNode): string {
  const parts = [
    node.conditions?.appliesWhen?.length ? `apply when ${node.conditions.appliesWhen.join("; ")}` : undefined,
    node.conditions?.doesNotApplyWhen?.length ? `do not apply when ${node.conditions.doesNotApplyWhen.join("; ")}` : undefined,
    node.activation?.negativeTriggers?.length ? `negative triggers ${node.activation.negativeTriggers.join("; ")}` : undefined
  ].filter((item): item is string => Boolean(item));
  return parts.length ? ` [${parts.join(" | ")}]` : "";
}

function sortNodes(a: PreferenceNode, b: PreferenceNode): number {
  return b.confidence - a.confidence || a.title.localeCompare(b.title);
}

function sortNamespaces(a: LearnV2SkillNamespaceCandidate, b: LearnV2SkillNamespaceCandidate): number {
  return b.confidence - a.confidence || a.label.localeCompare(b.label);
}

function sortOperations(a: LearnV2SkillOntologyMemoryStore["operations"][number], b: LearnV2SkillOntologyMemoryStore["operations"][number]): number {
  return a.operation.localeCompare(b.operation) || b.confidence - a.confidence || a.id.localeCompare(b.id);
}

function uniqueNodes(nodes: PreferenceNode[]): PreferenceNode[] {
  const byId = new Map<string, PreferenceNode>();
  for (const node of nodes) byId.set(node.id, node);
  return [...byId.values()];
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "learned-behavior";
}

function titleCase(value: string): string {
  return value.replace(/(^|-)([a-z])/g, (_match, prefix: string, letter: string) => `${prefix ? " " : ""}${letter.toUpperCase()}`);
}
