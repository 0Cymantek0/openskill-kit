import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readProjectConfig } from "../events/store.js";
import { readLearnV2ConceptStore, writeLearnV2ActivationIndex, type LearnV2ActivationIndex } from "./store.js";
import { learnV2Hash, learnV2ShortHash } from "./utils.js";

export const LearnV2ConceptOutcomeSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.concept-outcome.v1"),
  id: z.string().min(1),
  projectId: z.string().min(1),
  conceptId: z.string().min(1),
  recordedAt: z.string().datetime(),
  outcome: z.enum(["helpful", "ignored", "wrong", "harmful", "superseded"]),
  activationScore: z.number().min(0).max(1).optional(),
  queryHash: z.string().optional(),
  taskIdHash: z.string().optional(),
  pathHashes: z.array(z.string()).default([]),
  commandHashes: z.array(z.string()).default([]),
  reason: z.string().max(500).optional()
});
export type LearnV2ConceptOutcome = z.infer<typeof LearnV2ConceptOutcomeSchema>;

export interface LearnV2ConceptActivationQuery {
  query?: string;
  paths?: string[];
  commands?: string[];
  taskTypes?: string[];
  negativeSignals?: string[];
  includeCandidates?: boolean;
  limit?: number;
}

export interface LearnV2ConceptActivationMatch {
  conceptId: string;
  title: string;
  status: LearnV2ActivationIndex["entries"][number]["status"];
  risk: LearnV2ActivationIndex["entries"][number]["risk"];
  confidence: number;
  score: number;
  reasons: string[];
  suppressed: boolean;
  outcomeFeedback?: LearnV2ConceptOutcomeFeedback;
}

export interface LearnV2ConceptActivationResult {
  schemaVersion: "openskill-kit.learn-v2.activation-result.v1";
  generatedAt: string;
  query: {
    queryHash?: string;
    pathCount: number;
    commandCount: number;
    taskTypes: string[];
    includeCandidates: boolean;
    negativeSignals: string[];
  };
  matches: LearnV2ConceptActivationMatch[];
  suppressed: LearnV2ConceptActivationMatch[];
  diagnostics: {
    indexEntryCount: number;
    activeEntryCount: number;
    lockedEntryCount: number;
    candidateEntryCount: number;
    scoredEntryCount: number;
    visiblePositiveMatchCount: number;
    suppressedMatchCount: number;
  };
  activationIndexPath: string;
}

export interface LearnV2ConceptOutcomeResult {
  schemaVersion: "openskill-kit.learn-v2.concept-outcome-result.v1";
  outcomePath: string;
  record: LearnV2ConceptOutcome;
}

export interface LearnV2ConceptOutcomeFeedback {
  helpful: number;
  ignored: number;
  wrong: number;
  harmful: number;
  superseded: number;
  lastRecordedAt?: string;
}

export async function activateLearnV2Concepts(
  rootInput: string,
  query: LearnV2ConceptActivationQuery,
  now = new Date()
): Promise<LearnV2ConceptActivationResult> {
  const root = path.resolve(rootInput);
  const index = await readOrBuildActivationIndex(root, now);
  const outcomeFeedback = await readLearnV2ConceptOutcomeFeedback(root);
  const scored = scoreActivationEntries(index.entries, query, outcomeFeedback);
  const limit = Math.max(1, Math.min(50, query.limit ?? 8));
  const positive = scored.filter((match) => !match.suppressed && match.score > 0);
  const suppressedAll = scored.filter((match) => match.suppressed);
  const visible = positive.slice(0, limit);
  const suppressed = suppressedAll.slice(0, limit);
  return {
    schemaVersion: "openskill-kit.learn-v2.activation-result.v1",
    generatedAt: now.toISOString(),
    query: {
      queryHash: query.query ? learnV2Hash(normalizeText(query.query)) : undefined,
      pathCount: query.paths?.length ?? 0,
      commandCount: query.commands?.length ?? 0,
      taskTypes: query.taskTypes ?? [],
      includeCandidates: query.includeCandidates === true,
      negativeSignals: query.negativeSignals ?? []
    },
    matches: visible,
    suppressed,
    diagnostics: {
      indexEntryCount: index.entries.length,
      activeEntryCount: index.entries.filter((entry) => entry.status === "active").length,
      lockedEntryCount: index.entries.filter((entry) => entry.status === "locked").length,
      candidateEntryCount: index.entries.filter((entry) => entry.status === "candidate" || entry.status === "staged" || entry.status === "conflict").length,
      scoredEntryCount: scored.length,
      visiblePositiveMatchCount: positive.length,
      suppressedMatchCount: suppressedAll.length
    },
    activationIndexPath: learnV2ActivationIndexPath(root)
  };
}

export function scoreLearnV2ActivationEntries(
  entries: LearnV2ActivationIndex["entries"],
  query: LearnV2ConceptActivationQuery
): LearnV2ConceptActivationMatch[] {
  return scoreActivationEntries(entries, query);
}

export async function recordLearnV2ConceptOutcome(
  rootInput: string,
  input: {
    conceptId: string;
    outcome: LearnV2ConceptOutcome["outcome"];
    activationScore?: number;
    query?: string;
    taskId?: string;
    paths?: string[];
    commands?: string[];
    reason?: string;
  },
  now = new Date()
): Promise<LearnV2ConceptOutcomeResult> {
  const root = path.resolve(rootInput);
  const config = await readProjectConfig(root);
  const record = LearnV2ConceptOutcomeSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.concept-outcome.v1",
    id: `outcome_${learnV2ShortHash(`${input.conceptId}:${input.outcome}:${now.toISOString()}:${input.query ?? ""}`)}`,
    projectId: config.projectId,
    conceptId: input.conceptId,
    recordedAt: now.toISOString(),
    outcome: input.outcome,
    activationScore: input.activationScore,
    queryHash: input.query ? learnV2Hash(normalizeText(input.query)) : undefined,
    taskIdHash: input.taskId ? learnV2Hash(input.taskId) : undefined,
    pathHashes: (input.paths ?? []).map((item) => learnV2Hash(normalizePath(item))).sort(),
    commandHashes: (input.commands ?? []).map((item) => learnV2Hash(normalizeText(item))).sort(),
    reason: input.reason
  });
  const outcomePath = learnV2ConceptOutcomePath(root, now);
  await fs.mkdir(path.dirname(outcomePath), { recursive: true });
  await fs.appendFile(outcomePath, `${JSON.stringify(record)}\n`, "utf8");
  return {
    schemaVersion: "openskill-kit.learn-v2.concept-outcome-result.v1",
    outcomePath,
    record
  };
}

export function learnV2ConceptOutcomePath(root: string, now = new Date()): string {
  return path.join(root, ".openskill-kit", "learn-v2", "outcomes", `${now.toISOString().slice(0, 7)}.jsonl`);
}

function scoreActivationEntries(
  entries: LearnV2ActivationIndex["entries"],
  query: LearnV2ConceptActivationQuery,
  outcomeFeedback: Map<string, LearnV2ConceptOutcomeFeedback> = new Map()
): LearnV2ConceptActivationMatch[] {
  const queryText = normalizeText(query.query ?? "");
  const queryTokens = tokenSet(queryText);
  const paths = (query.paths ?? []).map(normalizePath);
  const commands = (query.commands ?? []).map(normalizeText);
  const taskTypes = new Set((query.taskTypes ?? []).map(normalizeText));
  const negativeSignals = new Set((query.negativeSignals ?? []).map(normalizeText));
  const visibleEntries = entries.filter((entry) => query.includeCandidates === true || entry.status === "active" || entry.status === "locked");
  const bm25 = buildActivationBm25Index(visibleEntries);
  return visibleEntries
    .map((entry) => scoreEntry(entry, { queryText, queryTokens, paths, commands, taskTypes, negativeSignals, bm25, outcomeFeedback }))
    .sort((a, b) => Number(a.suppressed) - Number(b.suppressed) || b.score - a.score || a.title.localeCompare(b.title));
}

function scoreEntry(
  entry: LearnV2ActivationIndex["entries"][number],
  query: {
    queryText: string;
    queryTokens: Set<string>;
    paths: string[];
    commands: string[];
    taskTypes: Set<string>;
    negativeSignals: Set<string>;
    bm25: ActivationBm25Index;
    outcomeFeedback: Map<string, LearnV2ConceptOutcomeFeedback>;
  }
): LearnV2ConceptActivationMatch {
  const reasons: string[] = [];
  const feedback = query.outcomeFeedback.get(entry.conceptId);
  const suppressedBy = entry.negativeTriggers.map(normalizeText).filter((trigger) => query.negativeSignals.has(trigger));
  if (suppressedBy.length) {
    return baseMatch(entry, 0, suppressedBy.map((trigger) => `negative-trigger:${trigger}`), true, feedback);
  }
  if (feedback && (feedback.harmful > 0 || feedback.superseded > 0)) {
    const reason = feedback.harmful > 0 ? "outcome:harmful" : "outcome:superseded";
    return baseMatch(entry, 0, [reason], true, feedback);
  }

  let score = entry.confidence * 0.22;
  score += entry.status === "locked" ? 0.16 : entry.status === "active" ? 0.14 : entry.status === "candidate" ? 0.04 : 0;

  const phraseHits = entry.phrases
    .map(normalizeText)
    .filter((phrase) => phrase && (query.queryText.includes(phrase) || tokenOverlap(tokenSet(phrase), query.queryTokens) >= Math.min(2, tokenSet(phrase).size)));
  if (phraseHits.length) {
    score += Math.min(0.32, phraseHits.length * 0.08);
    reasons.push(`phrase:${phraseHits.slice(0, 4).join(",")}`);
  }

  const pathHits = entry.pathGlobs.filter((glob) => query.paths.some((item) => pathGlobMatches(glob, item)));
  if (pathHits.length) {
    score += Math.min(0.28, pathHits.length * 0.1);
    reasons.push(`path:${pathHits.slice(0, 4).join(",")}`);
  }

  const commandHits = entry.commands.map(normalizeText).filter((command) => query.commands.some((item) => item.includes(command) || command.includes(item)));
  if (commandHits.length) {
    score += Math.min(0.22, commandHits.length * 0.1);
    reasons.push(`command:${commandHits.slice(0, 3).join(",")}`);
  }

  const taskHits = entry.taskTypes.map(normalizeText).filter((taskType) => query.taskTypes.has(taskType));
  if (taskHits.length) {
    score += Math.min(0.22, taskHits.length * 0.11);
    reasons.push(`task:${taskHits.slice(0, 4).join(",")}`);
  }

  const titleTokens = tokenSet(entry.title);
  const lexicalOverlap = tokenOverlap(titleTokens, query.queryTokens);
  if (lexicalOverlap) {
    score += Math.min(0.18, lexicalOverlap * 0.04);
    reasons.push(`lexical:${lexicalOverlap}`);
  }

  const bm25Score = scoreActivationBm25(entry, query.queryTokens, query.bm25);
  if (bm25Score > 0) {
    score += Math.min(0.24, bm25Score * 0.08);
    reasons.push(`bm25:${bm25Score.toFixed(2)}`);
  }

  if (feedback) {
    const helpfulBoost = Math.min(0.16, feedback.helpful * 0.05);
    const wrongPenalty = Math.min(0.24, feedback.wrong * 0.12);
    const ignoredPenalty = Math.min(0.08, feedback.ignored * 0.03);
    score += helpfulBoost;
    score -= wrongPenalty + ignoredPenalty;
    if (helpfulBoost > 0) reasons.push(`outcome:helpful:${feedback.helpful}`);
    if (wrongPenalty > 0) reasons.push(`outcome:wrong:${feedback.wrong}`);
    if (ignoredPenalty > 0) reasons.push(`outcome:ignored:${feedback.ignored}`);
  }

  if (!reasons.length) score = 0;
  return baseMatch(entry, Number(Math.max(0, Math.min(1, score)).toFixed(3)), reasons, false, feedback);
}

function baseMatch(
  entry: LearnV2ActivationIndex["entries"][number],
  score: number,
  reasons: string[],
  suppressed: boolean,
  outcomeFeedback?: LearnV2ConceptOutcomeFeedback
): LearnV2ConceptActivationMatch {
  return {
    conceptId: entry.conceptId,
    title: entry.title,
    status: entry.status,
    risk: entry.risk,
    confidence: entry.confidence,
    score,
    reasons,
    suppressed,
    outcomeFeedback
  };
}

async function readOrBuildActivationIndex(root: string, now: Date): Promise<LearnV2ActivationIndex> {
  const file = learnV2ActivationIndexPath(root);
  const text = await fs.readFile(file, "utf8").catch(() => "");
  if (text) return JSON.parse(text) as LearnV2ActivationIndex;
  const store = await readLearnV2ConceptStore(root, now);
  return await writeLearnV2ActivationIndex(root, store, now);
}

function learnV2ActivationIndexPath(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "activation-index.json");
}

async function readLearnV2ConceptOutcomeFeedback(root: string): Promise<Map<string, LearnV2ConceptOutcomeFeedback>> {
  const dir = path.join(root, ".openskill-kit", "learn-v2", "outcomes");
  const out = new Map<string, LearnV2ConceptOutcomeFeedback>();
  const files = (await fs.readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
  for (const file of files) {
    const text = await fs.readFile(file, "utf8").catch(() => "");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const record = LearnV2ConceptOutcomeSchema.parse(JSON.parse(line));
        const current = out.get(record.conceptId) ?? { helpful: 0, ignored: 0, wrong: 0, harmful: 0, superseded: 0 };
        current[record.outcome] += 1;
        if (!current.lastRecordedAt || current.lastRecordedAt < record.recordedAt) current.lastRecordedAt = record.recordedAt;
        out.set(record.conceptId, current);
      } catch {
        // Ignore malformed local telemetry; model activation should remain usable.
      }
    }
  }
  return out;
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(/\s+/).filter((item) => item.length > 3));
}

function tokenOverlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const item of left) if (right.has(item)) count += 1;
  return count;
}

interface ActivationBm25Index {
  avgLength: number;
  idf: Map<string, number>;
  docTokens: Map<string, string[]>;
}

function buildActivationBm25Index(entries: LearnV2ActivationIndex["entries"]): ActivationBm25Index {
  const docTokens = new Map<string, string[]>();
  const documentFrequency = new Map<string, number>();
  for (const entry of entries) {
    const tokens = activationDocumentTokens(entry);
    docTokens.set(entry.conceptId, tokens);
    for (const token of new Set(tokens)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  const documentCount = Math.max(1, entries.length);
  const avgLength = Math.max(1, [...docTokens.values()].reduce((sum, tokens) => sum + tokens.length, 0) / Math.max(1, docTokens.size));
  const idf = new Map([...documentFrequency.entries()].map(([token, frequency]) => [
    token,
    Math.log(1 + (documentCount - frequency + 0.5) / (frequency + 0.5))
  ]));
  return { avgLength, idf, docTokens };
}

function scoreActivationBm25(entry: LearnV2ActivationIndex["entries"][number], queryTokens: Set<string>, index: ActivationBm25Index): number {
  if (!queryTokens.size) return 0;
  const tokens = index.docTokens.get(entry.conceptId) ?? [];
  if (!tokens.length) return 0;
  const termFrequency = new Map<string, number>();
  for (const token of tokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  const k1 = 1.2;
  const b = 0.72;
  let score = 0;
  for (const token of queryTokens) {
    const frequency = termFrequency.get(token) ?? 0;
    if (!frequency) continue;
    const idf = index.idf.get(token) ?? 0;
    const numerator = frequency * (k1 + 1);
    const denominator = frequency + k1 * (1 - b + b * (tokens.length / index.avgLength));
    score += idf * (numerator / denominator);
  }
  return Number(score.toFixed(3));
}

function activationDocumentTokens(entry: LearnV2ActivationIndex["entries"][number]): string[] {
  const textParts = [
    entry.title,
    ...entry.phrases,
    ...entry.taskTypes,
    ...entry.commands,
    ...entry.pathGlobs.flatMap(pathTokens)
  ];
  return textParts.flatMap((part) => [...tokenSet(part)]);
}

function pathTokens(value: string): string[] {
  return normalizePath(value)
    .split(/[/.\\_-]+/)
    .filter((item) => item.length > 3 && item !== "**");
}

function pathGlobMatches(glob: string, file: string): boolean {
  const normalizedGlob = normalizePath(glob);
  const normalizedFile = normalizePath(file);
  if (normalizedGlob.endsWith("/**")) return normalizedFile.startsWith(normalizedGlob.slice(0, -3));
  return normalizedFile === normalizedGlob || normalizedFile.startsWith(`${normalizedGlob}/`);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_./:-]+/g, " ").replace(/\s+/g, " ").trim();
}
