import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const LearnV2SurfaceNormalizationProfileSchema = z.enum([
  "generic-transcript",
  "structured-events",
  "diff",
  "terminal",
  "ci-log",
  "review-local",
  "project-docs",
  "agent-summaries"
]);
export type LearnV2SurfaceNormalizationProfile = z.infer<typeof LearnV2SurfaceNormalizationProfileSchema>;

export const LearnV2SurfaceReadSchema = z.object({
  adapterId: z.string().min(1),
  adapterLabel: z.string().min(1).optional(),
  adapterDetection: z.object({
    matchedBy: z.enum(["explicit", "filename", "content", "fallback"]),
    confidence: z.enum(["high", "medium", "low"]),
    reasons: z.array(z.string()).default([])
  }).optional(),
  sourcePath: z.string().min(1),
  contentKind: z.enum(["transcript", "tool-trace", "diff", "log", "document", "summary", "unknown"]),
  rawText: z.string(),
  detectedFormat: z.enum(["json", "jsonl", "markdown", "plain", "diff", "log"]),
  normalizationProfile: LearnV2SurfaceNormalizationProfileSchema.optional(),
  policy: z.object({
    selection: z.literal("explicit-only"),
    read: z.literal("raw-local-file"),
    learnerInput: z.literal("raw-local-in-memory"),
    persistence: z.literal("preview-artifacts-or-apply-vault"),
    modelBoundary: z.literal("declassified-only"),
    rawRefsExportable: z.literal(false),
    sensitivity: z.enum(["low", "medium", "high"]),
    notes: z.array(z.string()).default([])
  }).optional()
});
export type LearnV2SurfaceRead = z.infer<typeof LearnV2SurfaceReadSchema>;
export type LearnV2SurfaceAdapterPolicy = NonNullable<LearnV2SurfaceRead["policy"]>;
export type LearnV2SurfaceAdapterDetection = NonNullable<LearnV2SurfaceRead["adapterDetection"]>;

export const LearnV2SurfaceAdapterContractSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  normalizationProfile: LearnV2SurfaceNormalizationProfileSchema,
  contentKind: LearnV2SurfaceReadSchema.shape.contentKind.optional(),
  sensitivity: z.enum(["low", "medium", "high"]),
  capabilities: z.object({
    discover: z.literal(true),
    fetch: z.literal(true),
    relevance: z.literal(true),
    normalize: z.literal(true)
  }),
  policy: LearnV2SurfaceReadSchema.shape.policy.unwrap()
});
export type LearnV2SurfaceAdapterContract = z.infer<typeof LearnV2SurfaceAdapterContractSchema>;

export interface LearnV2SurfaceAdapter {
  id: string;
  label: string;
  normalizationProfile: LearnV2SurfaceNormalizationProfile;
  contentKind?: LearnV2SurfaceRead["contentKind"];
  policy: LearnV2SurfaceAdapterPolicy;
  detect(sourcePath: string, rawText: string): LearnV2SurfaceAdapterDetection | undefined;
  read(sourcePath: string, rawText: string, detection?: LearnV2SurfaceAdapterDetection): LearnV2SurfaceRead;
}

export const learnV2SurfaceAdapters: LearnV2SurfaceAdapter[] = [
  makeAdapter("opencode", "OpenCode session or trace", "structured-events", /opencode|opencode-events|opencode-session|opencode-trace|tool\.execute|provider:\s*opencode/i, undefined, "high", ["Conversation/tool traces may include prompts, paths, commands, and outputs."]),
  makeAdapter("codex", "Codex transcript", "structured-events", /codex/i, undefined, "high", ["Conversation transcripts may include prompts, paths, commands, and outputs."]),
  makeAdapter("claude-code", "Claude Code transcript", "structured-events", /claude/i, undefined, "high", ["Conversation transcripts may include prompts, paths, commands, and outputs."]),
  makeAdapter("cursor", "Cursor transcript", "structured-events", /cursor/i, undefined, "high", ["Conversation transcripts may include prompts, paths, commands, and outputs."]),
  makeAdapter("git", "Git diff or metadata", "diff", /(?:\.diff|\.patch|^git[-_.]?|diff --git)/i, "diff", "high", ["Raw diffs are local-only learner input; output artifacts receive declassified summaries."]),
  makeAdapter("terminal", "Terminal transcript", "terminal", /(?:terminal|shell|console|history|commands?)/i, "log", "high", ["Shell history and output can contain secrets or machine-local paths."]),
  makeAdapter("review-local", "Local review notes", "review-local", /\b(?:review|comments?|pr|pull-request)\b/i, "document", "medium", ["Review notes are explicit local evidence and remain declassified before output."], /(?:^|\n)\s*(?:reviewer|review comment|pr comment|pull request comment|pull-request comment)\s*:/i),
  makeAdapter("ci-log", "CI or test log", "ci-log", /\b(?:ci|junit|vitest|pytest|build|log|PASS|FAIL|ERROR|WARN)\b/i, "log", "medium", ["Logs can be large and may include environment-specific paths or outputs."]),
  makeAdapter("project-docs", "Project documentation", "project-docs", /(?:README|docs?|notes?|plan)/i, "document", "low", ["Project documentation is still treated as explicit local raw evidence when supplied."], false),
  makeAdapter("agent-summaries", "Agent summary", "agent-summaries", /(?:summary|handoff|finish)/i, "summary", "medium", ["Summaries are explicit local evidence and may still contain private project details."], false),
  {
    id: "generic-transcript",
    label: "Generic transcript",
    normalizationProfile: "generic-transcript",
    policy: rawSurfacePolicy("high", ["Fallback raw surface adapter; explicit user selection required."]),
    detect: () => ({
      matchedBy: "fallback",
      confidence: "low",
      reasons: ["no-specific-surface-adapter-match"]
    }),
    read: (sourcePath, rawText, detection) => LearnV2SurfaceReadSchema.parse({
      adapterId: "generic-transcript",
      adapterLabel: "Generic transcript",
      adapterDetection: detection ?? {
        matchedBy: "fallback",
        confidence: "low",
        reasons: ["no-specific-surface-adapter-match"]
      },
      sourcePath,
      contentKind: inferContentKind(sourcePath, rawText),
      rawText,
      detectedFormat: detectSurfaceFormat(sourcePath, rawText),
      normalizationProfile: "generic-transcript",
      policy: rawSurfacePolicy("high", ["Fallback raw surface adapter; explicit user selection required."])
    })
  }
];

export function learnV2SurfaceAdapterContracts(): LearnV2SurfaceAdapterContract[] {
  return learnV2SurfaceAdapters.map((adapter) => LearnV2SurfaceAdapterContractSchema.parse({
    id: adapter.id,
    label: adapter.label,
    normalizationProfile: adapter.normalizationProfile,
    contentKind: adapter.contentKind,
    sensitivity: adapter.policy.sensitivity,
    capabilities: {
      discover: true,
      fetch: true,
      relevance: true,
      normalize: true
    },
    policy: adapter.policy
  }));
}

export function validateLearnV2SurfaceAdapterContracts(adapters: LearnV2SurfaceAdapter[] = learnV2SurfaceAdapters): LearnV2SurfaceAdapterContract[] {
  const ids = new Set<string>();
  const contracts = adapters.map((adapter) => {
    if (ids.has(adapter.id)) throw new Error(`Duplicate Learn v2 surface adapter id: ${adapter.id}`);
    ids.add(adapter.id);
    return LearnV2SurfaceAdapterContractSchema.parse({
      id: adapter.id,
      label: adapter.label,
      normalizationProfile: adapter.normalizationProfile,
      contentKind: adapter.contentKind,
      sensitivity: adapter.policy.sensitivity,
      capabilities: {
        discover: true,
        fetch: true,
        relevance: true,
        normalize: true
      },
      policy: adapter.policy
    });
  });
  const fallbackIndex = adapters.findIndex((adapter) => adapter.id === "generic-transcript");
  if (fallbackIndex !== adapters.length - 1) throw new Error("Learn v2 generic-transcript adapter must remain last fallback adapter.");
  return contracts;
}

export async function readLearnV2Surface(sourcePathInput: string, adapterId?: string): Promise<LearnV2SurfaceRead> {
  const sourcePath = path.resolve(sourcePathInput);
  const rawText = await fs.readFile(sourcePath, "utf8");
  const explicit = adapterId ? learnV2SurfaceAdapters.find((adapter) => adapter.id === adapterId) : undefined;
  if (adapterId && !explicit) throw new Error(`Unknown Learn v2 surface adapter: ${adapterId}`);
  if (explicit) {
    return explicit.read(sourcePath, rawText, {
      matchedBy: "explicit",
      confidence: "high",
      reasons: [`explicit-adapter:${adapterId}`]
    });
  }
  for (const adapter of learnV2SurfaceAdapters) {
    const detection = adapter.detect(sourcePath, rawText);
    if (detection) return adapter.read(sourcePath, rawText, detection);
  }
  const fallback = learnV2SurfaceAdapters.find((item) => item.id === "generic-transcript")!;
  return fallback.read(sourcePath, rawText, fallback.detect(sourcePath, rawText));
}

function makeAdapter(
  id: string,
  label: string,
  normalizationProfile: LearnV2SurfaceNormalizationProfile,
  pathPattern: RegExp,
  contentKind?: LearnV2SurfaceRead["contentKind"],
  sensitivity: LearnV2SurfaceAdapterPolicy["sensitivity"] = "high",
  notes: string[] = [],
  contentPattern: RegExp | false | undefined = undefined
): LearnV2SurfaceAdapter {
  const policy = rawSurfacePolicy(sensitivity, notes);
  return {
    id,
    label,
    normalizationProfile,
    contentKind,
    policy,
    detect: (sourcePath, rawText) => {
      const filename = path.basename(sourcePath);
      if (pathPattern.test(filename)) {
        return {
          matchedBy: "filename",
          confidence: "high",
          reasons: [`filename:${filename}`]
        };
      }
      const textPattern = contentPattern === false ? undefined : contentPattern ?? pathPattern;
      if (textPattern?.test(rawText.slice(0, 1000))) {
        return {
          matchedBy: "content",
          confidence: "medium",
          reasons: ["content-prefix"]
        };
      }
      return undefined;
    },
    read: (sourcePath, rawText, detection) => LearnV2SurfaceReadSchema.parse({
      adapterId: id,
      adapterLabel: label,
      adapterDetection: detection,
      sourcePath,
      contentKind: contentKind ?? inferContentKind(sourcePath, rawText),
      rawText,
      detectedFormat: detectSurfaceFormat(sourcePath, rawText),
      normalizationProfile,
      policy
    })
  };
}

function rawSurfacePolicy(sensitivity: LearnV2SurfaceAdapterPolicy["sensitivity"], notes: string[]): LearnV2SurfaceAdapterPolicy {
  return {
    selection: "explicit-only",
    read: "raw-local-file",
    learnerInput: "raw-local-in-memory",
    persistence: "preview-artifacts-or-apply-vault",
    modelBoundary: "declassified-only",
    rawRefsExportable: false,
    sensitivity,
    notes
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
