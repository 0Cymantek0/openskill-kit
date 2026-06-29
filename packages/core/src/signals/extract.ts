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
  signals.push(...extractOpenCodeDerivedTelemetrySignals(learnableEvents, now));
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
      if (key.startsWith("opencode-derived:")) continue;
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

function extractOpenCodeDerivedTelemetrySignals(events: OpenSkillEvent[], now: Date): Signal[] {
  const commandGroups = new Map<string, Array<{ event: OpenSkillEvent; kind: string; lengthBucket: string; riskFlags: string[] }>>();
  const fileGroups = new Map<string, Array<{ event: OpenSkillEvent; extension: string; kind: string; depth: number; riskFlags: string[] }>>();
  for (const event of events) {
    if (event.source.adapter !== "opencode-ambient") continue;
    const metadata = isRecord(event.normalized.metadata) ? event.normalized.metadata : {};
    if (event.normalized.traceMode === "eval" || event.normalized.containsRawFields === true) continue;
    const commandHash = stringValue(metadata["input.commandHash"]) ?? stringValue(metadata["output.commandHash"]);
    if (commandHash && isSuccessfulOpenCodeMetadata(event, metadata)) {
      const riskFlags = stringArrayValue(metadata["input.commandRiskFlags"] ?? metadata["output.commandRiskFlags"]);
      if (!hasSensitiveRiskFlag(riskFlags)) {
        const kind = stringValue(metadata["input.commandKind"]) ?? stringValue(metadata["output.commandKind"]) ?? "unknown";
        const lengthBucket = stringValue(metadata["input.commandLengthBucket"]) ?? stringValue(metadata["output.commandLengthBucket"]) ?? "unknown";
        commandGroups.set(commandHash, [...(commandGroups.get(commandHash) ?? []), { event, kind, lengthBucket, riskFlags }]);
      }
    }
    const pathHash = stringValue(metadata["input.pathHash"]) ?? stringValue(metadata["output.pathHash"]);
    if (pathHash) {
      const riskFlags = stringArrayValue(metadata["input.pathRiskFlags"] ?? metadata["output.pathRiskFlags"]);
      if (!hasSensitiveRiskFlag(riskFlags)) {
        const extension = stringValue(metadata["input.pathExtension"]) ?? stringValue(metadata["output.pathExtension"]) ?? "";
        const kind = stringValue(metadata["input.pathKind"]) ?? stringValue(metadata["output.pathKind"]) ?? "unknown";
        const depth = numberValue(metadata["input.pathDepth"] ?? metadata["output.pathDepth"]) ?? 0;
        const key = `${kind}:${extension || "extensionless"}:${depth}`;
        fileGroups.set(key, [...(fileGroups.get(key) ?? []), { event, extension, kind, depth, riskFlags }]);
      }
    }
  }
  const commandSignals = [...commandGroups.entries()]
    .filter(([, items]) => items.length >= 2)
    .map(([hash, items]) => {
      const first = items[0]!;
      return SignalSchema.parse({
        schemaVersion: "openskill-kit.signal.v1",
        id: `sig_${shortHash(`opencode-derived-command:${hash}:${items.map((item) => item.event.id).join(",")}`)}`,
        eventIds: items.map((item) => item.event.id),
        extractedAt: now.toISOString(),
        extractorId: "opencode-derived-command-v1",
        kind: "tool-choice",
        category: "command-policy",
        scope: { level: "project", paths: [] },
        statement: `Prefer repeated successful ${first.kind} command pattern observed by OpenCode ambient telemetry (${first.lengthBucket}, ${hash}).`,
        polarity: "positive",
        weight: Math.min(0.84, 0.5 + items.length * 0.08),
        evidence: items.map((item) => ({ eventId: item.event.id, command: `opencode-derived:${first.kind}:${hash}` }))
      });
    });
  const fileSignals = [...fileGroups.values()]
    .filter((items) => items.length >= 2)
    .map((items) => {
      const first = items[0]!;
      const extension = first.extension || "extensionless";
      return SignalSchema.parse({
        schemaVersion: "openskill-kit.signal.v1",
        id: `sig_${shortHash(`opencode-derived-file:${first.kind}:${extension}:${first.depth}:${items.map((item) => item.event.id).join(",")}`)}`,
        eventIds: items.map((item) => item.event.id),
        extractedAt: now.toISOString(),
        extractorId: "opencode-derived-file-v1",
        kind: "repo-pattern",
        category: "workflow",
        scope: { level: "project", paths: [] },
        statement: `OpenCode ambient telemetry repeatedly touched ${extension} files (${first.kind}, depth ${first.depth}); prefer matching focused checks before finishing related work.`,
        polarity: "positive",
        weight: Math.min(0.74, 0.42 + items.length * 0.06),
        evidence: items.map((item) => ({ eventId: item.event.id }))
      });
    });
  return [...commandSignals, ...fileSignals];
}

function isSuccessfulOpenCodeMetadata(event: OpenSkillEvent, metadata: Record<string, unknown>): boolean {
  if (event.commands.some((command) => command.status === "pass")) return true;
  const status = String(metadata["output.status"] ?? metadata.status ?? "").toLowerCase();
  return status === "pass" || status === "success" || status === "ok";
}

function hasSensitiveRiskFlag(flags: string[]): boolean {
  return flags.some((flag) => ["secret-keyword", "credential-pattern", "url-with-query", "sensitive-name"].includes(flag));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
