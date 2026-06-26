import { z } from "zod";

export const OpenWorldPrivacyClasses = [
  "project-private",
  "user-private",
  "global-private",
  "shareable",
  "openworld-public",
  "oracle-private"
] as const;

export const OpenWorldTaskSchema = z.object({
  schemaVersion: z.literal("openskill-kit.openworld-task.v1"),
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  createdAt: z.string().datetime(),
  status: z.enum(["draft", "planned", "researching", "verifying", "evolving", "complete", "blocked"]).default("draft"),
  privacyClass: z.enum(OpenWorldPrivacyClasses).default("project-private"),
  taskType: z.string().min(1).default("general"),
  languages: z.array(z.string().min(1)).default([]),
  paths: z.array(z.string().min(1)).default([]),
  forbiddenIdentifiers: z.array(z.string().min(1)).default([]),
  forbiddenPaths: z.array(z.string().min(1)).default([]),
  allowWeb: z.boolean().default(false),
  notes: z.array(z.string().min(1)).default([])
});

export const SourceTrustSchema = z.object({
  authority: z.number().min(0).max(1).default(0.5),
  freshness: z.number().min(0).max(1).default(0.5),
  independence: z.number().min(0).max(1).default(0.5),
  score: z.number().min(0).max(1).optional(),
  rationale: z.string().optional()
});

export const OpenWorldSourceSchema = z.object({
  schemaVersion: z.enum(["openskill-kit.openworld-source.v1", "openskill-kit.openworld-source.v2"]),
  id: z.string().min(1),
  taskId: z.string().min(1),
  kind: z.enum(["project-file", "local-doc", "package-docs", "official-docs", "web", "repository", "paper", "tutorial", "user-provided", "generated-placeholder"]),
  sourceType: z.enum(["project-file", "official-docs", "repository", "paper", "package-docs", "tutorial", "web", "user-provided", "local-doc", "generated-placeholder"]).optional(),
  uri: z.string().min(1),
  locator: z.object({
    url: z.string().url().optional(),
    repo: z.string().optional(),
    commit: z.string().optional(),
    path: z.string().optional(),
    packageName: z.string().optional(),
    version: z.string().optional()
  }).default({}),
  title: z.string().optional(),
  contentPath: z.string().optional(),
  cachePath: z.string().optional(),
  retrievedAt: z.string().datetime(),
  contentHash: z.string().min(16),
  trust: SourceTrustSchema.default({ authority: 0.5, freshness: 0.5, independence: 0.5 }),
  privacyClass: z.enum(OpenWorldPrivacyClasses).default("project-private"),
  usableFor: z.array(z.enum(["skill", "virtual-test", "safety", "report"])).default(["skill", "virtual-test"]),
  leakageAuditId: z.string().optional()
});

export const OpenWorldSourceIndexEntrySchema = z.object({
  sourceId: z.string().min(1),
  taskId: z.string().min(1),
  kind: OpenWorldSourceSchema.shape.kind,
  uri: z.string().min(1),
  contentHash: z.string().min(16),
  contentPath: z.string().optional(),
  cachePath: z.string().optional(),
  retrievedAt: z.string().datetime(),
  trustScore: z.number().min(0).max(1),
  privacyClass: z.enum(OpenWorldPrivacyClasses),
  leakageAuditId: z.string().optional()
});

export const OpenWorldSourceIndexSchema = z.object({
  schemaVersion: z.literal("openskill-kit.openworld-source-index.v1"),
  updatedAt: z.string().datetime(),
  entries: z.array(OpenWorldSourceIndexEntrySchema).default([])
});

export const OpenWorldTrustCacheEntrySchema = z.object({
  key: z.string().min(1),
  sourceType: OpenWorldSourceSchema.shape.kind,
  locator: OpenWorldSourceSchema.shape.locator,
  trust: SourceTrustSchema,
  assessedAt: z.string().datetime()
});

export const OpenWorldTrustCacheSchema = z.object({
  schemaVersion: z.literal("openskill-kit.openworld-trust-cache.v1"),
  updatedAt: z.string().datetime(),
  entries: z.record(z.string(), OpenWorldTrustCacheEntrySchema).default({})
});

export const AnchorCardSchema = z.object({
  schemaVersion: z.literal("openskill-kit.anchor-card.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1),
  sourceId: z.string().min(1),
  claim: z.string().min(1),
  anchorType: z.enum(["api-behavior", "workflow", "constraint", "example", "invariant", "safety", "environment"]),
  verifiableAs: z.array(z.enum(["stdout-contains", "json-schema", "file-exists", "file-contains", "unit-test", "command-exit", "manual-review"])).default([]),
  sourceQuote: z.string().max(600).optional(),
  sourceUrl: z.string().optional(),
  paths: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1),
  leakageRisk: z.enum(["low", "medium", "high", "blocked"]).default("low"),
  privacyClass: z.enum(OpenWorldPrivacyClasses).default("project-private"),
  usableFor: z.array(z.enum(["skill", "virtual-test", "safety", "report"])).default(["skill", "virtual-test"]),
  createdAt: z.string().datetime()
});

export const VirtualTestCaseSchema = z.object({
  id: z.string().min(1),
  anchorIds: z.array(z.string().min(1)).min(1),
  runner: z.enum(["vitest", "pytest", "node", "json-schema", "command", "manual"]),
  split: z.enum(["visible", "holdout"]),
  name: z.string().min(1),
  description: z.string().min(1),
  file: z.string().optional(),
  command: z.array(z.string().min(1)).default([]),
  assertions: z.array(z.string().min(1)).default([]),
  expectedArtifacts: z.array(z.string().min(1)).default([]),
  status: z.enum(["draft", "ready", "quarantined"]).default("draft")
});

export const VirtualTestSuiteSchema = z.object({
  schemaVersion: z.literal("openskill-kit.virtual-test-suite.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1),
  createdAt: z.string().datetime(),
  generatedFromAnchorIds: z.array(z.string().min(1)).default([]),
  cases: z.array(VirtualTestCaseSchema).default([]),
  artifacts: z.object({
    manifestPath: z.string().optional(),
    traceabilityMapPath: z.string().optional(),
    visibleDir: z.string().optional(),
    holdoutDir: z.string().optional()
  }).default({}),
  leakageAuditId: z.string().optional()
});

export const VirtualTestSuiteExecutionSchema = z.object({
  schemaVersion: z.literal("openskill-kit.virtual-test-execution.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1),
  suiteId: z.string().min(1),
  split: z.enum(["visible", "holdout", "all"]),
  executedAt: z.string().datetime(),
  results: z.array(z.object({
    caseId: z.string().min(1),
    split: z.enum(["visible", "holdout"]),
    status: z.enum(["pass", "fail", "blocked", "timeout", "skipped"]),
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    exitCode: z.number().nullable().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    durationMs: z.number().int().min(0).default(0),
    message: z.string().min(1)
  })),
  summary: z.object({
    pass: z.number().int().min(0),
    fail: z.number().int().min(0),
    blocked: z.number().int().min(0),
    timeout: z.number().int().min(0),
    skipped: z.number().int().min(0)
  }),
  resultPath: z.string().optional()
});

export const SkillPlanSchema = z.object({
  schemaVersion: z.literal("openskill-kit.skill-plan.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1),
  createdAt: z.string().datetime(),
  objective: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).default([]),
  anchorIds: z.array(z.string().min(1)).default([]),
  constraints: z.array(z.string().min(1)).default([]),
  candidateSkillNames: z.array(z.string().min(1)).default([]),
  maxRefinementRounds: z.number().int().min(0).max(5).default(3),
  status: z.enum(["draft", "ready", "blocked"]).default("draft")
});

export const OpenWorldLeakageFindingSchema = z.object({
  id: z.string().min(1),
  level: z.enum(["warn", "block"]),
  surface: z.enum(["query", "path", "content", "artifact"]),
  message: z.string().min(1),
  source: z.string().min(1),
  match: z.string().min(1)
});

export const OpenWorldLeakageAuditSchema = z.object({
  schemaVersion: z.literal("openskill-kit.openworld-leakage-audit.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1).optional(),
  scannedAt: z.string().datetime(),
  status: z.enum(["pass", "warning", "blocked"]),
  forbiddenIdentifiers: z.array(z.string().min(1)).default([]),
  forbiddenPaths: z.array(z.string().min(1)).default([]),
  findings: z.array(OpenWorldLeakageFindingSchema).default([]),
  sanitizedQueries: z.array(z.object({
    original: z.string(),
    sanitized: z.string()
  })).default([])
});

export const OpenWorldEvolutionRunSchema = z.object({
  schemaVersion: z.literal("openskill-kit.evolution-run.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  status: z.enum(["planned", "running", "passed", "failed", "blocked"]),
  maxRounds: z.number().int().min(0).max(5).default(3),
  rounds: z.array(z.object({
    index: z.number().int().min(0),
    status: z.enum(["planned", "passed", "failed", "blocked"]),
    verifierSuiteId: z.string().optional(),
    verifierExecutionId: z.string().optional(),
    verifierResultPath: z.string().optional(),
    split: z.enum(["visible", "holdout", "all"]).optional(),
    skillPlanId: z.string().optional(),
    failureType: z.enum(["missing-knowledge", "verifier-bug", "source-conflict", "skill-failure", "sandbox-error", "leakage", "overfit-risk", "unknown"]).optional(),
    summary: z.object({
      pass: z.number().int().min(0),
      fail: z.number().int().min(0),
      blocked: z.number().int().min(0),
      timeout: z.number().int().min(0),
      skipped: z.number().int().min(0)
    }).optional(),
    notes: z.array(z.string().min(1)).default([])
  })).default([]),
  sourceIds: z.array(z.string().min(1)).default([]),
  anchorIds: z.array(z.string().min(1)).default([]),
  virtualTestSuiteIds: z.array(z.string().min(1)).default([]),
  leakageAuditIds: z.array(z.string().min(1)).default([]),
  cost: z.object({
    wallClockMs: z.number().int().min(0).default(0),
    estimatedTokens: z.number().int().min(0).default(0)
  }).default({ wallClockMs: 0, estimatedTokens: 0 })
});

export const OpenWorldEvalReportSchema = z.object({
  schemaVersion: z.literal("openskill-kit.openworld-eval-report.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1),
  runId: z.string().min(1),
  suiteIds: z.array(z.string().min(1)).default([]),
  generatedAt: z.string().datetime(),
  status: z.enum(["pass", "warn", "fail"]),
  proofLevel: z.enum(["artifact-verifier", "hidden-oracle", "not-proof"]),
  hiddenOracleProof: z.boolean().default(false),
  metrics: z.object({
    visiblePassRate: z.number().min(0).max(1),
    holdoutPassRate: z.number().min(0).max(1),
    roundCount: z.number().int().min(0),
    overfitRisk: z.boolean(),
    leakageAuditCount: z.number().int().min(0),
    wallClockMs: z.number().int().min(0)
  }),
  references: z.object({
    runPath: z.string().optional(),
    verifierResultPaths: z.array(z.string().min(1)).default([]),
    sourceIds: z.array(z.string().min(1)).default([]),
    anchorIds: z.array(z.string().min(1)).default([])
  }),
  limitations: z.array(z.string().min(1)).default([])
});

export type OpenWorldTask = z.infer<typeof OpenWorldTaskSchema>;
export type OpenWorldSource = z.infer<typeof OpenWorldSourceSchema>;
export type OpenWorldSourceIndex = z.infer<typeof OpenWorldSourceIndexSchema>;
export type OpenWorldTrustCache = z.infer<typeof OpenWorldTrustCacheSchema>;
export type AnchorCard = z.infer<typeof AnchorCardSchema>;
export type VirtualTestCase = z.infer<typeof VirtualTestCaseSchema>;
export type VirtualTestSuite = z.infer<typeof VirtualTestSuiteSchema>;
export type VirtualTestSuiteExecution = z.infer<typeof VirtualTestSuiteExecutionSchema>;
export type SkillPlan = z.infer<typeof SkillPlanSchema>;
export type OpenWorldLeakageFinding = z.infer<typeof OpenWorldLeakageFindingSchema>;
export type OpenWorldLeakageAudit = z.infer<typeof OpenWorldLeakageAuditSchema>;
export type OpenWorldEvolutionRun = z.infer<typeof OpenWorldEvolutionRunSchema>;
export type OpenWorldEvalReport = z.infer<typeof OpenWorldEvalReportSchema>;
