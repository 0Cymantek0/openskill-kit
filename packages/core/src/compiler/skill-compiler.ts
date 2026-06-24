import { promises as fs } from "node:fs";
import path from "node:path";
import { readProjectConfig } from "../events/store.js";
import { readPreferenceGraph } from "../preferences/graph.js";
import type { PreferenceNode } from "../preferences/schema.js";

export interface CompileSkillsResult {
  schemaVersion: "openskill-kit.skill-compile.v1";
  skillsDir: string;
  skillPaths: string[];
}

export async function compileBehaviorSkills(projectRoot: string): Promise<CompileSkillsResult> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  const graph = await readPreferenceGraph(root);
  const active = graph.nodes.filter((node) => node.status === "active" || node.status === "locked");
  const skillsDir = path.join(root, ".openskill-kit", "compiled", "skills");
  const projectBehaviorDir = path.join(skillsDir, "project-behavior");
  await fs.mkdir(path.join(projectBehaviorDir, "references"), { recursive: true });
  const skillBody = renderProjectBehaviorSkill(config.projectName, active);
  await fs.writeFile(path.join(projectBehaviorDir, "SKILL.md"), skillBody, "utf8");
  await fs.writeFile(path.join(projectBehaviorDir, "references", "active-preferences.md"), renderReference(active), "utf8");
  return { schemaVersion: "openskill-kit.skill-compile.v1", skillsDir, skillPaths: [projectBehaviorDir] };
}

function renderProjectBehaviorSkill(projectName: string, nodes: PreferenceNode[]): string {
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
    "- Follow active preferences by confidence and scope.",
    "- If active preferences conflict with direct user instruction, follow direct instruction and record new evidence through OpenSkillKit.",
    "- Verify with project commands when available before reporting completion.",
    "- Keep raw private prompts, local event logs, and secret-like evidence out of generated output.",
    "",
    "## Current Active Preferences",
    "",
    ...(nodes.length ? nodes.slice(0, 12).map((node) => `- ${node.statement} (confidence ${node.confidence})`) : ["- No active preferences yet; follow existing repository conventions."]),
    ""
  ].join("\n");
}

function renderReference(nodes: PreferenceNode[]): string {
  const lines = ["# Active Preferences", ""];
  if (!nodes.length) lines.push("No active preferences yet.", "");
  for (const node of nodes.sort((a, b) => a.category.localeCompare(b.category) || b.confidence - a.confidence || a.title.localeCompare(b.title))) {
    lines.push(`## ${node.title}`, "", `- Category: ${node.category}`, `- Status: ${node.status}`, `- Confidence: ${node.confidence}`, `- Statement: ${node.statement}`);
    if (node.scope.paths.length) lines.push(`- Paths: ${node.scope.paths.join(", ")}`);
    lines.push(`- Evidence: ${node.evidence.map((item) => item.signalId).join(", ")}`, "");
  }
  return lines.join("\n");
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
