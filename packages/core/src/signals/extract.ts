import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { collectRepoContext } from "../context/collector.js";
import { readEvents, readProjectConfig } from "../events/store.js";
import type { OpenSkillEvent } from "../events/schema.js";
import { readSemanticProposalSignals } from "../preferences/proposals.js";
import { SignalSchema, type Signal } from "./schema.js";
import { runEventExtractors } from "./extractors/index.js";

export interface LearnSignalsResult {
  schemaVersion: "openskill-kit.learn.v1";
  signalCount: number;
  signalsPath: string;
  signals: Signal[];
}

export async function extractSignals(projectRoot: string, now = new Date()): Promise<LearnSignalsResult> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  const events = await readEvents(root);
  const signals = await extractSignalsTransiently(root, config.projectId, events, now, config.learning.highValueOnly);
  const signalsPath = path.join(root, ".openskill-kit", "signals", "normalized.jsonl");
  await fs.mkdir(path.dirname(signalsPath), { recursive: true });
  await fs.writeFile(signalsPath, signals.map((signal) => JSON.stringify(signal)).join("\n") + (signals.length ? "\n" : ""), "utf8");
  return { schemaVersion: "openskill-kit.learn.v1", signalCount: signals.length, signalsPath, signals };
}

/**
 * Pure, no-persistence signal extraction over a supplied set of events.
 *
 * Runs the same per-event extractors, repeated-command mining, repo-pattern
 * mining, and semantic-proposal read that {@link extractSignals} uses, but
 * over an in-memory event list and writes nothing to disk. Used by the
 * `/osk learn` preview so a dry-run can show candidate behavior before any
 * events are appended or any graph is mutated.
 */
export async function extractSignalsTransiently(
  projectRoot: string,
  projectId: string,
  events: OpenSkillEvent[],
  now = new Date(),
  highValueOnly = false
): Promise<Signal[]> {
  const root = path.resolve(projectRoot);
  const learnableEvents = highValueOnly ? events.filter((event) => classifyHighValueEvent(event).reasons.length > 0) : events;
  const signals: Signal[] = [];
  for (const event of learnableEvents) signals.push(...extractFromEvent(event, now));
  signals.push(...extractRepeatedCommandSignals(learnableEvents, now));
  signals.push(...await readSemanticProposalSignals(root));
  signals.push(...await extractRepoPatternSignals(root, projectId, now));
  return dedupeSignals(signals);
}

export function extractFromEvent(event: OpenSkillEvent, now = new Date()): Signal[] {
  return runEventExtractors(event, now);
}

export interface HighValueEventClassification {
  eventId: string;
  sessionId: string;
  eventType: OpenSkillEvent["eventType"];
  reasons: string[];
}

export function classifyHighValueEvent(event: OpenSkillEvent): HighValueEventClassification {
  const reasons: string[] = [];
  const text = eventText(event);
  if (hasExplicitPreference(text)) reasons.push("explicit-preference");
  if (event.eventType === "user-rejected") reasons.push("user-rejection");
  if (event.eventType === "user-edited" || event.eventType === "file-changed") reasons.push("manual-edit");
  if (event.eventType === "review-comment") reasons.push("review-comment");
  if (event.eventType === "test-result" && event.commands.some((command) => command.status === "fail" || command.status === "blocked" || command.exitCode && command.exitCode !== 0)) reasons.push("test-failure");
  if (event.eventType === "user-accepted") reasons.push("accepted-output");
  if ((event.eventType === "post-tool-use" || event.eventType === "test-result") && event.commands.some((command) => command.status === "pass")) reasons.push("successful-command");
  return { eventId: event.id, sessionId: event.sessionId, eventType: event.eventType, reasons: [...new Set(reasons)].sort() };
}

function hasExplicitPreference(text: string): boolean {
  if (!text) return false;
  return [
    /\b(always|prefer|use|keep|make sure to|default to)\s+.{8,220}?(?:[.!?\n]|$)/i,
    /\b(never|avoid|do not|don't|stop)\s+.{8,220}?(?:[.!?\n]|$)/i
  ].some((pattern) => pattern.test(text));
}

function extractRepeatedCommandSignals(events: OpenSkillEvent[], now: Date): Signal[] {
  const groups = new Map<string, Array<{ event: OpenSkillEvent; command: OpenSkillEvent["commands"][number] }>>();
  for (const event of events) {
    if (event.eventType !== "post-tool-use" && event.eventType !== "test-result") continue;
    for (const command of event.commands) {
      if (command.status !== "pass") continue;
      const key = [command.command, ...command.args].join(" ").trim();
      if (!key) continue;
      groups.set(key, [...(groups.get(key) ?? []), { event, command }]);
    }
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length >= 2)
    .map(([commandText, items]) => SignalSchema.parse({
      schemaVersion: "openskill-kit.signal.v1",
      id: `sig_${shortHash(`repeated-command:${commandText}:${items.map((item) => item.event.id).join(",")}`)}`,
      eventIds: items.map((item) => item.event.id),
      extractedAt: now.toISOString(),
      extractorId: "repeated-command-v1",
      kind: "tool-choice",
      category: "command-policy",
      scope: { level: "project", paths: [] },
      statement: `Prefer repeated successful command: ${commandText}`,
      polarity: "positive",
      weight: Math.min(0.9, 0.55 + items.length * 0.08),
      evidence: items.map((item) => ({ eventId: item.event.id, command: commandText }))
    }));
}

async function extractRepoPatternSignals(root: string, projectId: string, now: Date): Promise<Signal[]> {
  const context = await collectRepoContext(root, { maxFiles: 24, maxCharsPerFile: 1600, maxTotalChars: 16000 });
  const signals: Signal[] = [];
  if (context.packageManager !== "unknown") {
    signals.push(repoSignal(projectId, now, "tooling", `Use ${context.packageManager} as project package manager`, 0.36));
  }
  for (const [name, command] of Object.entries(context.scripts).filter(([name]) => /^(test|typecheck|lint|build|smoke|release-check)$/.test(name))) {
    signals.push(repoSignal(projectId, now, name === "test" ? "testing" : "tooling", `Project has ${name} script: ${command}`, 0.34));
  }
  for (const framework of context.frameworks.slice(0, 8)) {
    signals.push(repoSignal(projectId, now, framework === "vitest" ? "testing" : "architecture", `Project uses ${framework}`, 0.3));
  }
  return signals;
}

function repoSignal(projectId: string, now: Date, category: Signal["category"], statement: string, weight: number): Signal {
  const eventId = `repo_${shortHash(`${projectId}:${statement}`)}`;
  return SignalSchema.parse({
    schemaVersion: "openskill-kit.signal.v1",
    id: `sig_${shortHash(`${eventId}:${statement}`)}`,
    eventIds: [eventId],
    extractedAt: now.toISOString(),
    extractorId: "repo-pattern-v1",
    kind: "repo-pattern",
    category,
    scope: { level: "project", paths: [] },
    statement,
    polarity: "positive",
    weight,
    evidence: [{ eventId }]
  });
}

function eventText(event: OpenSkillEvent): string {
  const normalized = event.normalized as Record<string, unknown>;
  return [
    event.intent,
    normalized.text,
    normalized.textSnippet,
    normalized.prompt,
    normalized.promptSnippet,
    normalized.body,
    normalized.bodySnippet,
    normalized.content,
    normalized.contentSnippet
  ].filter((value): value is string => typeof value === "string").join("\n");
}

function dedupeSignals(signals: Signal[]): Signal[] {
  const seen = new Map<string, Signal>();
  for (const signal of signals) {
    const key = `${signal.kind}:${signal.category}:${signal.statement.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || signal.weight > existing.weight) seen.set(key, signal);
  }
  return [...seen.values()].sort((a, b) => a.category.localeCompare(b.category) || b.weight - a.weight || a.statement.localeCompare(b.statement));
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
