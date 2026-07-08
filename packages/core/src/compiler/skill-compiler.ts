import { promises as fs } from "node:fs";
import path from "node:path";
import { readProjectConfig } from "../events/store.js";
import { readPreferenceGraph } from "../preferences/graph.js";
import { writeFileAtomic } from "../storage/atomic.js";
import type { PreferenceNode } from "../preferences/schema.js";
import { readWorkflowGraph } from "../workflows/store.js";
import type { WorkflowNode } from "../workflows/schema.js";
import { compileDynamicSkillShards, compileLearnV2OntologySkillShards } from "./dynamic-skill-compiler.js";

export interface CompileSkillsResult {
  schemaVersion: "openskill-kit.skill-compile.v1";
  skillsDir: string;
  skillPaths: string[];
}

export async function compileBehaviorSkills(projectRoot: string): Promise<CompileSkillsResult> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  const graph = await readPreferenceGraph(root);
  const workflowGraph = await readWorkflowGraph(root, config.projectId, new Date());
  const active = graph.nodes.filter((node) => node.status === "active" || node.status === "locked");
  const activeWorkflows = workflowGraph.nodes.filter((node) => node.status === "active" || node.status === "locked");
  const skillsDir = path.join(root, ".openskill-kit", "compiled", "skills");
  await fs.rm(skillsDir, { recursive: true, force: true });
  const projectBehaviorDir = path.join(skillsDir, "project-behavior");
  const skillBody = renderProjectBehaviorSkill(config.projectName, active, activeWorkflows);
  await writeFileAtomic(path.join(projectBehaviorDir, "SKILL.md"), skillBody);
  await writeFileAtomic(path.join(projectBehaviorDir, "references", "active-preferences.md"), renderReference(active));
  await writeFileAtomic(path.join(projectBehaviorDir, "references", "active-workflows.md"), renderWorkflowReference(activeWorkflows));
  const shards = await compileDynamicSkillShards(skillsDir, active);
  const ontologyShards = await compileLearnV2OntologySkillShards(root, skillsDir, active);
  const workflowSkillPath = activeWorkflows.length ? await compileWorkflowSkill(skillsDir, activeWorkflows) : undefined;
  return { schemaVersion: "openskill-kit.skill-compile.v1", skillsDir, skillPaths: [projectBehaviorDir, ...shards.skillPaths, ...ontologyShards.skillPaths, workflowSkillPath].filter((skillPath): skillPath is string => Boolean(skillPath)) };
}

function renderProjectBehaviorSkill(projectName: string, nodes: PreferenceNode[], workflows: WorkflowNode[]): string {
  const description = `Apply evidence-backed project behavior for ${projectName}.`;
  return [
    "---",
    "name: project-behavior",
    `description: ${yamlString(description)}`,
    "metadata:",
    "  source: openskill-kit",
    "---",
    "",
    "# Project Behavior",
    "",
    "## When to use",
    "",
    "Use this skill for any coding, review, documentation, testing, or repository maintenance work in this project.",
    "",
    "## When not to use",
    "",
    "Do not use this skill outside this repository or when user instructions explicitly replace project behavior for current task.",
    "",
    "## Operating Rules",
    "",
    "- Load `references/active-preferences.md` before making project-specific decisions.",
    "- Load `references/active-workflows.md` when task involves repeated project command or review sequences.",
    "- Prefer category shards such as `project-testing`, `project-security`, or `project-architecture` when task scope is narrow.",
    "- Prefer `project-workflows` when an active Workflow Graph trigger matches task paths or commands.",
    "- Follow active preferences by confidence and scope.",
    "- If active preferences conflict with direct user instruction, follow direct instruction and record new evidence through OpenSkillKit.",
    "- Verify with project commands when available before reporting completion.",
    "- Keep raw private prompts, local event logs, and secret-like evidence out of generated output.",
    "",
    "## Current Active Preferences",
    "",
    ...(nodes.length ? nodes.slice(0, 12).map((node) => `- ${node.statement} (confidence ${node.confidence})`) : ["- No active preferences yet; follow existing repository conventions."]),
    "",
    "## Current Active Workflows",
    "",
    ...(workflows.length ? workflows.slice(0, 8).map((workflow) => `- ${workflow.name}: ${workflow.steps.map((step) => step.instruction).join(" -> ")} (confidence ${workflow.confidence})`) : ["- No active workflows yet; follow existing repository conventions."]),
    ""
  ].join("\n");
}

function renderReference(nodes: PreferenceNode[]): string {
  const lines = ["# Active Preferences", ""];
  if (!nodes.length) lines.push("No active preferences yet.", "");
  for (const node of nodes.sort((a, b) => a.category.localeCompare(b.category) || b.confidence - a.confidence || a.title.localeCompare(b.title))) {
    lines.push(`## ${node.title}`, "", `- Category: ${node.category}`, `- Status: ${node.status}`, `- Confidence: ${node.confidence}`, `- Statement: ${node.statement}`);
    if (node.scope.paths.length) lines.push(`- Paths: ${node.scope.paths.join(", ")}`);
    if (node.strength) lines.push(`- Strength: ${node.strength}`);
    if (node.privacy) lines.push(`- Privacy: ${node.privacy.class} (${node.privacy.rationale})`);
    if (node.compileTargets?.length) lines.push(`- Compile targets: ${node.compileTargets.join(", ")}`);
    lines.push(`- Evidence: ${node.evidence.map((item) => item.signalId).join(", ")}`, "");
  }
  return lines.join("\n");
}

async function compileWorkflowSkill(skillsDir: string, workflows: WorkflowNode[]): Promise<string> {
  const skillDir = path.join(skillsDir, "project-workflows");
  await writeFileAtomic(path.join(skillDir, "SKILL.md"), renderWorkflowSkill(workflows));
  await writeFileAtomic(path.join(skillDir, "references", "workflows.md"), renderWorkflowReference(workflows));
  return skillDir;
}

function renderWorkflowSkill(workflows: WorkflowNode[]): string {
  return [
    "---",
    "name: project-workflows",
    "description: \"Apply reviewed project workflow sequences from OpenSkillKit when task paths or commands match.\"",
    "metadata:",
    "  source: openskill-kit",
    "  workflowShard: true",
    "---",
    "",
    "# Project Workflows",
    "",
    "## When to use",
    "",
    "Use when task paths, commands, or review scope match an active Workflow Graph entry.",
    "",
    "## When not to use",
    "",
    "Do not use candidate or staged workflows. Do not run destructive commands unless directly approved.",
    "",
    "## Operating Rules",
    "",
    "- Load `references/workflows.md` before executing workflow-specific command sequences.",
    "- Follow commands in order when they apply to current task scope.",
    "- If a workflow command fails, stop and report the failing command before continuing.",
    "- Keep raw private events, prompts, diffs, and secret-like evidence out of output.",
    "",
    "## Active Workflows",
    "",
    ...workflows.sort(sortWorkflows).map((workflow) => `- ${workflow.name}: ${workflow.steps.map((step) => step.instruction).join(" -> ")} (confidence ${workflow.confidence})`),
    ""
  ].join("\n");
}

function renderWorkflowReference(workflows: WorkflowNode[]): string {
  const lines = ["# Active Workflows", ""];
  if (!workflows.length) lines.push("No active workflows yet.", "");
  for (const workflow of workflows.sort(sortWorkflows)) {
    lines.push(`## ${workflow.name}`, "", `- ID: ${workflow.id}`, `- Status: ${workflow.status}`, `- Confidence: ${workflow.confidence}`, `- Occurrences: ${workflow.occurrenceCount}`, `- Paths: ${workflow.trigger.paths.join(", ") || "project"}`, `- Commands: ${workflow.trigger.commands.join(" -> ") || "none"}`, `- Compile targets: ${workflow.compileTargets.join(", ")}`, "");
    for (const step of workflow.steps) lines.push(`- ${step.kind}: ${step.instruction}${step.command ? ` (${step.command})` : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

function sortWorkflows(a: WorkflowNode, b: WorkflowNode): number {
  return b.confidence - a.confidence || a.name.localeCompare(b.name);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
