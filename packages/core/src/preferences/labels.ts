import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { OpenSkillEvent } from "../events/schema.js";
import { writeJsonAtomic, withFileLock } from "../storage/atomic.js";

export const AmbientLabelKindSchema = z.enum(["command", "path"]);
export type AmbientLabelKind = z.infer<typeof AmbientLabelKindSchema>;

export const AmbientLabelSchema = z.object({
  schemaVersion: z.literal("openskill-kit.ambient-label.v1"),
  kind: AmbientLabelKindSchema,
  hash: z.string().min(1),
  status: z.enum(["candidate", "approved", "rejected"]),
  label: z.string().min(1).max(200).optional(),
  source: z.literal("opencode-ambient"),
  evidenceCount: z.number().int().min(0),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  reviewedAt: z.string().datetime().optional(),
  metadata: z.object({
    commandKind: z.string().optional(),
    pathKind: z.string().optional(),
    pathExtension: z.string().optional()
  }).default({})
});
export type AmbientLabel = z.infer<typeof AmbientLabelSchema>;

export const AmbientLabelLedgerSchema = z.object({
  schemaVersion: z.literal("openskill-kit.ambient-label-ledger.v1"),
  kind: AmbientLabelKindSchema,
  labels: z.array(AmbientLabelSchema),
  updatedAt: z.string().datetime()
});
export type AmbientLabelLedger = z.infer<typeof AmbientLabelLedgerSchema>;

export interface AmbientLabelCandidateSummary {
  kind: AmbientLabelKind;
  hash: string;
  evidenceCount: number;
  status: AmbientLabel["status"];
  labelRequired: true;
  metadata: AmbientLabel["metadata"];
}

export interface UpdateAmbientLabelCandidatesResult {
  schemaVersion: "openskill-kit.ambient-label-candidates.v1";
  commandLedgerPath: string;
  pathLedgerPath: string;
  candidates: AmbientLabelCandidateSummary[];
}

export interface ApplyAmbientLabelReviewOptions {
  approveCommand?: Array<{ hash: string; label: string }>;
  approvePath?: Array<{ hash: string; label: string }>;
  rejectCommand?: string[];
  rejectPath?: string[];
}

export interface ApplyAmbientLabelReviewResult {
  schemaVersion: "openskill-kit.ambient-label-review.v1";
  reviewedCount: number;
  commandLedger: AmbientLabelLedger;
  pathLedger: AmbientLabelLedger;
}

interface DerivedLabelObservation {
  kind: AmbientLabelKind;
  hash: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  metadata: AmbientLabel["metadata"];
}

export async function updateAmbientLabelCandidates(projectRoot: string, events: OpenSkillEvent[], now = new Date()): Promise<UpdateAmbientLabelCandidatesResult> {
  const root = path.resolve(projectRoot);
  return withFileLock(path.join(root, ".openskill-kit", "reviews", "labels", ".labels.lock"), async () => {
    const observations = collectDerivedLabelObservations(events);
    const commandLedger = await mergeCandidateLedger(root, "command", observations.filter((item) => item.kind === "command"), now);
    const pathLedger = await mergeCandidateLedger(root, "path", observations.filter((item) => item.kind === "path"), now);
    return {
      schemaVersion: "openskill-kit.ambient-label-candidates.v1",
      commandLedgerPath: labelLedgerPath(root, "command"),
      pathLedgerPath: labelLedgerPath(root, "path"),
      candidates: [...summarizeCandidateLabels(commandLedger), ...summarizeCandidateLabels(pathLedger)]
    };
  });
}

export function summarizeAmbientLabelCandidates(events: OpenSkillEvent[]): AmbientLabelCandidateSummary[] {
  return collectDerivedLabelObservations(events).map((item) => ({
    kind: item.kind,
    hash: item.hash,
    evidenceCount: item.count,
    status: "candidate",
    labelRequired: true,
    metadata: item.metadata
  }));
}

export async function applyAmbientLabelReview(projectRoot: string, options: ApplyAmbientLabelReviewOptions, now = new Date()): Promise<ApplyAmbientLabelReviewResult> {
  const root = path.resolve(projectRoot);
  return withFileLock(path.join(root, ".openskill-kit", "reviews", "labels", ".labels.lock"), async () => {
    const commandLedger = await applyLedgerReview(root, "command", options.approveCommand ?? [], options.rejectCommand ?? [], now);
    const pathLedger = await applyLedgerReview(root, "path", options.approvePath ?? [], options.rejectPath ?? [], now);
    const reviewedCount = [
      ...(options.approveCommand ?? []),
      ...(options.approvePath ?? []),
      ...(options.rejectCommand ?? []),
      ...(options.rejectPath ?? [])
    ].length;
    return { schemaVersion: "openskill-kit.ambient-label-review.v1", reviewedCount, commandLedger, pathLedger };
  });
}

export async function readAmbientLabelLedger(projectRoot: string, kind: AmbientLabelKind): Promise<AmbientLabelLedger> {
  const root = path.resolve(projectRoot);
  const file = labelLedgerPath(root, kind);
  return fs.readFile(file, "utf8")
    .then((text) => AmbientLabelLedgerSchema.parse(JSON.parse(text)))
    .catch(() => emptyLedger(kind, new Date()));
}

export async function readApprovedAmbientLabels(projectRoot: string): Promise<{ commands: AmbientLabel[]; paths: AmbientLabel[] }> {
  const [commands, paths] = await Promise.all([readAmbientLabelLedger(projectRoot, "command"), readAmbientLabelLedger(projectRoot, "path")]);
  return {
    commands: commands.labels.filter((label) => label.status === "approved" && label.label),
    paths: paths.labels.filter((label) => label.status === "approved" && label.label)
  };
}

function collectDerivedLabelObservations(events: OpenSkillEvent[]): DerivedLabelObservation[] {
  const byKey = new Map<string, DerivedLabelObservation>();
  for (const event of events) {
    for (const command of event.commands ?? []) {
      const parsed = parseDerivedCommand(command.command);
      if (parsed) addObservation(byKey, { ...parsed, firstSeenAt: event.timestamp, lastSeenAt: event.timestamp, count: 1 });
    }
    for (const file of event.files ?? []) {
      const parsed = parseDerivedPath(file.path);
      if (parsed) addObservation(byKey, { ...parsed, firstSeenAt: event.timestamp, lastSeenAt: event.timestamp, count: 1 });
    }
  }
  return [...byKey.values()].filter((item) => item.count >= 2);
}

function addObservation(byKey: Map<string, DerivedLabelObservation>, observation: DerivedLabelObservation): void {
  const key = `${observation.kind}:${observation.hash}`;
  const existing = byKey.get(key);
  if (!existing) {
    byKey.set(key, observation);
    return;
  }
  byKey.set(key, {
    ...existing,
    count: existing.count + observation.count,
    firstSeenAt: existing.firstSeenAt < observation.firstSeenAt ? existing.firstSeenAt : observation.firstSeenAt,
    lastSeenAt: existing.lastSeenAt > observation.lastSeenAt ? existing.lastSeenAt : observation.lastSeenAt,
    metadata: { ...existing.metadata, ...observation.metadata }
  });
}

async function mergeCandidateLedger(root: string, kind: AmbientLabelKind, observations: DerivedLabelObservation[], now: Date): Promise<AmbientLabelLedger> {
  const existing = await readAmbientLabelLedger(root, kind);
  const byHash = new Map(existing.labels.map((label) => [label.hash, label]));
  for (const observation of observations) {
    const current = byHash.get(observation.hash);
    if (current?.status === "rejected") continue;
    byHash.set(observation.hash, AmbientLabelSchema.parse({
      schemaVersion: "openskill-kit.ambient-label.v1",
      kind,
      hash: observation.hash,
      status: current?.status ?? "candidate",
      label: current?.label,
      source: "opencode-ambient",
      evidenceCount: (current?.evidenceCount ?? 0) + observation.count,
      firstSeenAt: current?.firstSeenAt ?? observation.firstSeenAt,
      lastSeenAt: observation.lastSeenAt,
      reviewedAt: current?.reviewedAt,
      metadata: { ...observation.metadata, ...current?.metadata }
    }));
  }
  const ledger = AmbientLabelLedgerSchema.parse({
    schemaVersion: "openskill-kit.ambient-label-ledger.v1",
    kind,
    labels: [...byHash.values()].sort((a, b) => a.hash.localeCompare(b.hash)),
    updatedAt: now.toISOString()
  });
  await writeLedger(root, ledger);
  return ledger;
}

async function applyLedgerReview(
  root: string,
  kind: AmbientLabelKind,
  approvals: Array<{ hash: string; label: string }>,
  rejections: string[],
  now: Date
): Promise<AmbientLabelLedger> {
  const ledger = await readAmbientLabelLedger(root, kind);
  const approvalByHash = new Map(approvals.map((item) => [item.hash, item.label.trim()]));
  const rejected = new Set(rejections);
  const labels = ledger.labels.map((entry) => {
    const approvedLabel = approvalByHash.get(entry.hash);
    if (approvedLabel) {
      return AmbientLabelSchema.parse({ ...entry, status: "approved", label: approvedLabel, reviewedAt: now.toISOString() });
    }
    if (rejected.has(entry.hash)) {
      const { label: _label, ...withoutLabel } = entry;
      return AmbientLabelSchema.parse({ ...withoutLabel, status: "rejected", reviewedAt: now.toISOString() });
    }
    return entry;
  });
  const next = AmbientLabelLedgerSchema.parse({ ...ledger, labels, updatedAt: now.toISOString() });
  await writeLedger(root, next);
  return next;
}

function summarizeCandidateLabels(ledger: AmbientLabelLedger): AmbientLabelCandidateSummary[] {
  return ledger.labels
    .filter((label) => label.status === "candidate")
    .map((label) => ({
      kind: label.kind,
      hash: label.hash,
      evidenceCount: label.evidenceCount,
      status: label.status,
      labelRequired: true,
      metadata: label.metadata
    }));
}

function parseDerivedCommand(command: string): DerivedLabelObservation | undefined {
  const match = /^opencode-derived:([^:]+):(sha256:[^:\s]+|sha256:[^\s]+)$/.exec(command);
  if (!match) return undefined;
  return {
    kind: "command",
    hash: match[2]!,
    count: 1,
    firstSeenAt: new Date(0).toISOString(),
    lastSeenAt: new Date(0).toISOString(),
    metadata: { commandKind: match[1] }
  };
}

function parseDerivedPath(filePath: string): DerivedLabelObservation | undefined {
  const match = /^opencode-derived:([^:]+):(sha256:[^.\s]+)(\.[A-Za-z0-9_-]{1,12})?$/.exec(filePath);
  if (!match) return undefined;
  return {
    kind: "path",
    hash: match[2]!,
    count: 1,
    firstSeenAt: new Date(0).toISOString(),
    lastSeenAt: new Date(0).toISOString(),
    metadata: { pathKind: match[1], pathExtension: match[3] ?? "" }
  };
}

function labelLedgerPath(root: string, kind: AmbientLabelKind): string {
  return path.join(root, ".openskill-kit", "reviews", "labels", kind === "command" ? "command-labels.json" : "path-labels.json");
}

async function writeLedger(root: string, ledger: AmbientLabelLedger): Promise<void> {
  await writeJsonAtomic(labelLedgerPath(root, ledger.kind), ledger);
}

function emptyLedger(kind: AmbientLabelKind, now: Date): AmbientLabelLedger {
  return { schemaVersion: "openskill-kit.ambient-label-ledger.v1", kind, labels: [], updatedAt: now.toISOString() };
}
