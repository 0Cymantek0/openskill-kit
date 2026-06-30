import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProjectConfig } from "../config/schema.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { LearnV2RawEvidenceManifestSchema, LearnV2RawEvidenceRecordSchema, type LearnV2RawEvidenceManifest, type LearnV2RawEvidenceRecord } from "./schemas.js";
import type { LearnV2ProjectRelevance } from "./relevance.js";
import { learnV2DeclassifyText, learnV2Hash, learnV2SafeLocalPath, learnV2ShortHash } from "./utils.js";

export interface LearnV2RawVaultOptions {
  root: string;
  config: ProjectConfig;
  now: Date;
  maxHotBytes?: number;
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
      tier: input.relevance.decision === "accept" ? "pinned" : "hot-spool",
      pinnedBy: input.relevance.decision === "accept" ? ["project-relevance"] : [],
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
  const manifest = await rebuildLearnV2RawManifest(root, options.config.projectId, options.maxHotBytes ?? 50_000_000, options.now);
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

export async function rebuildLearnV2RawManifest(rootInput: string, projectId: string, maxHotBytes: number, now: Date): Promise<LearnV2RawEvidenceManifest> {
  const root = path.resolve(rootInput);
  const recordsRoot = path.join(learnV2VaultRoot(root), "records");
  const records: LearnV2RawEvidenceRecord[] = [];
  for (const entry of await fs.readdir(recordsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const parsed = JSON.parse(await fs.readFile(path.join(recordsRoot, entry.name), "utf8"));
    records.push(LearnV2RawEvidenceRecordSchema.parse(parsed));
  }
  const budget = {
    hotBytes: sumTier(records, "hot-spool"),
    pinnedBytes: sumTier(records, "pinned"),
    compactedBytes: sumTier(records, "compacted"),
    expiredCount: records.filter((record) => record.retention.tier === "expired").length,
    totalBytes: records.reduce((sum, record) => sum + record.content.byteCount, 0),
    maxHotBytes,
    status: sumTier(records, "hot-spool") > maxHotBytes ? "over-budget" as const : "ok" as const
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

export async function garbageCollectLearnV2RawVault(rootInput: string, projectId: string, now: Date): Promise<LearnV2RawEvidenceManifest> {
  const root = path.resolve(rootInput);
  const recordsRoot = path.join(learnV2VaultRoot(root), "records");
  for (const entry of await fs.readdir(recordsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const recordPath = path.join(recordsRoot, entry.name);
    const record = LearnV2RawEvidenceRecordSchema.parse(JSON.parse(await fs.readFile(recordPath, "utf8")));
    if (record.retention.tier === "pinned") continue;
    if (!record.retention.expiresAt || new Date(record.retention.expiresAt).getTime() > now.getTime()) continue;
    const tombstone = LearnV2RawEvidenceRecordSchema.parse({
      ...record,
      retention: {
        ...record.retention,
        tier: "expired",
        tombstoneReason: "retention-expired"
      }
    });
    await writeJsonAtomic(recordPath, tombstone);
    await fs.rm(path.join(learnV2VaultRoot(root), record.content.blobRef), { force: true }).catch(() => undefined);
  }
  return rebuildLearnV2RawManifest(root, projectId, 50_000_000, now);
}

export function learnV2VaultRoot(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "raw-vault");
}

export function learnV2ManifestPath(root: string): string {
  return path.join(learnV2VaultRoot(root), "manifest.json");
}

function sumTier(records: LearnV2RawEvidenceRecord[], tier: LearnV2RawEvidenceRecord["retention"]["tier"]): number {
  return records.filter((record) => record.retention.tier === tier).reduce((sum, record) => sum + record.content.byteCount, 0);
}

