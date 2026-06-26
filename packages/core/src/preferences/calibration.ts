import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readEvidenceCards, type EvidenceCard } from "../evidence/cards.js";
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
  extractors: z.record(z.string(), CalibrationBucketSchema).default({}),
  scopes: z.record(z.string(), CalibrationBucketSchema).default({}),
  evidenceKinds: z.record(z.string(), CalibrationBucketSchema).default({}),
  privacyClasses: z.record(z.string(), CalibrationBucketSchema).default({}),
  evalOutcomes: z.record(z.string(), CalibrationBucketSchema).default({})
});

export type CalibrationBucket = z.infer<typeof CalibrationBucketSchema>;
export type CalibrationReport = z.infer<typeof CalibrationReportSchema>;
export type CalibrationOutcome = "accepted" | "rejected" | "locked" | "demoted";
export type EvalCalibrationStatus = "pass" | "fail" | "improved" | "regressed";

export async function recordCalibrationOutcomes(
  projectRoot: string,
  outcomes: Array<{ node: PreferenceNode; outcome: CalibrationOutcome }>,
  now = new Date()
): Promise<CalibrationReport> {
  const root = path.resolve(projectRoot);
  const report = await readCalibrationReport(root).catch(() => emptyReport(now));
  const signals = await readSignals(root);
  const signalsById = new Map(signals.map((signal) => [signal.id, signal]));
  for (const { node, outcome } of outcomes) {
    report.categories[node.category] = increment(report.categories[node.category], outcome);
    for (const scopeKey of scopeKeys(node.scope)) {
      report.scopes[scopeKey] = increment(report.scopes[scopeKey], outcome);
    }
    const nodeCards = await readEvidenceCards(root, node.evidence.flatMap((item) => item.cardIds ?? []));
    const extractors = new Set(node.evidence.map((item) => {
      const signal = signalsById.get(item.signalId);
      return signal?.extractorId ?? signal?.kind;
    }).filter((value): value is string => Boolean(value)));
    for (const extractor of extractors.size ? extractors : ["unknown"]) {
      report.extractors[extractor] = increment(report.extractors[extractor], outcome);
    }
    for (const evidenceKind of evidenceKindKeys(node, signalsById, nodeCards)) {
      report.evidenceKinds[evidenceKind] = increment(report.evidenceKinds[evidenceKind], outcome);
    }
    for (const privacy of privacyClassKeys(node, nodeCards)) {
      report.privacyClasses[privacy] = increment(report.privacyClasses[privacy], outcome);
    }
  }
  const next = CalibrationReportSchema.parse({ ...report, updatedAt: now.toISOString() });
  await writeJsonAtomic(calibrationFile(root), next);
  return next;
}

export async function recordEvalCalibrationOutcome(
  projectRoot: string,
  input: { suite: string; status: EvalCalibrationStatus; scenarioCount?: number; passCount?: number },
  now = new Date()
): Promise<CalibrationReport> {
  const root = path.resolve(projectRoot);
  const report = await readCalibrationReport(root).catch(() => emptyReport(now));
  const key = `${input.suite}:${input.status}`;
  const outcome: CalibrationOutcome = input.status === "pass" || input.status === "improved" ? "accepted" : "rejected";
  report.evalOutcomes[key] = increment(report.evalOutcomes[key], outcome);
  if (typeof input.scenarioCount === "number" && input.scenarioCount > 0) {
    const ratioKey = `${input.suite}:pass-rate`;
    const existing = report.evalOutcomes[ratioKey] ?? emptyBucket();
    report.evalOutcomes[ratioKey] = {
      ...existing,
      accepted: existing.accepted + Math.max(0, input.passCount ?? 0),
      rejected: existing.rejected + Math.max(0, input.scenarioCount - (input.passCount ?? 0)),
      reliability: reliability(existing.accepted + Math.max(0, input.passCount ?? 0), existing.locked, existing.rejected + Math.max(0, input.scenarioCount - (input.passCount ?? 0)), existing.demoted)
    };
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
    const reliabilities = [
      report.categories[signal.category]?.reliability,
      report.extractors[signal.extractorId ?? signal.kind]?.reliability,
      ...scopeKeys(signal.scope).map((key) => report.scopes[key]?.reliability),
      report.evidenceKinds[inferredEvidenceKind(signal)]?.reliability,
      report.privacyClasses[inferredPrivacyClass(signal.scope)]?.reliability
    ].filter((value): value is number => typeof value === "number");
    const factor = Math.max(0.35, Math.min(...(reliabilities.length ? reliabilities : [1])));
    return SignalSchema.parse({ ...signal, weight: Math.round(signal.weight * factor * 1000) / 1000 });
  });
}

function increment(bucket: CalibrationBucket | undefined, outcome: CalibrationOutcome): CalibrationBucket {
  const next = bucket ? { ...bucket } : emptyBucket();
  next[outcome] += 1;
  next.reliability = reliability(next.accepted, next.locked, next.rejected, next.demoted);
  return next;
}

function emptyReport(now: Date): CalibrationReport {
  return {
    schemaVersion: "openskill-kit.calibration.v1",
    updatedAt: now.toISOString(),
    categories: {},
    extractors: {},
    scopes: {},
    evidenceKinds: {},
    privacyClasses: {},
    evalOutcomes: {}
  };
}

async function readSignals(root: string): Promise<Signal[]> {
  const file = path.join(root, ".openskill-kit", "signals", "normalized.jsonl");
  const text = await fs.readFile(file, "utf8").catch(() => "");
  return text.split(/\r?\n/).filter(Boolean).map((line) => SignalSchema.parse(JSON.parse(line)));
}

function calibrationFile(root: string): string {
  return path.join(root, ".openskill-kit", "preferences", "calibration.json");
}

function emptyBucket(): CalibrationBucket {
  return { accepted: 0, rejected: 0, locked: 0, demoted: 0, reliability: 0.5 };
}

function reliability(accepted: number, locked: number, rejected: number, demoted: number): number {
  const positive = accepted + locked;
  const negative = rejected + demoted;
  return Math.round(((positive + 1) / (positive + negative + 2)) * 1000) / 1000;
}

function scopeKeys(scope: Signal["scope"]): string[] {
  return [
    `level:${scope.level}`,
    ...scope.paths.map((item) => `path:${item.replace(/\\/g, "/")}`)
  ];
}

function evidenceKindKeys(node: PreferenceNode, signalsById: Map<string, Signal>, cards: EvidenceCard[]): string[] {
  const values = new Set<string>();
  for (const card of cards) values.add(card.kind);
  for (const evidence of node.evidence) {
    const signal = signalsById.get(evidence.signalId);
    if (signal) values.add(inferredEvidenceKind(signal));
  }
  if (!values.size) values.add("unknown");
  return [...values].sort();
}

function privacyClassKeys(node: PreferenceNode, cards: EvidenceCard[]): string[] {
  const values = new Set(cards.map((card) => card.privacyClass));
  values.add(node.privacy?.class ?? inferredPrivacyClass(node.scope));
  return [...values].sort();
}

function inferredEvidenceKind(signal: Signal): string {
  if (signal.kind === "explicit-preference") return "user-correction";
  if (signal.kind === "review-feedback") return "review-comment";
  if (signal.kind === "acceptance") return "accepted-output";
  if (signal.kind === "rejection") return "rejected-output";
  if (signal.kind === "tool-choice") return "command-choice";
  return signal.kind;
}

function inferredPrivacyClass(scope: Signal["scope"]): "project-private" | "user-private" | "global-private" | "shareable" {
  if (scope.level === "global") return "global-private";
  if (scope.level === "user") return "user-private";
  return "project-private";
}
