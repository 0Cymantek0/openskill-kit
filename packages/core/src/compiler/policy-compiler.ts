import path from "node:path";
import { readProjectConfig } from "../events/store.js";
import { buildLearnV2CommandPolicyRules, renderLearnV2CommandPolicyMarkdown } from "../learn-v2/command-policy.js";
import { readLearnV2ConceptStore } from "../learn-v2/store.js";
import { readApprovedAmbientLabels } from "../preferences/labels.js";
import { readPreferenceGraph } from "../preferences/graph.js";
import type { PreferenceNode } from "../preferences/schema.js";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";
import { readWorkflowGraph } from "../workflows/store.js";
import type { WorkflowNode } from "../workflows/schema.js";

export interface CompilePolicyArtifactsResult {
  schemaVersion: "openskill-kit.policy-artifacts.v1";
  pathMapPath: string;
  commandPolicyPath: string;
  commandPolicyJsonPath: string;
  reviewChecklistPath: string;
}

export async function compilePolicyArtifacts(projectRoot: string): Promise<CompilePolicyArtifactsResult> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  const graph = await readPreferenceGraph(root);
  const workflowGraph = await readWorkflowGraph(root, config.projectId, new Date());
  const active = graph.nodes.filter((node) => node.status === "active" || node.status === "locked");
  const activeWorkflows = workflowGraph.nodes.filter((node) => node.status === "active" || node.status === "locked");
  const learnV2Store = await readLearnV2ConceptStore(root).catch(() => undefined);
  const learnV2CommandRules = buildLearnV2CommandPolicyRules(learnV2Store?.cards ?? []);
  const approvedLabels = await readApprovedAmbientLabels(root);
  const pathMapPath = path.join(root, ".openskill-kit", "compiled", "behavior", "path-map.json");
  const commandPolicyPath = path.join(root, ".openskill-kit", "compiled", "behavior", "command-policy.md");
  const commandPolicyJsonPath = path.join(root, ".openskill-kit", "compiled", "behavior", "command-policy.json");
  const reviewChecklistPath = path.join(root, ".openskill-kit", "compiled", "behavior", "review-checklist.md");
  await writeJsonAtomic(pathMapPath, renderPathMap(active, activeWorkflows));
  await writeFileAtomic(commandPolicyPath, renderCommandPolicy(active, activeWorkflows, approvedLabels.commands, learnV2CommandRules));
  await writeJsonAtomic(commandPolicyJsonPath, renderCommandPolicyJson(active, activeWorkflows, approvedLabels.commands, learnV2CommandRules));
  await writeFileAtomic(reviewChecklistPath, renderReviewChecklist(active, activeWorkflows, approvedLabels));
  return { schemaVersion: "openskill-kit.policy-artifacts.v1", pathMapPath, commandPolicyPath, commandPolicyJsonPath, reviewChecklistPath };
}

function renderPathMap(nodes: PreferenceNode[], workflows: WorkflowNode[]) {
  const paths: Record<string, Array<{ id: string; statement: string; category: string; confidence: number; strength?: string; privacyClass?: string }>> = {};
  for (const node of nodes) {
    for (const scopePath of node.scope.paths) {
      paths[scopePath] = [...(paths[scopePath] ?? []), {
        id: node.id,
        statement: node.statement,
        category: node.category,
        confidence: node.confidence,
        strength: node.strength,
        privacyClass: node.privacy?.class
      }];
    }
  }
  const workflowPaths: Record<string, Array<{ id: string; name: string; confidence: number; commands: string[] }>> = {};
  for (const workflow of workflows) {
    for (const scopePath of workflow.trigger.paths) {
      workflowPaths[scopePath] = [...(workflowPaths[scopePath] ?? []), {
        id: workflow.id,
        name: workflow.name,
        confidence: workflow.confidence,
        commands: workflow.trigger.commands
      }];
    }
  }
  return {
    schemaVersion: "openskill-kit.path-map.v1",
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    workflows: Object.fromEntries(Object.entries(workflowPaths).sort(([a], [b]) => a.localeCompare(b)))
  };
}

function renderCommandPolicy(
  nodes: PreferenceNode[],
  workflows: WorkflowNode[],
  commandLabels: Awaited<ReturnType<typeof readApprovedAmbientLabels>>["commands"],
  learnV2CommandRules: ReturnType<typeof buildLearnV2CommandPolicyRules>
): string {
  const commandNodes = nodes.filter((node) => node.category === "tooling" || node.category === "testing" || /command|script|npm|test|build|lint|typecheck/i.test(node.statement));
  const lines = ["# Command Policy", ""];
  if (commandNodes.length === 0 && workflows.length === 0 && commandLabels.length === 0 && learnV2CommandRules.length === 0) lines.push("No active command policy yet.", "");
  for (const node of commandNodes.sort(sortNodes)) lines.push(`- ${node.statement} (confidence ${node.confidence})`);
  if (commandLabels.length) {
    lines.push("", "## Approved Ambient Command Labels", "");
    for (const label of commandLabels.sort((a, b) => a.label!.localeCompare(b.label!))) {
      lines.push(`- ${label.label} (${label.hash}, evidence ${label.evidenceCount})`);
    }
  }
  if (workflows.length) {
    lines.push("", "## Active Workflow Commands", "");
    for (const workflow of workflows.sort(sortWorkflows)) {
      const conditions = [
        workflow.trigger.paths.length ? `paths ${workflow.trigger.paths.join(", ")}` : undefined,
        workflow.trigger.taskTypes.length ? `tasks ${workflow.trigger.taskTypes.join(", ")}` : undefined,
        workflow.trigger.naturalLanguagePatterns.length ? `phrases ${workflow.trigger.naturalLanguagePatterns.slice(0, 4).join(", ")}` : undefined
      ].filter(Boolean).join("; ") || "matching task scope";
      lines.push(`- ${workflow.name}: ${workflow.trigger.commands.join(" -> ")} when ${conditions} (confidence ${workflow.confidence})`);
    }
  }
  if (learnV2CommandRules.length) {
    lines.push("", "## Learn v2 Structured Command Rules", "");
    lines.push(renderLearnV2CommandPolicyMarkdown(learnV2CommandRules).replace(/^# Learn v2 Command Policy\s*/u, "").trim());
  }
  lines.push("");
  return lines.join("\n");
}

function renderCommandPolicyJson(
  nodes: PreferenceNode[],
  workflows: WorkflowNode[],
  commandLabels: Awaited<ReturnType<typeof readApprovedAmbientLabels>>["commands"],
  learnV2CommandRules: ReturnType<typeof buildLearnV2CommandPolicyRules>
) {
  const commandNodes = nodes.filter((node) => node.category === "tooling" || node.category === "testing" || /command|script|npm|test|build|lint|typecheck/i.test(node.statement));
  const workflowPolicies = workflows
    .filter((workflow) => workflow.trigger.commands.length || workflow.steps.some((step) => step.command))
    .sort(sortWorkflows)
    .map((workflow) => ({
      id: workflow.id,
      source: "workflow" as const,
      title: workflow.name,
      commands: [...new Set([...workflow.trigger.commands, ...workflow.steps.map((step) => step.command).filter((item): item is string => Boolean(item))])],
      conditions: {
        paths: workflow.trigger.paths,
        taskTypes: workflow.trigger.taskTypes,
        naturalLanguagePatterns: workflow.trigger.naturalLanguagePatterns
      },
      confidence: workflow.confidence,
      status: workflow.status,
      evidenceCardIds: workflow.evidenceCardIds,
      privacyClass: workflow.privacy.class,
      unconditional: false
    }));
  const preferencePolicies = commandNodes.sort(sortNodes).map((node) => ({
    id: node.id,
    source: "preference" as const,
    statement: node.statement,
    conditions: {
      paths: node.scope.paths,
      taskTypes: [],
      naturalLanguagePatterns: [node.title]
    },
    confidence: node.confidence,
    status: node.status,
    privacyClass: node.privacy?.class ?? "project-private",
    unconditional: node.scope.paths.length === 0
  }));
  const labelPolicies = commandLabels.sort((a, b) => a.label!.localeCompare(b.label!)).map((label) => ({
    id: label.hash,
    source: "ambient-label" as const,
    label: label.label,
    commandHash: label.hash,
    evidenceCount: label.evidenceCount,
    unconditional: false
  }));
  return {
    schemaVersion: "openskill-kit.command-policy.v2",
    generatedAt: new Date().toISOString(),
    invariant: "Commands are conditional on task, path, reviewed workflow, or approved label evidence; do not treat as unconditional global commands.",
    workflows: workflowPolicies,
    preferences: preferencePolicies,
    approvedAmbientCommandLabels: labelPolicies,
    learnV2: {
      schemaVersion: "openskill-kit.learn-v2.command-policy.v1",
      ruleCount: learnV2CommandRules.length,
      rules: learnV2CommandRules
    }
  };
}

function renderReviewChecklist(nodes: PreferenceNode[], workflows: WorkflowNode[], labels: Awaited<ReturnType<typeof readApprovedAmbientLabels>>): string {
  const checklistNodes = nodes.filter((node) => ["security", "testing", "workflow", "api", "api-design", "command-policy", "review-policy"].includes(node.category) || node.polarity === "negative");
  const lines = ["# Review Checklist", ""];
  if (checklistNodes.length === 0 && workflows.length === 0 && labels.commands.length === 0 && labels.paths.length === 0) lines.push("No active review checklist items yet.", "");
  for (const node of checklistNodes.sort(sortNodes)) lines.push(`- [ ] ${node.statement} (confidence ${node.confidence})`);
  for (const label of labels.commands.sort((a, b) => a.label!.localeCompare(b.label!))) lines.push(`- [ ] Recognize reviewed command label ${label.label} (${label.hash})`);
  for (const label of labels.paths.sort((a, b) => a.label!.localeCompare(b.label!))) lines.push(`- [ ] Recognize reviewed path label ${label.label} (${label.hash})`);
  for (const workflow of workflows.sort(sortWorkflows)) lines.push(`- [ ] Follow active workflow ${workflow.name}: ${workflow.steps.map((step) => step.instruction).join(" -> ")} (confidence ${workflow.confidence})`);
  lines.push("");
  return lines.join("\n");
}

function sortNodes(a: PreferenceNode, b: PreferenceNode): number {
  return a.category.localeCompare(b.category) || b.confidence - a.confidence || a.title.localeCompare(b.title);
}

function sortWorkflows(a: WorkflowNode, b: WorkflowNode): number {
  return b.confidence - a.confidence || a.name.localeCompare(b.name);
}
