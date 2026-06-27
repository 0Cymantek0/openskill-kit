import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { appendEvent, readProjectConfig } from "../events/store.js";
import type { OpenSkillEventInput } from "../events/schema.js";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";

export interface ImportInteractionSourceOptions {
  adapter?: string;
  agentName?: string;
  dryRun?: boolean;
  maxEvents?: number;
  allowDuplicate?: boolean;
  now?: Date;
}

export interface InteractionImportRun {
  schemaVersion: "openskill-kit.interaction-import-run.v1";
  id: string;
  status: "planned" | "imported" | "blocked";
  projectId: string;
  source: {
    path: string;
    hash: string;
    byteCount: number;
    lineCount: number;
    adapter: string;
    adapterKnown: boolean;
    adapterStatus: InteractionAdapterDescriptor["status"];
    agentName?: string;
  };
  dryRun: boolean;
  parsedEventCount: number;
  appendedEventCount: number;
  skippedCount: number;
  eventIds: string[];
  preview: Array<{
    eventType: OpenSkillEventInput["eventType"];
    sessionId: string;
    timestamp?: string;
    commandCount: number;
    fileCount: number;
    containsUserText: boolean;
    containsCode: boolean;
  }>;
  warnings: string[];
  messages: string[];
  artifacts: {
    jsonPath: string;
    markdownPath: string;
  };
}

export interface InteractionAdapterDescriptor {
  id: string;
  displayName: string;
  status: "available" | "experimental";
  privacy: "explicit-import-only";
  acceptedFormats: string[];
  detectionHints: string[];
  defaultAgentName?: string;
  notes: string[];
}

export interface InteractionAdapterValidation {
  adapter: InteractionAdapterDescriptor;
  known: boolean;
  normalizedAdapter: string;
  agentName?: string;
  warnings: string[];
}

const EVENT_TYPES = new Set<OpenSkillEventInput["eventType"]>([
  "session-start",
  "instructions-loaded",
  "user-prompt-submit",
  "assistant-message",
  "pre-tool-use",
  "post-tool-use",
  "post-tool-use-failure",
  "file-changed",
  "task-created",
  "task-completed",
  "permission-denied",
  "user-accepted",
  "user-rejected",
  "user-edited",
  "test-result",
  "review-comment",
  "session-end"
]);

const MAX_SNIPPET_CHARS = 500;
const INTERACTION_ADAPTERS: InteractionAdapterDescriptor[] = [
  {
    id: "manual-import",
    displayName: "Manual import",
    status: "available",
    privacy: "explicit-import-only",
    acceptedFormats: ["plain text", "markdown notes", "generic JSON", "generic JSONL"],
    detectionHints: ["Use for curated notes, copied session summaries, and manually prepared exports."],
    defaultAgentName: "Manual import",
    notes: ["Plain text parsing only keeps preference-like lines and recognized command lines."]
  },
  {
    id: "codex",
    displayName: "Codex",
    status: "available",
    privacy: "explicit-import-only",
    acceptedFormats: ["JSONL messages", "JSON arrays", "generic exported transcript objects", "plain text notes"],
    detectionHints: ["Detected session/export files remain high-risk explicit imports; do not read Codex memories unless user supplies a file."],
    defaultAgentName: "Codex",
    notes: ["Supports role/content records and command/tool result objects without copying raw source logs."]
  },
  {
    id: "claude-code",
    displayName: "Claude Code",
    status: "experimental",
    privacy: "explicit-import-only",
    acceptedFormats: ["JSONL messages", "JSON arrays", "nested message.content exports", "generic exported transcript objects", "plain text notes"],
    detectionHints: ["Prefer explicit Claude Code export files; generated CLAUDE.md and rules are instruction surfaces, not transcript imports."],
    defaultAgentName: "Claude Code",
    notes: ["Normalizes role/message/content records, tool result events, and command-like tool inputs without storing raw transcript bodies."]
  },
  {
    id: "cursor",
    displayName: "Cursor",
    status: "experimental",
    privacy: "explicit-import-only",
    acceptedFormats: ["JSONL messages", "JSON arrays", "IDE chat transcript objects", "terminal command records", "plain text notes"],
    detectionHints: ["Prefer explicit Cursor export files; .cursor/rules are instruction surfaces, not transcript imports."],
    defaultAgentName: "Cursor",
    notes: ["Normalizes user/assistant messages, terminal command records, and referenced file paths while keeping IDE accept/reject telemetry conservative."]
  }
];

export function listInteractionAdapters(): InteractionAdapterDescriptor[] {
  return INTERACTION_ADAPTERS.map((adapter) => ({ ...adapter, acceptedFormats: [...adapter.acceptedFormats], detectionHints: [...adapter.detectionHints], notes: [...adapter.notes] }));
}

export async function importInteractionSource(projectRootInput: string, sourcePathInput: string, options: ImportInteractionSourceOptions = {}): Promise<InteractionImportRun> {
  const root = path.resolve(projectRootInput);
  const sourcePath = path.resolve(sourcePathInput);
  const config = await readProjectConfig(root);
  const adapterValidation = validateInteractionAdapter(options.adapter, options.agentName);
  const stat = await fs.stat(sourcePath).catch(() => undefined);
  if (!stat || !stat.isFile()) {
    return writeImportRun(root, blockedRun(config.projectId, sourcePath, options, `Interaction source is not a file: ${sourcePath}`, adapterValidation));
  }
  const text = await fs.readFile(sourcePath, "utf8");
  const sourceHash = `sha256:${sha256(text)}`;
  const duplicate = options.allowDuplicate === true ? undefined : await findImportedDuplicate(root, sourceHash);
  if (duplicate && options.dryRun === false) {
    return writeImportRun(root, blockedRun(config.projectId, sourcePath, options, `Source already imported by ${duplicate.id}`, adapterValidation));
  }
  const importOptions = { ...options, adapter: adapterValidation.normalizedAdapter, agentName: adapterValidation.agentName };
  const parsed = parseInteractionText(text, importOptions, sourceHash);
  const maxEvents = options.maxEvents ?? 200;
  const limited = parsed.events.slice(0, maxEvents);
  const warnings = [...adapterValidation.warnings, ...parsed.warnings];
  if (parsed.events.length > maxEvents) warnings.push(`Truncated parsed events from ${parsed.events.length} to maxEvents=${maxEvents}`);
  if (duplicate) warnings.push(`Source hash already imported by ${duplicate.id}; dry-run only unless allowDuplicate is true.`);
  const dryRun = options.dryRun !== false;
  const eventIds: string[] = [];
  if (!dryRun) {
    for (const event of limited) {
      const result = await appendEvent(root, event);
      eventIds.push(result.event.id);
    }
  }
  return writeImportRun(root, {
    schemaVersion: "openskill-kit.interaction-import-run.v1",
    id: importRunId(options.now ?? new Date(), sourceHash),
    status: dryRun ? "planned" : "imported",
    projectId: config.projectId,
    source: {
      path: sourcePath,
      hash: sourceHash,
      byteCount: stat.size,
      lineCount: text.split(/\r?\n/).length,
      adapter: adapterValidation.normalizedAdapter,
      adapterKnown: adapterValidation.known,
      adapterStatus: adapterValidation.adapter.status,
      agentName: adapterValidation.agentName
    },
    dryRun,
    parsedEventCount: limited.length,
    appendedEventCount: eventIds.length,
    skippedCount: Math.max(0, parsed.events.length - limited.length),
    eventIds,
    preview: limited.map(previewEvent),
    warnings,
    messages: [
      dryRun ? "Dry-run only: no events appended." : `Imported ${eventIds.length} interaction event(s).`,
      "Raw source content was not copied into OpenSkillKit artifacts."
    ],
    artifacts: {
      jsonPath: "",
      markdownPath: ""
    }
  });
}

function validateInteractionAdapter(adapterInput: string | undefined, agentNameInput: string | undefined): InteractionAdapterValidation {
  const normalizedAdapter = normalizeAdapterId(adapterInput ?? "manual-import");
  const knownAdapter = INTERACTION_ADAPTERS.find((adapter) => adapter.id === normalizedAdapter);
  const adapter = knownAdapter ?? {
    id: normalizedAdapter,
    displayName: normalizedAdapter,
    status: "experimental" as const,
    privacy: "explicit-import-only" as const,
    acceptedFormats: ["generic JSON", "generic JSONL", "plain text notes"],
    detectionHints: ["Unknown adapter uses generic parsing only."],
    defaultAgentName: normalizedAdapter,
    notes: ["Unknown adapter accepted for extension, but event normalization may be lossy."]
  };
  const warnings = knownAdapter ? [] : [`Unknown interaction adapter "${normalizedAdapter}"; using generic parser and explicit-import-only policy.`];
  return {
    adapter,
    known: Boolean(knownAdapter),
    normalizedAdapter,
    agentName: agentNameInput ?? adapter.defaultAgentName,
    warnings
  };
}

function normalizeAdapterId(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

export async function readInteractionImportRuns(projectRootInput: string): Promise<InteractionImportRun[]> {
  const root = path.resolve(projectRootInput);
  const dir = path.join(root, ".openskill-kit", "interactions", "import-runs");
  const files = await fs.readdir(dir).catch(() => []);
  const runs: InteractionImportRun[] = [];
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    const full = path.join(dir, file);
    const parsed = JSON.parse(await fs.readFile(full, "utf8")) as InteractionImportRun;
    runs.push(parsed);
  }
  return runs.sort((a, b) => a.id.localeCompare(b.id));
}

function parseInteractionText(text: string, options: ImportInteractionSourceOptions, sourceHash: string): { events: OpenSkillEventInput[]; warnings: string[] } {
  const warnings: string[] = [];
  const objects = parseJsonObjects(text, warnings);
  const sessionId = `import_${sourceHash.replace(/^sha256:/, "").slice(0, 12)}`;
  const events = objects.length
    ? objects.flatMap((object, index) => eventFromObject(object, index, sessionId, options, warnings))
    : eventsFromPlainText(text, sessionId, options);
  return { events, warnings };
}

function parseJsonObjects(text: string, warnings: string[]): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 1) {
    const parsedLines: unknown[] = [];
    for (const line of lines) {
      try {
        parsedLines.push(JSON.parse(line));
      } catch {
        parsedLines.length = 0;
        break;
      }
    }
    if (parsedLines.length) return parsedLines;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (isObject(parsed) && Array.isArray(parsed.events)) return parsed.events;
    if (isObject(parsed) && Array.isArray(parsed.messages)) return parsed.messages;
    return [parsed];
  } catch {
    warnings.push("Source is not JSON/JSONL; parsed as plain text snippets.");
    return [];
  }
}

function eventFromObject(object: unknown, index: number, fallbackSessionId: string, options: ImportInteractionSourceOptions, warnings: string[]): OpenSkillEventInput[] {
  if (!isObject(object)) {
    warnings.push(`Skipped non-object JSON entry at index ${index}.`);
    return [];
  }
  const message = objectValue(object.message);
  const role = stringValue(object.role) ?? stringValue(message?.role) ?? roleFromKind(object);
  const type = stringValue(object.eventType) ?? stringValue(object.type) ?? stringValue(object.event) ?? stringValue(object.kind);
  const command = commandFromObject(object);
  const content = textFromValue(object.content) ?? stringValue(object.text) ?? textFromValue(message?.content) ?? stringValue(object.prompt) ?? stringValue(object.summary);
  const eventType = normalizeEventType(type, role, command !== undefined);
  if (!eventType) {
    warnings.push(`Skipped JSON entry at index ${index}; no supported role/type/command.`);
    return [];
  }
  return [baseEvent({
    eventType,
    index,
    sessionId: sessionIdFromObject(object) ?? fallbackSessionId,
    timestamp: datetimeValue(object.timestamp) ?? datetimeValue(object.createdAt) ?? datetimeValue(object.created_at) ?? timestampFor(options.now ?? new Date(), index),
    adapter: options.adapter ?? stringValue(object.adapter) ?? "manual-import",
    agentName: options.agentName ?? stringValue(object.agentName),
    intent: stringValue(object.intent) ?? snippet(content),
    text: content,
    command,
    commandStatus: commandStatus(object),
    filePath: filePathFromObject(object)
  })];
}

function eventsFromPlainText(text: string, sessionId: string, options: ImportInteractionSourceOptions): OpenSkillEventInput[] {
  const events: OpenSkillEventInput[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    const command = commandFromLine(line);
    const preference = /\b(always|prefer|never|avoid|do not|don't|keep|make sure to|default to)\b/i.test(line);
    if (!command && !preference) continue;
    events.push(baseEvent({
      eventType: command ? "post-tool-use" : "user-prompt-submit",
      index,
      sessionId,
      timestamp: timestampFor(options.now ?? new Date(), index),
      adapter: options.adapter ?? "manual-import",
      agentName: options.agentName,
      intent: snippet(line),
      text: command ? undefined : line,
      command,
      commandStatus: /\b(pass|passed|success|succeeded|ok)\b/i.test(line) ? "pass" : "unknown"
    }));
  }
  return events;
}

function baseEvent(input: {
  eventType: OpenSkillEventInput["eventType"];
  index: number;
  sessionId: string;
  timestamp: string;
  adapter: string;
  agentName?: string;
  intent?: string;
  text?: string;
  command?: { command: string; args: string[] };
  commandStatus?: "pass" | "fail" | "blocked" | "timeout" | "unknown";
  filePath?: string;
}): OpenSkillEventInput {
  return {
    schemaVersion: "openskill-kit.event.v1",
    sessionId: input.sessionId,
    timestamp: input.timestamp,
    source: {
      adapter: input.adapter,
      agentName: input.agentName
    },
    eventType: input.eventType,
    intent: input.intent,
    normalized: input.text ? {
      textSnippet: snippet(input.text),
      textOmitted: input.text.length > MAX_SNIPPET_CHARS,
      importIndex: input.index
    } : { importIndex: input.index },
    files: input.filePath ? [{ path: input.filePath, action: "unknown" }] : [],
    commands: input.command ? [{ ...input.command, status: input.commandStatus ?? "unknown" }] : [],
    privacy: {
      redacted: false,
      rawStored: false,
      containsUserText: Boolean(input.text),
      containsCode: Boolean(input.filePath)
    }
  };
}

function commandFromObject(object: Record<string, unknown>): { command: string; args: string[] } | undefined {
  const input = objectValue(object.input) ?? objectValue(object.params);
  const tool = objectValue(object.tool) ?? objectValue(object.toolUse) ?? objectValue(object.tool_use);
  const command =
    stringValue(object.command) ??
    stringValue(object.cmd) ??
    stringValue(object.commandLine) ??
    stringValue(object.terminalCommand) ??
    stringValue(input?.command) ??
    stringValue(input?.cmd) ??
    stringValue(tool?.command) ??
    stringValue(tool?.cmd);
  if (!command) return undefined;
  const argsSource = Array.isArray(object.args) ? object.args : Array.isArray(input?.args) ? input.args : undefined;
  const args = argsSource ? argsSource.filter((arg): arg is string => typeof arg === "string") : [];
  return args.length ? { command, args } : commandFromLine(command) ?? { command, args: [] };
}

function commandFromLine(line: string): { command: string; args: string[] } | undefined {
  const cleaned = line.replace(/^\$+\s*/, "").replace(/^\[(?:pass|passed|success|ok)\]\s*/i, "").trim();
  if (!/^(npm|pnpm|yarn|bun|node|npx|pytest|python|tsx|vitest|tsc|cargo|go)\b/i.test(cleaned)) return undefined;
  const parts = cleaned.match(/"[^"]+"|'[^']+'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) ?? [];
  while (parts.length > 1 && /^(pass|passed|success|succeeded|ok)$/i.test(parts[parts.length - 1]!)) parts.pop();
  const [command, ...args] = parts;
  return command ? { command, args } : undefined;
}

function commandStatus(object: Record<string, unknown>): "pass" | "fail" | "blocked" | "timeout" | "unknown" {
  const status = stringValue(object.status) ?? stringValue(object.outcome);
  if (status) {
    const normalized = status.trim().toLowerCase();
    if (["pass", "passed", "success", "succeeded", "ok"].includes(normalized)) return "pass";
    if (["fail", "failed", "error"].includes(normalized)) return "fail";
    if (["blocked", "timeout", "unknown"].includes(normalized)) return normalized as "blocked" | "timeout" | "unknown";
  }
  const exitCode = typeof object.exitCode === "number" ? object.exitCode : undefined;
  if (exitCode === 0) return "pass";
  if (exitCode !== undefined) return "fail";
  return "unknown";
}

function normalizeEventType(type: string | undefined, role: string | undefined, hasCommand: boolean): OpenSkillEventInput["eventType"] | undefined {
  const normalizedType = type?.trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (normalizedType && EVENT_TYPES.has(normalizedType as OpenSkillEventInput["eventType"])) return normalizedType as OpenSkillEventInput["eventType"];
  if (hasCommand) return "post-tool-use";
  if (normalizedType && ["user", "user-message", "human", "prompt"].includes(normalizedType)) return "user-prompt-submit";
  if (normalizedType && ["assistant", "assistant-message", "ai"].includes(normalizedType)) return "assistant-message";
  if (normalizedType && ["tool", "tool-result", "tool-use", "terminal", "terminal-command", "shell"].includes(normalizedType)) return "post-tool-use";
  if (role === "user" || role === "human") return "user-prompt-submit";
  if (role === "assistant" || role === "ai") return "assistant-message";
  if (role === "tool") return "post-tool-use";
  return undefined;
}

function previewEvent(event: OpenSkillEventInput): InteractionImportRun["preview"][number] {
  return {
    eventType: event.eventType,
    sessionId: event.sessionId ?? "import-session",
    timestamp: event.timestamp,
    commandCount: event.commands?.length ?? 0,
    fileCount: event.files?.length ?? 0,
    containsUserText: event.privacy?.containsUserText ?? false,
    containsCode: event.privacy?.containsCode ?? false
  };
}

async function findImportedDuplicate(root: string, sourceHash: string): Promise<InteractionImportRun | undefined> {
  const runs = await readInteractionImportRuns(root);
  return runs.find((run) => run.source.hash === sourceHash && run.status === "imported");
}

async function writeImportRun(root: string, run: InteractionImportRun): Promise<InteractionImportRun> {
  const dir = path.join(root, ".openskill-kit", "interactions", "import-runs");
  const withArtifacts = {
    ...run,
    artifacts: {
      jsonPath: path.join(dir, `${run.id}.json`),
      markdownPath: path.join(dir, `${run.id}.md`)
    }
  };
  await writeJsonAtomic(withArtifacts.artifacts.jsonPath, withArtifacts);
  await writeFileAtomic(withArtifacts.artifacts.markdownPath, renderImportRunMarkdown(withArtifacts));
  return withArtifacts;
}

function renderImportRunMarkdown(run: InteractionImportRun): string {
  const lines = [
    "# OpenSkillKit Interaction Import",
    "",
    `Status: ${run.status}`,
    `Source hash: ${run.source.hash}`,
    `Adapter: ${run.source.adapter}`,
    `Adapter known: ${run.source.adapterKnown ? "yes" : "no"}`,
    `Adapter status: ${run.source.adapterStatus}`,
    `Parsed events: ${run.parsedEventCount}`,
    `Appended events: ${run.appendedEventCount}`,
    "",
    "## Privacy",
    "",
    "- Raw source content was not copied.",
    "- Event snippets are redacted by normal OpenSkillKit event capture.",
    "",
    "## Preview",
    ""
  ];
  for (const item of run.preview) lines.push(`- ${item.eventType} session=${item.sessionId} commands=${item.commandCount} files=${item.fileCount}`);
  if (run.warnings.length) lines.push("", "## Warnings", "", ...run.warnings.map((warning) => `- ${warning}`));
  lines.push("");
  return lines.join("\n");
}

function blockedRun(projectId: string, sourcePath: string, options: ImportInteractionSourceOptions, message: string, adapterValidation = validateInteractionAdapter(options.adapter, options.agentName)): InteractionImportRun {
  return {
    schemaVersion: "openskill-kit.interaction-import-run.v1",
    id: importRunId(options.now ?? new Date(), message),
    status: "blocked",
    projectId,
    source: {
      path: sourcePath,
      hash: `sha256:${sha256(message)}`,
      byteCount: 0,
      lineCount: 0,
      adapter: adapterValidation.normalizedAdapter,
      adapterKnown: adapterValidation.known,
      adapterStatus: adapterValidation.adapter.status,
      agentName: adapterValidation.agentName
    },
    dryRun: options.dryRun !== false,
    parsedEventCount: 0,
    appendedEventCount: 0,
    skippedCount: 0,
    eventIds: [],
    preview: [],
    warnings: [...adapterValidation.warnings, message],
    messages: [message],
    artifacts: {
      jsonPath: "",
      markdownPath: ""
    }
  };
}

function importRunId(now: Date, seed: string): string {
  return `imir_${now.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}_${sha256(seed).slice(0, 10)}`;
}

function timestampFor(now: Date, index: number): string {
  return new Date(now.getTime() + index).toISOString();
}

function datetimeValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function roleFromKind(object: Record<string, unknown>): string | undefined {
  const kind = stringValue(object.kind) ?? stringValue(object.type);
  if (!kind) return undefined;
  const normalized = kind.trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (normalized.includes("user")) return "user";
  if (normalized.includes("assistant")) return "assistant";
  if (normalized.includes("tool") || normalized.includes("terminal")) return "tool";
  return undefined;
}

function textFromValue(value: unknown): string | undefined {
  const direct = stringValue(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    const parts = value.map((item) => {
      if (typeof item === "string") return item.trim();
      if (!isObject(item)) return undefined;
      return stringValue(item.text) ?? stringValue(item.content) ?? stringValue(item.value);
    }).filter((part): part is string => Boolean(part));
    return parts.length ? parts.join("\n") : undefined;
  }
  if (isObject(value)) return stringValue(value.text) ?? stringValue(value.content) ?? stringValue(value.value);
  return undefined;
}

function sessionIdFromObject(object: Record<string, unknown>): string | undefined {
  return stringValue(object.sessionId) ??
    stringValue(object.session_id) ??
    stringValue(object.conversationId) ??
    stringValue(object.conversation_id) ??
    stringValue(object.chatId) ??
    stringValue(object.threadId) ??
    stringValue(object.thread_id);
}

function filePathFromObject(object: Record<string, unknown>): string | undefined {
  const direct = stringValue(object.file) ?? stringValue(object.path) ?? stringValue(object.filePath) ?? stringValue(object.file_path);
  if (direct) return direct;
  const files = object.files;
  if (!Array.isArray(files)) return undefined;
  for (const file of files) {
    if (typeof file === "string" && file.trim()) return file.trim();
    if (isObject(file)) {
      const filePath = stringValue(file.path) ?? stringValue(file.filePath) ?? stringValue(file.name);
      if (filePath) return filePath;
    }
  }
  return undefined;
}

function snippet(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.slice(0, MAX_SNIPPET_CHARS);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
