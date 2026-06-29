import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

export const OpenSkillKitPlugin = async (context: Record<string, unknown> = {}) => {
  const projectRoot = typeof context.worktree === "string" ? context.worktree : typeof context.directory === "string" ? context.directory : process.cwd();
  const client = isRecord(context.client) ? context.client : undefined;
  const emit = async (eventType: string, input?: unknown, output?: unknown) => {
    // Metadata-only by default. Raw prompts, raw diffs, tool output, and secrets stay out.
    const metadata = safe(input, output);
    const record = {
      schemaVersion: "openskill-kit.opencode-ambient-event.v1",
      source: "opencode-plugin",
      eventType,
      capturedAt: new Date().toISOString(),
      metadata
    };
    const file = path.join(projectRoot, ".openskill-kit", "ambient", "opencode-events.jsonl");
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
    } catch (error) {
      await log(client, "WARN", eventType, error instanceof Error ? error.message : String(error));
    }
    await log(client, "INFO", eventType);
  };

  return {
    "session.created": async (input: unknown, output?: unknown) => emit("session-start", input, output),
    "session.compacted": async (input: unknown, output?: unknown) => emit("session-compacted", input, output),
    "session.diff": async (input: unknown, output?: unknown) => emit("diff-stats", input, output),
    "session.idle": async (input: unknown, output?: unknown) => emit("finish-task-suggestion", input, output),
    "file.edited": async (input: unknown, output?: unknown) => emit("file-changed", input, output),
    "tool.execute.before": async (input: unknown, output?: unknown) => emit("pre-tool-use", input, output),
    "tool.execute.after": async (input: unknown, output?: unknown) => emit("post-tool-use", input, output),
    "permission.asked": async (input: unknown, output?: unknown) => emit("permission-request", input, output),
    "permission.replied": async (input: unknown, output?: unknown) => emit("permission-decision", input, output),
    "command.executed": async (input: unknown, output?: unknown) => emit("command-intent", input, output),
    "tui.command.execute": async (input: unknown, output?: unknown) => emit("command-intent", input, output)
  };
};

function safe(input: unknown, output?: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  copySafe("input", input, out);
  copySafe("output", output, out);
  return out;
}

function copySafe(prefix: string, value: unknown, out: Record<string, unknown>) {
  if (!isRecord(value)) return;
  for (const key of ["id", "type", "tool", "command", "path", "status", "decision", "timestamp", "sessionID", "messageID"] as const) {
    const item = value[key];
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null) out[`${prefix}.${key}`] = item;
  }
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
