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
  files?: string[];
  commands?: string[];
  commandStatus?: AgentTaskCommandStatus;
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
  const files = normalizeList(input.files ?? []);
  const commands = normalizeList(input.commands ?? []);
  const commandStatus = input.commandStatus ?? "unknown";
  const appended: AppendEventResult[] = [];
  const base = {
    sessionId,
    source: { adapter: "agent-plugin", host: "coding-harness" },
    files: files.map((file) => ({ path: file, action: "edit" as const })),
    commands: commands.map((command) => ({ command, status: commandStatus })),
    privacy: { redacted: false, rawStored: false, containsUserText: true, containsCode: false }
  };
  appended.push(await appendEvent(root, eventInput("task-completed", summary, outcome, base)));
  if (commands.length) appended.push(await appendEvent(root, eventInput("test-result", summary, outcome, base)));
  if (outcome === "accepted") appended.push(await appendEvent(root, eventInput("user-accepted", summary, outcome, base)));
  if (outcome === "rejected") appended.push(await appendEvent(root, eventInput("user-rejected", summary, outcome, base)));
  if (outcome === "edited") appended.push(await appendEvent(root, eventInput("user-edited", summary, outcome, base)));
  appended.push(await appendEvent(root, eventInput("session-end", summary, outcome, base)));

  const lifecycle = input.learn === false
    ? undefined
    : await runLifecycleOnce({ projectRoot: root, maxEvents: input.maxEvents ?? 250, compileSafe: input.compileSafe === true });
  const review = lifecycle ? summarizeReview(await buildReviewQueue(root)) : undefined;
  const nextActions = [
    lifecycle ? `${lifecycle.signals.signalCount} signal(s) extracted; ${lifecycle.graph.candidateCount} preference candidate(s) pending.` : "Learning skipped; run `openskill-kit learn` when ready.",
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
  base: Pick<OpenSkillEventInput, "sessionId" | "source" | "files" | "commands" | "privacy">
): OpenSkillEventInput {
  return {
    ...base,
    eventType,
    intent: summary,
    normalized: {
      text: summary,
      outcome,
      summaryKind: "agent-task-finish"
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
