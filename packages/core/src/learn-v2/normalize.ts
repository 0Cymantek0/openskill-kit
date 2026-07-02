import type { LearnV2RawEvidenceRecord, LearnV2NormalizedEvidence } from "./schemas.js";
import type { LearnV2SurfaceRead } from "./surfaces.js";
import {
  learnV2CommandLinesFromText,
  learnV2FilePathsFromText,
  learnV2ShortHash,
  learnV2Snippet,
  learnV2StatusFromText
} from "./utils.js";

export function normalizeLearnV2Evidence(surface: LearnV2SurfaceRead, rawRecord: LearnV2RawEvidenceRecord, learnerText: string): LearnV2NormalizedEvidence[] {
  const objects = parseStructuredObjects(learnerText);
  const values = objects.length ? flattenStructuredObjects(objects) : [];
  const normalized = values.length
    ? values.flatMap((value, index) => normalizedFromObject(value, index, rawRecord))
    : normalizedFromText(surface, rawRecord, learnerText);
  return normalized.length ? normalized : [fallbackEvidence(surface, rawRecord, learnerText)];
}

function normalizedFromObject(value: unknown, index: number, rawRecord: LearnV2RawEvidenceRecord): LearnV2NormalizedEvidence[] {
  if (!isObject(value)) return [];
  const text = stringValue(value.content)
    ?? stringValue(value.text)
    ?? stringValue(value.message)
    ?? stringValue(value.body)
    ?? stringValue(value.summary)
    ?? stringValue(value.output)
    ?? stringValue(value.diff)
    ?? "";
  const command = stringValue(value.command) ?? stringValue(value.cmd) ?? stringValue(value.commandLine);
  const toolName = stringValue(value.toolName) ?? stringValue(value.tool) ?? stringValue(value.name);
  if (!text && !command && !toolName) return [];
  const fullText = text || command || toolName || `structured evidence ${index}`;
  const explicitPaths = arrayStrings(value.paths).concat(arrayStrings(value.files));
  const commands = command ? [command] : learnV2CommandLinesFromText(fullText);
  return [makeEvidence(rawRecord, index, {
    kind: inferKind(value, fullText, toolName, commands),
    actor: normalizeActor(stringValue(value.role) ?? stringValue(value.type) ?? stringValue(value.actor)),
    timestamp: normalizeTimestamp(stringValue(value.timestamp) ?? stringValue(value.createdAt) ?? stringValue(value.created_at)),
    sessionId: stringValue(value.sessionId) ?? stringValue(value.session_id) ?? rawRecord.trace.sessionIds[0],
    traceId: stringValue(value.traceId) ?? stringValue(value.trace_id) ?? rawRecord.trace.oskTraceId,
    episodeId: stringValue(value.episodeId) ?? stringValue(value.episode_id) ?? rawRecord.trace.oskEpisodeId,
    branch: stringValue(value.branch) ?? rawRecord.trace.branch,
    cwdHint: stringValue(value.cwd),
    text: fullText,
    toolName,
    status: learnV2StatusFromText(value.status ?? fullText),
    paths: [...new Set([...explicitPaths, ...learnV2FilePathsFromText(`${fullText}\n${JSON.stringify(value)}`)])].slice(0, 40),
    commands,
    metadata: {
      sourceIndex: index,
      rawKeys: Object.keys(value).slice(0, 40)
    }
  })];
}

function normalizedFromText(surface: LearnV2SurfaceRead, rawRecord: LearnV2RawEvidenceRecord, text: string): LearnV2NormalizedEvidence[] {
  if (surface.detectedFormat === "diff") {
    return [makeEvidence(rawRecord, 0, {
      kind: "file-change",
      actor: "assistant",
      text,
      status: "unknown",
      paths: learnV2FilePathsFromText(text),
      commands: [],
      metadata: { detectedFormat: "diff" }
    })];
  }
  if (surface.adapterId === "terminal") return normalizeTerminalText(surface, rawRecord, text);
  if (surface.adapterId === "ci-log") return normalizeCiLogText(surface, rawRecord, text);
  if (surface.adapterId === "review-local") return normalizeReviewText(surface, rawRecord, text);
  if (surface.adapterId === "project-docs") return normalizeProjectDocText(surface, rawRecord, text);
  if (surface.adapterId === "agent-summaries") return normalizeAgentSummaryText(surface, rawRecord, text);
  const roleBlocks = text.split(/\n(?=(?:user|assistant|system|developer|tool|reviewer|ci)\s*:)/i);
  if (roleBlocks.length > 1) {
    return roleBlocks.flatMap((block, index) => {
      const match = block.match(/^\s*(user|assistant|system|developer|tool|reviewer|ci)\s*:\s*([\s\S]*)$/i);
      if (!match) return [];
      const body = match[2]!.trim();
      return makeEvidence(rawRecord, index, {
        kind: match[1]!.toLowerCase() === "tool" ? "tool-call" : "message",
        actor: normalizeActor(match[1]),
        text: body,
        status: learnV2StatusFromText(body),
        paths: learnV2FilePathsFromText(body),
        commands: learnV2CommandLinesFromText(body),
        metadata: { detectedFormat: surface.detectedFormat }
      });
    });
  }
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .slice(0, 800)
    .map((line, index) => makeEvidence(rawRecord, index, {
      kind: surface.detectedFormat === "log" ? "log-line" : "message",
      actor: /^(always|prefer|never|avoid|do not|don't|stop|must|should)\b/i.test(line) ? "user" : "unknown",
      text: line,
      status: learnV2StatusFromText(line),
      paths: learnV2FilePathsFromText(line),
      commands: learnV2CommandLinesFromText(line),
      metadata: { detectedFormat: surface.detectedFormat }
    }));
}

function normalizeTerminalText(surface: LearnV2SurfaceRead, rawRecord: LearnV2RawEvidenceRecord, text: string): LearnV2NormalizedEvidence[] {
  const lines = text.split(/\r?\n/);
  const out: LearnV2NormalizedEvidence[] = [];
  let currentCommand: { command: string; output: string[]; index: number } | undefined;
  const flush = (): void => {
    if (!currentCommand) return;
    const body = currentCommand.output.join("\n").trim();
    out.push(makeEvidence(rawRecord, currentCommand.index, {
      kind: "command",
      actor: "tool",
      text: body ? `${currentCommand.command}\n${boundedMultiline(body, 1800)}` : currentCommand.command,
      status: learnV2StatusFromText(body || currentCommand.command),
      paths: learnV2FilePathsFromText(`${currentCommand.command}\n${body}`),
      commands: [currentCommand.command],
      metadata: { detectedFormat: surface.detectedFormat, adapter: "terminal" }
    }));
    currentCommand = undefined;
  };
  for (const line of lines) {
    const command = terminalCommand(line);
    if (command) {
      flush();
      currentCommand = { command, output: [], index: out.length };
    } else if (currentCommand) {
      currentCommand.output.push(line);
    }
  }
  flush();
  if (out.length) return out;
  return fallbackLineEvidence(surface, rawRecord, text, "log-line", "tool", "terminal");
}

function boundedMultiline(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 3)}...` : trimmed;
}

function normalizeCiLogText(surface: LearnV2SurfaceRead, rawRecord: LearnV2RawEvidenceRecord, text: string): LearnV2NormalizedEvidence[] {
  const chunks = splitLogChunks(text);
  return chunks.map((chunk, index) => makeEvidence(rawRecord, index, {
    kind: "test-result",
    actor: "ci",
    text: learnV2Snippet(chunk, 1800),
    status: learnV2StatusFromText(chunk),
    paths: learnV2FilePathsFromText(chunk),
    commands: learnV2CommandLinesFromText(chunk),
    metadata: { detectedFormat: surface.detectedFormat, adapter: "ci-log" }
  }));
}

function normalizeReviewText(surface: LearnV2SurfaceRead, rawRecord: LearnV2RawEvidenceRecord, text: string): LearnV2NormalizedEvidence[] {
  const blocks = text.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  return (blocks.length ? blocks : text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 8))
    .slice(0, 200)
    .map((block, index) => makeEvidence(rawRecord, index, {
      kind: "review",
      actor: "reviewer",
      text: block,
      status: learnV2StatusFromText(block),
      paths: learnV2FilePathsFromText(block),
      commands: learnV2CommandLinesFromText(block),
      metadata: { detectedFormat: surface.detectedFormat, adapter: "review-local" }
    }));
}

function normalizeProjectDocText(surface: LearnV2SurfaceRead, rawRecord: LearnV2RawEvidenceRecord, text: string): LearnV2NormalizedEvidence[] {
  const sections = markdownSections(text);
  return sections.slice(0, 120).map((section, index) => makeEvidence(rawRecord, index, {
    kind: "document-section",
    actor: "unknown",
    text: learnV2Snippet(section, 1800),
    status: "unknown",
    paths: learnV2FilePathsFromText(section),
    commands: learnV2CommandLinesFromText(section),
    metadata: { detectedFormat: surface.detectedFormat, adapter: "project-docs" }
  }));
}

function normalizeAgentSummaryText(surface: LearnV2SurfaceRead, rawRecord: LearnV2RawEvidenceRecord, text: string): LearnV2NormalizedEvidence[] {
  const blocks = text.split(/\n(?=(?:summary|outcome|files|commands|tests|next|risk|handoff)\s*:)/i)
    .map((block) => block.trim())
    .filter((block) => block.length >= 8);
  return (blocks.length ? blocks : [text]).slice(0, 80).map((block, index) => makeEvidence(rawRecord, index, {
    kind: /test|pass|fail|command/i.test(block) ? "test-result" : "message",
    actor: "assistant",
    text: learnV2Snippet(block, 1800),
    status: learnV2StatusFromText(block),
    paths: learnV2FilePathsFromText(block),
    commands: learnV2CommandLinesFromText(block),
    metadata: { detectedFormat: surface.detectedFormat, adapter: "agent-summaries" }
  }));
}

function fallbackLineEvidence(
  surface: LearnV2SurfaceRead,
  rawRecord: LearnV2RawEvidenceRecord,
  text: string,
  kind: LearnV2NormalizedEvidence["kind"],
  actor: LearnV2NormalizedEvidence["actor"],
  adapter: string
): LearnV2NormalizedEvidence[] {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .slice(0, 800)
    .map((line, index) => makeEvidence(rawRecord, index, {
      kind,
      actor,
      text: line,
      status: learnV2StatusFromText(line),
      paths: learnV2FilePathsFromText(line),
      commands: learnV2CommandLinesFromText(line),
      metadata: { detectedFormat: surface.detectedFormat, adapter }
    }));
}

function fallbackEvidence(surface: LearnV2SurfaceRead, rawRecord: LearnV2RawEvidenceRecord, text: string): LearnV2NormalizedEvidence {
  return makeEvidence(rawRecord, 0, {
    kind: "message",
    actor: "unknown",
    text: learnV2Snippet(text, 4000),
    status: "unknown",
    paths: learnV2FilePathsFromText(text),
    commands: learnV2CommandLinesFromText(text),
    metadata: { detectedFormat: surface.detectedFormat, fallback: true }
  });
}

function makeEvidence(rawRecord: LearnV2RawEvidenceRecord, index: number, input: Omit<LearnV2NormalizedEvidence, "schemaVersion" | "id" | "rawRef" | "sourceHash">): LearnV2NormalizedEvidence {
  return {
    schemaVersion: "openskill-kit.learn-v2.normalized-evidence.v1",
    id: `ev_${learnV2ShortHash(`${rawRecord.id}:${index}:${input.kind}:${input.text}`)}`,
    rawRef: rawRecord.id,
    sourceHash: rawRecord.source.contentHash,
    branch: rawRecord.trace.branch,
    sessionId: rawRecord.trace.sessionIds[0],
    traceId: rawRecord.trace.oskTraceId,
    episodeId: rawRecord.trace.oskEpisodeId,
    ...input,
    text: input.text,
    paths: [...new Set(input.paths)].slice(0, 40),
    commands: [...new Set(input.commands)].slice(0, 20),
    metadata: input.metadata ?? {}
  };
}

function parseStructuredObjects(text: string): unknown[] {
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
    if (isObject(parsed)) {
      for (const key of ["events", "messages", "turns", "conversation", "transcript", "items", "entries"]) {
        if (Array.isArray(parsed[key])) return parsed[key] as unknown[];
      }
    }
    return [parsed];
  } catch {
    return [];
  }
}

function flattenStructuredObjects(values: unknown[]): unknown[] {
  const out: unknown[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (isObject(value)) {
      const nested = ["events", "messages", "turns", "conversation", "transcript", "items", "entries"].find((key) => Array.isArray(value[key]));
      if (nested) {
        visit(value[nested]);
        return;
      }
    }
    out.push(value);
  };
  visit(values);
  return out;
}

function inferKind(value: Record<string, unknown>, text: string, toolName: string | undefined, commands: string[]): LearnV2NormalizedEvidence["kind"] {
  const type = String(value.kind ?? value.type ?? "").toLowerCase();
  if (/review|comment/.test(type)) return "review";
  if (/test/.test(type) || /\b(pass|fail|vitest|pytest|junit)\b/i.test(text)) return "test-result";
  if (/diff|patch|file/.test(type) || /^diff --git /m.test(text)) return "file-change";
  if (toolName) return "tool-call";
  if (commands.length) return "command";
  return "message";
}

function normalizeActor(value: string | undefined): LearnV2NormalizedEvidence["actor"] {
  const role = (value ?? "unknown").toLowerCase();
  if (["system", "developer", "user", "assistant", "tool", "reviewer", "ci"].includes(role)) return role as LearnV2NormalizedEvidence["actor"];
  if (/human|prompt/.test(role)) return "user";
  if (/function|command|result/.test(role)) return "tool";
  return "unknown";
}

function normalizeTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function terminalCommand(line: string): string | undefined {
  const trimmed = line.trim();
  const match = /^(?:\$|>|PS [^>]+>|PS>)\s*(.+)$/.exec(trimmed);
  if (match?.[1]) return match[1].trim();
  if (/^(?:npm|pnpm|yarn|node|tsx|tsc|vitest|pytest|python|git|cargo|go|dotnet|ruff|mypy|eslint)\b/.test(trimmed)) return trimmed;
  return undefined;
}

function splitLogChunks(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const chunks: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    const body = current.join("\n").trim();
    if (body.length >= 8) chunks.push(body);
    current = [];
  };
  for (const line of lines) {
    if (/^(?:FAIL|PASS|ERROR|WARN|\[.*?\]|\[ok\]|\[x\])\b/i.test(line.trim()) && current.length > 0) flush();
    current.push(line);
  }
  flush();
  return chunks.length ? chunks.slice(0, 200) : [text];
}

function markdownSections(text: string): string[] {
  const sections: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    const body = current.join("\n").trim();
    if (body.length >= 8) sections.push(body);
    current = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^#{1,6}\s+/.test(line) && current.length > 0) flush();
    current.push(line);
  }
  flush();
  if (sections.length) return sections;
  return text.split(/\n\s*\n+/).map((section) => section.trim()).filter((section) => section.length >= 8);
}
