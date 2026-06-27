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

export const OpenWorldResearchQuerySchema = z.object({
  id: z.string().min(1),
  purpose: z.enum(["task", "language-docs", "path-docs", "package-docs", "targeted-followup"]),
  query: z.string().min(1),
  sanitizedQuery: z.string().min(1),
  status: z.enum(["ready", "sanitized", "blocked"]),
  reasons: z.array(z.string().min(1)).default([])
});

export const OpenWorldRetrievalAdapterSchema = z.object({
  id: z.enum(["local-project-files", "explicit-http-fetch", "explicit-http-cache", "autonomous-docs-repo-discovery"]),
  kind: z.enum(["local-files", "http-fetch", "http-cache", "docs-repo-discovery"]),
  title: z.string().min(1),
  status: z.enum(["enabled", "disabled"]),
  networkAccess: z.enum(["none", "explicit-http"]),
  requiresAllowWeb: z.boolean().default(false),
  inputPrivacyClasses: z.array(z.enum(OpenWorldPrivacyClasses)).default([]),
  outputPrivacyClass: z.enum(OpenWorldPrivacyClasses),
  maxSources: z.number().int().min(0).max(100).optional(),
  maxBytes: z.number().int().min(0).optional(),
  timeoutMs: z.number().int().min(0).optional(),
  reasons: z.array(z.string().min(1)).default([]),
  safeguards: z.array(z.string().min(1)).default([])
});

export const OpenWorldSourceCandidateSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  kind: OpenWorldSourceSchema.shape.kind,
  uri: z.string().min(1),
  title: z.string().optional(),
  locator: OpenWorldSourceSchema.shape.locator.default({}),
  score: z.number().min(0).max(1),
  status: z.enum(["recommended", "available", "blocked", "skipped"]),
  privacyClass: z.enum(OpenWorldPrivacyClasses),
  adapterId: OpenWorldRetrievalAdapterSchema.shape.id.optional(),
  usableFor: z.array(z.enum(["skill", "virtual-test", "safety", "report"])).default(["skill", "virtual-test", "report"]),
  reasons: z.array(z.string().min(1)).default([]),
  leakageFindingIds: z.array(z.string().min(1)).default([]),
  ingestCommand: z.string().optional()
});

export const OpenWorldResearchPlanSchema = z.object({
  schemaVersion: z.literal("openskill-kit.openworld-research-plan.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1),
  createdAt: z.string().datetime(),
  retrievalAdapters: z.array(OpenWorldRetrievalAdapterSchema).default([]),
  queryPlan: z.array(OpenWorldResearchQuerySchema).default([]),
  candidates: z.array(OpenWorldSourceCandidateSchema).default([]),
  recommendedNextCommands: z.array(z.string().min(1)).default([]),
  summary: z.object({
    adapterCount: z.number().int().min(0).default(0),
    enabledAdapterCount: z.number().int().min(0).default(0),
    queryCount: z.number().int().min(0),
    candidateCount: z.number().int().min(0),
    recommendedCount: z.number().int().min(0),
    blockedCount: z.number().int().min(0),
    webAllowed: z.boolean()
  }),
  leakageAuditId: z.string().optional(),
  leakageAuditPath: z.string().optional(),
  planPath: z.string().optional()
});

export const OpenWorldResearchExecutionSchema = z.object({
  schemaVersion: z.literal("openskill-kit.openworld-research-execution.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1),
  planId: z.string().min(1),
  executedAt: z.string().datetime(),
  status: z.enum(["planned", "completed", "partial", "blocked"]),
  dryRun: z.boolean().default(false),
  summary: z.object({
    plannedLocalCount: z.number().int().min(0),
    ingestedCount: z.number().int().min(0),
    skippedCount: z.number().int().min(0),
    errorCount: z.number().int().min(0),
    explicitWebCount: z.number().int().min(0),
    adapterCount: z.number().int().min(0).default(0)
  }),
  adapterResults: z.array(z.object({
    adapterId: OpenWorldRetrievalAdapterSchema.shape.id,
    status: z.enum(["planned", "completed", "skipped", "blocked", "partial", "error"]),
    plannedCount: z.number().int().min(0).default(0),
    ingestedCount: z.number().int().min(0).default(0),
    skippedCount: z.number().int().min(0).default(0),
    errorCount: z.number().int().min(0).default(0),
    reasons: z.array(z.string().min(1)).default([])
  })).default([]),
  ingested: z.array(z.object({
    sourceId: z.string().min(1),
    kind: OpenWorldSourceSchema.shape.kind,
    uri: z.string().min(1),
    privacyClass: z.enum(OpenWorldPrivacyClasses),
    trustScore: z.number().min(0).max(1),
    auditId: z.string().optional()
  })).default([]),
  skipped: z.array(z.object({
    uri: z.string().min(1),
    reason: z.string().min(1)
  })).default([]),
  errors: z.array(z.object({
    uri: z.string().optional(),
    message: z.string().min(1)
  })).default([]),
  sourceIds: z.array(z.string().min(1)).default([]),
  leakageAuditIds: z.array(z.string().min(1)).default([]),
  executionPath: z.string().optional(),
  markdownPath: z.string().optional()
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
  sandboxMode: z.enum(["local-process", "docker"]).default("local-process"),
  dockerImage: z.string().min(1).optional(),
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

export const OpenWorldVerifierQualityFindingSchema = z.object({
  id: z.string().min(1),
  level: z.enum(["info", "warn", "fail"]),
  caseId: z.string().optional(),
  anchorId: z.string().optional(),
  message: z.string().min(1),
  recommendation: z.string().min(1)
});

export const OpenWorldVerifierQualityReportSchema = z.object({
  schemaVersion: z.literal("openskill-kit.openworld-verifier-quality.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1),
  suiteId: z.string().min(1),
  generatedAt: z.string().datetime(),
  status: z.enum(["pass", "warn", "fail"]),
  proofLevel: z.literal("verifier-quality"),
  hiddenOracleProof: z.literal(false),
  metrics: z.object({
    caseCount: z.number().int().min(0),
    visibleCount: z.number().int().min(0),
    holdoutCount: z.number().int().min(0),
    anchorCoverage: z.number().min(0).max(1),
    sourceTrustAverage: z.number().min(0).max(1),
    determinismScore: z.number().min(0).max(1),
    traceabilityScore: z.number().min(0).max(1),
    leakageAuditPresent: z.boolean()
  }),
  findings: z.array(OpenWorldVerifierQualityFindingSchema).default([]),
  reportPath: z.string().optional(),
  markdownPath: z.string().optional()
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

export const OpenWorldCandidateSkillSchema = z.object({
  schemaVersion: z.literal("openskill-kit.openworld-candidate-skill.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1),
  createdAt: z.string().datetime(),
  skillName: z.string().min(1),
  status: z.enum(["ready", "warning", "blocked"]),
  proofLevel: z.literal("candidate-artifact"),
  hiddenOracleProof: z.literal(false),
  sourceIds: z.array(z.string().min(1)).default([]),
  anchorIds: z.array(z.string().min(1)).default([]),
  suiteIds: z.array(z.string().min(1)).default([]),
  artifacts: z.object({
    skillDir: z.string().min(1),
    skillPath: z.string().min(1),
    anchorsReferencePath: z.string().optional(),
    candidatePath: z.string().optional()
  }),
  validation: z.object({
    issueCount: z.number().int().min(0),
    errorCount: z.number().int().min(0),
    warningCount: z.number().int().min(0)
  }),
  safety: z.object({
    status: z.enum(["pass", "fail"]),
    score: z.number().min(0).max(100),
    findingCount: z.number().int().min(0)
  }),
  leakageAuditId: z.string().optional(),
  limitations: z.array(z.string().min(1)).default([])
});

export const OpenWorldCandidateSkillRevisionSchema = z.object({
  schemaVersion: z.literal("openskill-kit.openworld-candidate-skill-revision.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1),
  candidateSkillId: z.string().min(1),
  createdAt: z.string().datetime(),
  status: z.enum(["ready", "warning", "blocked"]),
  failureType: z.enum(["missing-knowledge", "verifier-bug", "source-conflict", "skill-failure", "sandbox-error", "leakage", "overfit-risk", "unknown"]).optional(),
  diagnosis: z.string().min(1),
  artifacts: z.object({
    skillDir: z.string().min(1),
    skillPath: z.string().min(1),
    revisionPath: z.string().optional()
  }),
  validation: z.object({
    issueCount: z.number().int().min(0),
    errorCount: z.number().int().min(0),
    warningCount: z.number().int().min(0)
  }),
  safety: z.object({
    status: z.enum(["pass", "fail"]),
    score: z.number().min(0).max(100),
    findingCount: z.number().int().min(0)
  }),
  leakageAuditId: z.string().optional(),
  notes: z.array(z.string().min(1)).default([])
});

export const OpenWorldCandidateRepairRunSchema = z.object({
  schemaVersion: z.literal("openskill-kit.openworld-candidate-repair-run.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1),
  candidateSkillId: z.string().min(1),
  suiteId: z.string().min(1).optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  status: z.enum(["passed", "failed", "blocked"]),
  sandboxMode: z.enum(["local-process", "docker"]),
  dockerImage: z.string().min(1).optional(),
  maxRounds: z.number().int().min(1).max(5),
  hiddenOracleProof: z.literal(false),
  rounds: z.array(z.object({
    index: z.number().int().min(0),
    status: z.enum(["passed", "failed", "blocked"]),
    failureType: z.enum(["missing-knowledge", "verifier-bug", "source-conflict", "skill-failure", "sandbox-error", "leakage", "overfit-risk", "unknown"]).optional(),
    revisionId: z.string().min(1).optional(),
    revisionPath: z.string().optional(),
    probeScriptPath: z.string().optional(),
    probeResultPath: z.string().optional(),
    probeSummary: z.object({
      pass: z.number().int().min(0).default(0),
      fail: z.number().int().min(0).default(0),
      blocked: z.number().int().min(0).default(0),
      timeout: z.number().int().min(0).default(0)
    }).default({ pass: 0, fail: 0, blocked: 0, timeout: 0 }),
    notes: z.array(z.string().min(1)).default([])
  })).default([]),
  artifacts: z.object({
    repairRunPath: z.string().optional()
  }).default({}),
  limitations: z.array(z.string().min(1)).default([])
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
    candidateSkillId: z.string().optional(),
    candidateRevisionId: z.string().optional(),
    candidateRevisionPath: z.string().optional(),
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
  candidateSkillIds: z.array(z.string().min(1)).default([]),
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

export const OpenWorldHiddenOracleHarnessSchema = z.object({
  schemaVersion: z.literal("openskill-kit.openworld-hidden-oracle-harness.v1"),
  id: z.string().min(1),
  taskId: z.string().min(1),
  suiteId: z.string().min(1).optional(),
  generatedAt: z.string().datetime(),
  status: z.enum(["pass", "fail", "warn"]),
  proofLevel: z.enum(["denied-path-static", "not-proof"]),
  hiddenOracleProof: z.literal(false),
  deniedPathProof: z.object({
    deniedPathCount: z.number().int().min(0),
    scannedArtifactCount: z.number().int().min(0),
    leakedReferenceCount: z.number().int().min(0),
    osBoundaryEnforced: z.boolean(),
    status: z.enum(["pass", "fail", "not-enforced"])
  }),
  deniedPaths: z.array(z.object({
    id: z.string().min(1),
    pathHash: z.string().min(16),
    insideProject: z.boolean()
  })).default([]),
  scannedArtifacts: z.array(z.string().min(1)).default([]),
  leaks: z.array(z.object({
    artifactPath: z.string().min(1),
    deniedPathId: z.string().min(1),
    deniedPathHash: z.string().min(16)
  })).default([]),
  artifacts: z.object({
    harnessPath: z.string().optional(),
    markdownPath: z.string().optional()
  }).default({}),
  limitations: z.array(z.string().min(1)).default([])
});

export type OpenWorldTask = z.infer<typeof OpenWorldTaskSchema>;
export type OpenWorldSource = z.infer<typeof OpenWorldSourceSchema>;
export type OpenWorldSourceIndex = z.infer<typeof OpenWorldSourceIndexSchema>;
export type OpenWorldTrustCache = z.infer<typeof OpenWorldTrustCacheSchema>;
export type OpenWorldResearchQuery = z.infer<typeof OpenWorldResearchQuerySchema>;
export type OpenWorldRetrievalAdapter = z.infer<typeof OpenWorldRetrievalAdapterSchema>;
export type OpenWorldSourceCandidate = z.infer<typeof OpenWorldSourceCandidateSchema>;
export type OpenWorldResearchPlan = z.infer<typeof OpenWorldResearchPlanSchema>;
export type OpenWorldResearchExecution = z.infer<typeof OpenWorldResearchExecutionSchema>;
export type AnchorCard = z.infer<typeof AnchorCardSchema>;
export type VirtualTestCase = z.infer<typeof VirtualTestCaseSchema>;
export type VirtualTestSuite = z.infer<typeof VirtualTestSuiteSchema>;
export type VirtualTestSuiteExecution = z.infer<typeof VirtualTestSuiteExecutionSchema>;
export type OpenWorldVerifierQualityFinding = z.infer<typeof OpenWorldVerifierQualityFindingSchema>;
export type OpenWorldVerifierQualityReport = z.infer<typeof OpenWorldVerifierQualityReportSchema>;
export type SkillPlan = z.infer<typeof SkillPlanSchema>;
export type OpenWorldCandidateSkill = z.infer<typeof OpenWorldCandidateSkillSchema>;
export type OpenWorldCandidateSkillRevision = z.infer<typeof OpenWorldCandidateSkillRevisionSchema>;
export type OpenWorldCandidateRepairRun = z.infer<typeof OpenWorldCandidateRepairRunSchema>;
export type OpenWorldLeakageFinding = z.infer<typeof OpenWorldLeakageFindingSchema>;
export type OpenWorldLeakageAudit = z.infer<typeof OpenWorldLeakageAuditSchema>;
export type OpenWorldEvolutionRun = z.infer<typeof OpenWorldEvolutionRunSchema>;
export type OpenWorldEvalReport = z.infer<typeof OpenWorldEvalReportSchema>;
export type OpenWorldHiddenOracleHarness = z.infer<typeof OpenWorldHiddenOracleHarnessSchema>;
