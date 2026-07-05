import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../storage/atomic.js";
import { LearnV2CounterevidenceLedgerSchema, type LearnV2ConceptCard, type LearnV2CounterevidenceLedger } from "./schemas.js";
import { learnV2SafeLocalPath } from "./utils.js";

export async function writeLearnV2CounterevidenceLedger(
  rootInput: string,
  cards: LearnV2ConceptCard[],
  now = new Date()
): Promise<{ ledger: LearnV2CounterevidenceLedger; artifactPaths: { json: string; markdown: string } }> {
  const root = path.resolve(rootInput);
  const dir = path.join(root, ".openskill-kit", "learn-v2", "counterevidence");
  const json = path.join(dir, "counterevidence-ledger.json");
  const markdown = path.join(dir, "counterevidence-ledger.md");
  const entries = cards
    .flatMap((card) => card.counterevidence.map((item) => ({
      conceptId: card.id,
      title: card.title,
      status: card.status,
      risk: card.risk,
      evidenceId: item.evidenceId,
      reason: safeCounterevidenceReason(item.reason, root),
      activationBlocking: card.status !== "rejected" && card.status !== "superseded" && card.status !== "one-off"
    })))
    .sort((a, b) => Number(b.activationBlocking) - Number(a.activationBlocking)
      || a.status.localeCompare(b.status)
      || a.conceptId.localeCompare(b.conceptId)
      || a.evidenceId.localeCompare(b.evidenceId));
  const ledger = LearnV2CounterevidenceLedgerSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.counterevidence-ledger.v1",
    generatedAt: now.toISOString(),
    totalItems: entries.length,
    conceptCount: new Set(entries.map((entry) => entry.conceptId)).size,
    activationBlockingCount: entries.filter((entry) => entry.activationBlocking).length,
    statusCounts: countBy(entries.map((entry) => entry.status)),
    riskCounts: countBy(entries.map((entry) => entry.risk)),
    reasonCounts: countBy(entries.map((entry) => reasonBucket(entry.reason))),
    entries,
    artifacts: {
      json: learnV2SafeLocalPath(json, root),
      markdown: learnV2SafeLocalPath(markdown, root)
    }
  });
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(json, ledger);
  await fs.writeFile(markdown, renderCounterevidenceLedger(ledger), "utf8");
  return { ledger, artifactPaths: { json, markdown } };
}

function renderCounterevidenceLedger(ledger: LearnV2CounterevidenceLedger): string {
  const lines = [
    "# Learn v2 Counterevidence Ledger",
    "",
    `Generated: ${ledger.generatedAt}`,
    `Items: ${ledger.totalItems}`,
    `Concepts: ${ledger.conceptCount}`,
    `Activation-blocking items: ${ledger.activationBlockingCount}`,
    `Status: ${renderCounts(ledger.statusCounts)}`,
    `Risk: ${renderCounts(ledger.riskCounts)}`,
    `Reason buckets: ${renderCounts(ledger.reasonCounts)}`,
    "",
    "## Entries",
    ""
  ];
  if (!ledger.entries.length) {
    lines.push("No counterevidence recorded.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
  for (const entry of ledger.entries) {
    lines.push(`### ${entry.title}`);
    lines.push("");
    lines.push(`Concept: ${entry.conceptId}`);
    lines.push(`Status: ${entry.status}`);
    lines.push(`Risk: ${entry.risk}`);
    lines.push(`Evidence: ${entry.evidenceId}`);
    lines.push(`Activation blocking: ${entry.activationBlocking}`);
    lines.push(`Reason: ${entry.reason}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function safeCounterevidenceReason(reason: string, root: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return [root, home]
    .filter(Boolean)
    .flatMap((prefix) => localPathVariants(prefix))
    .reduce((text, prefix) => text.replace(new RegExp(escapeRegExp(prefix), "gi"), "[LOCAL_PATH]"), reason)
    .slice(0, 500);
}

function localPathVariants(prefix: string): string[] {
  const resolved = path.resolve(prefix);
  return [...new Set([resolved, resolved.replace(/\\/g, "/")])].filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function reasonBucket(reason: string): string {
  const normalized = reason.toLowerCase();
  if (/\b(scope|path|directory|task)\b/.test(normalized)) return "scope";
  if (/\b(conflict|contradict|opposite|against)\b/.test(normalized)) return "conflict";
  if (/\b(unsafe|secret|security|credential|private)\b/.test(normalized)) return "safety";
  if (/\b(stale|supersed|outdated|old)\b/.test(normalized)) return "staleness";
  if (/\b(one[- ]?off|single|isolated)\b/.test(normalized)) return "one-off";
  return "other";
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function renderCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "none";
}
