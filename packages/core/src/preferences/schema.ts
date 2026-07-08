import { z } from "zod";
import { SignalSchema } from "../signals/schema.js";
import { CompileTargets, PreferenceStatuses } from "../schema/constants.js";

export const PreferenceNodeSchema = z.object({
  schemaVersion: z.enum(["openskill-kit.preference-node.v1", "openskill-kit.preference-node.v2"]),
  id: z.string().min(1),
  title: z.string().min(1),
  statement: z.string().min(1),
  category: SignalSchema.shape.category,
  scope: SignalSchema.shape.scope,
  confidence: z.number().min(0).max(1),
  status: z.enum(PreferenceStatuses),
  polarity: SignalSchema.shape.polarity,
  evidence: z.array(z.object({
    signalId: z.string(),
    eventIds: z.array(z.string()),
    weight: z.number(),
    cardIds: z.array(z.string()).default([]),
    quote: z.string().optional(),
    command: z.string().optional()
  })).default([]),
  strength: z.enum(["must", "should", "may", "must-not"]).optional(),
  exceptions: z.array(z.string()).optional(),
  conditions: z.object({
    appliesWhen: z.array(z.string()).default([]),
    doesNotApplyWhen: z.array(z.string()).default([])
  }).optional(),
  activation: z.object({
    phrases: z.array(z.string()).default([]),
    pathGlobs: z.array(z.string()).default([]),
    commands: z.array(z.string()).default([]),
    negativeTriggers: z.array(z.string()).default([])
  }).optional(),
  privacy: z.object({
    class: z.enum(["project-private", "user-private", "global-private", "shareable"]),
    rationale: z.string().min(1)
  }).optional(),
  compileTargets: z.array(z.enum(CompileTargets)).optional(),
  lifecycle: z.object({
    state: z.enum(["candidate", "staged", "active", "deprecated"]),
    reviewedAt: z.string().datetime().optional(),
    promotedAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional()
  }).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type PreferenceNode = z.infer<typeof PreferenceNodeSchema>;

export const PreferenceGraphSchema = z.object({
  schemaVersion: z.literal("openskill-kit.preference-graph.v1"),
  projectId: z.string().min(1),
  nodes: z.array(PreferenceNodeSchema).default([]),
  conflicts: z.array(z.object({
    id: z.string(),
    nodeIds: z.array(z.string()).min(2),
    reason: z.string()
  })).default([]),
  updatedAt: z.string().datetime()
});

export type PreferenceGraph = z.infer<typeof PreferenceGraphSchema>;
