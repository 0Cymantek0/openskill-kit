import { App } from "opencode";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

export const OpenSkillKitPlugin = async ({ app }: { app: App }) => {
  const emit = async (eventType: string, metadata: Record<string, unknown>) => {
    // Metadata-only by default. Raw prompts, raw diffs, tool output, and secrets stay out.
    const record = {
      schemaVersion: "openskill-kit.opencode-ambient-event.v1",
      source: "opencode-plugin",
      eventType,
      capturedAt: new Date().toISOString(),
      metadata
    };
    const file = path.join(process.cwd(), ".openskill-kit", "ambient", "opencode-events.jsonl");
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
    } catch (error) {
      app.log?.warn?.("openskill-kit", { eventType, error: error instanceof Error ? error.message : String(error) });
    }
    app.log?.info?.("openskill-kit", { eventType, metadata });
  };

  app.on?.("session.created", async (event: unknown) => emit("session-start", safe(event)));
  app.on?.("tool.execute.before", async (event: unknown) => emit("pre-tool-use", safe(event)));
  app.on?.("tool.execute.after", async (event: unknown) => emit("post-tool-use", safe(event)));
  app.on?.("file.edited", async (event: unknown) => emit("file-changed", safe(event)));
  app.on?.("permission.asked", async (event: unknown) => emit("permission-request", safe(event)));
  app.on?.("permission.replied", async (event: unknown) => emit("permission-decision", safe(event)));
  app.on?.("session.diff", async (event: unknown) => emit("diff-stats", safe(event)));
  app.on?.("session.idle", async (event: unknown) => emit("finish-task-suggestion", safe(event)));
  app.on?.("tui.command.execute", async (event: unknown) => emit("command-intent", safe(event)));
};

function safe(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== "object") return {};
  const source = event as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["id", "type", "tool", "command", "path", "status", "decision", "timestamp"]) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value;
  }
  return out;
}

export default OpenSkillKitPlugin;
