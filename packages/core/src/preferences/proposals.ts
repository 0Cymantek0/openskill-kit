import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { readProjectConfig } from "../events/store.js";
import { redactValue } from "../events/redaction.js";
import { SuggestedCompileTargets } from "../schema/constants.js";
import { SignalSchema, type Signal } from "../signals/schema.js";
import { writeFileAtomic, writeJsonAtomic, withFileLock } from "../storage/atomic.js";
import { readPreferenceGraph } from "./graph.js";
import type { PreferenceNode } from "./schema.js";

export const SemanticPreferenceProposalSchema = z.object({
  schemaVersion: z.literal("openskill-kit.semantic-proposal.v1"),
  id: z.string().min(1).optional(),
  sessionId: z.string().min(1),
  statement: z.string().min(8),
  category: SignalSchema.shape.category,
  scope: SignalSchema.shape.scope,
  evidence: z.array(z.object({
    eventId: z.string().min(1),
    quote: z.string().optional(),
    file: z.string().optional(),
    command: z.string().optional()
  })).min(1),
  counterevidence: z.array(z.object({
    eventId: z.string().min(1),
    quote: z.string().optional(),
    reason: z.string().optional()
  })).default([]),
  confidence: z.number().min(0).max(1),
  risk: z.enum(["low", "medium", "high"]).default("medium"),
  suggestedCompileTargets: z.array(z.enum(SuggestedCompileTargets)).default(["context-pack", "agent-skills"])
});

export type SemanticPreferenceProposalInput = z.input<typeof SemanticPreferenceProposalSchema>;
export type SemanticPreferenceProposal = z.infer<typeof SemanticPreferenceProposalSchema> & {
  id: string;
  createdAt: string;
  privacy: { redacted: boolean; matches: string[] };
};

export interface ProposeSemanticPreferenceResult {
  schemaVersion: "openskill-kit.semantic-proposal-result.v1";
  proposal: SemanticPreferenceProposal;
  proposalPath: string;
  signalPath: string;
  signal: Signal;
}

export interface ReviewQueueResult {
  schemaVersion: "openskill-kit.review-queue.v1";
  queuePath: string;
  markdownPath: string;
  candidateCount: number;
  proposals: SemanticPreferenceProposal[];
  candidates: PreferenceNode[];
}

export async function proposeSemanticPreference(projectRoot: string, input: SemanticPreferenceProposalInput, now = new Date()): Promise<ProposeSemanticPreferenceResult> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  return withFileLock(path.join(root, ".openskill-kit", "reviews", ".proposals.lock"), async () => {
    const parsed = SemanticPreferenceProposalSchema.parse(input);
    const redacted = config.privacy.redactSecrets ? redactValue(parsed, config) : { value: parsed, redacted: false, matches: [] };
    const safeProposal = redacted.value as SemanticPreferenceProposalInput;
    const proposal: SemanticPreferenceProposal = {
      ...SemanticPreferenceProposalSchema.parse(safeProposal),
      id: parsed.id ?? `proposal_${shortHash(`${parsed.sessionId}:${parsed.statement}:${now.toISOString()}`)}`,
      createdAt: now.toISOString(),
      privacy: { redacted: redacted.redacted, matches: redacted.matches }
    };
    const signal = proposalSignal(proposal, now);
    const proposalPath = proposalFile(root);
    const signalPath = proposalSignalsFile(root);
    await fs.mkdir(path.dirname(proposalPath), { recursive: true });
    await fs.appendFile(proposalPath, `${JSON.stringify(proposal)}\n`, "utf8");
    await fs.mkdir(path.dirname(signalPath), { recursive: true });
    await fs.appendFile(signalPath, `${JSON.stringify(signal)}\n`, "utf8");
    return { schemaVersion: "openskill-kit.semantic-proposal-result.v1", proposal, proposalPath, signalPath, signal };
  });
}

export async function readSemanticProposals(projectRoot: string): Promise<SemanticPreferenceProposal[]> {
  const file = proposalFile(path.resolve(projectRoot));
  const text = await fs.readFile(file, "utf8").catch(() => "");
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SemanticPreferenceProposal);
}

export async function readSemanticProposalSignals(projectRoot: string): Promise<Signal[]> {
  const file = proposalSignalsFile(path.resolve(projectRoot));
  const text = await fs.readFile(file, "utf8").catch(() => "");
  return text.split(/\r?\n/).filter(Boolean).map((line) => SignalSchema.parse(JSON.parse(line)));
}

export async function buildReviewQueue(projectRoot: string): Promise<ReviewQueueResult> {
  const root = path.resolve(projectRoot);
  const graph = await readPreferenceGraph(root);
  const candidates = graph.nodes.filter((node) => node.status === "candidate" || node.status === "conflict");
  const proposals = await readSemanticProposals(root);
  const queuePath = path.join(root, ".openskill-kit", "reviews", "queue.json");
  const markdownPath = path.join(root, ".openskill-kit", "reviews", "queue.md");
  const queue = { schemaVersion: "openskill-kit.review-queue.v1", generatedAt: new Date().toISOString(), proposals, candidates };
  await writeJsonAtomic(queuePath, queue);
  await writeFileAtomic(markdownPath, renderReviewQueueMarkdown(proposals, candidates));
  return { schemaVersion: "openskill-kit.review-queue.v1", queuePath, markdownPath, candidateCount: candidates.length, proposals, candidates };
}

function proposalSignal(proposal: SemanticPreferenceProposal, now: Date): Signal {
  const evidenceWeight = Math.max(0.1, Math.min(1, proposal.confidence - proposal.counterevidence.length * 0.08));
  return SignalSchema.parse({
    schemaVersion: "openskill-kit.signal.v1",
    id: `sig_${shortHash(`${proposal.id}:${proposal.statement}`)}`,
    eventIds: proposal.evidence.map((item) => item.eventId),
    extractedAt: now.toISOString(),
    kind: "semantic-proposal",
    category: proposal.category,
    scope: proposal.scope,
    statement: proposal.statement,
    polarity: proposal.statement.toLowerCase().startsWith("do not") || proposal.statement.toLowerCase().startsWith("avoid") ? "negative" : "positive",
    weight: evidenceWeight,
    evidence: proposal.evidence
  });
}

function renderReviewQueueMarkdown(proposals: SemanticPreferenceProposal[], candidates: PreferenceNode[]): string {
  const lines = ["# Learning Review Queue", ""];
  lines.push("## Semantic Proposals", "");
  if (!proposals.length) lines.push("No semantic proposals.", "");
  for (const proposal of proposals.sort((a, b) => a.category.localeCompare(b.category) || b.confidence - a.confidence)) {
    lines.push(`### ${proposal.id}`, "", `- Category: ${proposal.category}`, `- Risk: ${proposal.risk}`, `- Confidence: ${proposal.confidence}`, `- Scope: ${proposal.scope.level}${proposal.scope.paths.length ? ` (${proposal.scope.paths.join(", ")})` : ""}`, `- Statement: ${proposal.statement}`);
    lines.push(`- Evidence: ${proposal.evidence.map((item) => item.eventId).join(", ")}`);
    if (proposal.counterevidence.length) lines.push(`- Counterevidence: ${proposal.counterevidence.map((item) => item.eventId).join(", ")}`);
    lines.push(`- Suggested targets: ${proposal.suggestedCompileTargets.join(", ")}`, "");
  }
  lines.push("## Graph Candidates", "");
  if (!candidates.length) lines.push("No graph candidates.", "");
  for (const node of candidates.sort((a, b) => a.category.localeCompare(b.category) || b.confidence - a.confidence)) {
    const cardIds = node.evidence.flatMap((item) => item.cardIds ?? []);
    lines.push(`### ${node.id}`, "", `- Status: ${node.status}`, `- Category: ${node.category}`, `- Confidence: ${node.confidence}`, `- Scope: ${node.scope.level}${node.scope.paths.length ? ` (${node.scope.paths.join(", ")})` : ""}`, `- Statement: ${node.statement}`, `- Evidence: ${node.evidence.map((item) => item.signalId).join(", ")}`);
    if (cardIds.length) lines.push(`- Evidence cards: ${cardIds.join(", ")}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function proposalFile(root: string): string {
  return path.join(root, ".openskill-kit", "reviews", "proposals.jsonl");
}

function proposalSignalsFile(root: string): string {
  return path.join(root, ".openskill-kit", "signals", "semantic-proposals.jsonl");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
