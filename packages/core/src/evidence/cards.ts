import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProjectConfig } from "../config/schema.js";
import { redactValue } from "../events/redaction.js";
import { readEvents } from "../events/store.js";
import type { Signal } from "../signals/schema.js";
import { writeJsonAtomic } from "../storage/atomic.js";

export const EvidenceCardSchema = z.object({
  schemaVersion: z.literal("openskill-kit.evidence-card.v1"),
  id: z.string().min(1),
  signalId: z.string().min(1),
  eventId: z.string().min(1),
  sourceType: z.enum(["event", "repo-pattern", "semantic-proposal", "unknown"]),
  category: z.string().min(1),
  scope: z.object({
    level: z.string().min(1),
    paths: z.array(z.string()).default([])
  }),
  statement: z.string().min(1),
  summary: z.string().min(1),
  quote: z.string().optional(),
  file: z.string().optional(),
  command: z.string().optional(),
  capturedAt: z.string().datetime(),
  privacy: z.object({
    rawIncluded: z.literal(false),
    redacted: z.boolean(),
    matches: z.array(z.string())
  })
});

export const EvidenceCardIndexSchema = z.object({
  schemaVersion: z.literal("openskill-kit.evidence-card-index.v1"),
  updatedAt: z.string().datetime(),
  cards: z.array(z.object({
    id: z.string(),
    path: z.string(),
    signalId: z.string(),
    eventId: z.string(),
    category: z.string(),
    statement: z.string()
  }))
});

export type EvidenceCard = z.infer<typeof EvidenceCardSchema>;
export type EvidenceCardIndex = z.infer<typeof EvidenceCardIndexSchema>;
type SignalEvidenceItem = { eventId: string; quote?: string; file?: string; command?: string };

export async function writeEvidenceCardsForSignals(
  projectRoot: string,
  signals: Signal[],
  config: ProjectConfig,
  now = new Date()
): Promise<Map<string, string[]>> {
  const root = path.resolve(projectRoot);
  const events = await readEvents(root).catch(() => []);
  const eventIds = new Set(events.map((event) => event.id));
  const cardsBySignal = new Map<string, string[]>();
  const indexCards: EvidenceCardIndex["cards"] = [];
  for (const signal of signals) {
    const evidenceItems: SignalEvidenceItem[] = signal.evidence.length ? signal.evidence : signal.eventIds.map((eventId) => ({ eventId }));
    for (const evidence of evidenceItems) {
      const id = `evc_${shortHash(`${signal.id}:${evidence.eventId}:${signal.statement}`)}`;
      const redactedQuote = config.privacy.redactSecrets && evidence.quote
        ? redactValue(evidence.quote, config)
        : { value: evidence.quote, redacted: false, matches: [] };
      const card = EvidenceCardSchema.parse({
        schemaVersion: "openskill-kit.evidence-card.v1",
        id,
        signalId: signal.id,
        eventId: evidence.eventId,
        sourceType: sourceType(signal, evidence.eventId, eventIds),
        category: signal.category,
        scope: signal.scope,
        statement: signal.statement,
        summary: summarize(signal, evidence.eventId),
        quote: typeof redactedQuote.value === "string" ? redactedQuote.value : undefined,
        file: evidence.file,
        command: evidence.command,
        capturedAt: now.toISOString(),
        privacy: {
          rawIncluded: false,
          redacted: redactedQuote.redacted,
          matches: redactedQuote.matches
        }
      });
      const rel = cardRelativePath(card.id);
      await writeJsonAtomic(path.join(root, rel), card);
      cardsBySignal.set(signal.id, [...(cardsBySignal.get(signal.id) ?? []), card.id]);
      indexCards.push({
        id: card.id,
        path: rel.replace(/\\/g, "/"),
        signalId: card.signalId,
        eventId: card.eventId,
        category: card.category,
        statement: card.statement
      });
    }
  }
  const existing = await readEvidenceCardIndex(root).catch(() => undefined);
  const merged = mergeIndexCards([...(existing?.cards ?? []), ...indexCards]);
  await writeJsonAtomic(path.join(root, ".openskill-kit", "evidence", "cards", "index.json"), EvidenceCardIndexSchema.parse({
    schemaVersion: "openskill-kit.evidence-card-index.v1",
    updatedAt: now.toISOString(),
    cards: merged
  }));
  return cardsBySignal;
}

export async function readEvidenceCardIndex(projectRoot: string): Promise<EvidenceCardIndex> {
  const file = path.join(path.resolve(projectRoot), ".openskill-kit", "evidence", "cards", "index.json");
  return EvidenceCardIndexSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
}

export async function readEvidenceCards(projectRoot: string, cardIds: string[]): Promise<EvidenceCard[]> {
  const root = path.resolve(projectRoot);
  const cards: EvidenceCard[] = [];
  for (const id of [...new Set(cardIds)].sort()) {
    const file = path.join(root, cardRelativePath(id));
    const card = await fs.readFile(file, "utf8").then((text) => EvidenceCardSchema.parse(JSON.parse(text))).catch(() => undefined);
    if (card) cards.push(card);
  }
  return cards;
}

function sourceType(signal: Signal, eventId: string, eventIds: Set<string>): EvidenceCard["sourceType"] {
  if (eventIds.has(eventId)) return "event";
  if (signal.kind === "repo-pattern" || eventId.startsWith("repo_")) return "repo-pattern";
  if (signal.kind === "semantic-proposal") return "semantic-proposal";
  return "unknown";
}

function summarize(signal: Signal, eventId: string): string {
  if (signal.kind === "repo-pattern") return `Repository pattern evidence for ${signal.category}.`;
  if (signal.kind === "semantic-proposal") return `Host-agent semantic proposal evidence from ${eventId}.`;
  return `Lifecycle event evidence from ${eventId}.`;
}

function cardRelativePath(id: string): string {
  return path.join(".openskill-kit", "evidence", "cards", `${id}.json`);
}

function mergeIndexCards(cards: EvidenceCardIndex["cards"]): EvidenceCardIndex["cards"] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
