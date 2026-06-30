import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const LearnV2SurfaceReadSchema = z.object({
  adapterId: z.string().min(1),
  sourcePath: z.string().min(1),
  contentKind: z.enum(["transcript", "tool-trace", "diff", "log", "document", "summary", "unknown"]),
  rawText: z.string(),
  detectedFormat: z.enum(["json", "jsonl", "markdown", "plain", "diff", "log"])
});
export type LearnV2SurfaceRead = z.infer<typeof LearnV2SurfaceReadSchema>;

export interface LearnV2SurfaceAdapter {
  id: string;
  label: string;
  canRead(sourcePath: string, rawText: string): boolean;
  read(sourcePath: string, rawText: string): LearnV2SurfaceRead;
}

export const learnV2SurfaceAdapters: LearnV2SurfaceAdapter[] = [
  makeAdapter("opencode", "OpenCode session or trace", /opencode|osk|session|trace/i),
  makeAdapter("codex", "Codex transcript", /codex|conversation|transcript|chat/i),
  makeAdapter("claude-code", "Claude Code transcript", /claude|conversation|transcript|chat/i),
  makeAdapter("cursor", "Cursor transcript", /cursor|conversation|transcript|chat/i),
  makeAdapter("terminal", "Terminal transcript", /(?:terminal|shell|console|history|commands?)/i, "log"),
  makeAdapter("review-local", "Local review notes", /(?:review|comments?|pr|pull-request)/i, "document"),
  makeAdapter("ci-log", "CI or test log", /(?:ci|junit|test|vitest|pytest|build|log)/i, "log"),
  makeAdapter("project-docs", "Project documentation", /(?:README|docs?|notes?|plan)/i, "document"),
  makeAdapter("agent-summaries", "Agent summary", /(?:summary|handoff|finish)/i, "summary"),
  {
    id: "generic-transcript",
    label: "Generic transcript",
    canRead: () => true,
    read: (sourcePath, rawText) => LearnV2SurfaceReadSchema.parse({
      adapterId: "generic-transcript",
      sourcePath,
      contentKind: inferContentKind(sourcePath, rawText),
      rawText,
      detectedFormat: detectSurfaceFormat(sourcePath, rawText)
    })
  },
  makeAdapter("git", "Git diff or metadata", /(?:\.diff|\.patch|git)/i, "diff")
];

export async function readLearnV2Surface(sourcePathInput: string, adapterId?: string): Promise<LearnV2SurfaceRead> {
  const sourcePath = path.resolve(sourcePathInput);
  const rawText = await fs.readFile(sourcePath, "utf8");
  const explicit = adapterId ? learnV2SurfaceAdapters.find((adapter) => adapter.id === adapterId) : undefined;
  const adapter = explicit ?? learnV2SurfaceAdapters.find((item) => item.canRead(sourcePath, rawText)) ?? learnV2SurfaceAdapters.find((item) => item.id === "generic-transcript")!;
  return adapter.read(sourcePath, rawText);
}

function makeAdapter(id: string, label: string, pathPattern: RegExp, contentKind?: LearnV2SurfaceRead["contentKind"]): LearnV2SurfaceAdapter {
  return {
    id,
    label,
    canRead: (sourcePath, rawText) => pathPattern.test(sourcePath) || pathPattern.test(rawText.slice(0, 1000)),
    read: (sourcePath, rawText) => LearnV2SurfaceReadSchema.parse({
      adapterId: id,
      sourcePath,
      contentKind: contentKind ?? inferContentKind(sourcePath, rawText),
      rawText,
      detectedFormat: detectSurfaceFormat(sourcePath, rawText)
    })
  };
}

function detectSurfaceFormat(sourcePath: string, rawText: string): LearnV2SurfaceRead["detectedFormat"] {
  const trimmed = rawText.trim();
  if (/\.diff$|\.patch$/i.test(sourcePath) || /^diff --git /m.test(rawText)) return "diff";
  if (/\.md$/i.test(sourcePath) || /^#{1,6}\s/m.test(rawText) || /^\s*(user|assistant|system|developer|tool|reviewer)\s*:/im.test(rawText)) return "markdown";
  if (/\.jsonl$/i.test(sourcePath) || looksJsonl(trimmed)) return "jsonl";
  if (/\.json$/i.test(sourcePath) || looksJson(trimmed)) return "json";
  if (/\.log$/i.test(sourcePath) || /\b(?:ERROR|WARN|INFO|FAIL|PASS)\b/.test(rawText.slice(0, 2000))) return "log";
  return "plain";
}

function inferContentKind(sourcePath: string, rawText: string): LearnV2SurfaceRead["contentKind"] {
  const format = detectSurfaceFormat(sourcePath, rawText);
  if (format === "diff") return "diff";
  if (format === "log") return "log";
  if (format === "markdown" && /(?:^|\n)#{1,6}\s/m.test(rawText)) return "document";
  if (/(?:toolName|tool|command|cmd|output)/i.test(rawText.slice(0, 1000))) return "tool-trace";
  return "transcript";
}

function looksJson(value: string): boolean {
  if (!value || !/^[{\[]/.test(value)) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function looksJsonl(value: string): boolean {
  const lines = value.split(/\r?\n/).filter((line) => line.trim()).slice(0, 10);
  if (lines.length < 2) return false;
  return lines.every((line) => {
    try {
      JSON.parse(line);
      return true;
    } catch {
      return false;
    }
  });
}

