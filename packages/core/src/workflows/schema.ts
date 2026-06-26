import { z } from "zod";

/**
 * Workflow Graph.
 *
 * A Preference Graph answers "what should agents do or avoid?".
 * A Workflow Graph answers "what repeatable sequence does this user/project follow?".
 *
 * Workflows are mined from repeated event sequences (command runs, test outcomes,
 * edit deltas, review comments) and compiled into skills, hooks, command policies,
 * and review checklists. They cite Evidence Cards, Preference Nodes, and (when
 * OpenWorld is involved) Anchor Cards.
 */

export const WorkflowStepKindSchema = z.enum([
  "command",
  "check",
  "edit",
  "review",
  "ask",
  "summarize"
]);

export const WorkflowStepSchema = z.object({
  id: z.string().min(1),
  instruction: z.string().min(1),
  kind: WorkflowStepKindSchema,
  optional: z.boolean().default(false),
  command: z.string().optional(),
  verifier: z.string().optional()
});

export const WorkflowStatusSchema = z.enum([
  "candidate",
  "staged",
  "active",
  "locked",
  "rejected",
  "conflict"
]);

export const WorkflowCompileTargetSchema = z.enum([
  "skill",
  "hook",
  "command-policy",
  "review-checklist",
  "mcp-resource",
  "manifest",
  "context-pack"
]);

export const WorkflowNodeSchema = z.object({
  schemaVersion: z.literal("openskill-kit.workflow-node.v1"),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  trigger: z.object({
    paths: z.array(z.string()).default([]),
    taskTypes: z.array(z.string()).default([]),
    commands: z.array(z.string()).default([]),
    naturalLanguagePatterns: z.array(z.string()).default([])
  }),
  steps: z.array(WorkflowStepSchema).min(1),
  evidenceCardIds: z.array(z.string()).default([]),
  preferenceNodeIds: z.array(z.string()).default([]),
  anchorCardIds: z.array(z.string()).default([]),
  occurrenceCount: z.number().int().min(1).default(1),
  confidence: z.number().min(0).max(1).default(0.5),
  status: WorkflowStatusSchema.default("candidate"),
  compileTargets: z.array(WorkflowCompileTargetSchema).default(["skill", "command-policy"]),
  privacy: z.object({
    class: z.enum(["shareable", "project-private", "user-private", "global-private"]).default("project-private"),
    rationale: z.string().min(1).default("Workflow mined from project-local evidence.")
  }),
  lifecycle: z.object({
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    reviewedAt: z.string().datetime().optional(),
    promotedAt: z.string().datetime().optional()
  }).optional(),
  sourceSignalIds: z.array(z.string()).default([])
});

export const WorkflowGraphSchema = z.object({
  schemaVersion: z.literal("openskill-kit.workflow-graph.v1"),
  projectId: z.string().min(1),
  nodes: z.array(WorkflowNodeSchema).default([]),
  conflicts: z.array(z.object({
    id: z.string(),
    workflowIds: z.array(z.string()).min(2),
    reason: z.string()
  })).default([]),
  updatedAt: z.string().datetime()
});

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowStepKind = z.infer<typeof WorkflowStepKindSchema>;
export type WorkflowCompileTarget = z.infer<typeof WorkflowCompileTargetSchema>;

export const WorkflowMiningEvidenceSchema = z.object({
  schemaVersion: z.literal("openskill-kit.workflow-mining-evidence.v1"),
  workflowId: z.string().min(1),
  sequenceHash: z.string().min(1),
  occurrences: z.array(z.object({
    sessionId: z.string(),
    timestamp: z.string().datetime(),
    eventIds: z.array(z.string()).default([]),
    commandFingerprint: z.string().optional(),
    pathCluster: z.array(z.string()).default([])
  })).min(1),
  commandFingerprints: z.array(z.string()).default([]),
  pathClusters: z.array(z.array(z.string())).default([])
});
export type WorkflowMiningEvidence = z.infer<typeof WorkflowMiningEvidenceSchema>;
