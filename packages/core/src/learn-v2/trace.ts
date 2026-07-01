import { LearnV2OskTraceContextSchema, type LearnV2OskTraceContext } from "./schemas.js";

export interface LearnV2TraceEnv {
  OSK_EPISODE_ID?: string;
  OSK_TRACE_ID?: string;
  OSK_SESSION_ID?: string;
  OPENCODE_SESSION_ID?: string;
  OPENCODE_PROJECT_ROOT?: string;
}

/**
 * Create a fresh trace context for a new learning session or OpenCode session start.
 * The caller should persist this and inject the ids into child processes / hooks.
 */
export function createLearnV2TraceContext(input: {
  projectId: string;
  worktree: string;
  gitBranch?: string;
  gitHead?: string;
  opencodeSessionId?: string;
  now?: Date;
}): LearnV2OskTraceContext {
  const now = (input.now ?? new Date()).toISOString();
  const seed = `${input.projectId}:${input.worktree}:${input.gitBranch ?? ""}:${input.gitHead ?? ""}:${now}`;
  return LearnV2OskTraceContextSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.trace-context.v1",
    projectId: input.projectId,
    worktree: input.worktree,
    oskSessionId: `osk_session_${shortId(seed)}`,
    oskEpisodeId: `osk_episode_${shortId(`${seed}:episode`)}`,
    oskTraceId: `osk_trace_${shortId(`${seed}:trace`)}`,
    opencodeSessionId: input.opencodeSessionId,
    gitBranch: input.gitBranch,
    gitHead: input.gitHead,
    createdAt: now
  });
}

/**
 * Recover a trace context from environment variables set by the OpenCode plugin
 * or a parent OSK process. Returns undefined if no trace anchors are present.
 */
export function recoverLearnV2TraceContext(env: LearnV2TraceEnv, projectId: string, worktree: string): LearnV2OskTraceContext | undefined {
  const episodeId = env.OSK_EPISODE_ID;
  const traceId = env.OSK_TRACE_ID;
  const sessionId = env.OSK_SESSION_ID;
  if (!episodeId && !traceId && !sessionId) return undefined;
  const now = new Date().toISOString();
  return LearnV2OskTraceContextSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.trace-context.v1",
    projectId,
    worktree,
    oskSessionId: sessionId ?? `osk_session_${shortId(`${projectId}:${worktree}:${now}`)}`,
    oskEpisodeId: episodeId ?? `osk_episode_${shortId(`${projectId}:${worktree}:${now}:ep`)}`,
    oskTraceId: traceId ?? `osk_trace_${shortId(`${projectId}:${worktree}:${now}:tr`)}`,
    opencodeSessionId: env.OPENCODE_SESSION_ID,
    gitBranch: undefined,
    gitHead: undefined,
    createdAt: now
  });
}

/**
 * Produce the env vars that a plugin / hook should export to child processes
 * so trace ids propagate into shell commands, tool calls, and child agents.
 */
export function learnV2TraceContextToEnv(context: LearnV2OskTraceContext): Record<string, string> {
  const env: Record<string, string> = {
    OSK_EPISODE_ID: context.oskEpisodeId,
    OSK_TRACE_ID: context.oskTraceId,
    OSK_SESSION_ID: context.oskSessionId
  };
  if (context.opencodeSessionId) env.OPENCODE_SESSION_ID = context.opencodeSessionId;
  return env;
}

/**
 * Determine the stitching priority rank for a set of trace anchors.
 * Lower rank = higher confidence stitching.
 */
export function learnV2TraceStitchingRank(anchors: {
  oskEpisodeId?: string;
  oskTraceId?: string;
  opencodeSessionId?: string;
  sessionId?: string;
  branch?: string;
  pathCluster?: string[];
}): number {
  if (anchors.oskEpisodeId || anchors.oskTraceId) return 1;
  if (anchors.opencodeSessionId) return 2;
  if (anchors.sessionId) return 3;
  if (anchors.branch && anchors.pathCluster?.length) return 4;
  if (anchors.pathCluster?.length) return 5;
  return 6;
}

function shortId(seed: string): string {
  let hash = 5381;
  for (let index = 0; index < seed.length; index++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(8, "0").slice(0, 12);
}
