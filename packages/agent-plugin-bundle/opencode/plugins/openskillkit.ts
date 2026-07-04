import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Plugin } from "@opencode-ai/plugin";

export const OpenSkillKitPlugin: Plugin = async (context) => {
  const rawContext = context as unknown as Record<string, unknown>;
  const projectRoot = typeof rawContext.worktree === "string" ? rawContext.worktree : typeof rawContext.directory === "string" ? rawContext.directory : process.cwd();
  const client = isRecord(rawContext.client) ? rawContext.client : undefined;
  const traceMode = resolveTraceMode();
  const pluginStartedAt = new Date().toISOString();
  const bootTraceSeed = `${projectRoot}:${process.env.OSK_SESSION_ID ?? ""}:${process.env.OSK_TRACE_ID ?? ""}:${pluginStartedAt}`;
  let currentOpenCodeSessionId: string | undefined;
  const emit = async (eventType: string, input?: unknown, output?: unknown) => {
    // Metadata-only by default. Raw commands, raw paths, args, cwd, env, urls, prompts,
    // diffs, tool outputs, and full message text stay out of normal ambient learning.
    const metadata = safe(input, output);
    currentOpenCodeSessionId = safeOpenCodeSessionId(metadata) ?? currentOpenCodeSessionId;
    const traceContext = buildTraceContext(projectRoot, currentOpenCodeSessionId, pluginStartedAt, bootTraceSeed);
    const base = {
      schemaVersion: "openskill-kit.opencode-ambient-event.v1",
      source: "opencode-plugin",
      eventType,
      capturedAt: new Date().toISOString(),
      traceMode,
      traceContext,
      metadata
    };
    const safeRecord = { ...base, containsRawFields: false };
    const safeFile = path.join(projectRoot, ".openskill-kit", "ambient", "opencode-events.jsonl");
    try {
      await mkdir(path.dirname(safeFile), { recursive: true });
      await appendFile(safeFile, `${JSON.stringify(safeRecord)}\n`, "utf8");
    } catch (error) {
      await log(client, "WARN", eventType, error instanceof Error ? error.message : String(error));
    }
    await log(client, "INFO", eventType);
    // Eval/debug traces are opt-in, clearly labeled, and written to a separate file so they
    // cannot be confused with normal privacy-safe ambient learning.
    if (traceMode === "eval") {
      const evalRecord = {
        ...base,
        schemaVersion: "openskill-kit.opencode-ambient-event-eval.v1",
        traceMode: "eval",
        containsRawFields: true,
        intendedUse: "local-evaluation-only",
        rawInput: input,
        rawOutput: output
      };
      const evalFile = path.join(projectRoot, ".openskill-kit", "evals", "traces", "opencode-events.raw.jsonl");
      try {
        await mkdir(path.dirname(evalFile), { recursive: true });
        await appendFile(evalFile, `${JSON.stringify(evalRecord)}\n`, "utf8");
      } catch (error) {
        await log(client, "WARN", eventType, error instanceof Error ? error.message : String(error));
      }
    }
  };

  return {
    event: async (input) => {
      const event: Record<string, unknown> = isRecord(input.event) ? input.event : {};
      const rawEventType = event["type"];
      const eventType = typeof rawEventType === "string" ? rawEventType : "event";
      await emit(mapOpenCodeEvent(eventType), event);
    },
    "tool.execute.before": async (input, output) => emit("pre-tool-use", input, output),
    "tool.execute.after": async (input, output) => emit("post-tool-use", input, output),
    "command.execute.before": async (input, output) => emit("command-intent", input, output),
    "permission.ask": async (input, output) => emit("permission-request", input, output)
  };
};

export const server = OpenSkillKitPlugin;

function mapOpenCodeEvent(eventType: string): string {
  const mapped: Record<string, string> = {
    "session.created": "session-start",
    "session.compacted": "session-compacted",
    "session.diff": "diff-stats",
    "session.idle": "finish-task-suggestion",
    "file.edited": "file-changed",
    "permission.replied": "permission-decision",
    "command.executed": "command-intent",
    "tui.command.execute": "command-intent"
  };
  return mapped[eventType] ?? eventType;
}

function safe(input: unknown, output?: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  copySafe("input", input, out);
  copySafe("output", output, out);
  return out;
}

// Only safe, low-risk primitives are copied verbatim. Commands and paths are never
// stored raw: they are projected into deterministic derived fields (kind, hash,
// length bucket, extension, depth, risk flags) so ambient learning keeps high-value
// signal without leaking secrets, customer/project names, or private repo paths.
const SAFE_PRIMITIVE_KEYS = ["id", "type", "tool", "status", "decision", "timestamp", "messageID"] as const;
const COMMAND_KEYS = ["command", "cmd", "args", "argv"] as const;
const PATH_KEYS = ["path", "file", "filePath", "filename"] as const;
const SESSION_KEYS = ["sessionID", "sessionId", "session_id"] as const;

function copySafe(prefix: string, value: unknown, out: Record<string, unknown>) {
  if (!isRecord(value)) return;
  for (const key of SAFE_PRIMITIVE_KEYS) {
    const item = value[key];
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null) out[`${prefix}.${key}`] = item;
  }
  const command = firstString(value, COMMAND_KEYS);
  if (command !== undefined) Object.assign(out, projectCommand(`${prefix}.command`, command));
  const filePath = firstString(value, PATH_KEYS);
  if (filePath !== undefined) Object.assign(out, projectPath(`${prefix}.path`, filePath));
  const sessionId = firstString(value, SESSION_KEYS);
  if (sessionId !== undefined) out[`${prefix}.sessionIDHash`] = hashValue(sessionId);
}

function firstString(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.length) return item;
  }
  return undefined;
}

function projectCommand(prefix: string, value: string): Record<string, unknown> {
  return {
    [`${prefix}Kind`]: classifyCommand(value),
    [`${prefix}Hash`]: hashValue(value),
    [`${prefix}LengthBucket`]: getCommandLengthBucket(value),
    [`${prefix}RiskFlags`]: getRiskFlags(value)
  };
}

function projectPath(prefix: string, value: string): Record<string, unknown> {
  return {
    [`${prefix}Kind`]: classifyPath(value),
    [`${prefix}Hash`]: hashValue(value),
    [`${prefix}Extension`]: getPathExtension(value),
    [`${prefix}Depth`]: getPathDepth(value),
    [`${prefix}RiskFlags`]: getPathRiskFlags(value)
  };
}

function resolveTraceMode(): "safe" | "eval" {
  const flag = (process.env.OPENSKILLKIT_AMBIENT_TRACE_MODE ?? "safe").toLowerCase();
  return flag === "eval" ? "eval" : "safe";
}

function buildTraceContext(projectRoot: string, currentOpenCodeSessionId: string | undefined, pluginStartedAt: string, seed: string): Record<string, string> {
  const envSessionId = safeTraceId(process.env.OSK_SESSION_ID, "osk_session");
  const envEpisodeId = safeTraceId(process.env.OSK_EPISODE_ID, "osk_episode");
  const envTraceId = safeTraceId(process.env.OSK_TRACE_ID, "osk_trace");
  return {
    schemaVersion: "openskill-kit.learn-v2.trace-context.v1",
    oskSessionId: envSessionId ?? `osk_session_${hashBare(`${seed}:session`)}`,
    oskEpisodeId: envEpisodeId ?? `osk_episode_${hashBare(`${seed}:episode`)}`,
    oskTraceId: envTraceId ?? `osk_trace_${hashBare(`${seed}:trace`)}`,
    opencodeSessionId: currentOpenCodeSessionId ?? safeTraceId(process.env.OPENCODE_SESSION_ID, "opencode_session") ?? `opencode_session_${hashBare(`${seed}:opencode`)}`,
    source: envSessionId || envEpisodeId || envTraceId ? "env" : "generated",
    projectRootHash: hashValue(projectRoot),
    createdAt: pluginStartedAt
  };
}

function safeOpenCodeSessionId(metadata: Record<string, unknown>): string | undefined {
  const hash = stringMetadata(metadata, "input.sessionIDHash") ?? stringMetadata(metadata, "output.sessionIDHash");
  if (!hash?.startsWith("sha256:")) return undefined;
  return `opencode_session_${hash.slice("sha256:".length)}`;
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length ? value : undefined;
}

function safeTraceId(value: string | undefined, prefix: string): string | undefined {
  if (!value || value.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(value)) return undefined;
  return value.startsWith(`${prefix}_`) || value.startsWith(`${prefix}:`) ? value : undefined;
}

function hashValue(value: string): string {
  return `sha256:${hashBare(value)}`;
}

function hashBare(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function classifyCommand(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (isGitCommand(trimmed)) return "git";
  if (/\b(npm|npx|pnpm|yarn|bunx?)\b/.test(trimmed)) return "package-manager";
  if (/\b(python\d?|pip\d?|poetry|pytest|uv)\b/.test(trimmed)) return "python";
  if (/\bnode\b|\.m?js\b/.test(trimmed)) return "node";
  if (/\b(test|spec|jest|vitest|mocha)\b/.test(trimmed)) return "test";
  if (/\b(sh|bash|zsh|powershell|pwsh|cmd)\b/.test(trimmed)) return "shell";
  if (/\bopenskill-kit\b/.test(trimmed)) return "osk";
  return "other";
}

function isGitCommand(value: string): boolean {
  return /(^|\s|;|&&|\|)git\s/.test(value);
}

function classifyPath(value: string): string {
  if (value.startsWith("/")) return "absolute";
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\")) return "absolute";
  if (/^[a-zA-Z]:/.test(value)) return "absolute";
  if (value.startsWith("~/") || value.startsWith("~\\")) return "home";
  if (value.startsWith("./") || value.startsWith(".\\") || value.startsWith("../")) return "relative";
  if (/^https?:\/\//.test(value)) return "url";
  if (value.startsWith(".")) return "hidden-relative";
  return "relative";
}

function getPathExtension(value: string): string {
  const base = value.replace(/[?#].*$/, "").replace(/[\\/]$/, "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  const ext = base.slice(dot).toLowerCase();
  return ext.length > 8 ? "" : ext;
}

function getPathDepth(value: string): number {
  const normalized = value.replace(/^[a-zA-Z]:/, "").replace(/^~\//, "").replace(/^https?:\/\/[^\\/]+/, "");
  const segments = normalized.split(/[\\/]+/).filter((segment) => segment.length && segment !== ".");
  return Math.max(0, segments.length - 1);
}

function getCommandLengthBucket(value: string): string {
  const length = value.length;
  if (length <= 32) return "short";
  if (length <= 128) return "medium";
  if (length <= 512) return "long";
  return "xlong";
}

// Risk indicators flag shapes likely to carry secrets or sensitive values. They do
// not record the value itself, only the category of risk observed.
function getRiskFlags(value: string): string[] {
  const flags: string[] = [];
  if (/[A-Za-z0-9_]+\s*=\s*[^\s&|;]+/.test(value)) flags.push("assignment-like");
  if (/\b(token|secret|password|passwd|apikey|api_key|access_key|private_key|credentials?)\b/i.test(value)) flags.push("secret-keyword");
  if (/(sk-[A-Za-z0-9]{8,})|(gh[pousr]_[A-Za-z0-9]{10,})|(AKIA[0-9A-Z]{8,})/.test(value)) flags.push("credential-pattern");
  if (/https?:\/\/[^\s]+[?&][^\s]+/.test(value)) flags.push("url-with-query");
  return flags;
}

function getPathRiskFlags(value: string): string[] {
  const flags: string[] = [];
  if (value.startsWith("~") || /^[A-Za-z]:[\\/]?(Users|home|Documents|Desktop|Downloads)/i.test(value) || /^\/(Users|home)\//.test(value)) flags.push("home-path");
  if (/(private|secret|internal|customer|confidential)/i.test(value)) flags.push("sensitive-name");
  if (/https?:\/\/[^\s]+[?&][^\s]+/.test(value)) flags.push("url-with-query");
  if (/^\./.test(value.split(/[\\/]/).pop() ?? "")) flags.push("hidden-segment");
  return flags;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function log(client: Record<string, unknown> | undefined, level: "INFO" | "WARN", eventType: string, error?: string) {
  const app = isRecord(client?.app) ? client.app : undefined;
  const logFn = typeof app?.log === "function" ? app.log.bind(app) : undefined;
  if (!logFn) return;
  await logFn({ body: { service: "openskill-kit", level, message: error ? `${eventType}: ${error}` : eventType } }).catch(() => undefined);
}
