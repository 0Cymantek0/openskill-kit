import { z } from "zod";
import { CompileTargets } from "../schema/constants.js";

const RawEvidenceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  defaultScope: z.enum(["project", "subsystem", "path"]).default("project"),
  extractionExecution: z.enum([
    "opencode-host-raw-allowed",
    "opencode-host-sanitized-only",
    "deterministic-only"
  ]).default("deterministic-only"),
  retainRawDays: z.number().int().min(1).max(365).default(14),
  maxRawBytesPerRun: z.number().int().min(100_000).default(5_000_000),
  maxRawBytesTotal: z.number().int().min(1_000_000).default(250_000_000),
  maxEpisodeBundleChars: z.number().int().min(1_000).default(60_000),
  autoCompactOnBudget: z.boolean().default(true),
  pinAcceptableRelevance: z.boolean().default(true)
});

export const ProjectConfigSchema = z.object({
  schemaVersion: z.literal("openskill-kit.config.v1"),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  createdAt: z.string().datetime(),
  learning: z.object({
    enabled: z.boolean().default(true),
    mode: z.enum(["off", "manual-review", "auto-stage", "auto-apply-safe"]).default("manual-review"),
    highValueOnly: z.boolean().default(true),
    minConfidenceToApply: z.number().min(0).max(1).default(0.72),
    minConfidenceToShare: z.number().min(0).max(1).default(0.86),
    decayHalfLifeDays: z.number().int().min(1).default(90),
    rawEvidence: RawEvidenceConfigSchema.default(() => RawEvidenceConfigSchema.parse({}))
  }),
  privacy: z.object({
    localOnly: z.boolean().default(true),
    redactSecrets: z.boolean().default(true),
    storeRawPrompts: z.boolean().default(false),
    storeRawDiffs: z.boolean().default(false),
    maxSnippetChars: z.number().int().min(100).default(2000),
    customRedactions: z.array(z.string()).default([])
  }),
  scopes: z.object({
    project: z.boolean().default(true),
    user: z.boolean().default(true),
    globalPromotion: z.enum(["off", "suggest", "auto-stage"]).default("suggest")
  }),
  adapters: z.object({
    mcp: z.boolean().default(true),
    agentSkills: z.boolean().default(true),
    localAdapter: z.boolean().default(false),
    agentsDirectory: z.boolean().default(true)
  }),
  compileTargets: z.array(z.enum(CompileTargets)).default([...CompileTargets])
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export function createDefaultProjectConfig(input: {
  projectId: string;
  projectName: string;
  createdAt: string;
}): ProjectConfig {
  return ProjectConfigSchema.parse({
    schemaVersion: "openskill-kit.config.v1",
    projectId: input.projectId,
    projectName: input.projectName,
    createdAt: input.createdAt,
    learning: { rawEvidence: {} },
    privacy: {},
    scopes: {},
    adapters: {},
    compileTargets: undefined
  });
}
