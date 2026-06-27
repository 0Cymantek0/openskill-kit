import { z } from "zod";
import { detectAgentEnvironment } from "../detection/detector.js";
import { readInteractionImportRuns } from "./importer.js";

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

  for (const surface of report.surfaces) {
    if (surface.surfaceType === "interaction-export") {
      sources.push(source(`explicit:${surface.id}`, `Explicit import: ${surface.relativePath ?? surface.path}`, surface.adapter, "explicit-import", false, "Session/export files require preview and explicit apply before learning.", surface.path));
    }
    if (surface.surfaceType === "memory-store") {
      sources.push(source(`blocked:${surface.id}`, `Blocked memory store: ${surface.relativePath ?? surface.path}`, surface.adapter, "blocked", false, "Raw memory stores are metadata-only and must not be imported silently.", surface.path));
    }
  }

  const parsed = sources.map((item) => LearnSourceOptionSchema.parse(item));
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
