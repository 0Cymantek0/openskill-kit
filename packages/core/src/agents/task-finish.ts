import path from "node:path";
import { appendEvent, type AppendEventResult } from "../events/store.js";
import type { OpenSkillEventInput } from "../events/schema.js";
import { runLifecycleOnce, type LifecycleRunnerResult } from "../lifecycle/runner.js";
import { buildReviewQueue, type ReviewQueueResult } from "../preferences/proposals.js";

export type AgentTaskOutcome = "completed" | "accepted" | "rejected" | "edited";
export type AgentTaskCommandStatus = "pass" | "fail" | "blocked" | "timeout" | "unknown";

export interface AgentTaskFinishInput {
  projectRoot: string;
  sessionId?: string;
  summary: string;
  outcome?: AgentTaskOutcome;
  outcomeReason?: string;
  files?: string[];
  commands?: string[];
  commandStatus?: AgentTaskCommandStatus;
  proposedPatchHash?: string;
  finalPatchHash?: string;
  diffStats?: {
    added: number;
    removed: number;
    files: number;
  };
  learn?: boolean;
  compileSafe?: boolean;
  maxEvents?: number;
}

export interface AgentTaskFinishResult {
  schemaVersion: "openskill-kit.agent-task-finish.v1";
  sessionId: string;
  outcome: AgentTaskOutcome;
  eventIds: string[];
  eventPaths: string[];
  redactionMatches: string[];
  lifecycle?: LifecycleRunnerResult;
  review?: {
    pendingPreferenceCount: number;
    pendingWorkflowCount: number;
    markdownPath: string;
  };
  nextActions: string[];
}

export async function finishAgentTask(input: AgentTaskFinishInput): Promise<AgentTaskFinishResult> {
  const root = path.resolve(input.projectRoot);
  const summary = input.summary.trim();
  if (!summary) throw new Error("summary is required.");
  const sessionId = input.sessionId?.trim() || `agent-task-${new Date().toISOString().slice(0, 10)}`;
  const outcome = input.outcome ?? "completed";
  const outcomeReason = input.outcomeReason?.trim();
  const files = normalizeList(input.files ?? []);
  const commands = normalizeList(input.commands ?? []);
  const commandStatus = input.commandStatus ?? "unknown";
  const proposedPatchHash = normalizeHash(input.proposedPatchHash);
  const finalPatchHash = normalizeHash(input.finalPatchHash);
  const diffStats = normalizeDiffStats(input.diffStats);
  const appended: AppendEventResult[] = [];
  const base = {
    sessionId,
    source: { adapter: "agent-plugin", host: "coding-harness" },
    files: files.map((file) => ({ path: file, action: "edit" as const })),
    commands: commands.map((command) => ({ command, status: commandStatus })),
    privacy: { redacted: false, rawStored: false, containsUserText: true, containsCode: false }
  };
  const metadata = { outcomeReason, proposedPatchHash, finalPatchHash, diffStats };
  appended.push(await appendEvent(root, eventInput("task-completed", summary, outcome, base, metadata)));
  if (commands.length) appended.push(await appendEvent(root, eventInput("test-result", summary, outcome, base, metadata)));
  if (outcome === "accepted") appended.push(await appendEvent(root, eventInput("user-accepted", summary, outcome, base, metadata)));
  if (outcome === "rejected") appended.push(await appendEvent(root, eventInput("user-rejected", summary, outcome, base, metadata)));
  if (outcome === "edited") appended.push(await appendEvent(root, eventInput("user-edited", summary, outcome, base, metadata)));
  appended.push(await appendEvent(root, eventInput("session-end", summary, outcome, base, metadata)));

  const lifecycle = input.learn === false
    ? undefined
    : await runLifecycleOnce({ projectRoot: root, maxEvents: input.maxEvents ?? 250, compileSafe: input.compileSafe === true });
  const review = lifecycle ? summarizeReview(await buildReviewQueue(root)) : undefined;
  const nextActions = [
    lifecycle ? `${lifecycle.signals.signalCount} signal(s) extracted; ${lifecycle.graph.candidateCount} preference candidate(s) pending.` : "Learning skipped; run `openskill-kit osk learn` when ready.",
    review && (review.pendingPreferenceCount > 0 || review.pendingWorkflowCount > 0) ? `Review pending behavior: ${review.markdownPath}` : undefined,
    input.compileSafe === true && lifecycle?.compiled ? "Safe active behavior compiled." : undefined,
    input.compileSafe === true && !lifecycle?.compiled ? "Compile skipped because no safe active behavior was available or conflicts exist." : undefined,
    "Keep raw prompts, raw diffs, secrets, and hidden benchmark answers out of task summaries."
  ].filter(Boolean) as string[];
  return {
    schemaVersion: "openskill-kit.agent-task-finish.v1",
    sessionId,
    outcome,
    eventIds: appended.map((item) => item.event.id),
    eventPaths: [...new Set(appended.map((item) => item.eventPath))],
    redactionMatches: [...new Set(appended.flatMap((item) => item.redactionMatches))].sort(),
    lifecycle,
    review,
    nextActions
  };
}

function eventInput(
  eventType: OpenSkillEventInput["eventType"],
  summary: string,
  outcome: AgentTaskOutcome,
  base: Pick<OpenSkillEventInput, "sessionId" | "source" | "files" | "commands" | "privacy">,
  metadata: Pick<AgentTaskFinishInput, "outcomeReason" | "proposedPatchHash" | "finalPatchHash" | "diffStats">
): OpenSkillEventInput {
  const accepted = outcome === "accepted";
  const rejected = outcome === "rejected";
  const edited = outcome === "edited";
  return {
    ...base,
    eventType,
    intent: summary,
    normalized: {
      text: summary,
      outcome,
      summaryKind: "agent-task-finish",
      task: {
        type: inferTaskType(summary),
        risk: inferRisk(summary, base.commands ?? [])
      },
      userAction: {
        accepted,
        rejectedReason: rejected ? metadata.outcomeReason : undefined,
        editedPatchHash: edited ? metadata.finalPatchHash : undefined,
        finalPatchHash: metadata.finalPatchHash
      },
      agent: {
        proposedPatchHash: metadata.proposedPatchHash
      },
      git: {
        diffStats: metadata.diffStats
      },
      outcomeDetails: {
        status: outcomeStatus(outcome, base.commands ?? []),
        reason: metadata.outcomeReason,
        evidence: [
          ...((base.files ?? []).map((file) => file.path)),
          ...((base.commands ?? []).map((command) => [command.command, ...(command.args ?? [])].join(" ").trim()).filter(Boolean))
        ]
      }
    }
  };
}

function summarizeReview(queue: ReviewQueueResult): AgentTaskFinishResult["review"] {
  return {
    pendingPreferenceCount: queue.candidates.length,
    pendingWorkflowCount: queue.workflowCandidates.length,
    markdownPath: queue.markdownPath
  };
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizeHash(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^[A-Za-z0-9:_-]{6,128}$/.test(trimmed) ? trimmed : undefined;
}

function normalizeDiffStats(value: AgentTaskFinishInput["diffStats"]): AgentTaskFinishInput["diffStats"] | undefined {
  if (!value) return undefined;
  const added = Math.max(0, Math.floor(value.added));
  const removed = Math.max(0, Math.floor(value.removed));
  const files = Math.max(0, Math.floor(value.files));
  return { added, removed, files };
}

function inferTaskType(summary: string): string {
  if (/\b(test|spec|pytest|vitest)\b/i.test(summary)) return "test";
  if (/\b(doc|readme|documentation)\b/i.test(summary)) return "docs";
  if (/\b(security|auth|secret|token)\b/i.test(summary)) return "security";
  if (/\b(refactor|cleanup)\b/i.test(summary)) return "refactor";
  if (/\b(fix|bug|regression)\b/i.test(summary)) return "bugfix";
  return "feature";
}

function inferRisk(summary: string, commands: NonNullable<OpenSkillEventInput["commands"]>): string {
  if (/\b(security|auth|delete|destructive|migration|production)\b/i.test(summary)) return "high";
  if (commands.some((command) => command.status === "fail" || command.status === "blocked" || command.status === "timeout")) return "medium";
  return "low";
}

function outcomeStatus(outcome: AgentTaskOutcome, commands: NonNullable<OpenSkillEventInput["commands"]>): string {
  if (outcome === "rejected") return "failed";
  if (commands.some((command) => command.status === "fail" || command.status === "blocked" || command.status === "timeout")) return "failed";
  return "success";
}
