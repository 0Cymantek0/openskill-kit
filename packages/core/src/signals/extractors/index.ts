import { createHash } from "node:crypto";
import type { OpenSkillEvent } from "../../events/schema.js";
import { SignalSchema, type Signal } from "../schema.js";

export interface ExtractorContext {
  now: Date;
}

export interface SignalExtractor {
  id: string;
  extract(event: OpenSkillEvent, context: ExtractorContext): Signal[];
}

const explicitPatterns = [
  /\b(always|prefer|use|keep|make sure to|default to)\s+(.{8,220}?)(?:[.!?\n]|$)/gi,
  /\b(never|avoid|do not|don't|stop)\s+(.{8,220}?)(?:[.!?\n]|$)/gi
];

export const eventExtractors: SignalExtractor[] = [
  { id: "explicit-preference-v2", extract: extractExplicitPreferences },
  { id: "tool-choice-v2", extract: extractToolChoice },
  { id: "test-outcome-v2", extract: extractTestOutcome },
  { id: "accepted-output-v2", extract: extractAcceptedOutput },
  { id: "rejection-correction-v2", extract: extractRejection },
  { id: "user-edit-diff-v2", extract: extractEditDelta },
  { id: "review-comment-v2", extract: extractReviewComment },
  { id: "contradiction-v2", extract: extractContradiction }
];

export function runEventExtractors(event: OpenSkillEvent, now = new Date()): Signal[] {
  return eventExtractors.flatMap((extractor) =>
    extractor.extract(event, { now }).map((signal) => SignalSchema.parse({ ...signal, extractorId: signal.extractorId ?? extractor.id }))
  );
}

function extractExplicitPreferences(event: OpenSkillEvent, context: ExtractorContext): Signal[] {
  const text = eventText(event);
  if (!text) return [];
  const signals: Signal[] = [];
  for (const pattern of explicitPatterns) {
    for (const match of text.matchAll(pattern)) {
      const verb = (match[1] ?? "").toLowerCase();
      const body = cleanStatement(match[2] ?? "");
      if (body.length < 8) continue;
      const negative = ["never", "avoid", "do not", "don't", "stop"].includes(verb);
      const statement = `${negative ? "Do not" : "Prefer"} ${body}`;
      signals.push(signalFromEvent(event, context.now, "explicit-preference", categorize(statement), statement, negative ? "negative" : "positive", negative ? 0.88 : 0.82, event.files.map((file) => file.path), text.slice(Math.max(0, match.index ?? 0), Math.min(text.length, (match.index ?? 0) + 260))));
    }
  }
  return signals;
}

function extractToolChoice(event: OpenSkillEvent, context: ExtractorContext): Signal[] {
  if (event.eventType !== "post-tool-use" && event.eventType !== "pre-tool-use") return [];
  return event.commands.filter((command) => !command.command.startsWith("opencode-derived:")).map((command) => signalFromEvent(
    event,
    context.now,
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

function extractTestOutcome(event: OpenSkillEvent, context: ExtractorContext): Signal[] {
  if (event.eventType !== "test-result") return [];
  return event.commands.map((command) => signalFromEvent(
    event,
    context.now,
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

function extractAcceptedOutput(event: OpenSkillEvent, context: ExtractorContext): Signal[] {
  if (event.eventType !== "user-accepted") return [];
  return [signalFromEvent(event, context.now, "acceptance", "workflow", "User accepted agent output", "positive", 0.64)];
}

function extractRejection(event: OpenSkillEvent, context: ExtractorContext): Signal[] {
  if (event.eventType !== "user-rejected") return [];
  const rejected = summarizeText(eventText(event));
  return [signalFromEvent(event, context.now, "rejection", "workflow", rejected ? `Do not repeat rejected agent approach: ${rejected}` : "Do not repeat rejected agent approach", "negative", 0.78)];
}

function extractEditDelta(event: OpenSkillEvent, context: ExtractorContext): Signal[] {
  if (event.eventType !== "user-edited" && event.eventType !== "file-changed") return [];
  const paths = event.files.map((file) => file.path);
  const text = eventText(event);
  const statement = paths.length
    ? `Prefer preserving user-edited patterns in ${paths.slice(0, 3).join(", ")}`
    : "Prefer preserving user-edited project patterns";
  return [
    signalFromEvent(event, context.now, "edit-delta", categorize(`${paths.join(" ")} ${text}`), statement, "positive", 0.66, paths, summarizeText(text)),
    ...extractEditDeltaTaste(event, text, context.now)
  ];
}

function extractReviewComment(event: OpenSkillEvent, context: ExtractorContext): Signal[] {
  if (event.eventType !== "review-comment") return [];
  const text = cleanStatement(eventText(event));
  if (!text) return [];
  const paths = event.files.map((file) => file.path);
  const negative = /\b(block|must not|should not|avoid|never|security|leak|secret)\b/i.test(text);
  const statement = negative
    ? `Do not ignore review feedback: ${summarizeText(text)}`
    : `Prefer addressing review feedback: ${summarizeText(text)}`;
  return [signalFromEvent(event, context.now, "review-feedback", categorize(text), statement, negative ? "negative" : "positive", negative ? 0.82 : 0.74, paths, summarizeText(text))];
}

function extractContradiction(event: OpenSkillEvent, context: ExtractorContext): Signal[] {
  const text = eventText(event);
  if (!/\b(previous|earlier|before|old)\b.{0,80}\bwrong|changed my mind|instead of|not what i want|ignore that\b/i.test(text)) return [];
  return [signalFromEvent(event, context.now, "rejection", "workflow", `Treat earlier conflicting instruction as superseded: ${summarizeText(text)}`, "negative", 0.7, event.files.map((file) => file.path), summarizeText(text))];
}

function extractEditDeltaTaste(event: OpenSkillEvent, text: string, now: Date): Signal[] {
  const normalized = event.normalized as Record<string, unknown>;
  const diffText = [
    normalized.diff,
    normalized.diffSnippet,
    normalized.patch,
    normalized.patchSnippet,
    normalized.before,
    normalized.beforeSnippet,
    normalized.after,
    normalized.afterSnippet,
    normalized.original,
    normalized.updated,
    text
  ].filter((value): value is string => typeof value === "string").join("\n");
  if (!diffText.trim()) return [];
  const paths = event.files.map((file) => file.path);
  const scope = paths.slice(0, 3).join(", ") || "edited files";
  const signals: Signal[] = [];
  if (looksLikeDependencyRemoval(diffText)) signals.push(signalFromEvent(event, now, "edit-delta", "architecture", `Prefer dependency-light edits in ${scope}`, "positive", 0.82, paths, summarizeText(diffText)));
  if (looksLikeSecretLoggingRemoval(diffText)) signals.push(signalFromEvent(event, now, "edit-delta", "security", `Do not log secrets or raw credentials in ${scope}`, "negative", 0.86, paths, summarizeText(diffText)));
  if (looksLikeFocusedTestAddition(diffText)) signals.push(signalFromEvent(event, now, "edit-delta", "testing", `Prefer adding focused regression tests with edits in ${scope}`, "positive", 0.78, paths, summarizeText(diffText)));
  return signals;
}

function looksLikeDependencyRemoval(text: string): boolean {
  const removedImport = /^-\s*(import\s+.+\s+from\s+['"][^.'"][^'"]+['"]|const\s+.+\s*=\s*require\(['"][^.'"][^'"]+['"]\))/m.test(text);
  const removedPackageDep = /^-\s*"[^"]+"\s*:\s*"[^"]+"/m.test(text) && /dependencies|devDependencies|package\.json/i.test(text);
  const addedNativeOrLocal = /^\+\s*(import\s+.+\s+from\s+['"][.][^'"]+['"]|const\s+.+\s*=\s*require\(['"][.][^'"]+['"]\)|function\s+|export\s+function|const\s+\w+\s*=)/m.test(text);
  return (removedImport || removedPackageDep) && addedNativeOrLocal;
}

function looksLikeSecretLoggingRemoval(text: string): boolean {
  return /^-\s*console\.(log|debug|info|warn|error)\(.{0,120}(token|secret|password|credential|authorization|api[_-]?key)/im.test(text);
}

function looksLikeFocusedTestAddition(text: string): boolean {
  return /^\+\s*(it|test|describe)\(['"].{0,120}(regression|edge|parser|focused|specific|bug|fixture)/im.test(text);
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
  if (/\b(module|architecture|package|dependency|boundary)\b/.test(lower)) return "architecture";
  return "general";
}

function cleanStatement(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/^to\s+/i, "");
}

function summarizeText(value: string): string | undefined {
  const cleaned = cleanStatement(value);
  return cleaned ? cleaned.slice(0, 140) : undefined;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
