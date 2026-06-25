import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { collectRepoContext } from "../context/collector.js";
import { readEvents, readProjectConfig } from "../events/store.js";
import type { OpenSkillEvent } from "../events/schema.js";
import { readSemanticProposalSignals } from "../preferences/proposals.js";
import { SignalSchema, type Signal } from "./schema.js";

export interface LearnSignalsResult {
  schemaVersion: "openskill-kit.learn.v1";
  signalCount: number;
  signalsPath: string;
  signals: Signal[];
}

const explicitPatterns = [
  /\b(always|prefer|use|keep|make sure to|default to)\s+(.{8,220}?)(?:[.!?\n]|$)/gi,
  /\b(never|avoid|do not|don't|stop)\s+(.{8,220}?)(?:[.!?\n]|$)/gi
];

export async function extractSignals(projectRoot: string, now = new Date()): Promise<LearnSignalsResult> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  const events = await readEvents(root);
  const signals: Signal[] = [];
  const learnableEvents = config.learning.highValueOnly ? events.filter((event) => classifyHighValueEvent(event).reasons.length > 0) : events;
  for (const event of learnableEvents) signals.push(...extractFromEvent(event, now));
  signals.push(...extractRepeatedCommandSignals(learnableEvents, now));
  signals.push(...await readSemanticProposalSignals(root));
  signals.push(...await extractRepoPatternSignals(root, config.projectId, now));
  const deduped = dedupeSignals(signals);
  const signalsPath = path.join(root, ".openskill-kit", "signals", "normalized.jsonl");
  await fs.mkdir(path.dirname(signalsPath), { recursive: true });
  await fs.writeFile(signalsPath, deduped.map((signal) => JSON.stringify(signal)).join("\n") + (deduped.length ? "\n" : ""), "utf8");
  return { schemaVersion: "openskill-kit.learn.v1", signalCount: deduped.length, signalsPath, signals: deduped };
}

export function extractFromEvent(event: OpenSkillEvent, now = new Date()): Signal[] {
  const out: Signal[] = [];
  const text = eventText(event);
  if (text) out.push(...extractExplicitPreferences(event, text, now));
  if (event.eventType === "post-tool-use" || event.eventType === "pre-tool-use") out.push(...extractToolChoice(event, now));
  if (event.eventType === "test-result") out.push(...extractTestOutcome(event, now));
  if (event.eventType === "user-accepted") out.push(signalFromEvent(event, now, "acceptance", "workflow", "User accepted agent output", "positive", 0.64));
  if (event.eventType === "user-rejected") {
    const rejected = summarizeText(text);
    out.push(signalFromEvent(event, now, "rejection", "workflow", rejected ? `Do not repeat rejected agent approach: ${rejected}` : "Do not repeat rejected agent approach", "negative", 0.78));
  }
  if (event.eventType === "user-edited" || event.eventType === "file-changed") {
    const paths = event.files.map((file) => file.path);
    const statement = paths.length
      ? `Prefer preserving user-edited patterns in ${paths.slice(0, 3).join(", ")}`
      : "Prefer preserving user-edited project patterns";
    out.push(signalFromEvent(event, now, "edit-delta", categorize(`${paths.join(" ")} ${text}`), statement, "positive", 0.66, paths, summarizeText(text)));
  }
  return out;
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

function extractExplicitPreferences(event: OpenSkillEvent, text: string, now: Date): Signal[] {
  const signals: Signal[] = [];
  for (const pattern of explicitPatterns) {
    for (const match of text.matchAll(pattern)) {
      const verb = (match[1] ?? "").toLowerCase();
      const body = cleanStatement(match[2] ?? "");
      if (body.length < 8) continue;
      const negative = ["never", "avoid", "do not", "don't", "stop"].includes(verb);
      const statement = `${negative ? "Do not" : "Prefer"} ${body}`;
      signals.push(signalFromEvent(event, now, "explicit-preference", categorize(statement), statement, negative ? "negative" : "positive", negative ? 0.88 : 0.82, event.files.map((file) => file.path), text.slice(Math.max(0, match.index ?? 0), Math.min(text.length, (match.index ?? 0) + 260))));
    }
  }
  return signals;
}

function hasExplicitPreference(text: string): boolean {
  if (!text) return false;
  return [
    /\b(always|prefer|use|keep|make sure to|default to)\s+.{8,220}?(?:[.!?\n]|$)/i,
    /\b(never|avoid|do not|don't|stop)\s+.{8,220}?(?:[.!?\n]|$)/i
  ].some((pattern) => pattern.test(text));
}

function extractToolChoice(event: OpenSkillEvent, now: Date): Signal[] {
  return event.commands.map((command) => signalFromEvent(
    event,
    now,
    "tool-choice",
    "tooling",
    `Use command recipe: ${[command.command, ...command.args].join(" ").trim()}`,
    command.status === "fail" || command.status === "blocked" ? "negative" : "positive",
    command.status === "pass" ? 0.6 : 0.45,
    [],
    undefined,
    command.command
  ));
}

function extractTestOutcome(event: OpenSkillEvent, now: Date): Signal[] {
  return event.commands.map((command) => signalFromEvent(
    event,
    now,
    "test-outcome",
    "testing",
    `${command.status === "pass" ? "Verification passes with" : "Verification failed with"} ${[command.command, ...command.args].join(" ").trim()}`,
    command.status === "pass" ? "positive" : "negative",
    command.status === "pass" ? 0.56 : 0.66,
    [],
    undefined,
    command.command
  ));
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

function signalFromEvent(
  event: OpenSkillEvent,
  now: Date,
  kind: Signal["kind"],
  category: Signal["category"],
  statement: string,
  polarity: Signal["polarity"],
  weight: number,
  paths: string[] = [],
  quote?: string,
  command?: string
): Signal {
  return SignalSchema.parse({
    schemaVersion: "openskill-kit.signal.v1",
    id: `sig_${shortHash(`${event.id}:${kind}:${statement}`)}`,
    eventIds: [event.id],
    extractedAt: now.toISOString(),
    kind,
    category,
    scope: { level: paths.length ? "path" : "project", paths },
    statement,
    polarity,
    weight,
    evidence: [{ eventId: event.id, quote, command }]
  });
}

function repoSignal(projectId: string, now: Date, category: Signal["category"], statement: string, weight: number): Signal {
  const eventId = `repo_${shortHash(`${projectId}:${statement}`)}`;
  return SignalSchema.parse({
    schemaVersion: "openskill-kit.signal.v1",
    id: `sig_${shortHash(`${eventId}:${statement}`)}`,
    eventIds: [eventId],
    extractedAt: now.toISOString(),
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

function categorize(text: string): Signal["category"] {
  const lower = text.toLowerCase();
  if (/\b(test|vitest|jest|coverage|smoke|verify)\b/.test(lower)) return "testing";
  if (/\b(secret|privacy|security|token|credential|permission)\b/.test(lower)) return "security";
  if (/\b(api|route|endpoint|schema)\b/.test(lower)) return "api";
  if (/\b(component|react|css|ui|frontend|browser)\b/.test(lower)) return "frontend";
  if (/\b(server|database|backend|service)\b/.test(lower)) return "backend";
  if (/\b(command|npm|pnpm|script|tool)\b/.test(lower)) return "tooling";
  if (/\b(workflow|review|commit|branch|plan)\b/.test(lower)) return "workflow";
  if (/\b(module|architecture|package|dependency)\b/.test(lower)) return "architecture";
  return "general";
}

function cleanStatement(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/^to\s+/i, "");
}

function summarizeText(value: string): string | undefined {
  const cleaned = cleanStatement(value);
  return cleaned ? cleaned.slice(0, 140) : undefined;
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
