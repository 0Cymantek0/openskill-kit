import path from "node:path";
import { compileBehaviorLayer, type CompileBehaviorLayerResult } from "../compiler/package-compiler.js";
import { readEvents } from "../events/store.js";
import type { OpenSkillEvent } from "../events/schema.js";
import { updatePreferenceGraph, type UpdateGraphResult } from "../preferences/graph.js";
import { classifyHighValueEvent, extractSignals, type HighValueEventClassification, type LearnSignalsResult } from "../signals/extract.js";
import { writeJsonAtomic } from "../storage/atomic.js";

export interface LifecycleRunnerOptions {
  projectRoot: string;
  maxEvents?: number;
  compileSafe?: boolean;
  now?: Date;
}

export interface SessionSummary {
  schemaVersion: "openskill-kit.session-summary.v1";
  sessionId: string;
  eventCount: number;
  highValueEventCount: number;
  eventTypes: Record<string, number>;
  highValueReasons: Record<string, number>;
  files: string[];
  commands: string[];
  firstTimestamp?: string;
  lastTimestamp?: string;
}

export interface LifecycleRunnerResult {
  schemaVersion: "openskill-kit.lifecycle-run.v1";
  projectRoot: string;
  processedEventCount: number;
  highValueEvents: HighValueEventClassification[];
  summaryPaths: string[];
  signals: LearnSignalsResult;
  graph: UpdateGraphResult;
  compiled?: CompileBehaviorLayerResult;
}

export async function runLifecycleOnce(options: LifecycleRunnerOptions): Promise<LifecycleRunnerResult> {
  const root = path.resolve(options.projectRoot);
  const allEvents = await readEvents(root);
  const events = allEvents.slice(-(options.maxEvents ?? 250));
  const highValueEvents = events.map((event) => classifyHighValueEvent(event)).filter((item) => item.reasons.length > 0);
  const summaryPaths = await writeSessionSummaries(root, events, highValueEvents, options.now ?? new Date());
  const signals = await extractSignals(root, options.now ?? new Date());
  const graph = await updatePreferenceGraph(root, options.now ?? new Date());
  const compiled = options.compileSafe && graph.graph.conflicts.length === 0 && graph.graph.nodes.some((node) => node.status === "active" || node.status === "locked")
    ? await compileBehaviorLayer(root)
    : undefined;
  const result = {
    schemaVersion: "openskill-kit.lifecycle-run.v1" as const,
    projectRoot: root,
    processedEventCount: events.length,
    highValueEvents,
    summaryPaths,
    signals,
    graph,
    compiled
  };
  await writeJsonAtomic(path.join(root, ".openskill-kit", "runtime", "last-run.json"), result);
  return result;
}

async function writeSessionSummaries(root: string, events: OpenSkillEvent[], highValueEvents: HighValueEventClassification[], now: Date): Promise<string[]> {
  const highValueByEvent = new Map(highValueEvents.map((event) => [event.eventId, event]));
  const bySession = new Map<string, OpenSkillEvent[]>();
  for (const event of events) bySession.set(event.sessionId, [...(bySession.get(event.sessionId) ?? []), event]);
  const out: string[] = [];
  for (const [sessionId, sessionEvents] of bySession) {
    const summary = summarizeSession(sessionId, sessionEvents, highValueByEvent);
    const safeSessionId = sessionId.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) || `session-${now.getTime()}`;
    const file = path.join(root, ".openskill-kit", "sessions", "summaries", `${safeSessionId}.json`);
    await writeJsonAtomic(file, summary);
    out.push(file);
  }
  return out.sort();
}

function summarizeSession(sessionId: string, events: OpenSkillEvent[], highValueByEvent: Map<string, HighValueEventClassification>): SessionSummary {
  const eventTypes: Record<string, number> = {};
  const highValueReasons: Record<string, number> = {};
  const files = new Set<string>();
  const commands = new Set<string>();
  for (const event of events) {
    eventTypes[event.eventType] = (eventTypes[event.eventType] ?? 0) + 1;
    for (const file of event.files) files.add(file.path);
    for (const command of event.commands) commands.add([command.command, ...command.args].join(" ").trim());
    for (const reason of highValueByEvent.get(event.id)?.reasons ?? []) highValueReasons[reason] = (highValueReasons[reason] ?? 0) + 1;
  }
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    schemaVersion: "openskill-kit.session-summary.v1",
    sessionId,
    eventCount: events.length,
    highValueEventCount: [...highValueByEvent.values()].filter((event) => event.sessionId === sessionId).length,
    eventTypes,
    highValueReasons,
    files: [...files].sort(),
    commands: [...commands].filter(Boolean).sort(),
    firstTimestamp: sorted[0]?.timestamp,
    lastTimestamp: sorted.at(-1)?.timestamp
  };
}
