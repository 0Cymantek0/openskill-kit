import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ProjectConfigSchema, type ProjectConfig } from "../config/schema.js";
import { EventInputSchema, EventSchema, type OpenSkillEvent, type OpenSkillEventInput } from "./schema.js";
import { redactValue } from "./redaction.js";

export interface EventStoreIndex {
  schemaVersion: "openskill-kit.event-index.v1";
  eventCount: number;
  files: Record<string, { count: number; firstTimestamp: string; lastTimestamp: string }>;
  updatedAt: string;
}

export interface AppendEventResult {
  event: OpenSkillEvent;
  eventPath: string;
  indexPath: string;
  redactionMatches: string[];
}

export async function appendEvent(projectRoot: string, input: OpenSkillEventInput): Promise<AppendEventResult> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const sessionId = input.sessionId ?? `session_${timestamp.slice(0, 10)}`;
  const normalizedInput = EventInputSchema.parse(input);
  const rawNormalized = normalizedInput.normalized ?? {};
  const rawStored = shouldStoreRaw(normalizedInput.eventType, config);
  const normalized = rawStored ? rawNormalized : trimRawFields(rawNormalized, config.privacy.maxSnippetChars);
  const redacted = config.privacy.redactSecrets ? redactValue(normalized, config) : { value: normalized, redacted: false, matches: [] };
  const redactedIntent = config.privacy.redactSecrets ? redactValue(normalizedInput.intent, config) : { value: normalizedInput.intent, redacted: false, matches: [] };
  const redactedRawRef = config.privacy.redactSecrets ? redactValue(normalizedInput.rawRef, config) : { value: normalizedInput.rawRef, redacted: false, matches: [] };
  const redactionMatches = [...new Set([...redacted.matches, ...redactedIntent.matches, ...redactedRawRef.matches])].sort();
  const event = EventSchema.parse({
    ...normalizedInput,
    schemaVersion: "openskill-kit.event.v1",
    id: normalizedInput.id ?? createEventId(config.projectId, sessionId, normalizedInput.eventType, timestamp),
    projectId: normalizedInput.projectId ?? config.projectId,
    timestamp,
    sessionId,
    source: normalizedInput.source ?? { adapter: "manual" },
    intent: redactedIntent.value,
    rawRef: redactedRawRef.value,
    normalized: redacted.value,
    files: normalizedInput.files ?? [],
    commands: normalizedInput.commands ?? [],
    privacy: {
      redacted: redactionMatches.length > 0,
      rawStored,
      containsUserText: normalizedInput.privacy?.containsUserText ?? normalizedInput.eventType === "user-prompt-submit",
      containsCode: normalizedInput.privacy?.containsCode ?? false
    }
  });
  const eventPath = eventFile(root, event.timestamp);
  await fs.mkdir(path.dirname(eventPath), { recursive: true });
  await fs.appendFile(eventPath, `${JSON.stringify(event)}\n`, "utf8");
  const indexPath = await updateEventIndex(root, event);
  return { event, eventPath, indexPath, redactionMatches };
}

export async function readEvents(projectRoot: string): Promise<OpenSkillEvent[]> {
  const root = path.resolve(projectRoot);
  const dir = path.join(root, ".openskill-kit", "events");
  const files = await fs.readdir(dir).catch(() => []);
  const events: OpenSkillEvent[] = [];
  for (const file of files.filter((name) => name.endsWith(".jsonl")).sort()) {
    const text = await fs.readFile(path.join(dir, file), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      events.push(EventSchema.parse(JSON.parse(line)));
    }
  }
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function readProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const configPath = path.join(path.resolve(projectRoot), ".openskill-kit", "config.json");
  return ProjectConfigSchema.parse(JSON.parse(await fs.readFile(configPath, "utf8")));
}

function shouldStoreRaw(eventType: OpenSkillEvent["eventType"], config: ProjectConfig): boolean {
  if (eventType === "user-prompt-submit") return config.privacy.storeRawPrompts;
  if (eventType === "user-edited" || eventType === "file-changed") return config.privacy.storeRawDiffs;
  return true;
}

function trimRawFields(value: Record<string, unknown>, maxChars: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/^(text|prompt|body|content|diff|patch)$/i.test(key) && typeof nested === "string") {
      out[`${key}Snippet`] = nested.slice(0, maxChars);
      out[`${key}Omitted`] = nested.length > maxChars;
    } else {
      out[key] = nested;
    }
  }
  return out;
}

function eventFile(root: string, timestamp: string): string {
  return path.join(root, ".openskill-kit", "events", `${timestamp.slice(0, 7)}.jsonl`);
}

function createEventId(projectId: string, sessionId: string, eventType: string, timestamp: string): string {
  const hash = createHash("sha256").update(`${projectId}:${sessionId}:${eventType}:${timestamp}:${Math.random()}`).digest("hex").slice(0, 12);
  return `evt_${timestamp.replace(/[^0-9]/g, "").slice(0, 14)}_${hash}`;
}

async function updateEventIndex(root: string, event: OpenSkillEvent): Promise<string> {
  const indexPath = path.join(root, ".openskill-kit", "events", "index.json");
  const existing = await fs.readFile(indexPath, "utf8").then((text) => JSON.parse(text) as EventStoreIndex).catch((): EventStoreIndex => ({
    schemaVersion: "openskill-kit.event-index.v1",
    eventCount: 0,
    files: {},
    updatedAt: event.timestamp
  }));
  const file = path.basename(eventFile(root, event.timestamp));
  const entry = existing.files[file] ?? { count: 0, firstTimestamp: event.timestamp, lastTimestamp: event.timestamp };
  entry.count += 1;
  entry.firstTimestamp = entry.firstTimestamp < event.timestamp ? entry.firstTimestamp : event.timestamp;
  entry.lastTimestamp = entry.lastTimestamp > event.timestamp ? entry.lastTimestamp : event.timestamp;
  existing.files[file] = entry;
  existing.eventCount += 1;
  existing.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(existing, null, 2), "utf8");
  return indexPath;
}
