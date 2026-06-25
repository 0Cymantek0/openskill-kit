import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SignalSchema, type Signal } from "../signals/schema.js";
import type { PreferenceNode } from "./schema.js";
import { writeJsonAtomic } from "../storage/atomic.js";

const CalibrationBucketSchema = z.object({
  accepted: z.number().int().min(0).default(0),
  rejected: z.number().int().min(0).default(0),
  locked: z.number().int().min(0).default(0),
  demoted: z.number().int().min(0).default(0),
  reliability: z.number().min(0).max(1)
});

export const CalibrationReportSchema = z.object({
  schemaVersion: z.literal("openskill-kit.calibration.v1"),
  updatedAt: z.string().datetime(),
  categories: z.record(z.string(), CalibrationBucketSchema).default({}),
  extractors: z.record(z.string(), CalibrationBucketSchema).default({})
});

export type CalibrationBucket = z.infer<typeof CalibrationBucketSchema>;
export type CalibrationReport = z.infer<typeof CalibrationReportSchema>;
export type CalibrationOutcome = "accepted" | "rejected" | "locked" | "demoted";

export async function recordCalibrationOutcomes(
  projectRoot: string,
  outcomes: Array<{ node: PreferenceNode; outcome: CalibrationOutcome }>,
  now = new Date()
): Promise<CalibrationReport> {
  const root = path.resolve(projectRoot);
  const report = await readCalibrationReport(root).catch(() => emptyReport(now));
  const signals = await readSignals(root);
  const signalKinds = new Map(signals.map((signal) => [signal.id, signal.kind]));
  for (const { node, outcome } of outcomes) {
    report.categories[node.category] = increment(report.categories[node.category], outcome);
    const kinds = new Set(node.evidence.map((item) => signalKinds.get(item.signalId)).filter((value): value is Signal["kind"] => Boolean(value)));
    for (const kind of kinds.size ? kinds : ["unknown"]) {
      report.extractors[kind] = increment(report.extractors[kind], outcome);
    }
  }
  const next = CalibrationReportSchema.parse({ ...report, updatedAt: now.toISOString() });
  await writeJsonAtomic(calibrationFile(root), next);
  return next;
}

export async function readCalibrationReport(projectRoot: string): Promise<CalibrationReport> {
  return CalibrationReportSchema.parse(JSON.parse(await fs.readFile(calibrationFile(path.resolve(projectRoot)), "utf8")));
}

export async function applyCalibrationToSignals(projectRoot: string, signals: Signal[]): Promise<Signal[]> {
  const report = await readCalibrationReport(projectRoot).catch(() => undefined);
  if (!report) return signals;
  return signals.map((signal) => {
    const categoryReliability = report.categories[signal.category]?.reliability ?? 1;
    const extractorReliability = report.extractors[signal.kind]?.reliability ?? 1;
    const factor = Math.max(0.35, Math.min(categoryReliability, extractorReliability));
    return SignalSchema.parse({ ...signal, weight: Math.round(signal.weight * factor * 1000) / 1000 });
  });
}

function increment(bucket: CalibrationBucket | undefined, outcome: CalibrationOutcome): CalibrationBucket {
  const next = {
    accepted: bucket?.accepted ?? 0,
    rejected: bucket?.rejected ?? 0,
    locked: bucket?.locked ?? 0,
    demoted: bucket?.demoted ?? 0,
    reliability: bucket?.reliability ?? 0.5
  };
  next[outcome] += 1;
  const positive = next.accepted + next.locked;
  const negative = next.rejected + next.demoted;
  next.reliability = Math.round(((positive + 1) / (positive + negative + 2)) * 1000) / 1000;
  return next;
}

function emptyReport(now: Date): CalibrationReport {
  return { schemaVersion: "openskill-kit.calibration.v1", updatedAt: now.toISOString(), categories: {}, extractors: {} };
}

async function readSignals(root: string): Promise<Signal[]> {
  const file = path.join(root, ".openskill-kit", "signals", "normalized.jsonl");
  const text = await fs.readFile(file, "utf8").catch(() => "");
  return text.split(/\r?\n/).filter(Boolean).map((line) => SignalSchema.parse(JSON.parse(line)));
}

function calibrationFile(root: string): string {
  return path.join(root, ".openskill-kit", "preferences", "calibration.json");
}
