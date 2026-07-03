import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "../storage/atomic.js";
import { learnV2SafeLocalPath } from "./utils.js";
import { LearnV2ProjectRelevanceSchema, type LearnV2ProjectRelevance } from "./relevance.js";
import { LearnV2SurfaceReadSchema, type LearnV2SurfaceRead } from "./surfaces.js";

export const LearnV2SourceGateReviewEntrySchema = z.object({
  id: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceHash: z.string().min(1),
  byteCount: z.number().int().min(0),
  lineCount: z.number().int().min(0),
  adapter: z.object({
    id: z.string().min(1),
    label: z.string().optional(),
    detectedFormat: LearnV2SurfaceReadSchema.shape.detectedFormat,
    normalizationProfile: LearnV2SurfaceReadSchema.shape.normalizationProfile,
    contentKind: LearnV2SurfaceReadSchema.shape.contentKind,
    detection: LearnV2SurfaceReadSchema.shape.adapterDetection,
    policy: LearnV2SurfaceReadSchema.shape.policy
  }),
  relevance: LearnV2ProjectRelevanceSchema,
  extractionEligible: z.boolean(),
  decision: z.enum(["accept", "review", "reject"]),
  artifactPolicy: z.object({
    normalizedEvidenceWritten: z.boolean(),
    rawVaultRecordWritten: z.boolean(),
    reviewSnippetIncluded: z.boolean(),
    tombstoneOnly: z.boolean()
  }),
  reviewSnippet: z.string().optional(),
  declassification: z.object({
    redacted: z.boolean(),
    matches: z.array(z.string()).default([])
  }),
  nextAction: z.string().min(1)
});
export type LearnV2SourceGateReviewEntry = z.infer<typeof LearnV2SourceGateReviewEntrySchema>;

export const LearnV2SourceGateReviewArtifactSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.source-gate-review.v1"),
  generatedAt: z.string().datetime(),
  projectRoot: z.string().min(1),
  counts: z.object({
    total: z.number().int().min(0),
    accepted: z.number().int().min(0),
    review: z.number().int().min(0),
    rejected: z.number().int().min(0),
    extractionEligible: z.number().int().min(0),
    normalizedEvidenceSuppressed: z.number().int().min(0)
  }),
  entries: z.array(LearnV2SourceGateReviewEntrySchema)
});
export type LearnV2SourceGateReviewArtifact = z.infer<typeof LearnV2SourceGateReviewArtifactSchema>;

export interface LearnV2SourceGateEntryInput {
  id: string;
  root: string;
  sourcePath: string;
  sourceHash: string;
  byteCount: number;
  lineCount: number;
  surface: LearnV2SurfaceRead;
  relevance: LearnV2ProjectRelevance;
  declassifiedText: string;
  declassificationMatches: string[];
  rawVaultRecordWritten: boolean;
}

export function buildLearnV2SourceGateReviewEntry(input: LearnV2SourceGateEntryInput): LearnV2SourceGateReviewEntry {
  const extractionEligible = input.relevance.decision === "accept";
  return LearnV2SourceGateReviewEntrySchema.parse({
    id: input.id,
    sourcePath: learnV2SafeLocalPath(input.sourcePath, input.root),
    sourceHash: input.sourceHash,
    byteCount: input.byteCount,
    lineCount: input.lineCount,
    adapter: {
      id: input.surface.adapterId,
      label: input.surface.adapterLabel,
      detectedFormat: input.surface.detectedFormat,
      normalizationProfile: input.surface.normalizationProfile,
      contentKind: input.surface.contentKind,
      detection: input.surface.adapterDetection,
      policy: input.surface.policy
    },
    relevance: input.relevance,
    extractionEligible,
    decision: input.relevance.decision,
    artifactPolicy: {
      normalizedEvidenceWritten: extractionEligible,
      rawVaultRecordWritten: input.rawVaultRecordWritten,
      reviewSnippetIncluded: false,
      tombstoneOnly: input.relevance.decision === "reject"
    },
    reviewSnippet: undefined,
    declassification: {
      redacted: input.declassificationMatches.length > 0,
      matches: input.declassificationMatches
    },
    nextAction: extractionEligible
      ? "Accepted source entered Learn v2 extraction."
      : input.relevance.decision === "review"
        ? "Review source relevance from metadata only, then rerun with a more clearly project-anchored source if it should enter extraction."
        : "Rejected source stayed tombstone-only and did not enter extraction."
  });
}

export async function writeLearnV2SourceGateReviewArtifact(
  rootInput: string,
  entries: LearnV2SourceGateReviewEntry[],
  now = new Date()
): Promise<{ artifact: LearnV2SourceGateReviewArtifact; paths: { json: string; markdown: string } }> {
  const root = path.resolve(rootInput);
  const dir = path.join(root, ".openskill-kit", "learn-v2", "source-gate");
  const json = path.join(dir, "source-gate-review.json");
  const markdown = path.join(dir, "source-gate-review.md");
  const artifact = LearnV2SourceGateReviewArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.source-gate-review.v1",
    generatedAt: now.toISOString(),
    projectRoot: "[PROJECT_ROOT]",
    counts: {
      total: entries.length,
      accepted: entries.filter((entry) => entry.decision === "accept").length,
      review: entries.filter((entry) => entry.decision === "review").length,
      rejected: entries.filter((entry) => entry.decision === "reject").length,
      extractionEligible: entries.filter((entry) => entry.extractionEligible).length,
      normalizedEvidenceSuppressed: entries.filter((entry) => !entry.artifactPolicy.normalizedEvidenceWritten).length
    },
    entries
  });
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(json, artifact);
  await fs.writeFile(markdown, renderSourceGateReviewMarkdown(artifact), "utf8");
  return { artifact, paths: { json, markdown } };
}

function renderSourceGateReviewMarkdown(artifact: LearnV2SourceGateReviewArtifact): string {
  const lines = [
    "# Learn v2 Source Gate Review",
    "",
    `Generated: ${artifact.generatedAt}`,
    `Sources: ${artifact.counts.total}`,
    `Accepted: ${artifact.counts.accepted}`,
    `Review-needed: ${artifact.counts.review}`,
    `Rejected: ${artifact.counts.rejected}`,
    `Suppressed normalized evidence: ${artifact.counts.normalizedEvidenceSuppressed}`,
    ""
  ];
  for (const entry of artifact.entries) {
    lines.push(`## ${entry.decision}: ${entry.sourcePath}`, "");
    lines.push(`- Adapter: ${entry.adapter.id}${entry.adapter.normalizationProfile ? ` (${entry.adapter.normalizationProfile})` : ""}`);
    lines.push(`- Score: ${entry.relevance.score ?? "unknown"} via ${entry.relevance.gate ?? "unknown"}`);
    if (Array.isArray(entry.relevance.reasons) && entry.relevance.reasons.length) lines.push(`- Reasons: ${entry.relevance.reasons.slice(0, 8).join(", ")}`);
    lines.push(`- Extraction eligible: ${entry.extractionEligible ? "yes" : "no"}`);
    lines.push(`- Normalized evidence written: ${entry.artifactPolicy.normalizedEvidenceWritten ? "yes" : "no"}`);
    lines.push(`- Raw vault record written: ${entry.artifactPolicy.rawVaultRecordWritten ? "yes" : "no"}`);
    const policy = entry.extractionEligible
      ? "accepted-extraction"
      : entry.artifactPolicy.tombstoneOnly
        ? "tombstone-only"
        : "review-metadata-only";
    lines.push(`- Policy: ${policy}`);
    if (entry.reviewSnippet) lines.push(`- Review snippet: ${entry.reviewSnippet}`);
    lines.push(`- Next: ${entry.nextAction}`, "");
  }
  return `${lines.join("\n")}\n`;
}
