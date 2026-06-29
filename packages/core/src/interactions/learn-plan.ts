import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { detectAgentEnvironment } from "../detection/detector.js";
import { appendEvent } from "../events/store.js";
import type { OpenSkillEvent } from "../events/schema.js";
import { runLifecycleOnce, type LifecycleRunnerResult } from "../lifecycle/runner.js";
import { buildReviewQueue } from "../preferences/proposals.js";
import { inspectGitLocalContext, type GitLocalContextResult } from "./git-local.js";
import { importInteractionSource, readInteractionImportRuns, type InteractionImportRun } from "./importer.js";

export const OPENCODE_AMBIENT_LOG_RELATIVE_PATH = ".openskill-kit/ambient/opencode-events.jsonl";

export const LearnSourcePolicySchema = z.enum(["safe-metadata", "explicit-import", "blocked"]);
export type LearnSourcePolicy = z.infer<typeof LearnSourcePolicySchema>;

export const LearnSourceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  adapter: z.string().min(1),
  policy: LearnSourcePolicySchema,
  defaultSelected: z.boolean(),
  approvalRequired: z.boolean(),
  reason: z.string().min(1),
  path: z.string().optional(),
  privacy: z.object({
    rawPromptRead: z.boolean(),
    rawDiffRead: z.boolean(),
    rawTranscriptCopied: z.boolean(),
    notes: z.array(z.string()).default([])
  })
});
export type LearnSourceOption = z.infer<typeof LearnSourceOptionSchema>;

export const LearnSourcePlanSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-source-plan.v1"),
  projectRoot: z.string().min(1),
  generatedAt: z.string().datetime(),
  sourceMode: z.enum(["ask", "all-detected", "selected"]).default("ask"),
  options: z.array(LearnSourceOptionSchema),
  question: z.object({
    prompt: z.string(),
    choices: z.array(z.object({
      id: z.string(),
      label: z.string(),
      approvalRequired: z.boolean()
    }))
  }),
  defaults: z.object({
    selectedSourceIds: z.array(z.string()),
    previewOnly: z.boolean(),
    projectLocal: z.boolean(),
    runReviewAfterLearning: z.boolean()
  }),
  summary: z.object({
    total: z.number().int().min(0),
    safeMetadata: z.number().int().min(0),
    explicitImport: z.number().int().min(0),
    blocked: z.number().int().min(0),
    previousImportRuns: z.number().int().min(0)
  }),
  privacyPreview: z.array(z.string()),
  nextActions: z.array(z.string())
});
export type LearnSourcePlan = z.infer<typeof LearnSourcePlanSchema>;

export const LearnRunSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-run.v1"),
  projectRoot: z.string().min(1),
  generatedAt: z.string().datetime(),
  plan: LearnSourcePlanSchema,
  selectedSourceIds: z.array(z.string()),
  previewOnly: z.boolean(),
  importRuns: z.array(z.any()),
  safeMetadata: z.object({
    git: z.any().optional(),
    opencode: z.any().optional(),
    eventIds: z.array(z.string())
  }),
  lifecycle: z.any().optional(),
  digest: z.object({
    sourcesConsidered: z.number().int().min(0),
    sourcesUsed: z.number().int().min(0),
    eventsAppended: z.number().int().min(0),
    signalsExtracted: z.number().int().min(0),
    candidatePreferences: z.number().int().min(0),
    candidateWorkflows: z.number().int().min(0),
    highRiskItems: z.number().int().min(0),
    reviewMarkdownPath: z.string().optional()
  }),
  privacy: z.array(z.string()),
  nextActions: z.array(z.string())
});
export type LearnRun = z.infer<typeof LearnRunSchema>;

export async function planLearningSources(
  projectRoot: string,
  options: { sourceMode?: "ask" | "all-detected" | "selected"; selectedSourceIds?: string[]; homeDir?: string; now?: Date } = {}
): Promise<LearnSourcePlan> {
  const report = await detectAgentEnvironment(projectRoot, { includeUserSurfaces: true, homeDir: options.homeDir, now: options.now });
  const imports = await readInteractionImportRuns(projectRoot);
  const sources: LearnSourceOption[] = [
    source("current-session", "Current session safe summary", "current-session", "safe-metadata", true, "Use task finish summaries and safe event metadata already recorded by OSK."),
    source("git-local", "Git metadata only", "git-local", "safe-metadata", true, "Use branch, changed file names, diff stats, and recent commit metadata without raw diffs.")
  ];
  const opencodeAmbient = await inspectOpenCodeAmbientMetadata(projectRoot);
  if (opencodeAmbient.available) {
    sources.push(source(
      "opencode-ambient",
      "OpenCode ambient metadata",
      "opencode",
      "safe-metadata",
      true,
      `Use ${opencodeAmbient.eventCount} metadata-only OpenCode hook events from ${OPENCODE_AMBIENT_LOG_RELATIVE_PATH}; no raw prompts or raw diffs.`,
      opencodeAmbient.path
    ));
  }

  for (const surface of report.surfaces) {
    if (surface.surfaceType === "interaction-export") {
      sources.push(source(`explicit:${surface.id}`, `Explicit import: ${surface.relativePath ?? surface.path}`, surface.adapter, "explicit-import", false, "Session/export files require preview and explicit apply before learning.", surface.path));
    }
    if (surface.surfaceType === "memory-store") {
      sources.push(source(`blocked:${surface.id}`, `Blocked memory store: ${surface.relativePath ?? surface.path}`, surface.adapter, "blocked", false, "Raw memory stores are metadata-only and must not be imported silently.", surface.path));
    }
  }

  const parsed = sources.map((item) => LearnSourceOptionSchema.parse(item));
  if (options.selectedSourceIds?.length) {
    const selectionIssue = explainSelectionIssue(options.selectedSourceIds, parsed);
    if (selectionIssue) throw new Error(selectionIssue);
  }
  const selectedSourceIds = options.selectedSourceIds?.length
    ? options.selectedSourceIds.filter((id) => parsed.some((item) => item.id === id && item.policy !== "blocked"))
    : options.sourceMode === "all-detected"
      ? parsed.filter((item) => item.policy === "safe-metadata").map((item) => item.id)
      : parsed.filter((item) => item.defaultSelected).map((item) => item.id);

  return LearnSourcePlanSchema.parse({
    schemaVersion: "openskill-kit.learn-source-plan.v1",
    projectRoot,
    generatedAt: (options.now ?? new Date()).toISOString(),
    sourceMode: options.sourceMode ?? "ask",
    options: parsed,
    question: {
      prompt: "What should OpenSkillKit learn from?",
      choices: parsed.filter((item) => item.policy !== "blocked").map((item) => ({
        id: item.id,
        label: item.label,
        approvalRequired: item.approvalRequired
      }))
    },
    defaults: {
      selectedSourceIds,
      previewOnly: true,
      projectLocal: true,
      runReviewAfterLearning: true
    },
    summary: {
      total: parsed.length,
      safeMetadata: parsed.filter((item) => item.policy === "safe-metadata").length,
      explicitImport: parsed.filter((item) => item.policy === "explicit-import").length,
      blocked: parsed.filter((item) => item.policy === "blocked").length,
      previousImportRuns: imports.length
    },
    privacyPreview: [
      "No raw prompts are read by default.",
      "No raw diffs are read by default.",
      "Session/export files require preview before apply.",
      "User/global memories and shell history paths are blocked unless the user supplies an explicit export/file.",
      "Learned behavior remains staged for review."
    ],
    nextActions: [
      parsed.some((item) => item.policy === "explicit-import")
        ? "Preview explicit imports before applying any learning source plan."
        : "Run learning from selected safe metadata sources, then review candidates.",
      "After learning, run `/osk review`; activation stays review-gated."
    ]
  });
}

export async function runLearningPlan(
  projectRoot: string,
  options: {
    sourceMode?: "ask" | "all-detected" | "selected";
    selectedSourceIds?: string[];
    previewOnly?: boolean;
    maxEvents?: number;
    allowDuplicateImports?: boolean;
    homeDir?: string;
    now?: Date;
  } = {}
): Promise<LearnRun> {
  const plan = await planLearningSources(projectRoot, {
    sourceMode: options.sourceMode ?? (options.selectedSourceIds?.length ? "selected" : "ask"),
    selectedSourceIds: options.selectedSourceIds,
    homeDir: options.homeDir,
    now: options.now
  });
  const previewOnly = options.previewOnly !== false;
  const requested = options.selectedSourceIds?.length ? options.selectedSourceIds : plan.defaults.selectedSourceIds;
  const selectionIssue = explainSelectionIssue(requested, plan.options);
  if (selectionIssue) throw new Error(selectionIssue);
  const selected = requested.filter((id) => plan.options.some((sourceOption) => sourceOption.id === id && sourceOption.policy !== "blocked"));
  const selectedOptions = selected.map((id) => plan.options.find((sourceOption) => sourceOption.id === id)!).filter(Boolean);
  const importRuns: InteractionImportRun[] = [];
  const safeEventIds: string[] = [];
  let git: GitLocalContextResult | undefined;
  let opencode: OpenCodeAmbientAppendResult | undefined;

  for (const sourceOption of selectedOptions) {
    if (sourceOption.policy === "explicit-import" && sourceOption.path) {
      importRuns.push(await importInteractionSource(projectRoot, sourceOption.path, {
        adapter: sourceOption.adapter === "other" ? "manual-import" : sourceOption.adapter,
        dryRun: previewOnly,
        maxEvents: options.maxEvents ?? 200,
        allowDuplicate: options.allowDuplicateImports === true,
        now: options.now
      }));
    }
    if (sourceOption.id === "git-local" && !previewOnly) {
      git = await inspectGitLocalContext(projectRoot);
      const appended = await appendEvent(projectRoot, {
        sessionId: "osk-learn-git-local",
        eventType: "post-tool-use",
        source: { adapter: "git-local" },
        intent: "Learn from git metadata only.",
        normalized: {
          adapter: "git-local",
          rawDiffIncluded: false,
          repository: git.repository,
          summary: git.summary,
          recentCommitSubjects: git.recentCommits.map((commit) => commit.subject)
        },
        files: git.changedFiles.map((file) => ({ path: file.path, action: "unknown" as const })),
        commands: [{ command: "git status --porcelain && git diff --numstat", status: git.warnings.length ? "unknown" : "pass" }],
        privacy: { redacted: false, rawStored: false, containsUserText: false, containsCode: false }
      });
      safeEventIds.push(appended.event.id);
    }
    if (sourceOption.id === "opencode-ambient" && !previewOnly) {
      opencode = await appendOpenCodeAmbientEvents(projectRoot, { maxEvents: options.maxEvents ?? 200, now: options.now });
      safeEventIds.push(...opencode.eventIds);
    }
  }

  const eventsAppended = safeEventIds.length + importRuns.reduce((sum, run) => sum + run.appendedEventCount, 0);
  const lifecycle: LifecycleRunnerResult | undefined = previewOnly
    ? undefined
    : await runLifecycleOnce({ projectRoot, maxEvents: options.maxEvents ?? 250, compileSafe: false, now: options.now });
  const review = lifecycle ? await buildReviewQueue(projectRoot) : undefined;
  return LearnRunSchema.parse({
    schemaVersion: "openskill-kit.learn-run.v1",
    projectRoot,
    generatedAt: (options.now ?? new Date()).toISOString(),
    plan,
    selectedSourceIds: selected,
    previewOnly,
    importRuns,
    safeMetadata: { git, opencode, eventIds: safeEventIds },
    lifecycle,
    digest: {
      sourcesConsidered: plan.options.length,
      sourcesUsed: selectedOptions.length,
      eventsAppended,
      signalsExtracted: lifecycle?.signals.signalCount ?? 0,
      candidatePreferences: lifecycle?.graph.candidateCount ?? 0,
      candidateWorkflows: review?.workflowCandidates.length ?? 0,
      highRiskItems: review?.candidates.filter((item) => item.privacy?.class === "user-private" || item.privacy?.class === "global-private").length ?? 0,
      reviewMarkdownPath: review?.markdownPath
    },
    privacy: [
      "No raw prompts, raw diffs, secrets, or hidden benchmark answers were copied.",
      "Explicit imports used dry-run preview unless previewOnly=false.",
      "Git learning uses metadata only and never raw diff hunks.",
      "OpenCode ambient learning uses whitelisted hook metadata only and never raw message text or raw diffs.",
      "Learned behavior remains candidate/staged until `/osk review`."
    ],
    nextActions: previewOnly
      ? ["Preview complete. Re-run with previewOnly=false only after approving selected explicit imports.", "Then run `/osk review`; activation remains review-gated."]
      : ["Learning run complete. Run `/osk review` before compiling or deploying behavior.", "Run `/osk compile` only after review accepts desired behavior."]
  });
}

function explainSelectionIssue(requested: string[], options: LearnSourceOption[]): string | undefined {
  const known = new Set(options.map((sourceOption) => sourceOption.id));
  const blocked = new Set(options.filter((sourceOption) => sourceOption.policy === "blocked").map((sourceOption) => sourceOption.id));
  const invalidIds = requested.filter((id) => !known.has(id));
  const blockedIds = requested.filter((id) => blocked.has(id));
  if (!invalidIds.length && !blockedIds.length) return undefined;
  const supported = options.filter((sourceOption) => sourceOption.policy !== "blocked").map((sourceOption) => sourceOption.id);
  const blockedLabels = options
    .filter((sourceOption) => blockedIds.includes(sourceOption.id))
    .map((sourceOption) => `${sourceOption.id} (${sourceOption.reason})`);
  return [
    invalidIds.length ? `Unknown learning source(s): ${invalidIds.join(", ")}.` : "",
    blockedLabels.length ? `Blocked learning source(s): ${blockedLabels.join("; ")}.` : "",
    `Supported source ids: ${supported.join(", ") || "none"}.`
  ].filter(Boolean).join(" ");
}

interface OpenCodeAmbientInspection {
  available: boolean;
  path: string;
  eventCount: number;
}

interface OpenCodeAmbientAppendResult {
  path: string;
  readCount: number;
  appendedCount: number;
  skippedCount: number;
  eventIds: string[];
}

async function inspectOpenCodeAmbientMetadata(projectRoot: string): Promise<OpenCodeAmbientInspection> {
  const file = path.join(path.resolve(projectRoot), OPENCODE_AMBIENT_LOG_RELATIVE_PATH);
  const text = await fs.readFile(file, "utf8").catch(() => "");
  const eventCount = text.split(/\r?\n/).filter((line) => line.trim()).length;
  return { available: eventCount > 0, path: file, eventCount };
}

async function appendOpenCodeAmbientEvents(projectRoot: string, options: { maxEvents: number; now?: Date }): Promise<OpenCodeAmbientAppendResult> {
  const file = path.join(path.resolve(projectRoot), OPENCODE_AMBIENT_LOG_RELATIVE_PATH);
  const text = await fs.readFile(file, "utf8").catch(() => "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const selected = lines.slice(-Math.max(0, options.maxEvents));
  const eventIds: string[] = [];
  let skippedCount = lines.length - selected.length;
  for (const line of selected) {
    const record = parseOpenCodeAmbientRecord(line);
    if (!record) {
      skippedCount += 1;
      continue;
    }
    const appended = await appendEvent(projectRoot, {
      sessionId: "osk-learn-opencode-ambient",
      eventType: mapOpenCodeAmbientEventType(record.eventType, record.metadata),
      timestamp: timestampOrUndefined(record.metadata.timestamp) ?? record.capturedAt ?? options.now?.toISOString(),
      source: { adapter: "opencode-ambient", host: "opencode" },
      intent: `Learn from OpenCode metadata-only hook event: ${record.eventType}.`,
      normalized: {
        adapter: "opencode",
        source: "opencode-plugin",
        eventType: record.eventType,
        rawPromptIncluded: false,
        rawDiffIncluded: false,
        metadata: record.metadata
      },
      files: typeof record.metadata.path === "string" ? [{ path: record.metadata.path, action: "unknown" as const }] : [],
      commands: typeof record.metadata.command === "string"
        ? [{ command: record.metadata.command, status: statusFromMetadata(record.metadata.status) }]
        : [],
      privacy: { redacted: false, rawStored: false, containsUserText: false, containsCode: false }
    });
    eventIds.push(appended.event.id);
  }
  return { path: file, readCount: lines.length, appendedCount: eventIds.length, skippedCount, eventIds };
}

function parseOpenCodeAmbientRecord(line: string): { eventType: string; capturedAt?: string; metadata: Record<string, unknown> } | undefined {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const eventType = typeof parsed.eventType === "string" ? parsed.eventType : undefined;
    const metadata = parsed.metadata && typeof parsed.metadata === "object" && !Array.isArray(parsed.metadata)
      ? sanitizeOpenCodeMetadata(parsed.metadata as Record<string, unknown>)
      : {};
    if (!eventType) return undefined;
    return {
      eventType,
      capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : undefined,
      metadata
    };
  } catch {
    return undefined;
  }
}

function sanitizeOpenCodeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["id", "type", "tool", "command", "path", "status", "decision", "timestamp"]) {
    const value = metadata[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value;
  }
  return out;
}

function mapOpenCodeAmbientEventType(eventType: string, metadata: Record<string, unknown>): OpenSkillEvent["eventType"] {
  if (eventType === "session-start") return "session-start";
  if (eventType === "pre-tool-use" || eventType === "permission-request" || eventType === "command-intent") return "pre-tool-use";
  if (eventType === "post-tool-use") return metadata.status === "fail" ? "post-tool-use-failure" : "post-tool-use";
  if (eventType === "file-changed" || eventType === "diff-stats") return "file-changed";
  if (eventType === "permission-decision") {
    const decision = String(metadata.decision ?? "").toLowerCase();
    if (/deny|reject|block/.test(decision)) return "permission-denied";
    if (/allow|approve|accept/.test(decision)) return "user-accepted";
  }
  if (eventType === "finish-task-suggestion") return "task-completed";
  return "assistant-message";
}

function statusFromMetadata(value: unknown): "pass" | "fail" | "blocked" | "timeout" | "unknown" {
  const status = String(value ?? "").toLowerCase();
  if (status === "pass" || status === "success" || status === "ok") return "pass";
  if (status === "fail" || status === "failed" || status === "error") return "fail";
  if (status === "blocked" || status === "denied") return "blocked";
  if (status === "timeout") return "timeout";
  return "unknown";
}

function timestampOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : new Date(value).toISOString();
}

function source(id: string, label: string, adapter: string, policy: LearnSourcePolicy, defaultSelected: boolean, reason: string, sourcePath?: string): LearnSourceOption {
  return {
    id,
    label,
    adapter,
    policy,
    defaultSelected,
    approvalRequired: policy === "explicit-import",
    reason,
    path: sourcePath,
    privacy: {
      rawPromptRead: false,
      rawDiffRead: false,
      rawTranscriptCopied: false,
      notes: policy === "blocked"
        ? ["Blocked by ambient-not-silent learning policy."]
        : policy === "explicit-import"
          ? ["Dry-run preview required before appending redacted events."]
          : ["Metadata-only source can be planned without import approval."]
    }
  };
}
