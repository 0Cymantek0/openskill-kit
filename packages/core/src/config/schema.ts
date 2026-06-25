import { z } from "zod";
import { CompileTargets } from "../schema/constants.js";

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
    decayHalfLifeDays: z.number().int().min(1).default(90)
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
    learning: {},
    privacy: {},
    scopes: {},
    adapters: {},
    compileTargets: undefined
  });
}
