import path from "node:path";
import { getAdaptiveStatus } from "../status/status.js";
import { buildReviewQueue, type ReviewQueueResult } from "../preferences/proposals.js";
import { retrieveRelevantPreferences } from "../preferences/retrieval.js";
import { routeBehavior } from "../routing/router.js";
import { activateLearnV2Concepts, type LearnV2ConceptActivationResult } from "../learn-v2/activation.js";
import { learnV2ActivationBehaviorKey } from "../learn-v2/activation-signals.js";
import { getAgentPluginAttachStatus, getAgentPluginInstallProfile } from "./plugin-attach.js";

export interface AgentTaskContextInput {
  projectRoot: string;
  query?: string;
  paths?: string[];
  changedFiles?: string[];
  commands?: string[];
  negativeSignals?: string[];
  limit?: number;
}

export interface AgentTaskContextResult {
  schemaVersion: "openskill-kit.agent-task-context.v1";
  query?: string;
  paths: string[];
  changedFiles: string[];
  commands: string[];
  negativeSignals: string[];
  route: Awaited<ReturnType<typeof routeBehavior>>;
  preferences: Awaited<ReturnType<typeof retrieveRelevantPreferences>>;
  learnV2Activation: LearnV2ConceptActivationResult;
  learnedConcepts: {
    shown: LearnV2ConceptActivationResult["matches"];
    dedupedByPreference: LearnV2ConceptActivationResult["matches"];
    dedupeReasons: Array<{
      conceptId: string;
      preferenceIds: string[];
      reasons: string[];
    }>;
    suppressed: LearnV2ConceptActivationResult["suppressed"];
  };
  status: {
    activePreferenceCount: number;
    pendingReviewCount: number;
    workflowCount: number;
    compiledContextPack: boolean;
  };
  plugin: Awaited<ReturnType<typeof getAgentPluginAttachStatus>>;
  pluginInstallProfile: Awaited<ReturnType<typeof getAgentPluginInstallProfile>>;
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
  const negativeSignals = normalizeList(input.negativeSignals ?? []);
  const query = input.query?.trim() || undefined;
  const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
  const [route, preferences, learnV2Activation, status, plugin, pluginInstallProfile, reviewQueue] = await Promise.all([
    routeBehavior({ projectRoot: root, query, paths, changedFiles, commands }),
    retrieveRelevantPreferences({ projectRoot: root, query, paths: [...paths, ...changedFiles], limit }),
    activateLearnV2Concepts(root, {
      query,
      paths: [...paths, ...changedFiles],
      commands,
      negativeSignals,
      taskTypes: inferLearnV2TaskTypes(query, [...paths, ...changedFiles], commands),
      includeCandidates: false,
      limit
    }),
    getAdaptiveStatus(root),
    getAgentPluginAttachStatus(root),
    getAgentPluginInstallProfile(root),
    buildReviewQueue(root)
  ]);
  const learnedConcepts = dedupeLearnV2ActivationMatches(learnV2Activation, preferences);
  const review = summarizeReviewQueue(reviewQueue, limit);
  const nextActions = buildNextActions(route, preferences.items.length, learnedConcepts.shown.length, status.pendingReviewCount, plugin.attached, pluginInstallProfile.ready, review);
  const compactMarkdown = renderAgentTaskContextMarkdown({
    route,
    preferences,
    learnV2Activation,
    learnedConcepts,
    status: {
      activePreferenceCount: status.activePreferenceCount,
      pendingReviewCount: status.pendingReviewCount,
      workflowCount: status.activeWorkflowCount + status.stagedWorkflowCount + status.workflowCandidateCount,
      compiledContextPack: Boolean(status.compiled.contextPack)
    },
    plugin,
    pluginInstallProfile,
    review,
    nextActions
  });
  return {
    schemaVersion: "openskill-kit.agent-task-context.v1",
    query,
    paths,
    changedFiles,
    commands,
    negativeSignals,
    route,
    preferences,
    learnV2Activation,
    learnedConcepts,
    status: {
      activePreferenceCount: status.activePreferenceCount,
      pendingReviewCount: status.pendingReviewCount,
      workflowCount: status.activeWorkflowCount + status.stagedWorkflowCount + status.workflowCandidateCount,
      compiledContextPack: Boolean(status.compiled.contextPack)
    },
    plugin,
    pluginInstallProfile,
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
  learnedConceptCount: number,
  pendingReviewCount: number,
  pluginAttached: boolean,
  pluginInstallProfileReady: boolean,
  review: AgentTaskContextResult["review"]
): string[] {
  const actions = [
    pluginAttached ? undefined : "Attach the plugin host config before relying on MCP in this harness.",
    pluginInstallProfileReady ? "Use pluginInstallProfile.profile for first-call, MCP env binding, command routing, and approval gates." : "Compile the plugin install profile before harness attachment.",
    preferenceCount > 0
      ? "Apply only returned preferences relevant to this task and paths."
      : learnedConceptCount > 0
        ? "Apply only returned learned concepts relevant to this task and paths."
        : "No strong active preferences or learned concepts returned; proceed from repo truth and record useful corrections later.",
    route.decision === "openworld-research" ? "Use OpenWorld research only through leakage-audited sources and review gates." : undefined,
    route.gates.includes("review") || pendingReviewCount > 0 || review.totalPendingCount > 0 ? "Review pending behavior before promoting or compiling broader instructions." : undefined,
    review.pendingProposalCount > 0 ? "Semantic proposals are review inputs only; run learning/update graph before applying review actions." : undefined,
    "Record high-value accepted/rejected behavior after task completion; do not store raw prompts, raw diffs, or secrets."
  ].filter(Boolean) as string[];
  return [...new Set(actions)];
}

function renderAgentTaskContextMarkdown(input: Pick<AgentTaskContextResult, "route" | "preferences" | "learnV2Activation" | "learnedConcepts" | "status" | "plugin" | "pluginInstallProfile" | "review" | "nextActions">): string {
  return [
    "## OpenSkillKit Task Context",
    "",
    `- Route: ${input.route.decision}`,
    `- Risk: ${input.route.risk.level}`,
    `- Local coverage: ${input.route.localCoverage}`,
    `- Novelty: ${input.route.novelty.score}`,
    `- Plugin attached: ${input.plugin.attached}`,
    `- Plugin install profile: ${input.pluginInstallProfile.ready ? "ready" : "missing"}`,
    input.pluginInstallProfile.profile ? `- Plugin first call: ${input.pluginInstallProfile.profile.firstCall.mcpTool}` : "",
    `- Active preferences: ${input.status.activePreferenceCount}`,
    `- Pending review: ${input.review.totalPendingCount}`,
    "",
    input.route.reasons.length ? ["### Route Reasons", "", ...input.route.reasons.map((reason) => `- ${reason}`), ""].join("\n") : "",
    input.preferences.compactMarkdown || "### Relevant Preferences\n\nNo active preferences matched this task.",
    renderLearnV2ActivationMarkdown(input.learnedConcepts),
    input.route.workflows.compactMarkdown ? `\n${input.route.workflows.compactMarkdown}` : "",
    input.review.items.length ? ["", "### Pending Review Items", "", ...input.review.items.map((item) => `- ${item.kind} ${item.id}${item.status ? ` [${item.status}]` : ""}: ${item.statement} (${item.actionHint})`), ""].join("\n") : "",
    "",
    "### Next Actions",
    "",
    ...input.nextActions.map((action) => `- ${action}`)
  ].filter((line) => line !== "").join("\n");
}

function dedupeLearnV2ActivationMatches(
  activation: LearnV2ConceptActivationResult,
  preferences: Awaited<ReturnType<typeof retrieveRelevantPreferences>>
): AgentTaskContextResult["learnedConcepts"] {
  const coverage = preferences.items.map((item) => preferenceLearnV2Coverage(item.node));
  const dedupedByPreference: LearnV2ConceptActivationResult["matches"] = [];
  const dedupeReasons: AgentTaskContextResult["learnedConcepts"]["dedupeReasons"] = [];
  const shown: LearnV2ConceptActivationResult["matches"] = [];
  for (const match of activation.matches) {
    const coveredBy = coverage
      .map((item) => ({
        preferenceId: item.preferenceId,
        reasons: [
          ...(item.generatedConceptIds.has(match.conceptId) ? ["generated-preference-id"] : []),
          ...(item.evidenceConceptIds.has(match.conceptId) ? ["learn-v2-evidence-link"] : []),
          ...(match.behaviorKey && item.behaviorKey === match.behaviorKey ? ["behavior-key"] : [])
        ]
      }))
      .filter((item) => item.reasons.length);
    if (coveredBy.length) {
      dedupedByPreference.push(match);
      dedupeReasons.push({
        conceptId: match.conceptId,
        preferenceIds: coveredBy.map((item) => item.preferenceId).sort(),
        reasons: [...new Set(coveredBy.flatMap((item) => item.reasons))].sort()
      });
    } else {
      shown.push(match);
    }
  }
  return { shown, dedupedByPreference, dedupeReasons, suppressed: activation.suppressed };
}

function preferenceLearnV2Coverage(node: Awaited<ReturnType<typeof retrieveRelevantPreferences>>["items"][number]["node"]): {
  preferenceId: string;
  generatedConceptIds: Set<string>;
  evidenceConceptIds: Set<string>;
  behaviorKey: string;
} {
  const generatedConceptIds = new Set<string>();
  if (node.id.startsWith("pref_")) generatedConceptIds.add(node.id.slice("pref_".length));
  const evidenceConceptIds = new Set(node.evidence.flatMap((evidence) => [
    ...evidence.cardIds,
    evidence.signalId.startsWith("learn-v2:") ? evidence.signalId.slice("learn-v2:".length) : undefined
  ].filter((id): id is string => Boolean(id))));
  return {
    preferenceId: node.id,
    generatedConceptIds,
    evidenceConceptIds,
    behaviorKey: learnV2ActivationBehaviorKey(node.statement)
  };
}

function renderLearnV2ActivationMarkdown(learnedConcepts: AgentTaskContextResult["learnedConcepts"]): string {
  const lines: string[] = ["### Relevant Learned Concepts", ""];
  if (!learnedConcepts.shown.length && !learnedConcepts.dedupedByPreference.length && !learnedConcepts.suppressed.length) {
    lines.push("No reviewed Learn v2 concepts matched this task.");
    return lines.join("\n");
  }
  for (const match of learnedConcepts.shown) {
    lines.push(`- ${match.title}: score ${match.score}; confidence ${match.confidence}; reasons ${match.reasons.join(", ") || "matched"}`);
  }
  if (learnedConcepts.dedupedByPreference.length) {
    lines.push(`- ${learnedConcepts.dedupedByPreference.length} Learn v2 concept(s) already covered by relevant preference nodes.`);
    for (const item of learnedConcepts.dedupeReasons.slice(0, 5)) {
      lines.push(`  - ${item.conceptId} covered by ${item.preferenceIds.join(", ")} (${item.reasons.join(", ")})`);
    }
  }
  if (learnedConcepts.suppressed.length) {
    lines.push(`- ${learnedConcepts.suppressed.length} Learn v2 concept(s) suppressed by negative triggers or outcome telemetry.`);
  }
  return lines.join("\n");
}

function inferLearnV2TaskTypes(query: string | undefined, paths: string[], commands: string[]): string[] {
  const text = [query, ...paths, ...commands].filter(Boolean).join(" ").toLowerCase();
  const taskTypes = new Set<string>();
  if (/\b(parser|parse|syntax|grammar|lexer|token)\b/.test(text)) taskTypes.add("parser-change");
  if (/\b(test|spec|fixture|regression|vitest|jest|pytest)\b/.test(text)) taskTypes.add("test-change");
  if (/\b(doc|docs|readme|markdown)\b/.test(text)) taskTypes.add("docs-change");
  if (/\b(security|secret|credential|auth|token)\b/.test(text)) taskTypes.add("security-change");
  if (/\b(refactor|rewrite|architecture|dependency|package)\b/.test(text)) taskTypes.add("architecture-change");
  return [...taskTypes].sort();
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function renderScope(scope: { level: string; paths: string[] }): string {
  return scope.paths.length ? `${scope.level} (${scope.paths.join(", ")})` : scope.level;
}
