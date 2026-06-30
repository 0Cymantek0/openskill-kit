import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { detectAgentEnvironment } from "../detection/detector.js";
import { appendEvent, readEvents, readProjectConfig } from "../events/store.js";
import { EventSchema, type OpenSkillEvent } from "../events/schema.js";
import { runLifecycleOnce, type LifecycleRunnerResult } from "../lifecycle/runner.js";
import { buildReviewQueue } from "../preferences/proposals.js";
import { summarizeAmbientLabelCandidates, updateAmbientLabelCandidates } from "../preferences/labels.js";
import { extractSignalsTransiently } from "../signals/extract.js";
import { writeJsonAtomic } from "../storage/atomic.js";
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
  preview: z.object({
    eventsRead: z.number().int().min(0),
    recordsRead: z.number().int().min(0).optional(),
    recordsSkipped: z.number().int().min(0).optional(),
    rawFieldsDetected: z.boolean(),
    rawFieldWarnings: z.array(z.string()),
    commandWorkflowSignals: z.number().int().min(0),
    fileTouchPatterns: z.number().int().min(0),
    candidatePreferences: z.number().int().min(0),
    candidateWorkflows: z.number().int().min(0),
    candidateBehavior: z.array(z.object({
      kind: z.enum(["preference", "workflow", "command-policy", "file-pattern"]),
      statement: z.string()
    })),
    labelCandidates: z.array(z.object({
      kind: z.enum(["command", "path"]),
      hash: z.string(),
      evidenceCount: z.number().int().min(0),
      status: z.enum(["candidate", "approved", "rejected"]),
      labelRequired: z.literal(true),
      metadata: z.record(z.string(), z.string().optional())
    })).default([])
  }).optional(),
  receipt: z.object({
    schemaVersion: z.literal("openskill-kit.learn-receipt.v1"),
    source: z.string(),
    eventsRead: z.number().int().min(0),
    rawFieldsDetected: z.boolean(),
    candidatePreferences: z.number().int().min(0),
    candidateWorkflows: z.number().int().min(0),
    reviewRequired: z.literal(true),
    nextCommand: z.literal("/osk review"),
    applied: z.boolean(),
    generatedAt: z.string().datetime()
  }).optional(),
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
    const ambientNotes = [
      "Reads: event types, tool names, command categories, command hashes, path categories, path hashes, file extensions, status, permission decisions.",
      "Does not read: raw commands, raw paths, prompts, diffs, outputs."
    ];
    if (opencodeAmbient.rawRecordCount > 0) ambientNotes.push(`Warning: ${opencodeAmbient.rawRecordCount} record(s) flagged containsRawFields or eval traceMode; raw values are NOT imported.`);
    if (opencodeAmbient.hasEvalTrace) ambientNotes.push("An eval trace file exists at .openskill-kit/evals/traces/; it is segregated from learning and never imported.");
    sources.push(source(
      "opencode-ambient",
      "OpenCode ambient metadata",
      "opencode",
      "safe-metadata",
      true,
      `Use ${opencodeAmbient.eventCount} metadata-only OpenCode hook events from ${OPENCODE_AMBIENT_LOG_RELATIVE_PATH}; no raw prompts or raw diffs.`,
      opencodeAmbient.path,
      ambientNotes
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
  const transientEvents: OpenSkillEvent[] = [];
  let ambientRecordsRead = 0;
  let ambientRecordsSkipped = 0;
  let ambientRawFieldsDetected = false;
  const ambientRawFieldWarnings: string[] = [];
  const labelCandidateSummaries: NonNullable<z.infer<typeof LearnRunSchema>["preview"]>["labelCandidates"] = [];
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
    if (sourceOption.id === "git-local") {
      git = await inspectGitLocalContext(projectRoot);
      const gitEventInput = {
        sessionId: "osk-learn-git-local",
        eventType: "post-tool-use" as const,
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
        commands: [{ command: "git status --porcelain && git diff --numstat", status: git.warnings.length ? "unknown" as const : "pass" as const }],
        privacy: { redacted: false, rawStored: false, containsUserText: false, containsCode: false }
      };
      if (previewOnly) {
        const ts = (options.now ?? new Date()).toISOString();
        const previewProjectId = `preview_${createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 16)}`;
        transientEvents.push(EventSchema.parse({
          schemaVersion: "openskill-kit.event.v1",
          id: `evt_preview_${createHash("sha256").update(`${previewProjectId}:osk-learn-git-local:post-tool-use:${ts}`).digest("hex").slice(0, 16)}`,
          projectId: previewProjectId,
          timestamp: ts,
          ...gitEventInput
        }));
      } else {
        const appended = await appendEvent(projectRoot, gitEventInput);
        safeEventIds.push(appended.event.id);
      }
    }
    if (sourceOption.id === "opencode-ambient") {
      if (previewOnly) {
        const file = path.join(path.resolve(projectRoot), OPENCODE_AMBIENT_LOG_RELATIVE_PATH);
        const text = await fs.readFile(file, "utf8").catch(() => "");
        const lines = text.split(/\r?\n/).filter((line) => line.trim());
        const parsed = parseOpenCodeAmbientEvents(projectRoot, lines, { maxEvents: options.maxEvents ?? 200, now: options.now });
        ambientRecordsRead += parsed.readCount;
        ambientRecordsSkipped += parsed.skippedCount;
        ambientRawFieldsDetected = ambientRawFieldsDetected || parsed.rawFieldsDetected;
        ambientRawFieldWarnings.push(...parsed.rawFieldWarnings);
        transientEvents.push(...parsed.events);
        labelCandidateSummaries.push(...summarizeAmbientLabelCandidates(parsed.events));
      } else {
        opencode = await appendOpenCodeAmbientEvents(projectRoot, { maxEvents: options.maxEvents ?? 200, now: options.now });
        safeEventIds.push(...opencode.eventIds);
        labelCandidateSummaries.push(...opencode.labelCandidates);
      }
    }
  }

  const eventsAppended = safeEventIds.length + importRuns.reduce((sum, run) => sum + run.appendedEventCount, 0);
  const lifecycle: LifecycleRunnerResult | undefined = previewOnly
    ? undefined
    : await runLifecycleOnce({ projectRoot, maxEvents: options.maxEvents ?? 250, compileSafe: false, now: options.now });
  const review = lifecycle ? await buildReviewQueue(projectRoot) : undefined;

  let preview: z.infer<typeof LearnRunSchema>["preview"] | undefined;
  if (previewOnly && (transientEvents.length > 0 || ambientRawFieldsDetected)) {
    const previewProjectId = `preview_${createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 16)}`;
    const signals = await extractSignalsTransiently(projectRoot, previewProjectId, transientEvents, options.now ?? new Date(), false);
    const commandWorkflowSignals = signals.filter((s) => s.category === "command-policy" || s.kind === "tool-choice").length;
    const fileTouchPatterns = signals.filter((s) => s.kind === "repo-pattern").length;
    const candidatePreferences = signals.filter((s) => s.kind === "explicit-preference" || s.kind === "acceptance" || s.kind === "rejection").length;
    const candidateWorkflows = signals.filter((s) => s.category === "command-policy").length;
    const candidateBehavior: Array<{ kind: "preference" | "workflow" | "command-policy" | "file-pattern"; statement: string }> = [];
    for (const signal of signals) {
      let kind: "preference" | "workflow" | "command-policy" | "file-pattern";
      if (signal.kind === "explicit-preference" || signal.kind === "acceptance" || signal.kind === "rejection") kind = "preference";
      else if (signal.category === "command-policy") kind = "command-policy";
      else if (signal.kind === "repo-pattern") kind = "file-pattern";
      else kind = "workflow";
      candidateBehavior.push({ kind, statement: signal.statement });
    }
    const opencodeAmbient = await inspectOpenCodeAmbientMetadata(projectRoot);
    preview = {
      eventsRead: transientEvents.length,
      recordsRead: ambientRecordsRead || undefined,
      recordsSkipped: ambientRecordsSkipped || undefined,
      rawFieldsDetected: ambientRawFieldsDetected || opencodeAmbient.rawRecordCount > 0,
      rawFieldWarnings: ambientRawFieldWarnings.length
        ? ambientRawFieldWarnings
        : opencodeAmbient.rawRecordCount > 0
          ? [`${opencodeAmbient.rawRecordCount} record(s) with containsRawFields or eval traceMode detected; raw values were NOT imported.`]
          : [],
      commandWorkflowSignals,
      fileTouchPatterns,
      candidatePreferences,
      candidateWorkflows,
      candidateBehavior,
      labelCandidates: labelCandidateSummaries
    };
  }

  const generatedAt = (options.now ?? new Date()).toISOString();
  const receiptData = {
    schemaVersion: "openskill-kit.learn-receipt.v1" as const,
    source: selected.join(", "),
    eventsRead: previewOnly ? transientEvents.length : eventsAppended,
    rawFieldsDetected: preview?.rawFieldsDetected ?? false,
    candidatePreferences: previewOnly ? (preview?.candidatePreferences ?? 0) : (lifecycle?.graph.candidateCount ?? 0),
    candidateWorkflows: previewOnly ? (preview?.candidateWorkflows ?? 0) : (review?.workflowCandidates.length ?? 0),
    reviewRequired: true as const,
    nextCommand: "/osk review" as const,
    applied: !previewOnly,
    generatedAt
  };
  const receiptPath = path.join(path.resolve(projectRoot), ".openskill-kit", "reviews", "learn-receipt.json");
  await fs.mkdir(path.dirname(receiptPath), { recursive: true });
  await writeJsonAtomic(receiptPath, receiptData);

  return LearnRunSchema.parse({
    schemaVersion: "openskill-kit.learn-run.v1",
    projectRoot,
    generatedAt,
    plan,
    selectedSourceIds: selected,
    previewOnly,
    importRuns,
    safeMetadata: { git, opencode, eventIds: safeEventIds },
    lifecycle,
    preview,
    receipt: receiptData,
    digest: {
      sourcesConsidered: plan.options.length,
      sourcesUsed: selectedOptions.length,
      eventsAppended,
      signalsExtracted: previewOnly ? (preview?.candidateBehavior.length ?? 0) : (lifecycle?.signals.signalCount ?? 0),
      candidatePreferences: previewOnly ? (preview?.candidatePreferences ?? 0) : (lifecycle?.graph.candidateCount ?? 0),
      candidateWorkflows: previewOnly ? (preview?.candidateWorkflows ?? 0) : (review?.workflowCandidates.length ?? 0),
      highRiskItems: review?.candidates.filter((item) => item.privacy?.class === "user-private" || item.privacy?.class === "global-private").length ?? 0,
      reviewMarkdownPath: review?.markdownPath
    },
    privacy: [
      "No raw prompts, raw diffs, secrets, or hidden benchmark answers were copied.",
      previewOnly
        ? "Preview mode: events were parsed transiently and never written to disk."
        : "Explicit imports used dry-run preview unless previewOnly=false.",
      "Git learning uses metadata only and never raw diff hunks.",
      "OpenCode ambient learning uses whitelisted hook metadata only and never raw message text or raw diffs.",
      "Learned behavior remains candidate/staged until `/osk review`."
    ],
    nextActions: previewOnly
      ? [
          "Preview complete. Review candidate behavior above.",
          "Re-run with previewOnly=false to apply (creates review candidates, not active behavior).",
          "Then run `/osk review` to activate."
        ]
      : [
          "Learning run complete. Run `/osk review` before compiling or deploying behavior.",
          "Run `/osk compile` only after review accepts desired behavior."
        ]
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
  rawRecordCount: number;
  hasEvalTrace: boolean;
}

interface OpenCodeAmbientAppendResult {
  path: string;
  readCount: number;
  appendedCount: number;
  skippedCount: number;
  eventIds: string[];
  labelCandidates: Array<{
    kind: "command" | "path";
    hash: string;
    evidenceCount: number;
    status: "candidate" | "approved" | "rejected";
    labelRequired: true;
    metadata: Record<string, string | undefined>;
  }>;
}

async function inspectOpenCodeAmbientMetadata(projectRoot: string): Promise<OpenCodeAmbientInspection> {
  const root = path.resolve(projectRoot);
  const file = path.join(root, OPENCODE_AMBIENT_LOG_RELATIVE_PATH);
  const text = await fs.readFile(file, "utf8").catch(() => "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  let rawRecordCount = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.containsRawFields === true || parsed.traceMode === "eval" || findRawProneAmbientKeyPaths(parsed).length > 0) rawRecordCount += 1;
    } catch { /* skip malformed */ }
  }
  const evalTracePath = path.join(root, ".openskill-kit", "evals", "traces", "opencode-events.raw.jsonl");
  const hasEvalTrace = await fs.stat(evalTracePath).then(() => true, () => false);
  return { available: lines.length > 0, path: file, eventCount: lines.length, rawRecordCount, hasEvalTrace };
}

interface OpenCodeAmbientParseResult {
  path: string;
  readCount: number;
  skippedCount: number;
  rawFieldsDetected: boolean;
  rawFieldWarnings: string[];
  events: OpenSkillEvent[];
}

function parseOpenCodeAmbientEvents(projectRoot: string, lines: string[], options: { maxEvents: number; now?: Date }): OpenCodeAmbientParseResult {
  const root = path.resolve(projectRoot);
  const file = path.join(root, OPENCODE_AMBIENT_LOG_RELATIVE_PATH);
  const selected = lines.slice(-Math.max(0, options.maxEvents));
  const events: OpenSkillEvent[] = [];
  let skippedCount = lines.length - selected.length;
  let rawFieldsDetected = false;
  const rawFieldWarnings: string[] = [];
  const projectId = `preview_${createHash("sha256").update(root).digest("hex").slice(0, 16)}`;
  for (const [index, line] of selected.entries()) {
    const record = parseOpenCodeAmbientRecord(line);
    if (!record) {
      skippedCount += 1;
      continue;
    }
    if (record.containsRawFields || record.traceMode === "eval" || record.rawKeyPaths.length > 0) {
      rawFieldsDetected = true;
      skippedCount += 1;
      rawFieldWarnings.push(record.rawKeyPaths.length
        ? `Record ${index}: containsRawFields=${record.containsRawFields}, traceMode=${record.traceMode ?? "safe"}; raw-prone key(s) ${record.rawKeyPaths.join(", ")} detected; values were NOT imported.`
        : `Record ${index}: containsRawFields=${record.containsRawFields}, traceMode=${record.traceMode ?? "safe"}; raw/eval-origin values were NOT imported.`);
      continue;
    }
    const ts = timestampOrUndefined(record.metadata.timestamp) ?? record.capturedAt ?? options.now?.toISOString() ?? new Date().toISOString();
    const eventId = `evt_preview_${createHash("sha256").update(`${projectId}:osk-learn-opencode-ambient:${record.eventType}:${ts}:${index}`).digest("hex").slice(0, 16)}`;
    const commands = derivedCommandsFromOpenCodeMetadata(record.metadata);
    const files = derivedFilesFromOpenCodeMetadata(record.metadata);
    const event = EventSchema.parse({
      schemaVersion: "openskill-kit.event.v1",
      id: eventId,
      projectId,
      sessionId: "osk-learn-opencode-ambient",
      timestamp: ts,
      eventType: mapOpenCodeAmbientEventType(record.eventType, record.metadata),
      source: { adapter: "opencode-ambient", host: "opencode" },
      intent: `Learn from OpenCode metadata-only hook event: ${record.eventType}.`,
      normalized: {
        adapter: "opencode",
        source: "opencode-plugin",
        eventType: record.eventType,
        traceMode: record.traceMode ?? "safe",
        containsRawFields: false,
        rawPromptIncluded: false,
        rawDiffIncluded: false,
        metadata: record.metadata
      },
      files,
      commands,
      privacy: { redacted: false, rawStored: false, containsUserText: false, containsCode: false }
    });
    events.push(event);
  }
  return { path: file, readCount: lines.length, skippedCount, rawFieldsDetected, rawFieldWarnings, events };
}

async function appendOpenCodeAmbientEvents(projectRoot: string, options: { maxEvents: number; now?: Date }): Promise<OpenCodeAmbientAppendResult> {
  const file = path.join(path.resolve(projectRoot), OPENCODE_AMBIENT_LOG_RELATIVE_PATH);
  const text = await fs.readFile(file, "utf8").catch(() => "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const parsed = parseOpenCodeAmbientEvents(projectRoot, lines, options);
  const eventIds: string[] = [];
  for (const event of parsed.events) {
    const appended = await appendEvent(projectRoot, {
      sessionId: event.sessionId,
      eventType: event.eventType,
      timestamp: event.timestamp,
      source: event.source,
      intent: event.intent,
      normalized: event.normalized,
      files: event.files,
      commands: event.commands,
      privacy: event.privacy
    });
    eventIds.push(appended.event.id);
  }
  const labels = await updateAmbientLabelCandidates(projectRoot, parsed.events, options.now ?? new Date());
  return { path: file, readCount: parsed.readCount, appendedCount: eventIds.length, skippedCount: parsed.skippedCount, eventIds, labelCandidates: labels.candidates };
}

function parseOpenCodeAmbientRecord(line: string): { eventType: string; capturedAt?: string; traceMode?: string; containsRawFields: boolean; rawKeyPaths: string[]; metadata: Record<string, unknown> } | undefined {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const eventType = typeof parsed.eventType === "string" ? parsed.eventType : undefined;
    const rawKeyPaths = findRawProneAmbientKeyPaths(parsed);
    const metadata = parsed.metadata && typeof parsed.metadata === "object" && !Array.isArray(parsed.metadata)
      ? sanitizeOpenCodeMetadata(parsed.metadata as Record<string, unknown>)
      : {};
    if (!eventType) return undefined;
    return {
      eventType,
      capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : undefined,
      traceMode: typeof parsed.traceMode === "string" ? parsed.traceMode : undefined,
      containsRawFields: parsed.containsRawFields === true,
      rawKeyPaths,
      metadata
    };
  } catch {
    return undefined;
  }
}

function sanitizeOpenCodeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["id", "type", "tool", "status", "decision", "timestamp"]) {
    const value = metadata[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value;
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!isSafeOpenCodeDerivedMetadataKey(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === "string")) out[key] = value;
  }
  return out;
}

function mapOpenCodeAmbientEventType(eventType: string, metadata: Record<string, unknown>): OpenSkillEvent["eventType"] {
  if (eventType === "session-start") return "session-start";
  if (eventType === "pre-tool-use" || eventType === "permission-request" || eventType === "command-intent") return "pre-tool-use";
  if (eventType === "post-tool-use") return statusFromMetadata(metadata.status ?? metadata["output.status"]) === "fail" ? "post-tool-use-failure" : "post-tool-use";
  if (eventType === "file-changed" || eventType === "diff-stats") return "file-changed";
  if (eventType === "permission-decision") {
    const decision = String(metadata.decision ?? "").toLowerCase();
    if (/deny|reject|block/.test(decision)) return "permission-denied";
    if (/allow|approve|accept/.test(decision)) return "user-accepted";
  }
  if (eventType === "finish-task-suggestion") return "task-completed";
  return "assistant-message";
}

function isSafeOpenCodeDerivedMetadataKey(key: string): boolean {
  return /^(input|output)\.(tool|type|status|decision|timestamp|sessionID|messageID|commandKind|commandHash|commandLengthBucket|commandRiskFlags|pathKind|pathHash|pathExtension|pathDepth|pathRiskFlags)$/.test(key);
}

const RAW_PRONE_AMBIENT_KEYS = new Set([
  "args",
  "arguments",
  "command",
  "content",
  "cwd",
  "diff",
  "env",
  "message",
  "messages",
  "output",
  "path",
  "prompt",
  "raw",
  "rawcommand",
  "rawdiff",
  "rawinput",
  "rawoutput",
  "rawpath",
  "rawprompt",
  "text",
  "url"
]);

function findRawProneAmbientKeyPaths(value: unknown, prefix: string[] = []): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findRawProneAmbientKeyPaths(item, [...prefix, String(index)]));
  }
  const out: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    const pathParts = [...prefix, key];
    if (isRawProneAmbientKey(key)) out.push(pathParts.join("."));
    out.push(...findRawProneAmbientKeyPaths(nested, pathParts));
  }
  return [...new Set(out)].sort();
}

function isRawProneAmbientKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const dottedLeaf = key.split(".").pop() ?? key;
  const normalizedLeaf = dottedLeaf.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return RAW_PRONE_AMBIENT_KEYS.has(normalized) || RAW_PRONE_AMBIENT_KEYS.has(normalizedLeaf);
}

function derivedCommandsFromOpenCodeMetadata(metadata: Record<string, unknown>): OpenSkillEvent["commands"] {
  const out: OpenSkillEvent["commands"] = [];
  for (const prefix of ["input", "output"] as const) {
    const hash = stringValue(metadata[`${prefix}.commandHash`]);
    if (!hash) continue;
    const kind = stringValue(metadata[`${prefix}.commandKind`]) ?? "unknown";
    const lengthBucket = stringValue(metadata[`${prefix}.commandLengthBucket`]) ?? "unknown-length";
    const riskFlags = stringArrayValue(metadata[`${prefix}.commandRiskFlags`]);
    out.push({
      command: `opencode-derived:${kind}:${hash}`,
      args: [`length=${lengthBucket}`, ...riskFlags.map((flag) => `risk=${flag}`)],
      status: statusFromMetadata(metadata.status ?? metadata["output.status"] ?? metadata[`${prefix}.status`])
    });
  }
  return out;
}

function derivedFilesFromOpenCodeMetadata(metadata: Record<string, unknown>): OpenSkillEvent["files"] {
  const out: OpenSkillEvent["files"] = [];
  for (const prefix of ["input", "output"] as const) {
    const hash = stringValue(metadata[`${prefix}.pathHash`]);
    if (!hash) continue;
    const kind = stringValue(metadata[`${prefix}.pathKind`]) ?? "unknown";
    const extension = stringValue(metadata[`${prefix}.pathExtension`]) ?? "";
    out.push({
      path: `opencode-derived:${kind}:${hash}${extension}`,
      action: "unknown"
    });
  }
  return out;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
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

function source(id: string, label: string, adapter: string, policy: LearnSourcePolicy, defaultSelected: boolean, reason: string, sourcePath?: string, privacyNotes?: string[]): LearnSourceOption {
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
      notes: privacyNotes ?? (policy === "blocked"
        ? ["Blocked by ambient-not-silent learning policy."]
        : policy === "explicit-import"
          ? ["Dry-run preview required before appending redacted events."]
          : ["Metadata-only source can be planned without import approval."])
    }
  };
}
