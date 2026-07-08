import type { LearnV2RawEvidenceRecord, LearnV2NormalizedEvidence } from "./schemas.js";
import type { LearnV2SurfaceNormalizationProfile, LearnV2SurfaceRead } from "./surfaces.js";
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
    ? values.flatMap((value, index) => normalizedFromObject(value, index, rawRecord, surface))
    : normalizedFromText(surface, rawRecord, learnerText);
  return normalized.length ? normalized : [fallbackEvidence(surface, rawRecord, learnerText)];
}

function normalizedFromObject(value: unknown, index: number, rawRecord: LearnV2RawEvidenceRecord, surface: LearnV2SurfaceRead): LearnV2NormalizedEvidence[] {
  if (!isObject(value)) return [];
  const traceContext = objectValue(value.traceContext);
  const metadataObject = objectValue(value.metadata);
  const toolInput = firstObject(value.input, value.args, value.arguments, value.parameters, value.toolInput, value.metadata);
  const ambient = opencodeAmbientDerivedEvidence(value, metadataObject);
  const diagnosticText = surface.adapterId === "ide-diagnostics" ? diagnosticTextValue(value) : undefined;
  const text = diagnosticText
    ?? textValue(value.content)
    ?? textValue(value.text)
    ?? stringValue(value.message)
    ?? stringValue(value.body)
    ?? stringValue(value.summary)
    ?? stringValue(value.output)
    ?? diagnosticTextValue(value)
    ?? stringValue(value.diff)
    ?? ambient?.text
    ?? "";
  const command = commandValue(value, toolInput) ?? ambient?.command;
  const toolName = toolNameValue(value) ?? toolNameValue(toolInput) ?? ambient?.toolName;
  if (!text && !command && !toolName) return [];
  const fullText = text || command || toolName || `structured evidence ${index}`;
  const explicitPaths = pathsFromStructuredValue(value);
  const commands = command ? [command] : learnV2CommandLinesFromText(fullText);
  return [makeEvidence(rawRecord, index, {
    kind: inferKind(value, fullText, toolName, commands, surface),
    actor: normalizeActorForSurface(surface, stringValue(value.role) ?? stringValue(value.type) ?? stringValue(value.actor)),
    timestamp: normalizeTimestamp(stringValue(value.timestamp) ?? stringValue(value.createdAt) ?? stringValue(value.created_at) ?? stringValue(value.capturedAt)),
    sessionId: stringValue(value.sessionId) ?? stringValue(value.session_id) ?? stringValue(value.sessionID) ?? stringValue(value.conversationId) ?? stringValue(value.conversation_id) ?? stringValue(value.chatId) ?? stringValue(value.threadId) ?? safeTraceId(traceContext?.oskSessionId, "osk_session") ?? safeTraceId(traceContext?.sessionId, "osk_session") ?? safeTraceId(metadataObject?.oskSessionId, "osk_session") ?? rawRecord.trace.sessionIds[0],
    traceId: stringValue(value.traceId) ?? stringValue(value.trace_id) ?? stringValue(value.runId) ?? safeTraceId(traceContext?.oskTraceId, "osk_trace") ?? safeTraceId(traceContext?.traceId, "osk_trace") ?? safeTraceId(metadataObject?.oskTraceId, "osk_trace") ?? rawRecord.trace.oskTraceId,
    episodeId: stringValue(value.episodeId) ?? stringValue(value.episode_id) ?? stringValue(value.turnId) ?? safeTraceId(traceContext?.oskEpisodeId, "osk_episode") ?? safeTraceId(traceContext?.episodeId, "osk_episode") ?? safeTraceId(metadataObject?.oskEpisodeId, "osk_episode") ?? rawRecord.trace.oskEpisodeId,
    branch: stringValue(value.branch) ?? stringValue(traceContext?.gitBranch) ?? rawRecord.trace.branch,
    cwdHint: stringValue(value.cwd) ?? stringValue(value.workspace) ?? stringValue(value.projectRoot),
    text: fullText,
    toolName,
    status: learnV2StatusFromText(value.status ?? value.severity ?? value.level ?? fullText),
    paths: [...new Set([...explicitPaths, ...learnV2FilePathsFromText(`${fullText}\n${JSON.stringify(value)}`)])].slice(0, 40),
    commands,
    metadata: {
      sourceIndex: index,
      adapter: surface.adapterId,
      rawKeys: Object.keys(value).slice(0, 40),
      traceContext: safeTraceMetadata(traceContext),
      opencodeSessionId: safeTraceId(traceContext?.opencodeSessionId, "opencode_session"),
      ...(ambient ? { opencodeAmbient: true, opencodeAmbientEventType: ambient.eventType } : {}),
      ...factorMetadataFromStructuredValue(value, metadataObject, toolInput)
    }
  })];
}

function normalizedFromText(surface: LearnV2SurfaceRead, rawRecord: LearnV2RawEvidenceRecord, text: string): LearnV2NormalizedEvidence[] {
  const profile = normalizationProfileForSurface(surface);
  if (profile === "diff") {
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
  if (profile === "terminal") return normalizeTerminalText(surface, rawRecord, text);
  if (profile === "ci-log") return normalizeCiLogText(surface, rawRecord, text);
  if (profile === "ide-diagnostics") return normalizeDiagnosticText(surface, rawRecord, text);
  if (profile === "issue-local") return normalizeIssueText(surface, rawRecord, text);
  if (profile === "review-local") return normalizeReviewText(surface, rawRecord, text);
  if (profile === "project-docs") return normalizeProjectDocText(surface, rawRecord, text);
  if (profile === "agent-summaries") return normalizeAgentSummaryText(surface, rawRecord, text);
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
  if (surface.detectedFormat === "xml" || /<(?:testsuite|testsuites|testcase)\b/i.test(text.slice(0, 2000))) {
    const junit = normalizeJUnitXml(surface, rawRecord, text);
    if (junit.length) return junit;
  }
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

function normalizeJUnitXml(surface: LearnV2SurfaceRead, rawRecord: LearnV2RawEvidenceRecord, text: string): LearnV2NormalizedEvidence[] {
  const suiteScopes = xmlElements(text, "testsuite");
  const scopes = suiteScopes.length ? suiteScopes : [{ attributes: "", text: "", rawText: text }];
  const out: LearnV2NormalizedEvidence[] = [];
  const testcasePattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/gi;
  for (const scope of scopes) {
    const suiteAttrs = parseXmlAttributes(scope.attributes);
    const suiteName = suiteAttrs.name;
    for (const match of scope.rawText.matchAll(testcasePattern)) {
      const attrs = parseXmlAttributes(match[1] ?? "");
      const body = match[2] ?? "";
      const failure = firstXmlElement(body, "failure") ?? firstXmlElement(body, "error");
      const skipped = firstXmlElement(body, "skipped") ?? (/<skipped\b/i.test(body) ? { attributes: "", text: "", rawText: "" } : undefined);
      const status = failure ? "fail" : skipped ? "blocked" : "pass";
      const failureAttrs = failure ? parseXmlAttributes(failure.attributes) : {};
      const skippedAttrs = skipped ? parseXmlAttributes(skipped.attributes) : {};
      const parts = [
        `JUnit ${status}`,
        suiteName ? `suite=${suiteName}` : undefined,
        attrs.classname ? `class=${attrs.classname}` : undefined,
        attrs.name ? `test=${attrs.name}` : undefined,
        attrs.file ? `file=${attrs.file}` : undefined,
        failureAttrs.type ? `type=${failureAttrs.type}` : undefined,
        failureAttrs.message ? `message=${failureAttrs.message}` : undefined,
        skippedAttrs.message ? `skipped=${skippedAttrs.message}` : undefined,
        failure?.text ? boundedMultiline(failure.text, 1200) : undefined,
        skipped?.text ? boundedMultiline(skipped.text, 600) : undefined
      ].filter(Boolean);
      const fullText = parts.join("\n");
      out.push(makeEvidence(rawRecord, out.length, {
        kind: "test-result",
        actor: "ci",
        text: fullText,
        status,
        paths: [...new Set([
          ...arrayStrings(attrs.file),
          ...learnV2FilePathsFromText(`${fullText}\n${body}`)
        ])],
        commands: [],
        metadata: {
          detectedFormat: surface.detectedFormat,
          adapter: "ci-log",
          junit: true,
          suite: suiteName,
          className: attrs.classname,
          testName: attrs.name
        }
      }));
    }
  }
  return out.slice(0, 400);
}

function normalizeDiagnosticText(surface: LearnV2SurfaceRead, rawRecord: LearnV2RawEvidenceRecord, text: string): LearnV2NormalizedEvidence[] {
  const chunks = splitLogChunks(text);
  return chunks.map((chunk, index) => makeEvidence(rawRecord, index, {
    kind: "test-result",
    actor: "tool",
    text: learnV2Snippet(chunk, 1800),
    status: learnV2StatusFromText(chunk),
    paths: learnV2FilePathsFromText(chunk),
    commands: learnV2CommandLinesFromText(chunk),
    metadata: { detectedFormat: surface.detectedFormat, adapter: "ide-diagnostics" }
  }));
}

function normalizeIssueText(surface: LearnV2SurfaceRead, rawRecord: LearnV2RawEvidenceRecord, text: string): LearnV2NormalizedEvidence[] {
  const blocks = text.split(/\n(?=\s*(?:issue|ticket|title|status|assignee|labels?|body|description)\s*:)/i)
    .map((block) => block.trim())
    .filter((block) => block.length >= 8);
  return (blocks.length ? blocks : markdownSections(text)).slice(0, 200).map((block, index) => makeEvidence(rawRecord, index, {
    kind: "review",
    actor: "reviewer",
    text: learnV2Snippet(block, 1800),
    status: learnV2StatusFromText(block),
    paths: learnV2FilePathsFromText(block),
    commands: learnV2CommandLinesFromText(block),
    metadata: { detectedFormat: surface.detectedFormat, adapter: "issue-local" }
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

function normalizationProfileForSurface(surface: LearnV2SurfaceRead): LearnV2SurfaceNormalizationProfile {
  if (surface.normalizationProfile) return surface.normalizationProfile;
  if (surface.detectedFormat === "diff") return "diff";
  if (surface.adapterId === "terminal") return "terminal";
  if (surface.adapterId === "ci-log") return "ci-log";
  if (surface.adapterId === "ide-diagnostics") return "ide-diagnostics";
  if (surface.adapterId === "issue-local") return "issue-local";
  if (surface.adapterId === "review-local") return "review-local";
  if (surface.adapterId === "project-docs") return "project-docs";
  if (surface.adapterId === "agent-summaries") return "agent-summaries";
  if (surface.detectedFormat === "json" || surface.detectedFormat === "jsonl") return "structured-events";
  return "generic-transcript";
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

function factorMetadataFromStructuredValue(
  value: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined,
  toolInput: Record<string, unknown> | undefined
): Record<string, unknown> {
  const sources = [value, metadata, toolInput].filter((item): item is Record<string, unknown> => Boolean(item));
  const out: Record<string, unknown> = {};
  copyFirstFactorMetadata(out, sources, "theme", ["theme", "uiTheme", "mode", "colorMode", "dataTheme"]);
  copyFirstFactorMetadata(out, sources, "component.container", ["container", "componentContainer", "parentContainer"]);
  copyFirstFactorMetadata(out, sources, "componentRole", ["componentRole", "role", "ariaRole"]);
  copyFirstFactorMetadata(out, sources, "surfaceKind", ["surfaceKind", "pageType", "routeType", "screenType"]);
  copyFirstFactorMetadata(out, sources, "className", ["className", "class", "classes", "cssClasses", "tailwindClasses"]);
  copyFirstFactorMetadata(out, sources, "componentTree", ["componentTree", "ancestorComponents", "parentComponents", "jsxAncestors", "domPath"]);
  copyFirstFactorMetadata(out, sources, "componentNames", ["componentNames", "jsxComponents"]);
  copyFirstFactorMetadata(out, sources, "symbols", ["symbols", "changedSymbols", "exportedNames"]);
  copyFirstFactorMetadata(out, sources, "imports", ["imports", "changedImports"]);
  copyFirstFactorMetadata(out, sources, "screenshotLabels", ["screenshotLabels", "visualLabels", "detectedObjects", "imageLabels"]);
  copyFirstFactorMetadata(out, sources, "designTokens", ["designToken", "designTokens", "cssVariable", "cssVariables", "colorToken", "colorTokens"]);
  return out;
}

function copyFirstFactorMetadata(out: Record<string, unknown>, sources: Record<string, unknown>[], target: string, keys: string[]): void {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (isSafeFactorMetadata(value)) {
        out[target] = value;
        return;
      }
    }
  }
}

function isSafeFactorMetadata(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0 && value.length <= 500;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length <= 50 && value.every(isSafeFactorMetadata);
  if (!isObject(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 30 && entries.every(([key, item]) => key.length <= 80 && isSafeFactorMetadata(item));
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
      for (const key of ["events", "messages", "turns", "conversation", "transcript", "items", "entries", "diagnostics", "problems", "issues", "tickets"]) {
        if (Array.isArray(parsed[key])) return [parsed];
      }
    }
    return [parsed];
  } catch {
    return [];
  }
}

function flattenStructuredObjects(values: unknown[]): unknown[] {
  const out: unknown[] = [];
  const visit = (value: unknown, inherited: Record<string, unknown> = {}): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, inherited);
      return;
    }
    if (isObject(value)) {
      const nested = ["events", "messages", "turns", "conversation", "transcript", "items", "entries", "diagnostics", "problems", "issues", "tickets"].find((key) => Array.isArray(value[key]));
      if (nested) {
        visit(value[nested], { ...inherited, ...structuredParentContext(value) });
        return;
      }
      out.push(Object.keys(inherited).length ? mergeStructuredContext(inherited, value) : value);
      return;
    }
    out.push(value);
  };
  visit(values);
  return out;
}

function mergeStructuredContext(parent: Record<string, unknown>, child: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...parent, ...child };
  if (isObject(parent.metadata) || isObject(child.metadata)) {
    merged.metadata = {
      ...(isObject(parent.metadata) ? parent.metadata : {}),
      ...(isObject(child.metadata) ? child.metadata : {})
    };
  }
  if (isObject(parent.traceContext) || isObject(child.traceContext)) {
    merged.traceContext = {
      ...(isObject(parent.traceContext) ? parent.traceContext : {}),
      ...(isObject(child.traceContext) ? child.traceContext : {})
    };
  }
  return merged;
}

function structuredParentContext(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [
    "sessionId",
    "session_id",
    "sessionID",
    "conversationId",
    "conversation_id",
    "chatId",
    "threadId",
    "traceId",
    "trace_id",
    "runId",
    "episodeId",
    "episode_id",
    "turnId",
    "branch",
    "cwd",
    "workspace",
    "projectRoot",
    "traceContext",
    "metadata"
  ]) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

function inferKind(value: Record<string, unknown>, text: string, toolName: string | undefined, commands: string[], surface: LearnV2SurfaceRead): LearnV2NormalizedEvidence["kind"] {
  const type = String(value.kind ?? value.type ?? "").toLowerCase();
  if (surface.adapterId === "ide-diagnostics") return "test-result";
  if (surface.adapterId === "issue-local") return "review";
  if (/review|comment/.test(type)) return "review";
  if (toolName) return "tool-call";
  if (/test/.test(type) || /\b(pass|fail|vitest|pytest|junit)\b/i.test(text)) return "test-result";
  if (/diff|patch|file/.test(type) || /^diff --git /m.test(text)) return "file-change";
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

function normalizeActorForSurface(surface: LearnV2SurfaceRead, value: string | undefined): LearnV2NormalizedEvidence["actor"] {
  if (!value && surface.adapterId === "ide-diagnostics") return "tool";
  if (!value && surface.adapterId === "issue-local") return "reviewer";
  return normalizeActor(value);
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

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function firstObject(...values: unknown[]): Record<string, unknown> | undefined {
  for (const value of values) {
    if (isObject(value)) return value;
    if (typeof value === "string") {
      const parsed = parseJsonObject(value);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => textValue(item))
      .filter((item): item is string => Boolean(item?.trim()));
    return parts.length ? parts.join("\n") : undefined;
  }
  if (!isObject(value)) return undefined;
  return stringValue(value.text)
    ?? stringValue(value.content)
    ?? stringValue(value.message)
    ?? stringValue(value.body)
    ?? stringValue(value.output)
    ?? stringValue(value.result)
    ?? textValue(value.parts);
}

function diagnosticTextValue(value: Record<string, unknown>): string | undefined {
  const message = stringValue(value.message) ?? stringValue(value.detail) ?? stringValue(value.description);
  if (!message) return undefined;
  const severity = stringValue(value.severity) ?? stringValue(value.level);
  const source = stringValue(value.source) ?? stringValue(value.ruleId) ?? stringValue(value.code);
  return [severity, source, message].filter(Boolean).join(": ");
}

function commandValue(value: Record<string, unknown>, nestedInput?: Record<string, unknown>): string | undefined {
  return stringValue(value.command)
    ?? stringValue(value.cmd)
    ?? stringValue(value.commandLine)
    ?? stringValue(value.command_line)
    ?? stringValue(nestedInput?.command)
    ?? stringValue(nestedInput?.cmd)
    ?? stringValue(nestedInput?.commandLine)
    ?? commandFromContentParts(value.content)
    ?? commandFromContentParts(value.messages);
}

function toolNameValue(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) return undefined;
  return stringValue(value.toolName)
    ?? stringValue(value.tool)
    ?? stringValue(value.name)
    ?? stringValue(value.functionName)
    ?? stringValue(value.function_name)
    ?? stringValue(objectValue(value.function)?.name)
    ?? toolNameFromContentParts(value.content)
    ?? toolNameFromContentParts(value.messages);
}

function opencodeAmbientDerivedEvidence(
  value: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined
): { text: string; command?: string; toolName?: string; eventType?: string } | undefined {
  if (stringValue(value.schemaVersion) !== "openskill-kit.opencode-ambient-event.v1" || !metadata) return undefined;
  const eventType = stringValue(value.eventType);
  const toolName = stringValue(metadata["input.tool"]) ?? stringValue(metadata["output.tool"]);
  const commandKind = stringValue(metadata["input.commandKind"]);
  const commandHash = stringValue(metadata["input.commandHash"]);
  const pathKind = stringValue(metadata["input.pathKind"]);
  const pathExtension = stringValue(metadata["input.pathExtension"]);
  const outputStatus = stringValue(metadata["output.status"]) ?? stringValue(value.status);
  const commandRiskFlags = metadataList(metadata["input.commandRiskFlags"]);
  const pathRiskFlags = metadataList(metadata["input.pathRiskFlags"]);
  const parts = [
    "OpenCode ambient event",
    eventType ? `event=${eventType}` : undefined,
    toolName ? `tool=${toolName}` : undefined,
    commandKind ? `commandKind=${commandKind}` : undefined,
    commandHash ? `commandHash=${commandHash}` : undefined,
    pathKind ? `pathKind=${pathKind}` : undefined,
    pathExtension ? `pathExtension=${pathExtension}` : undefined,
    outputStatus ? `status=${outputStatus}` : undefined,
    commandRiskFlags.length ? `commandRiskFlags=${commandRiskFlags.join(",")}` : undefined,
    pathRiskFlags.length ? `pathRiskFlags=${pathRiskFlags.join(",")}` : undefined
  ].filter((item): item is string => Boolean(item));
  if (parts.length <= 1 && !toolName) return undefined;
  return {
    text: parts.join(" "),
    command: commandKind && commandHash ? `opencode-derived:${commandKind}:${commandHash}` : undefined,
    toolName,
    eventType
  };
}

function metadataList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 120).slice(0, 20)
    : [];
}

function commandFromContentParts(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const part of value) {
    if (!isObject(part)) continue;
    const input = firstObject(part.input, part.args, part.arguments, part.parameters);
    const command = stringValue(input?.command) ?? stringValue(input?.cmd) ?? stringValue(input?.commandLine);
    if (command) return command;
  }
  return undefined;
}

function toolNameFromContentParts(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const part of value) {
    if (!isObject(part)) continue;
    const name = stringValue(part.name) ?? stringValue(part.toolName) ?? stringValue(part.tool);
    if (name) return name;
  }
  return undefined;
}

function pathsFromStructuredValue(value: Record<string, unknown>): string[] {
  return [
    ...arrayStrings(value.path),
    ...arrayStrings(value.file),
    ...arrayStrings(value.uri),
    ...arrayStrings(value.paths),
    ...arrayStrings(value.files),
    ...arrayStrings(value.filePaths),
    ...arrayStrings(value.contextFiles),
    ...arrayStrings(value.relevantFiles),
    ...arrayObjectStrings(value.attachments, "path"),
    ...arrayObjectStrings(value.references, "path")
  ];
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseXmlAttributes(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of value.matchAll(/\b([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1]!] = decodeXmlEntities(match[2] ?? match[3] ?? "");
  }
  return attrs;
}

function firstXmlElement(value: string, name: string): { attributes: string; text: string; rawText: string } | undefined {
  return xmlElements(value, name)[0];
}

function xmlElements(value: string, name: string): { attributes: string; text: string; rawText: string }[] {
  const pattern = new RegExp(`<${name}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${name}>)`, "gi");
  return [...value.matchAll(pattern)].map((match) => ({
    attributes: match[1] ?? "",
    text: decodeXmlEntities(stripXmlTags(match[2] ?? "").trim()),
    rawText: match[2] ?? ""
  }));
}

function stripXmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeTraceId(value: unknown, prefix: string): string | undefined {
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(value)) return undefined;
  return value.startsWith(`${prefix}_`) || value.startsWith(`${prefix}:`) ? value : undefined;
}

function safeTraceMetadata(value: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  const out: Record<string, string> = {};
  const schemaVersion = stringValue(value.schemaVersion);
  if (schemaVersion === "openskill-kit.learn-v2.trace-context.v1") out.schemaVersion = schemaVersion;
  const oskSessionId = safeTraceId(value.oskSessionId, "osk_session");
  const oskEpisodeId = safeTraceId(value.oskEpisodeId, "osk_episode");
  const oskTraceId = safeTraceId(value.oskTraceId, "osk_trace");
  const opencodeSessionId = safeTraceId(value.opencodeSessionId, "opencode_session");
  if (oskSessionId) out.oskSessionId = oskSessionId;
  if (oskEpisodeId) out.oskEpisodeId = oskEpisodeId;
  if (oskTraceId) out.oskTraceId = oskTraceId;
  if (opencodeSessionId) out.opencodeSessionId = opencodeSessionId;
  return Object.keys(out).length ? out : undefined;
}

function arrayStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function arrayObjectStrings(value: unknown, key: string): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => isObject(item) && typeof item[key] === "string" ? [item[key] as string] : [])
    : [];
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
