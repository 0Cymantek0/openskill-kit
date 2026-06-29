import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "@opencode-ai/plugin";

export const OpenSkillKitPlugin: Plugin = async (context) => {
  const rawContext = context as unknown as Record<string, unknown>;
  const projectRoot = typeof rawContext.worktree === "string" ? rawContext.worktree : typeof rawContext.directory === "string" ? rawContext.directory : process.cwd();
  const client = isRecord(rawContext.client) ? rawContext.client : undefined;
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
