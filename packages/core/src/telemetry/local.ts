import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { withFileLock } from "../storage/atomic.js";

export const CommandTelemetryFamilySchema = z.enum([
  "init",
  "status",
  "task",
  "learn",
  "review",
  "research",
  "evolve",
  "verify",
  "compile",
  "deploy",
  "eval",
  "pack"
]);

export const CommandTelemetryRecordSchema = z.object({
  schemaVersion: z.literal("openskill-kit.command-telemetry.v1"),
  recordedAt: z.string().datetime(),
  surface: z.enum(["cli", "mcp"]),
  family: CommandTelemetryFamilySchema,
  status: z.enum(["success", "failure"]),
  durationMs: z.number().int().min(0),
  exitCode: z.number().int().optional()
});

export const CommandTelemetrySummarySchema = z.object({
  schemaVersion: z.literal("openskill-kit.command-telemetry-summary.v1"),
  total: z.number().int().min(0),
  success: z.number().int().min(0),
  failure: z.number().int().min(0),
  byFamily: z.record(z.string(), z.object({
    total: z.number().int().min(0),
    success: z.number().int().min(0),
    failure: z.number().int().min(0),
    lastStatus: z.enum(["success", "failure"]).optional(),
    lastRecordedAt: z.string().datetime().optional(),
    avgDurationMs: z.number().int().min(0)
  })),
  bySurface: z.record(z.string(), z.object({
    total: z.number().int().min(0),
    success: z.number().int().min(0),
    failure: z.number().int().min(0)
  }))
});

export type CommandTelemetryFamily = z.infer<typeof CommandTelemetryFamilySchema>;
export type CommandTelemetryRecord = z.infer<typeof CommandTelemetryRecordSchema>;
export type CommandTelemetrySummary = z.infer<typeof CommandTelemetrySummarySchema>;

export async function recordCommandTelemetry(
  projectRoot: string,
  input: {
    surface: CommandTelemetryRecord["surface"];
    family: CommandTelemetryFamily;
    status: CommandTelemetryRecord["status"];
    durationMs: number;
    exitCode?: number;
    now?: Date;
  }
): Promise<CommandTelemetryRecord> {
  const root = path.resolve(projectRoot);
  const record = CommandTelemetryRecordSchema.parse({
    schemaVersion: "openskill-kit.command-telemetry.v1",
    recordedAt: (input.now ?? new Date()).toISOString(),
    surface: input.surface,
    family: input.family,
    status: input.status,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    exitCode: input.exitCode
  });
  const file = commandTelemetryPath(root);
  await withFileLock(`${file}.lock`, async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
  });
  return record;
}

export async function summarizeCommandTelemetry(projectRoot: string): Promise<CommandTelemetrySummary> {
  const root = path.resolve(projectRoot);
  const records = await readCommandTelemetry(root);
  const byFamily: Record<string, { total: number; success: number; failure: number; lastStatus?: "success" | "failure"; lastRecordedAt?: string; avgDurationMs: number; durationSum: number }> = {};
  const bySurface: Record<string, { total: number; success: number; failure: number }> = {};
  for (const record of records) {
    const family = byFamily[record.family] ?? { total: 0, success: 0, failure: 0, avgDurationMs: 0, durationSum: 0 };
    family.total += 1;
    family[record.status] += 1;
    family.durationSum += record.durationMs;
    if (!family.lastRecordedAt || record.recordedAt >= family.lastRecordedAt) {
      family.lastRecordedAt = record.recordedAt;
      family.lastStatus = record.status;
    }
    byFamily[record.family] = family;
    const surface = bySurface[record.surface] ?? { total: 0, success: 0, failure: 0 };
    surface.total += 1;
    surface[record.status] += 1;
    bySurface[record.surface] = surface;
  }
  const publicByFamily = Object.fromEntries(Object.entries(byFamily).map(([family, value]) => [family, {
    total: value.total,
    success: value.success,
    failure: value.failure,
    lastStatus: value.lastStatus,
    lastRecordedAt: value.lastRecordedAt,
    avgDurationMs: value.total ? Math.round(value.durationSum / value.total) : 0
  }]));
  return CommandTelemetrySummarySchema.parse({
    schemaVersion: "openskill-kit.command-telemetry-summary.v1",
    total: records.length,
    success: records.filter((record) => record.status === "success").length,
    failure: records.filter((record) => record.status === "failure").length,
    byFamily: publicByFamily,
    bySurface
  });
}

async function readCommandTelemetry(root: string): Promise<CommandTelemetryRecord[]> {
  const text = await fs.readFile(commandTelemetryPath(root), "utf8").catch(() => "");
  const records: CommandTelemetryRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = CommandTelemetryRecordSchema.safeParse(JSON.parse(line));
      if (parsed.success) records.push(parsed.data);
    } catch {
      continue;
    }
  }
  return records;
}

function commandTelemetryPath(root: string): string {
  return path.join(root, ".openskill-kit", "telemetry", "commands.jsonl");
}
