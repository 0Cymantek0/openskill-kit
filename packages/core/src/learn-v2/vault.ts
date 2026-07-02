import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProjectConfig } from "../config/schema.js";
import { readProjectConfig } from "../events/store.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { LearnV2RawEvidenceManifestSchema, LearnV2RawEvidenceRecordSchema, type LearnV2RawEvidenceManifest, type LearnV2RawEvidenceRecord } from "./schemas.js";
import type { LearnV2ProjectRelevance } from "./relevance.js";
import { learnV2DeclassifyText, learnV2Hash, learnV2SafeLocalPath, learnV2ShortHash, learnV2Snippet } from "./utils.js";

export interface LearnV2RawVaultOptions {
  root: string;
  config: ProjectConfig;
  now: Date;
  maxHotBytes?: number;
  maxPinnedBytes?: number;
  maxTotalBytes?: number;
  retentionDays?: number;
}

export interface LearnV2StoreRawInput {
  adapterId: string;
  sourcePath: string;
  text: string;
  contentKind: LearnV2RawEvidenceRecord["content"]["kind"];
  relevance: LearnV2ProjectRelevance;
  trace?: LearnV2RawEvidenceRecord["trace"];
}

export interface LearnV2StoredRawEvidence {
  record: LearnV2RawEvidenceRecord;
  rawText: string;
  declassifiedText: string;
  recordPath: string;
  blobPath: string;
  manifestPath: string;
  manifest: LearnV2RawEvidenceManifest;
}

export interface LearnV2RawVaultMaintenanceResult {
  schemaVersion: "openskill-kit.learn-v2.raw-vault-maintenance.v1";
  projectRoot: string;
  status: "ok" | "over-budget";
  gc: boolean;
  expiredRecords: number;
  compactedRecords: number;
  removedBlobRefs: string[];
  prunedPreviewArtifacts: string[];
  manifestPath: string;
  manifest: LearnV2RawEvidenceManifest;
  previewArtifacts: LearnV2PreviewArtifactSummary;
  nextActions: string[];
}

export interface LearnV2RawEvidencePinSyncResult {
  pinnedRecordIds: string[];
  unpinnedRecordIds: string[];
  missingRawRefs: string[];
  manifest: LearnV2RawEvidenceManifest;
}

export interface LearnV2PreviewArtifactSummary {
  root: string;
  previewStoreCount: number;
  previewStoreBytes: number;
  oldestPreviewStore?: string;
  newestPreviewStore?: string;
  prunedPreviewStores: string[];
  retention: {
    keepLatest: number;
    maxAgeDays: number;
  };
}

export async function syncLearnV2RawEvidenceRecordPins(
  rootInput: string,
  protectedRawRefsInput: string[],
  pin: string,
  now = new Date(),
  maxHotBytes = 50_000_000
): Promise<LearnV2RawEvidencePinSyncResult> {
  const root = path.resolve(rootInput);
  const config = await readProjectConfig(root);
  const protectedRawRefs = new Set(protectedRawRefsInput.filter(isSafeRawRefId));
  const invalidProtectedRefs = protectedRawRefsInput.filter((rawRef) => !isSafeRawRefId(rawRef));
  const recordsRoot = path.join(learnV2VaultRoot(root), "records");
  const pinnedRecordIds: string[] = [];
  const unpinnedRecordIds: string[] = [];
  const missingRawRefs: string[] = [];
  const seenRecordIds = new Set<string>();
  for (const entry of await fs.readdir(recordsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const recordPath = path.join(recordsRoot, entry.name);
    const record = LearnV2RawEvidenceRecordSchema.parse(JSON.parse(await fs.readFile(recordPath, "utf8")));
    seenRecordIds.add(record.id);
    const protect = protectedRawRefs.has(record.id);
    if (protect && record.retention.tier === "hot-spool" && !(await rawEvidenceBlobExists(root, record))) {
      missingRawRefs.push(record.id);
      continue;
    }
    const next = protect
      ? withRawEvidencePin(record, pin)
      : withoutRawEvidencePin(record, pin, now);
    if (next === record) continue;
    await writeJsonAtomic(recordPath, next);
    if (protect) pinnedRecordIds.push(record.id);
    else unpinnedRecordIds.push(record.id);
  }
  missingRawRefs.push(...[...protectedRawRefs].filter((rawRef) => !seenRecordIds.has(rawRef)), ...invalidProtectedRefs);
  return {
    pinnedRecordIds: pinnedRecordIds.sort(),
    unpinnedRecordIds: unpinnedRecordIds.sort(),
    missingRawRefs: [...new Set(missingRawRefs)].sort(),
    manifest: await rebuildLearnV2RawManifest(root, config.projectId, maxHotBytes, now)
  };
}

export async function storeLearnV2RawEvidence(options: LearnV2RawVaultOptions, input: LearnV2StoreRawInput): Promise<LearnV2StoredRawEvidence> {
  const root = path.resolve(options.root);
  const sourcePath = path.resolve(input.sourcePath);
  const declassified = learnV2DeclassifyText(input.text, root, options.config);
  const contentHash = learnV2Hash(input.text);
  const id = `raw_${learnV2ShortHash(`${input.adapterId}:${sourcePath}:${contentHash}`)}`;
  const vaultRoot = learnV2VaultRoot(root);
  const blobRel = `blobs/${contentHash.replace(/^sha256:/, "").slice(0, 2)}/${contentHash.replace(/^sha256:/, "")}.txt`;
  const blobPath = path.join(vaultRoot, blobRel);
  const recordPath = path.join(vaultRoot, "records", `${id}.json`);
  const expiresAt = new Date(options.now.getTime() + (options.retentionDays ?? 14) * 24 * 60 * 60 * 1000).toISOString();
  await fs.mkdir(path.dirname(blobPath), { recursive: true });
  await fs.writeFile(blobPath, input.text, "utf8");
  const record = LearnV2RawEvidenceRecordSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.raw-evidence-record.v1",
    id,
    projectId: options.config.projectId,
    source: {
      adapterId: input.adapterId,
      uri: `file://${learnV2SafeLocalPath(sourcePath, root)}`,
      path: learnV2SafeLocalPath(sourcePath, root),
      pathHash: learnV2Hash(sourcePath),
      contentHash
    },
    capturedAt: options.now.toISOString(),
    content: {
      kind: input.contentKind,
      encoding: "utf8",
      byteCount: Buffer.byteLength(input.text, "utf8"),
      lineCount: input.text.split(/\r?\n/).length,
      blobRef: blobRel,
      blobHash: contentHash
    },
    retention: {
      tier: "hot-spool",
      pinnedBy: [],
      expiresAt
    },
    privacy: {
      rawLocalOnly: true,
      declassified: false,
      redactionMatches: declassified.matches,
      placeholders: declassified.placeholders
    },
    relevance: input.relevance,
    trace: input.trace ?? {}
  });
  await writeJsonAtomic(recordPath, record);
  const manifest = await rebuildLearnV2RawManifest(root, options.config.projectId, options.maxHotBytes ?? 50_000_000, options.now, {
    maxPinnedBytes: options.maxPinnedBytes,
    maxTotalBytes: options.maxTotalBytes
  });
  return {
    record,
    rawText: input.text,
    declassifiedText: declassified.text,
    recordPath,
    blobPath,
    manifestPath: learnV2ManifestPath(root),
    manifest
  };
}

export async function rebuildLearnV2RawManifest(
  rootInput: string,
  projectId: string,
  maxHotBytes: number,
  now: Date,
  options: { maxPinnedBytes?: number; maxTotalBytes?: number } = {}
): Promise<LearnV2RawEvidenceManifest> {
  const root = path.resolve(rootInput);
  const recordsRoot = path.join(learnV2VaultRoot(root), "records");
  const records: LearnV2RawEvidenceRecord[] = [];
  for (const entry of await fs.readdir(recordsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const parsed = JSON.parse(await fs.readFile(path.join(recordsRoot, entry.name), "utf8"));
    records.push(LearnV2RawEvidenceRecordSchema.parse(parsed));
  }
  const storage = await summarizeVaultStorage(root, records);
  const totalBytes = storage.hotBytes + storage.pinnedBytes + storage.compactedBytes;
  const maxPinnedBytes = options.maxPinnedBytes ?? Math.max(maxHotBytes * 2, maxHotBytes);
  const maxTotalBytes = options.maxTotalBytes ?? Math.max(maxHotBytes * 4, maxHotBytes);
  const budget = {
    hotBytes: storage.hotBytes,
    pinnedBytes: storage.pinnedBytes,
    compactedBytes: storage.compactedBytes,
    expiredCount: records.filter((record) => record.retention.tier === "expired").length,
    totalBytes,
    maxHotBytes,
    maxPinnedBytes,
    maxTotalBytes,
    status: storage.hotBytes > maxHotBytes || storage.pinnedBytes > maxPinnedBytes || totalBytes > maxTotalBytes ? "over-budget" as const : "ok" as const
  };
  const manifest = LearnV2RawEvidenceManifestSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.raw-evidence-manifest.v1",
    projectId,
    updatedAt: now.toISOString(),
    records: records.map((record) => ({
      id: record.id,
      contentHash: record.source.contentHash,
      adapterId: record.source.adapterId,
      retentionTier: record.retention.tier,
      byteCount: record.content.byteCount,
      capturedAt: record.capturedAt,
      expiresAt: record.retention.expiresAt,
      relevanceDecision: record.relevance.decision
    })).sort((a, b) => a.id.localeCompare(b.id)),
    budget
  });
  await writeJsonAtomic(learnV2ManifestPath(root), manifest);
  return manifest;
}

export async function garbageCollectLearnV2RawVault(
  rootInput: string,
  config: ProjectConfig,
  now: Date,
  maxHotBytes = 50_000_000,
  options: { maxPinnedBytes?: number; maxTotalBytes?: number } = {}
): Promise<{ manifest: LearnV2RawEvidenceManifest; expiredRecords: number; compactedRecords: number; removedBlobRefs: string[] }> {
  const root = path.resolve(rootInput);
  const recordsRoot = path.join(learnV2VaultRoot(root), "records");
  let expiredRecords = 0;
  let compactedRecords = 0;
  const removedBlobRefs: string[] = [];
  for (const entry of await fs.readdir(recordsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const recordPath = path.join(recordsRoot, entry.name);
    const record = LearnV2RawEvidenceRecordSchema.parse(JSON.parse(await fs.readFile(recordPath, "utf8")));
    if (record.retention.tier === "pinned") continue;
    if (record.retention.tier === "compacted" || record.retention.tier === "expired") continue;
    if (!record.retention.expiresAt || new Date(record.retention.expiresAt).getTime() > now.getTime()) continue;
    const compactedRef = await compactLearnV2RawRecord(root, config, record, now);
    const retained = LearnV2RawEvidenceRecordSchema.parse({
      ...record,
      retention: compactedRef
        ? {
            ...record.retention,
            tier: "compacted",
            compactedRef,
            tombstoneReason: "retention-compacted"
          }
        : {
            ...record.retention,
            tier: "expired",
            tombstoneReason: "retention-expired-missing-blob"
          }
    });
    await writeJsonAtomic(recordPath, retained);
    if (compactedRef) compactedRecords += 1;
    else expiredRecords += 1;
    const blobPath = path.join(learnV2VaultRoot(root), record.content.blobRef);
    const removed = await fs.rm(blobPath).then(() => true, () => false);
    if (removed) removedBlobRefs.push(record.content.blobRef);
  }
  return {
    manifest: await rebuildLearnV2RawManifest(root, config.projectId, maxHotBytes, now, options),
    expiredRecords,
    compactedRecords,
    removedBlobRefs
  };
}

export async function runLearnV2RawVaultMaintenance(
  projectRootInput: string,
  options: { gc?: boolean; maxHotBytes?: number; maxPinnedBytes?: number; maxTotalBytes?: number; previewRetentionDays?: number; keepPreviewRuns?: number; now?: Date } = {}
): Promise<LearnV2RawVaultMaintenanceResult> {
  const root = path.resolve(projectRootInput);
  const config = await readProjectConfig(root);
  const now = options.now ?? new Date();
  const maxHotBytes = options.maxHotBytes ?? 50_000_000;
  const gc = options.gc === true
    ? await garbageCollectLearnV2RawVault(root, config, now, maxHotBytes, {
        maxPinnedBytes: options.maxPinnedBytes,
        maxTotalBytes: options.maxTotalBytes
      })
    : {
        manifest: await rebuildLearnV2RawManifest(root, config.projectId, maxHotBytes, now, {
          maxPinnedBytes: options.maxPinnedBytes,
          maxTotalBytes: options.maxTotalBytes
        }),
        expiredRecords: 0,
        compactedRecords: 0,
        removedBlobRefs: []
      };
  const previewArtifacts = await summarizeLearnV2PreviewArtifacts(root, now, {
    gc: options.gc,
    previewRetentionDays: options.previewRetentionDays,
    keepPreviewRuns: options.keepPreviewRuns
  });
  return {
    schemaVersion: "openskill-kit.learn-v2.raw-vault-maintenance.v1",
    projectRoot: root,
    status: gc.manifest.budget.status,
    gc: options.gc === true,
    expiredRecords: gc.expiredRecords,
    compactedRecords: gc.compactedRecords,
    removedBlobRefs: gc.removedBlobRefs,
    prunedPreviewArtifacts: previewArtifacts.prunedPreviewStores,
    manifestPath: learnV2ManifestPath(root),
    manifest: gc.manifest,
    previewArtifacts,
    nextActions: [
      ...(gc.manifest.budget.status === "over-budget"
        ? ["Review hot, pinned, and total raw-vault budgets; compact low-value raw records, reject stale candidates, or rerun maintenance with garbage collection after retention expiry."]
        : ["Raw vault budget is within configured limits."]),
      ...(previewArtifacts.previewStoreCount > previewArtifacts.retention.keepLatest
        ? ["Prune old Learn v2 preview stores with --gc-raw-vault or increase preview retention settings."]
        : ["Learn v2 preview artifact count is within retention settings."])
    ]
  };
}

export function learnV2VaultRoot(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "raw-vault");
}

export function learnV2ManifestPath(root: string): string {
  return path.join(learnV2VaultRoot(root), "manifest.json");
}

async function summarizeLearnV2PreviewArtifacts(
  root: string,
  now: Date,
  options: { gc?: boolean; previewRetentionDays?: number; keepPreviewRuns?: number }
): Promise<LearnV2PreviewArtifactSummary> {
  const previewRoot = path.join(root, ".openskill-kit", "learn-v2", "compiled-preview");
  const keepLatest = Math.max(1, options.keepPreviewRuns ?? 20);
  const maxAgeDays = Math.max(0, options.previewRetentionDays ?? 14);
  const files = await readPreviewStoreFiles(previewRoot);
  const sorted = files.sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime() || a.file.localeCompare(b.file));
  const pruned: string[] = [];
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  if (options.gc === true) {
    for (const [index, file] of sorted.entries()) {
      const protectedByCount = index < keepLatest;
      const tooOld = maxAgeDays === 0 || now.getTime() - file.generatedAt.getTime() > maxAgeMs;
      if (protectedByCount || !tooOld) continue;
      await fs.rm(file.path).catch(() => undefined);
      pruned.push(learnV2SafeLocalPath(file.path, root));
    }
  }
  const remaining = sorted.filter((file) => !pruned.includes(learnV2SafeLocalPath(file.path, root)));
  return {
    root: learnV2SafeLocalPath(previewRoot, root),
    previewStoreCount: remaining.length,
    previewStoreBytes: remaining.reduce((sum, file) => sum + file.bytes, 0),
    oldestPreviewStore: remaining.at(-1)?.generatedAt.toISOString(),
    newestPreviewStore: remaining[0]?.generatedAt.toISOString(),
    prunedPreviewStores: pruned,
    retention: { keepLatest, maxAgeDays }
  };
}

async function readPreviewStoreFiles(previewRoot: string): Promise<Array<{ file: string; path: string; bytes: number; generatedAt: Date }>> {
  const entries = await fs.readdir(previewRoot, { withFileTypes: true }).catch(() => []);
  const files: Array<{ file: string; path: string; bytes: number; generatedAt: Date }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^concept-store-preview-\d{14}\.json$/.test(entry.name)) continue;
    const filePath = path.join(previewRoot, entry.name);
    const stat = await fs.stat(filePath).catch(() => undefined);
    if (!stat) continue;
    files.push({
      file: entry.name,
      path: filePath,
      bytes: stat.size,
      generatedAt: previewTimestampFromFile(entry.name) ?? stat.mtime
    });
  }
  return files;
}

function previewTimestampFromFile(file: string): Date | undefined {
  const match = /^concept-store-preview-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.json$/.exec(file);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function withRawEvidencePin(record: LearnV2RawEvidenceRecord, pin: string): LearnV2RawEvidenceRecord {
  if (record.retention.tier === "expired") return record;
  const pinnedBy = [...new Set([...record.retention.pinnedBy, pin])].sort();
  const alreadyPinnedBy = pinnedBy.length === record.retention.pinnedBy.length && pinnedBy.every((item, index) => item === record.retention.pinnedBy[index]);
  if (record.retention.tier === "hot-spool") {
    return LearnV2RawEvidenceRecordSchema.parse({
      ...record,
      retention: {
        ...record.retention,
        tier: "pinned",
        pinnedBy,
        tombstoneReason: undefined,
        compactedRef: undefined
      }
    });
  }
  if (alreadyPinnedBy) return record;
  return LearnV2RawEvidenceRecordSchema.parse({
    ...record,
    retention: {
      ...record.retention,
      pinnedBy
    }
  });
}

function withoutRawEvidencePin(record: LearnV2RawEvidenceRecord, pin: string, now: Date): LearnV2RawEvidenceRecord {
  if (!record.retention.pinnedBy.includes(pin)) return record;
  const pinnedBy = record.retention.pinnedBy.filter((item) => item !== pin).sort();
  if (record.retention.tier !== "pinned" || pinnedBy.length) {
    return LearnV2RawEvidenceRecordSchema.parse({
      ...record,
      retention: {
        ...record.retention,
        pinnedBy
      }
    });
  }
  return LearnV2RawEvidenceRecordSchema.parse({
    ...record,
    retention: {
      ...record.retention,
      tier: "hot-spool",
      pinnedBy,
      expiresAt: record.retention.expiresAt ?? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
    }
  });
}

function isSafeRawRefId(rawRef: string): boolean {
  return /^[A-Za-z0-9_.:-]+$/.test(rawRef);
}

async function rawEvidenceBlobExists(root: string, record: LearnV2RawEvidenceRecord): Promise<boolean> {
  return fs.stat(path.join(learnV2VaultRoot(root), record.content.blobRef)).then(() => true, () => false);
}

async function compactLearnV2RawRecord(root: string, config: ProjectConfig, record: LearnV2RawEvidenceRecord, now: Date): Promise<string | undefined> {
  const rawText = await fs.readFile(path.join(learnV2VaultRoot(root), record.content.blobRef), "utf8").catch(() => undefined);
  if (rawText === undefined) return undefined;
  const declassified = learnV2DeclassifyText(rawText, root, config);
  const compactedRel = `compacted/${record.id}.json`;
  await writeJsonAtomic(path.join(learnV2VaultRoot(root), compactedRel), {
    schemaVersion: "openskill-kit.learn-v2.compacted-raw-evidence.v1",
    rawRef: record.id,
    projectId: record.projectId,
    compactedAt: now.toISOString(),
    originalCapturedAt: record.capturedAt,
    source: {
      adapterId: record.source.adapterId,
      path: record.source.path,
      pathHash: record.source.pathHash,
      contentHash: record.source.contentHash
    },
    originalContent: {
      kind: record.content.kind,
      byteCount: record.content.byteCount,
      lineCount: record.content.lineCount,
      blobHash: record.content.blobHash
    },
    retention: {
      previousTier: record.retention.tier,
      expiresAt: record.retention.expiresAt
    },
    declassifiedSummary: learnV2Snippet(declassified.text, 2000),
    redactionMatches: declassified.matches,
    placeholders: declassified.placeholders,
    relevance: record.relevance,
    trace: record.trace
  });
  return compactedRel;
}

async function summarizeVaultStorage(root: string, records: LearnV2RawEvidenceRecord[]): Promise<{ hotBytes: number; pinnedBytes: number; compactedBytes: number }> {
  let hotBytes = 0;
  let pinnedBytes = 0;
  let compactedBytes = 0;
  for (const record of records) {
    if (record.retention.tier === "hot-spool") hotBytes += record.content.byteCount;
    if (record.retention.tier === "pinned") pinnedBytes += record.content.byteCount;
    if (record.retention.tier === "compacted" && record.retention.compactedRef) {
      const stat = await fs.stat(path.join(learnV2VaultRoot(root), record.retention.compactedRef)).catch(() => undefined);
      compactedBytes += stat?.size ?? 0;
    }
  }
  return { hotBytes, pinnedBytes, compactedBytes };
}
