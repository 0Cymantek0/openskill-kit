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

export const LearnV2SurfaceCandidateSchema = z.object({
  id: z.string().min(1),
  adapterId: z.string().min(1),
  adapterLabel: z.string().min(1),
  relativePath: z.string().min(1),
  path: z.string().min(1),
  contentKind: LearnV2SurfaceReadSchema.shape.contentKind,
  normalizationProfile: LearnV2SurfaceNormalizationProfileSchema,
  sensitivity: z.enum(["low", "medium", "high"]),
  detectedFormat: LearnV2SurfaceReadSchema.shape.detectedFormat.optional(),
  detection: LearnV2SurfaceReadSchema.shape.adapterDetection.unwrap(),
  policy: LearnV2SurfaceReadSchema.shape.policy.unwrap(),
  score: z.number().min(0).max(1),
  sortKey: z.string().min(1)
});
export type LearnV2SurfaceCandidate = z.infer<typeof LearnV2SurfaceCandidateSchema>;

export const LearnV2SurfaceDiscoveryReportSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.raw-surface-discovery.v1"),
  scannedFiles: z.number().int().min(0),
  maxFiles: z.number().int().min(0),
  maxDepth: z.number().int().min(0),
  candidateLimit: z.number().int().min(0),
  candidatesFound: z.number().int().min(0),
  candidatesReturned: z.number().int().min(0),
  truncatedByMaxFiles: z.boolean(),
  truncatedByLimit: z.boolean(),
  knownSurfaceFilesSkipped: z.number().int().min(0),
  allowedHiddenExportDirs: z.array(z.string()),
  blockedHiddenDirs: z.array(z.string()),
  adapterCounts: z.record(z.string(), z.number().int().min(0)),
  sensitivityCounts: z.record(z.string(), z.number().int().min(0)),
  matchedByCounts: z.record(z.string(), z.number().int().min(0)),
  confidenceCounts: z.record(z.string(), z.number().int().min(0)),
  policy: z.object({
    plannerInput: z.literal("path-metadata-only"),
    normalPlanSelection: z.literal("blocked"),
    rawImport: z.literal("explicit-command-only"),
    modelBoundary: z.literal("declassified-only")
  }),
  notes: z.array(z.string())
});
export type LearnV2SurfaceDiscoveryReport = z.infer<typeof LearnV2SurfaceDiscoveryReportSchema>;

export interface LearnV2SurfaceAdapter {
  id: string;
  label: string;
  normalizationProfile: LearnV2SurfaceNormalizationProfile;
  contentKind?: LearnV2SurfaceRead["contentKind"];
  policy: LearnV2SurfaceAdapterPolicy;
  detect(sourcePath: string, rawText: string): LearnV2SurfaceAdapterDetection | undefined;
  read(sourcePath: string, rawText: string, detection?: LearnV2SurfaceAdapterDetection): LearnV2SurfaceRead;
}

export interface LearnV2SurfaceDiscoveryOptions {
  knownSurfacePaths?: Set<string>;
  maxFiles?: number;
  maxDepth?: number;
  limit?: number;
}

const RAW_LOCAL_SOURCE_SCAN_MAX_FILES = 2500;
const RAW_LOCAL_SOURCE_SCAN_MAX_DEPTH = 5;
const RAW_LOCAL_SOURCE_CANDIDATE_LIMIT = 12;
const RAW_LOCAL_SOURCE_EXTENSIONS = new Set([".jsonl", ".json", ".md", ".txt", ".log", ".patch", ".diff"]);
const RAW_LOCAL_SOURCE_SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".openskill-kit",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "tmp",
  "temp",
  ".next",
  ".turbo",
  ".cache",
  ".vite"
]);
const RAW_LOCAL_SOURCE_ALLOWED_HIDDEN_DIRS = [
  ".codex-log",
  ".codex/sessions",
  ".codex/transcripts",
  ".claude/projects",
  ".claude/sessions",
  ".cursor/chats",
  ".cursor/sessions",
  ".gemini/sessions",
  ".gemini/transcripts",
  ".roo/chats",
  ".roo/sessions",
  ".roo-code/chats",
  ".roo-code/sessions",
  ".kilo/chats",
  ".kilo/sessions",
  ".kilo-code/chats",
  ".kilo-code/sessions",
  ".cline/chats",
  ".cline/sessions",
  ".goose/sessions",
  ".zed/agent-sessions",
  ".zed/sessions",
  ".zed/transcripts",
  ".opencode/sessions",
  ".opencode/traces"
];
const RAW_LOCAL_SOURCE_BLOCKED_HIDDEN_DIRS = [
  ".codex/memories",
  ".codex/memory",
  ".claude/memories",
  ".claude/memory",
  ".cursor/memories",
  ".cursor/memory",
  ".gemini/memories",
  ".gemini/memory",
  ".roo/memories",
  ".roo/memory",
  ".roo-code/memories",
  ".roo-code/memory",
  ".kilo/memories",
  ".kilo/memory",
  ".kilo-code/memories",
  ".kilo-code/memory",
  ".cline/memories",
  ".cline/memory",
  ".goose/memories",
  ".goose/memory",
  ".zed/memories",
  ".zed/memory"
];

export const learnV2SurfaceAdapters: LearnV2SurfaceAdapter[] = [
  makeAdapter("opencode", "OpenCode session or trace", "structured-events", /opencode|opencode-events|opencode-session|opencode-trace|tool\.execute|provider:\s*opencode/i, undefined, "high", ["Conversation/tool traces may include prompts, paths, commands, and outputs."]),
  makeAdapter("codex", "Codex transcript", "structured-events", /codex/i, undefined, "high", ["Conversation transcripts may include prompts, paths, commands, and outputs."]),
  makeAdapter("claude-code", "Claude Code transcript", "structured-events", /claude/i, undefined, "high", ["Conversation transcripts may include prompts, paths, commands, and outputs."]),
  makeAdapter("cursor", "Cursor transcript", "structured-events", /cursor/i, undefined, "high", ["Conversation transcripts may include prompts, paths, commands, and outputs."]),
  makeAdapter("gemini", "Gemini CLI transcript", "structured-events", /gemini/i, undefined, "high", ["Conversation transcripts may include prompts, paths, commands, and outputs."]),
  makeAdapter("roo", "Roo Code transcript", "structured-events", /\broo(?:[-_. ]?code)?\b/i, undefined, "high", ["Conversation transcripts may include prompts, paths, commands, and outputs."]),
  makeAdapter("kilo", "Kilo Code transcript", "structured-events", /\bkilo(?:[-_. ]?code)?\b/i, undefined, "high", ["Conversation transcripts may include prompts, paths, commands, and outputs."]),
  makeAdapter("cline", "Cline transcript", "structured-events", /\bcline\b/i, undefined, "high", ["Conversation transcripts may include prompts, paths, commands, and outputs."]),
  makeAdapter("goose", "Goose transcript", "structured-events", /\bgoose\b/i, undefined, "high", ["Conversation transcripts may include prompts, paths, commands, and outputs."]),
  makeAdapter("zed", "Zed agent transcript", "structured-events", /\bzed(?:[-_. ]?agent)?\b/i, undefined, "high", ["Conversation transcripts may include prompts, paths, commands, and outputs."]),
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

export async function discoverLearnV2SurfaceCandidates(
  projectRootInput: string,
  options: LearnV2SurfaceDiscoveryOptions = {}
): Promise<LearnV2SurfaceCandidate[]> {
  return (await discoverLearnV2SurfaceCandidateReport(projectRootInput, options)).candidates;
}

export async function discoverLearnV2SurfaceCandidateReport(
  projectRootInput: string,
  options: LearnV2SurfaceDiscoveryOptions = {}
): Promise<{ candidates: LearnV2SurfaceCandidate[]; report: LearnV2SurfaceDiscoveryReport }> {
  const projectRoot = path.resolve(projectRootInput);
  const knownSurfacePaths = options.knownSurfacePaths ?? new Set<string>();
  const candidates: LearnV2SurfaceCandidate[] = [];
  const maxFiles = options.maxFiles ?? RAW_LOCAL_SOURCE_SCAN_MAX_FILES;
  const maxDepth = options.maxDepth ?? RAW_LOCAL_SOURCE_SCAN_MAX_DEPTH;
  const limit = options.limit ?? RAW_LOCAL_SOURCE_CANDIDATE_LIMIT;
  let visitedFiles = 0;
  let knownSurfaceFilesSkipped = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (visitedFiles >= maxFiles || depth > maxDepth) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipRawLocalSourceDir(projectRoot, fullPath, entry.name)) continue;
        await walk(fullPath, depth + 1);
        if (visitedFiles >= maxFiles) return;
        continue;
      }
      if (!entry.isFile()) continue;
      visitedFiles += 1;
      if (visitedFiles > maxFiles) return;
      if (knownSurfacePaths.has(path.resolve(fullPath).toLowerCase())) {
        knownSurfaceFilesSkipped += 1;
        continue;
      }
      const candidate = discoverLearnV2SurfaceCandidate(projectRoot, fullPath);
      if (candidate) candidates.push(candidate);
    }
  }

  await walk(projectRoot, 0);
  const sorted = candidates.sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath));
  const limited = sorted.slice(0, limit);
  const report = LearnV2SurfaceDiscoveryReportSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.raw-surface-discovery.v1",
    scannedFiles: Math.min(visitedFiles, maxFiles),
    maxFiles,
    maxDepth,
    candidateLimit: limit,
    candidatesFound: sorted.length,
    candidatesReturned: limited.length,
    truncatedByMaxFiles: visitedFiles >= maxFiles,
    truncatedByLimit: sorted.length > limited.length,
    knownSurfaceFilesSkipped,
    allowedHiddenExportDirs: [...RAW_LOCAL_SOURCE_ALLOWED_HIDDEN_DIRS],
    blockedHiddenDirs: [...RAW_LOCAL_SOURCE_BLOCKED_HIDDEN_DIRS],
    adapterCounts: countValues(limited.map((candidate) => candidate.adapterId)),
    sensitivityCounts: countValues(limited.map((candidate) => candidate.sensitivity)),
    matchedByCounts: countValues(limited.map((candidate) => candidate.detection.matchedBy)),
    confidenceCounts: countValues(limited.map((candidate) => candidate.detection.confidence)),
    policy: {
      plannerInput: "path-metadata-only",
      normalPlanSelection: "blocked",
      rawImport: "explicit-command-only",
      modelBoundary: "declassified-only"
    },
    notes: [
      "Source planning never opens raw local candidate files; it scores path, extension, and adapter filename/export-dir metadata only.",
      "Normal /osk learn plans keep raw-local candidates blocked so they cannot be selected accidentally.",
      "Raw candidate import requires the suggested --raw --surface-file command and keeps model-facing output declassified-only."
    ]
  });
  return { candidates: limited, report };
}

export function discoverLearnV2SurfaceCandidate(projectRootInput: string, sourcePathInput: string): LearnV2SurfaceCandidate | undefined {
  const projectRoot = path.resolve(projectRootInput);
  const sourcePath = path.resolve(sourcePathInput);
  const relativePath = path.relative(projectRoot, sourcePath).replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return undefined;
  const extension = path.extname(sourcePath).toLowerCase();
  if (!RAW_LOCAL_SOURCE_EXTENSIONS.has(extension)) return undefined;
  if (isLowValueRawLocalCandidate(relativePath)) return undefined;
  const pathAdapter = detectLearnV2SurfaceAdapterByPath(sourcePath);
  const relativeAdapter = detectLearnV2SurfaceAdapterByProjectRelativePath(relativePath);
  const adapter = pathAdapter?.id === "generic-transcript" ? relativeAdapter ?? pathAdapter : pathAdapter ?? relativeAdapter;
  if (!adapter) return undefined;
  const detection = adapter.detect(sourcePath, "") ?? exportDirDetection(relativePath, adapter.id) ?? {
    matchedBy: "filename" as const,
    confidence: "low" as const,
    reasons: [`extension:${extension || "none"}`]
  };
  const score = rawLocalSourceCandidateScore(relativePath, adapter, detection);
  if (score <= 0) return undefined;
  return LearnV2SurfaceCandidateSchema.parse({
    id: rawLocalSourceCandidateId(relativePath),
    adapterId: adapter.id,
    adapterLabel: adapter.label,
    relativePath,
    path: sourcePath,
    contentKind: adapter.contentKind ?? contentKindFromExtension(extension),
    normalizationProfile: adapter.normalizationProfile,
    sensitivity: adapter.policy.sensitivity,
    detectedFormat: formatFromExtension(extension),
    detection,
    policy: adapter.policy,
    score,
    sortKey: `${String(Math.round((1 - score) * 1000)).padStart(4, "0")}:${relativePath}`
  });
}

export function detectLearnV2SurfaceAdapterByPath(sourcePathInput: string): LearnV2SurfaceAdapter | undefined {
  const sourcePath = path.resolve(sourcePathInput);
  for (const adapter of learnV2SurfaceAdapters) {
    const detection = adapter.detect(sourcePath, "");
    if (detection && detection.matchedBy === "filename") return adapter;
  }
  const extension = path.extname(sourcePath).toLowerCase();
  if (RAW_LOCAL_SOURCE_EXTENSIONS.has(extension)) return learnV2SurfaceAdapters.find((adapter) => adapter.id === "generic-transcript");
  return undefined;
}

function detectLearnV2SurfaceAdapterByProjectRelativePath(relativePathInput: string): LearnV2SurfaceAdapter | undefined {
  const relativePath = relativePathInput.replace(/\\/g, "/").toLowerCase();
  const adapterId =
    relativePath.startsWith(".codex-log/") || relativePath.startsWith(".codex/sessions/") || relativePath.startsWith(".codex/transcripts/")
      ? "codex"
      : relativePath.startsWith(".claude/projects/") || relativePath.startsWith(".claude/sessions/")
        ? "claude-code"
        : relativePath.startsWith(".cursor/chats/") || relativePath.startsWith(".cursor/sessions/")
          ? "cursor"
          : relativePath.startsWith(".gemini/sessions/") || relativePath.startsWith(".gemini/transcripts/")
            ? "gemini"
            : relativePath.startsWith(".roo/chats/") || relativePath.startsWith(".roo/sessions/") || relativePath.startsWith(".roo-code/chats/") || relativePath.startsWith(".roo-code/sessions/")
              ? "roo"
              : relativePath.startsWith(".kilo/chats/") || relativePath.startsWith(".kilo/sessions/") || relativePath.startsWith(".kilo-code/chats/") || relativePath.startsWith(".kilo-code/sessions/")
                ? "kilo"
                : relativePath.startsWith(".cline/chats/") || relativePath.startsWith(".cline/sessions/")
                  ? "cline"
                  : relativePath.startsWith(".goose/sessions/")
                    ? "goose"
                    : relativePath.startsWith(".zed/agent-sessions/") || relativePath.startsWith(".zed/sessions/") || relativePath.startsWith(".zed/transcripts/")
                      ? "zed"
                      : relativePath.startsWith(".opencode/sessions/") || relativePath.startsWith(".opencode/traces/")
                        ? "opencode"
                        : undefined;
  return adapterId ? learnV2SurfaceAdapters.find((adapter) => adapter.id === adapterId) : undefined;
}

function exportDirDetection(relativePathInput: string, adapterId: string): LearnV2SurfaceAdapterDetection | undefined {
  const relativePath = relativePathInput.replace(/\\/g, "/").toLowerCase();
  const prefix = RAW_LOCAL_SOURCE_ALLOWED_HIDDEN_DIRS.find((dir) => relativePath.startsWith(`${dir}/`) || relativePath === dir);
  if (!prefix) return undefined;
  return {
    matchedBy: "filename",
    confidence: "high",
    reasons: [`project-export-dir:${adapterId}:${prefix}`]
  };
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

function shouldSkipRawLocalSourceDir(projectRoot: string, fullPath: string, name: string): boolean {
  if (RAW_LOCAL_SOURCE_SKIP_DIRS.has(name) || name.startsWith(".pnpm")) return true;
  const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, "/").toLowerCase();
  if (RAW_LOCAL_SOURCE_BLOCKED_HIDDEN_DIRS.some((dir) => relativePath === dir || relativePath.startsWith(`${dir}/`))) return true;
  if (relativePath.startsWith(".")) return !isAllowedRawLocalHiddenPathOrAncestor(relativePath);
  if (relativePath.includes("/")) {
    return RAW_LOCAL_SOURCE_BLOCKED_HIDDEN_DIRS.some((dir) => relativePath === dir || relativePath.startsWith(`${dir}/`));
  }
  return false;
}

function isAllowedRawLocalHiddenPathOrAncestor(relativePath: string): boolean {
  return RAW_LOCAL_SOURCE_ALLOWED_HIDDEN_DIRS.some((dir) =>
    dir === relativePath
    || dir.startsWith(`${relativePath}/`)
    || relativePath.startsWith(`${dir}/`)
  );
}

function isLowValueRawLocalCandidate(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  if (/(^|\/)(package-lock|pnpm-lock|yarn.lock|bun.lockb|cargo.lock|poetry.lock)$/.test(lower)) return true;
  if (/(^|\/)(tsconfig|eslint|prettier|package)\.json$/.test(lower)) return true;
  if (/(^|\/)(license|changelog|changes)\.md$/.test(lower)) return true;
  return false;
}

function rawLocalSourceCandidateScore(
  relativePath: string,
  adapter: LearnV2SurfaceAdapter,
  detection: LearnV2SurfaceAdapterDetection
): number {
  const lower = relativePath.toLowerCase();
  let score = 0.18;
  if (detection.matchedBy === "filename") score += 0.22;
  if (detection.confidence === "high") score += 0.18;
  if (adapter.id !== "generic-transcript") score += 0.14;
  if (/(^|\/)(codex|claude|cursor|gemini|roo|kilo|cline|goose|zed|opencode|terminal|review|comments?|ci|logs?|plans?|docs?|handoff|summary)[^/]*\.(jsonl|json|md|txt|log|patch|diff)$/.test(lower)) score += 0.18;
  if (/\.(patch|diff|jsonl|log)$/.test(lower)) score += 0.08;
  if (/(^|\/)(logs?|traces?|sessions?|transcripts?|reviews?|plans?|docs?)\//.test(lower)) score += 0.08;
  if (/(^|\/)(readme|notes?)\.md$/.test(lower)) score += 0.04;
  return Math.min(1, Number(score.toFixed(2)));
}

function rawLocalSourceCandidateId(relativePath: string): string {
  return relativePath.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "candidate";
}

function contentKindFromExtension(extension: string): LearnV2SurfaceRead["contentKind"] {
  if (extension === ".diff" || extension === ".patch") return "diff";
  if (extension === ".log") return "log";
  if (extension === ".md") return "document";
  return "transcript";
}

function formatFromExtension(extension: string): LearnV2SurfaceRead["detectedFormat"] | undefined {
  if (extension === ".jsonl") return "jsonl";
  if (extension === ".json") return "json";
  if (extension === ".md") return "markdown";
  if (extension === ".diff" || extension === ".patch") return "diff";
  if (extension === ".log") return "log";
  if (extension === ".txt") return "plain";
  return undefined;
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

function countValues(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}
