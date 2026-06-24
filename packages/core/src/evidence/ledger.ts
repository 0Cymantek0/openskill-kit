import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { RepoContext } from "../context/collector.js";

export const EvidenceSourceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["repo", "manual", "external", "generated"]),
  trust: z.enum(["trusted-local", "user-provided", "unverified-external", "generated"]),
  title: z.string().min(1),
  path: z.string().optional(),
  url: z.string().url().optional(),
  capturedAt: z.string().datetime(),
  sha256: z.string().length(64).optional(),
  excerpt: z.string().max(2000).optional()
});

export const EvidenceClaimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  sourceIds: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
  status: z.enum(["supported", "incomplete", "conflict"]),
  tags: z.array(z.string())
});

export const EvidenceLedgerSchema = z.object({
  schemaVersion: z.literal("openskill-kit.evidence.v0"),
  task: z.string().min(1),
  createdAt: z.string().datetime(),
  sources: z.array(EvidenceSourceSchema),
  claims: z.array(EvidenceClaimSchema),
  warnings: z.array(z.string())
});

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
export type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>;
export type EvidenceLedger = z.infer<typeof EvidenceLedgerSchema>;

export interface AdditionalEvidence {
  title: string;
  content: string;
  kind: "manual" | "external";
  path?: string;
  url?: string;
}

export function createLocalEvidenceLedger(task: string, context: RepoContext, now = new Date(), additionalEvidence: AdditionalEvidence[] = []): EvidenceLedger {
  const capturedAt = now.toISOString();
  const sources: EvidenceSource[] = context.files.slice(0, 12).map((file, index) => ({
    id: `src.repo.${index + 1}`,
    type: "repo",
    trust: "trusted-local",
    title: file.path,
    path: file.path,
    capturedAt,
    sha256: sha256(file.snippet),
    excerpt: file.snippet.slice(0, 1000)
  }));

  if (context.configFiles.length && !sources.some((source) => source.path === "package.json")) {
    sources.unshift({
      id: "src.repo.config",
      type: "repo",
      trust: "trusted-local",
      title: "Detected repository configuration",
      capturedAt,
      excerpt: context.configFiles.join("\n")
    });
  }

  const firstSourceId = sources[0]?.id ?? "src.generated.context";
  if (sources.length === 0) {
    sources.push({
      id: firstSourceId,
      type: "generated",
      trust: "generated",
      title: "Empty local context",
      capturedAt,
      excerpt: "No repository context files were collected."
    });
  }

  const addedSources: Array<{ id: string; evidence: AdditionalEvidence; sequence: number }> = [];
  const counts: Record<AdditionalEvidence["kind"], number> = { manual: 0, external: 0 };
  for (const evidence of additionalEvidence) {
    counts[evidence.kind] += 1;
    const sequence = counts[evidence.kind];
    const id = evidence.kind === "external" ? `src.external.${sequence}` : `src.manual.${sequence}`;
    addedSources.push({ id, evidence, sequence });
    sources.push({
      id,
      type: evidence.kind,
      trust: evidence.kind === "external" ? "unverified-external" : "user-provided",
      title: evidence.title,
      path: evidence.path,
      url: evidence.url,
      capturedAt,
      sha256: sha256(evidence.content),
      excerpt: evidence.content.slice(0, 2000)
    });
  }

  const claims: EvidenceClaim[] = [
    {
      id: "claim.repo.package-manager",
      text: `Detected package manager: ${context.packageManager}`,
      sourceIds: [firstSourceId],
      confidence: context.packageManager === "unknown" ? 0.3 : 0.85,
      status: context.packageManager === "unknown" ? "incomplete" : "supported",
      tags: ["repo", "tooling"]
    },
    {
      id: "claim.repo.frameworks",
      text: `Detected frameworks: ${context.frameworks.join(", ") || "none"}`,
      sourceIds: [firstSourceId],
      confidence: context.frameworks.length ? 0.75 : 0.4,
      status: "supported",
      tags: ["repo", "stack"]
    },
    {
      id: "claim.repo.verification-scripts",
      text: `Detected verification scripts: ${Object.keys(context.scripts).filter((name) => /test|lint|typecheck|check/.test(name)).join(", ") || "none"}`,
      sourceIds: [firstSourceId],
      confidence: Object.keys(context.scripts).length ? 0.8 : 0.35,
      status: Object.keys(context.scripts).length ? "supported" : "incomplete",
      tags: ["repo", "verification"]
    }
  ];

  for (const source of addedSources) {
    const tag = source.evidence.kind;
    claims.push({
      id: `claim.${tag}.${source.sequence}`,
      text: `${tag === "external" ? "External" : "User supplied"} evidence source: ${source.evidence.title}`,
      sourceIds: [source.id],
      confidence: tag === "external" ? 0.55 : 0.7,
      status: "supported",
      tags: [tag, "evidence"]
    });
  }

  return {
    schemaVersion: "openskill-kit.evidence.v0",
    task,
    createdAt: capturedAt,
    sources,
    claims,
    warnings: [
      ...context.warnings,
      additionalEvidence.some((item) => item.kind === "external")
        ? "External evidence is unverified and must be checked against installed versions and local repo truth."
        : "Ledger contains local repository evidence only; no external retrieval was performed."
    ]
  };
}

export async function writeEvidenceLedger(file: string, ledger: EvidenceLedger): Promise<void> {
  EvidenceLedgerSchema.parse(ledger);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(ledger, null, 2), "utf8");
}

export async function readEvidenceLedger(file: string): Promise<EvidenceLedger> {
  return EvidenceLedgerSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
