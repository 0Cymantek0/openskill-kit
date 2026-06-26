import { z } from "zod";

export const BehaviorRoutePlanSchema = z.object({
  schemaVersion: z.literal("openskill-kit.behavior-route-plan.v1"),
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  projectRoot: z.string().min(1),
  query: z.string().optional(),
  paths: z.array(z.string()).default([]),
  changedFiles: z.array(z.string()).default([]),
  decision: z.enum(["local-only", "project-evidence", "openworld-research", "review-needed"]),
  risk: z.object({
    level: z.enum(["low", "medium", "high"]),
    reasons: z.array(z.string()).default([])
  }),
  novelty: z.object({
    score: z.number().min(0).max(1),
    reasons: z.array(z.string()).default([])
  }),
  localCoverage: z.number().min(0).max(1),
  gates: z.array(z.enum(["privacy", "review", "integrity", "leakage", "sandbox"])).default(["privacy"]),
  reasons: z.array(z.string()).default([]),
  retrieval: z.object({
    consideredCount: z.number().int().min(0),
    returnedCount: z.number().int().min(0),
    omittedCount: z.number().int().min(0),
    compactMarkdown: z.string()
  }),
  conflicts: z.array(z.object({
    id: z.string(),
    nodeIds: z.array(z.string()),
    reason: z.string()
  })).default([]),
  openWorld: z.object({
    recommended: z.boolean(),
    maxSources: z.number().int().min(0),
    requireVerifier: z.boolean(),
    reason: z.string().optional()
  }),
  tracePath: z.string().optional()
});

export type BehaviorRoutePlan = z.infer<typeof BehaviorRoutePlanSchema>;

