import path from "node:path";
import { getAdaptiveStatus } from "../status/status.js";
import { buildReviewQueue, type ReviewQueueResult } from "../preferences/proposals.js";
import { retrieveRelevantPreferences } from "../preferences/retrieval.js";
import { routeBehavior } from "../routing/router.js";
import { getAgentPluginAttachStatus } from "./plugin-attach.js";

export interface AgentTaskContextInput {
  projectRoot: string;
  query?: string;
  paths?: string[];
  changedFiles?: string[];
  commands?: string[];
  limit?: number;
}

export interface AgentTaskContextResult {
  schemaVersion: "openskill-kit.agent-task-context.v1";
  query?: string;
  paths: string[];
  changedFiles: string[];
  commands: string[];
  route: Awaited<ReturnType<typeof routeBehavior>>;
  preferences: Awaited<ReturnType<typeof retrieveRelevantPreferences>>;
  status: {
    activePreferenceCount: number;
    pendingReviewCount: number;
    workflowCount: number;
    compiledContextPack: boolean;
  };
  plugin: Awaited<ReturnType<typeof getAgentPluginAttachStatus>>;
  review: {
    pendingProposalCount: number;
    pendingPreferenceCount: number;
    pendingWorkflowCount: number;
    totalPendingCount: number;
    markdownPath?: string;
    items: Array<{
      kind: "semantic-proposal" | "preference" | "workflow";
      id: string;
      status?: string;
      category?: string;
      confidence?: number;
      risk?: string;
      scope?: string;
      statement: string;
      actionHint: string;
    }>;
  };
  compactMarkdown: string;
  nextActions: string[];
}

export async function getAgentTaskContext(input: AgentTaskContextInput): Promise<AgentTaskContextResult> {
  const root = path.resolve(input.projectRoot);
  const paths = normalizeList(input.paths ?? []);
  const changedFiles = normalizeList(input.changedFiles ?? []);
  const commands = normalizeList(input.commands ?? []);
  const query = input.query?.trim() || undefined;
  const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
  const [route, preferences, status, plugin, reviewQueue] = await Promise.all([
    routeBehavior({ projectRoot: root, query, paths, changedFiles, commands }),
    retrieveRelevantPreferences({ projectRoot: root, query, paths: [...paths, ...changedFiles], limit }),
    getAdaptiveStatus(root),
    getAgentPluginAttachStatus(root),
    buildReviewQueue(root)
  ]);
  const review = summarizeReviewQueue(reviewQueue, limit);
  const nextActions = buildNextActions(route, preferences.items.length, status.pendingReviewCount, plugin.attached, review);
  const compactMarkdown = renderAgentTaskContextMarkdown({
    route,
    preferences,
    status: {
      activePreferenceCount: status.activePreferenceCount,
      pendingReviewCount: status.pendingReviewCount,
      workflowCount: status.activeWorkflowCount + status.stagedWorkflowCount + status.workflowCandidateCount,
      compiledContextPack: Boolean(status.compiled.contextPack)
    },
    plugin,
    review,
    nextActions
  });
  return {
    schemaVersion: "openskill-kit.agent-task-context.v1",
    query,
    paths,
    changedFiles,
    commands,
    route,
    preferences,
    status: {
      activePreferenceCount: status.activePreferenceCount,
      pendingReviewCount: status.pendingReviewCount,
      workflowCount: status.activeWorkflowCount + status.stagedWorkflowCount + status.workflowCandidateCount,
      compiledContextPack: Boolean(status.compiled.contextPack)
    },
    plugin,
    review,
    compactMarkdown,
    nextActions
  };
}

function summarizeReviewQueue(queue: ReviewQueueResult, limit: number): AgentTaskContextResult["review"] {
  const proposalItems = queue.proposals
    .sort((a, b) => b.confidence - a.confidence || a.category.localeCompare(b.category))
    .map((proposal) => ({
      kind: "semantic-proposal" as const,
      id: proposal.id,
      category: proposal.category,
      confidence: proposal.confidence,
      risk: proposal.risk,
      scope: renderScope(proposal.scope),
      statement: proposal.statement,
      actionHint: "Run learning/update graph, then review the generated candidate before activation; proposals are not active behavior."
    }));
  const preferenceItems = queue.candidates
    .sort((a, b) => b.confidence - a.confidence || a.category.localeCompare(b.category))
    .map((node) => ({
      kind: "preference" as const,
      id: node.id,
      status: node.status,
      category: node.category,
      confidence: node.confidence,
      scope: renderScope(node.scope),
      statement: node.statement,
      actionHint: "Use osk_apply_review_actions with activate/reject/lock/demote for this preference id."
    }));
  const workflowItems = queue.workflowCandidates
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name))
    .map((workflow) => ({
      kind: "workflow" as const,
      id: workflow.id,
      status: workflow.status,
      confidence: workflow.confidence,
      scope: workflow.trigger.paths.length ? `path (${workflow.trigger.paths.join(", ")})` : "project",
      statement: `${workflow.name}: ${workflow.trigger.commands.join(" -> ") || workflow.description}`,
      actionHint: "Use osk_apply_review_actions with workflowActivate/workflowReject/workflowLock/workflowDemote for this workflow id."
    }));
  const items = [...proposalItems, ...preferenceItems, ...workflowItems].slice(0, limit);
  return {
    pendingProposalCount: queue.proposals.length,
    pendingPreferenceCount: queue.candidates.length,
    pendingWorkflowCount: queue.workflowCandidates.length,
    totalPendingCount: queue.proposals.length + queue.candidates.length + queue.workflowCandidates.length,
    markdownPath: queue.markdownPath,
    items
  };
}

function buildNextActions(
  route: Awaited<ReturnType<typeof routeBehavior>>,
  preferenceCount: number,
  pendingReviewCount: number,
  pluginAttached: boolean,
  review: AgentTaskContextResult["review"]
): string[] {
  const actions = [
    pluginAttached ? undefined : "Attach the plugin host config before relying on MCP in this harness.",
    preferenceCount > 0 ? "Apply only returned preferences relevant to this task and paths." : "No strong active preferences returned; proceed from repo truth and record useful corrections later.",
    route.decision === "openworld-research" ? "Use OpenWorld research only through leakage-audited sources and review gates." : undefined,
    route.gates.includes("review") || pendingReviewCount > 0 || review.totalPendingCount > 0 ? "Review pending behavior before promoting or compiling broader instructions." : undefined,
    review.pendingProposalCount > 0 ? "Semantic proposals are review inputs only; run learning/update graph before applying review actions." : undefined,
    "Record high-value accepted/rejected behavior after task completion; do not store raw prompts, raw diffs, or secrets."
  ].filter(Boolean) as string[];
  return [...new Set(actions)];
}

function renderAgentTaskContextMarkdown(input: Pick<AgentTaskContextResult, "route" | "preferences" | "status" | "plugin" | "review" | "nextActions">): string {
  return [
    "## OpenSkillKit Task Context",
    "",
    `- Route: ${input.route.decision}`,
    `- Risk: ${input.route.risk.level}`,
    `- Local coverage: ${input.route.localCoverage}`,
    `- Novelty: ${input.route.novelty.score}`,
    `- Plugin attached: ${input.plugin.attached}`,
    `- Active preferences: ${input.status.activePreferenceCount}`,
    `- Pending review: ${input.review.totalPendingCount}`,
    "",
    input.route.reasons.length ? ["### Route Reasons", "", ...input.route.reasons.map((reason) => `- ${reason}`), ""].join("\n") : "",
    input.preferences.compactMarkdown || "### Relevant Preferences\n\nNo active preferences matched this task.",
    input.route.workflows.compactMarkdown ? `\n${input.route.workflows.compactMarkdown}` : "",
    input.review.items.length ? ["", "### Pending Review Items", "", ...input.review.items.map((item) => `- ${item.kind} ${item.id}${item.status ? ` [${item.status}]` : ""}: ${item.statement} (${item.actionHint})`), ""].join("\n") : "",
    "",
    "### Next Actions",
    "",
    ...input.nextActions.map((action) => `- ${action}`)
  ].filter((line) => line !== "").join("\n");
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function renderScope(scope: { level: string; paths: string[] }): string {
  return scope.paths.length ? `${scope.level} (${scope.paths.join(", ")})` : scope.level;
}
