import { z } from "zod";

export const LearnV2RetentionTierSchema = z.enum(["hot-spool", "pinned", "compacted", "expired"]);
export type LearnV2RetentionTier = z.infer<typeof LearnV2RetentionTierSchema>;

export const LearnV2RawEvidenceRecordSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.raw-evidence-record.v1"),
  id: z.string().min(1),
  projectId: z.string().min(1),
  source: z.object({
    adapterId: z.string().min(1),
    uri: z.string().min(1),
    path: z.string().optional(),
    pathHash: z.string().optional(),
    contentHash: z.string().min(1)
  }),
  capturedAt: z.string().datetime(),
  content: z.object({
    kind: z.enum(["transcript", "tool-trace", "diff", "log", "document", "summary", "unknown"]),
    encoding: z.literal("utf8"),
    byteCount: z.number().int().min(0),
    lineCount: z.number().int().min(0),
    blobRef: z.string().min(1),
    blobHash: z.string().min(1)
  }),
  retention: z.object({
    tier: LearnV2RetentionTierSchema,
    pinnedBy: z.array(z.string()).default([]),
    expiresAt: z.string().datetime().optional(),
    compactedRef: z.string().optional(),
    tombstoneReason: z.string().optional()
  }),
  privacy: z.object({
    rawLocalOnly: z.literal(true),
    declassified: z.literal(false),
    redactionMatches: z.array(z.string()).default([]),
    placeholders: z.array(z.string()).default([])
  }),
  relevance: z.object({
    score: z.number().min(0).max(1),
    decision: z.enum(["accept", "review", "reject"]),
    gate: z.enum(["hard-accept", "hard-review", "hard-reject", "calibrated-score"]).default("calibrated-score"),
    calibrationVersion: z.string().optional(),
    featureValues: z.record(z.string(), z.number()).default({}),
    reasons: z.array(z.string()).default([]),
    matchedPaths: z.array(z.string()).default([]),
    matchedRemotes: z.array(z.string()).default([])
  }),
  trace: z.object({
    oskTraceId: z.string().optional(),
    oskEpisodeId: z.string().optional(),
    sessionIds: z.array(z.string()).default([]),
    branch: z.string().optional()
  }).default({ sessionIds: [] })
});
export type LearnV2RawEvidenceRecord = z.infer<typeof LearnV2RawEvidenceRecordSchema>;

export const LearnV2RawEvidenceManifestSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.raw-evidence-manifest.v1"),
  projectId: z.string().min(1),
  updatedAt: z.string().datetime(),
  records: z.array(z.object({
    id: z.string().min(1),
    contentHash: z.string().min(1),
    adapterId: z.string().min(1),
    retentionTier: LearnV2RetentionTierSchema,
    byteCount: z.number().int().min(0),
    capturedAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    relevanceDecision: z.enum(["accept", "review", "reject"])
  })).default([]),
  budget: z.object({
    hotBytes: z.number().int().min(0),
    pinnedBytes: z.number().int().min(0),
    compactedBytes: z.number().int().min(0),
    expiredCount: z.number().int().min(0),
    totalBytes: z.number().int().min(0),
    maxHotBytes: z.number().int().min(0),
    maxPinnedBytes: z.number().int().min(0).optional(),
    maxTotalBytes: z.number().int().min(0).optional(),
    status: z.enum(["ok", "over-budget"])
  })
});
export type LearnV2RawEvidenceManifest = z.infer<typeof LearnV2RawEvidenceManifestSchema>;

export const LearnV2NormalizedEvidenceSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.normalized-evidence.v1"),
  id: z.string().min(1),
  rawRef: z.string().min(1),
  sourceHash: z.string().min(1),
  kind: z.enum(["message", "tool-call", "command", "file-change", "test-result", "review", "log-line", "document-section"]),
  actor: z.enum(["system", "developer", "user", "assistant", "tool", "reviewer", "ci", "unknown"]),
  timestamp: z.string().datetime().optional(),
  sessionId: z.string().optional(),
  traceId: z.string().optional(),
  episodeId: z.string().optional(),
  branch: z.string().optional(),
  cwdHint: z.string().optional(),
  text: z.string().default(""),
  toolName: z.string().optional(),
  status: z.enum(["pass", "fail", "blocked", "timeout", "unknown"]).default("unknown"),
  paths: z.array(z.string()).default([]),
  commands: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({})
});
export type LearnV2NormalizedEvidence = z.infer<typeof LearnV2NormalizedEvidenceSchema>;

export const LearnV2ToolCallSummarySchema = z.object({
  id: z.string().min(1),
  evidenceId: z.string().min(1).optional(),
  toolName: z.string().min(1),
  status: z.enum(["pass", "fail", "blocked", "timeout", "unknown"]),
  command: z.string().optional(),
  commandShape: z.object({
    rendered: z.string().min(1),
    base: z.string().min(1),
    argsShape: z.array(z.string()).default([]),
    riskFlags: z.array(z.string()).default([])
  }).optional(),
  paths: z.array(z.string()).default([]),
  summary: z.string().min(1),
  omittedBytes: z.number().int().min(0).default(0),
  outputCompression: z.object({
    strategy: z.enum(["status-only", "first-last-lines", "diagnostic-extract", "stacktrace-signature", "test-failure-summary", "deduplicated-log"]),
    summary: z.string().min(1),
    omittedBytes: z.number().int().min(0),
    signatures: z.array(z.string()).default([])
  }).default({
    strategy: "status-only",
    summary: "No output captured.",
    omittedBytes: 0,
    signatures: []
  })
});
export type LearnV2ToolCallSummary = z.infer<typeof LearnV2ToolCallSummarySchema>;

export const LearnV2PatchComparisonSchema = z.object({
  id: z.string().min(1),
  evidenceId: z.string().min(1).optional(),
  kind: z.enum(["agent-patch", "manual-edit", "final-patch", "diff-summary"]),
  pairedWithIds: z.array(z.string().min(1)).default([]),
  paths: z.array(z.string()).default([]),
  structuralClasses: z.array(z.enum(["api", "parser", "test", "config", "docs", "generated", "lockfile", "formatting", "unknown"])).default([]),
  structuralSummary: z.object({
    languages: z.array(z.enum(["typescript", "javascript", "python", "go", "rust", "json", "markdown", "unknown"])).default([]),
    semanticChange: z.boolean().default(false),
    formattingOnly: z.boolean().default(false),
    ignoredFiles: z.array(z.string()).default([]),
    changedSymbols: z.array(z.string()).default([]),
    changedImports: z.array(z.string()).default([]),
    fileSummaries: z.array(z.object({
      path: z.string(),
      language: z.enum(["typescript", "javascript", "python", "go", "rust", "json", "markdown", "unknown"]),
      classes: z.array(z.enum(["api", "parser", "test", "config", "docs", "generated", "lockfile", "formatting", "unknown"])).default([]),
      changedSymbols: z.array(z.string()).default([]),
      changedImports: z.array(z.string()).default([]),
      addedLines: z.number().int().min(0),
      removedLines: z.number().int().min(0),
      semanticChange: z.boolean()
    })).default([])
  }).default({
    languages: [],
    semanticChange: false,
    formattingOnly: false,
    ignoredFiles: [],
    changedSymbols: [],
    changedImports: [],
    fileSummaries: []
  }),
  addedLines: z.number().int().min(0).default(0),
  removedLines: z.number().int().min(0).default(0),
  summary: z.string().min(1),
  ignoredGenerated: z.boolean().default(false),
  behaviorEligible: z.boolean().default(true),
  filterReasons: z.array(z.enum([
    "generated-only",
    "dependency-lockfile-only",
    "formatting-only",
    "rename-only",
    "empty-diff",
    "non-semantic"
  ])).default([]),
  comparison: z.object({
    schemaVersion: z.literal("openskill-kit.learn-v2.patch-comparison.v1"),
    role: z.enum(["agent-proposed", "user-final", "manual-edit", "standalone"]),
    relation: z.enum(["standalone", "proposed-vs-final", "manual-edit-over-agent"]),
    counterpartPatchId: z.string().min(1).optional(),
    sharedPaths: z.array(z.string()).default([]),
    proposedOnlyPaths: z.array(z.string()).default([]),
    finalOnlyPaths: z.array(z.string()).default([]),
    sharedStructuralClasses: z.array(z.enum(["api", "parser", "test", "config", "docs", "generated", "lockfile", "formatting", "unknown"])).default([]),
    proposedOnlyStructuralClasses: z.array(z.enum(["api", "parser", "test", "config", "docs", "generated", "lockfile", "formatting", "unknown"])).default([]),
    finalOnlyStructuralClasses: z.array(z.enum(["api", "parser", "test", "config", "docs", "generated", "lockfile", "formatting", "unknown"])).default([]),
    proposedOnlySymbols: z.array(z.string()).default([]),
    finalOnlySymbols: z.array(z.string()).default([]),
    proposedOnlyImports: z.array(z.string()).default([]),
    finalOnlyImports: z.array(z.string()).default([]),
    addedLineDelta: z.number().int(),
    removedLineDelta: z.number().int(),
    behaviorSignal: z.enum([
      "user-expanded-scope",
      "user-narrowed-scope",
      "user-added-tests",
      "user-removed-generated-or-lockfile",
      "user-changed-api-surface",
      "user-kept-proposal",
      "user-reworked-patch",
      "unknown"
    ]),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string()).default([])
  }).optional()
});
export type LearnV2PatchComparison = z.infer<typeof LearnV2PatchComparisonSchema>;

export const LearnV2TaskEpisodeSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.task-episode.v1"),
  id: z.string().min(1),
  traceIds: z.array(z.string()).default([]),
  sessionIds: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).min(1),
  rawRefs: z.array(z.string()).min(1),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  cwdHints: z.array(z.string()).default([]),
  branch: z.string().optional(),
  pathCluster: z.array(z.string()).default([]),
  taskHints: z.array(z.string()).default([]),
  outcome: z.enum(["accepted", "rejected", "edited", "failed", "passed", "unknown"]).default("unknown"),
  episodeConfidence: z.number().min(0).max(1),
  episodeConfidenceBreakdown: z.object({
    schemaVersion: z.literal("openskill-kit.learn-v2.episode-confidence.v1"),
    score: z.number().min(0).max(1),
    linkage: z.object({
      traceId: z.number().min(0).max(1),
      sessionId: z.number().min(0).max(1),
      branch: z.number().min(0).max(1),
      pathCluster: z.number().min(0).max(1),
      semanticTaskSimilarity: z.number().min(0).max(1),
      timeWindow: z.number().min(0).max(1),
      outcomeLink: z.number().min(0).max(1)
    }),
    risks: z.array(z.enum([
      "mixed-intent",
      "same-branch-context-switch",
      "weak-path-overlap",
      "missing-outcome",
      "imported-without-session-id",
      "single-record-only",
      "time-gap-only"
    ])).default([]),
    reasons: z.array(z.string()).default([])
  }).optional(),
  stitching: z.object({
    method: z.enum(["explicit-id", "trace-id", "session", "branch-path-time", "single-record"]),
    reasons: z.array(z.string()).default([])
  }),
  phases: z.array(z.object({
    phase: z.enum(["goal", "context-loading", "planning", "implementation", "tool-use/debugging", "validation", "review/correction", "finalization"]),
    evidenceIds: z.array(z.string().min(1)).default([]),
    summary: z.string().min(1),
    confidence: z.number().min(0).max(1)
  })).default([]),
  messages: z.array(LearnV2NormalizedEvidenceSchema).default([]),
  toolSummaries: z.array(LearnV2ToolCallSummarySchema).default([]),
  patchComparisons: z.array(LearnV2PatchComparisonSchema).default([]),
  tokenBudget: z.object({
    inputChars: z.number().int().min(0),
    compressedChars: z.number().int().min(0),
    compressionRatio: z.number().min(0).max(1)
  })
});
export type LearnV2TaskEpisode = z.infer<typeof LearnV2TaskEpisodeSchema>;

export const LearnV2EpisodeLearningBundleSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.episode-learning-bundle.v1"),
  episodeId: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  taskHints: z.array(z.string()).default([]),
  outcome: LearnV2TaskEpisodeSchema.shape.outcome,
  episodeConfidence: z.number().min(0).max(1),
  episodeConfidenceBreakdown: LearnV2TaskEpisodeSchema.shape.episodeConfidenceBreakdown,
  phases: LearnV2TaskEpisodeSchema.shape.phases,
  scope: z.object({
    paths: z.array(z.string()).default([]),
    branch: z.string().optional()
  }),
  messages: z.array(z.object({
    evidenceId: z.string().min(1),
    actor: LearnV2NormalizedEvidenceSchema.shape.actor,
    status: LearnV2NormalizedEvidenceSchema.shape.status,
    text: z.string().max(1200)
  })).default([]),
  tools: z.array(z.object({
    id: z.string().min(1),
    evidenceId: z.string().min(1).optional(),
    toolName: z.string().min(1),
    status: LearnV2ToolCallSummarySchema.shape.status,
    command: z.string().optional(),
    commandShape: LearnV2ToolCallSummarySchema.shape.commandShape,
    summary: z.string().max(800)
      .min(1),
    outputCompression: LearnV2ToolCallSummarySchema.shape.outputCompression
  })).default([]),
  patches: z.array(z.object({
    id: z.string().min(1),
    evidenceId: z.string().min(1).optional(),
    paths: z.array(z.string()).default([]),
    structuralClasses: LearnV2PatchComparisonSchema.shape.structuralClasses,
    structuralSummary: LearnV2PatchComparisonSchema.shape.structuralSummary,
    comparison: LearnV2PatchComparisonSchema.shape.comparison,
    behaviorEligible: LearnV2PatchComparisonSchema.shape.behaviorEligible,
    filterReasons: LearnV2PatchComparisonSchema.shape.filterReasons,
    addedLines: z.number().int().min(0),
    removedLines: z.number().int().min(0),
    summary: z.string().max(1000)
  })).default([]),
  instructions: z.array(z.string()).default([])
});
export type LearnV2EpisodeLearningBundle = z.infer<typeof LearnV2EpisodeLearningBundleSchema>;

export const LearnV2BehaviorAtomSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.behavior-atom.v1"),
  id: z.string().min(1),
  kind: z.enum(["preference", "workflow", "security", "verification", "dependency-policy", "review-policy", "command-policy", "scope-boundary"]),
  statement: z.string().min(1),
  polarity: z.enum(["positive", "negative", "neutral"]),
  scope: z.object({
    level: z.enum(["project", "path", "directory", "task"]),
    paths: z.array(z.string()).default([]),
    taskTypes: z.array(z.string()).default([])
  }),
  confidence: z.number().min(0).max(1),
  confidenceCap: z.number().min(0).max(1),
  sourceReliability: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()).min(1),
  rawRefs: z.array(z.string()).min(1),
  rationale: z.string().min(1),
  risk: z.enum(["low", "medium", "high"]).default("medium"),
  conditions: z.object({
    appliesWhen: z.array(z.string()).default([]),
    doesNotApplyWhen: z.array(z.string()).default([])
  }).optional(),
  activationHints: z.object({
    phrases: z.array(z.string()).default([]),
    pathGlobs: z.array(z.string()).default([]),
    commands: z.array(z.string()).default([]),
    negativeTriggers: z.array(z.string()).default([])
  }).optional(),
  counterevidence: z.array(z.object({
    evidenceId: z.string().min(1),
    reason: z.string().min(1)
  })).optional()
});
export type LearnV2BehaviorAtom = z.infer<typeof LearnV2BehaviorAtomSchema>;

export const LearnV2LlmConceptExtractionOutputSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.llm-concept-extraction-output.v1"),
  atoms: z.array(z.object({
    id: z.string().optional(),
    statement: z.string().min(8).max(500),
    kind: LearnV2BehaviorAtomSchema.shape.kind,
    polarity: LearnV2BehaviorAtomSchema.shape.polarity,
    evidenceIds: z.array(z.string().min(1)).min(1),
    confidence: z.number().min(0).max(1).optional(),
    confidenceCap: z.number().min(0).max(1).optional(),
    rationale: z.string().min(1).max(800).optional(),
    risk: LearnV2BehaviorAtomSchema.shape.risk.optional(),
    scope: z.object({
      level: LearnV2BehaviorAtomSchema.shape.scope.shape.level.optional(),
      paths: z.array(z.string().min(1)).default([]),
      taskTypes: z.array(z.string().min(1)).default([])
    }).optional(),
    appliesWhen: z.array(z.string().min(1).max(240)).default([]),
    doesNotApplyWhen: z.array(z.string().min(1).max(240)).default([]),
    activation: z.object({
      phrases: z.array(z.string().min(1).max(120)).default([]),
      pathGlobs: z.array(z.string().min(1).max(200)).default([]),
      commands: z.array(z.string().min(1).max(200)).default([]),
      negativeTriggers: z.array(z.string().min(1).max(160)).default([])
    }).optional(),
    counterevidence: z.array(z.object({
      evidenceId: z.string().min(1),
      reason: z.string().min(1).max(300)
    })).default([]),
    oneOff: z.boolean().optional()
  })).default([]),
  rejected: z.array(z.object({
    reason: z.string().min(1),
    evidenceIds: z.array(z.string()).default([])
  })).default([])
});
export type LearnV2LlmConceptExtractionOutput = z.infer<typeof LearnV2LlmConceptExtractionOutputSchema>;

export const LearnV2LlmScopeInferenceOutputSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.llm-scope-inference-output.v1"),
  conceptId: z.string().min(1),
  appliesWhen: z.array(z.string().min(1).max(240)).default([]),
  doesNotApplyWhen: z.array(z.string().min(1).max(240)).default([]),
  scope: z.object({
    level: z.enum(["project", "path", "directory", "task"]).optional(),
    paths: z.array(z.string().min(1).max(240)).default([]),
    taskTypes: z.array(z.string().min(1).max(80)).default([])
  }).default({ paths: [], taskTypes: [] }),
  activation: z.object({
    phrases: z.array(z.string().min(1).max(120)).default([]),
    pathGlobs: z.array(z.string().min(1).max(200)).default([]),
    commands: z.array(z.string().min(1).max(200)).default([]),
    negativeTriggers: z.array(z.string().min(1).max(160)).default([])
  }).default({ phrases: [], pathGlobs: [], commands: [], negativeTriggers: [] }),
  counterevidence: z.array(z.object({
    evidenceId: z.string().min(1),
    reason: z.string().min(1).max(300)
  })).default([]),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().min(1).max(800).optional(),
  rejected: z.array(z.object({
    reason: z.string().min(1).max(300),
    evidenceIds: z.array(z.string().min(1)).default([])
  })).default([])
});
export type LearnV2LlmScopeInferenceOutput = z.infer<typeof LearnV2LlmScopeInferenceOutputSchema>;

export const LearnV2LlmContradictionReviewOutputSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.llm-contradiction-review-output.v1"),
  reviewId: z.string().min(1),
  findings: z.array(z.object({
    id: z.string().min(1).optional(),
    kind: z.enum(["counterevidence", "supersession", "scope-narrowing", "human-review"]),
    conceptIds: z.array(z.string().min(1)).min(1).max(2),
    evidenceIds: z.array(z.string().min(1)).default([]),
    rationale: z.string().min(1).max(800),
    confidence: z.number().min(0).max(1).optional(),
    counterevidence: z.array(z.object({
      conceptId: z.string().min(1),
      evidenceId: z.string().min(1),
      reason: z.string().min(1).max(300)
    })).default([]),
    supersession: z.object({
      supersededId: z.string().min(1),
      supersededById: z.string().min(1),
      reason: z.string().min(1).max(300)
    }).optional(),
    narrowScopes: z.array(z.object({
      conceptId: z.string().min(1),
      paths: z.array(z.string().min(1).max(240)).optional(),
      taskTypes: z.array(z.string().min(1).max(80)).optional(),
      negativeTriggers: z.array(z.string().min(1).max(160)).optional()
    })).default([]),
    requiresHumanReview: z.boolean().default(true)
  })).default([]),
  rejected: z.array(z.object({
    reason: z.string().min(1).max(300),
    conceptIds: z.array(z.string().min(1)).default([]),
    evidenceIds: z.array(z.string().min(1)).default([])
  })).default([])
});
export type LearnV2LlmContradictionReviewOutput = z.infer<typeof LearnV2LlmContradictionReviewOutputSchema>;

const LearnV2EvalAtomKindSchema = z.enum(["preference", "workflow", "security", "verification", "dependency-policy", "review-policy", "command-policy", "scope-boundary"]);

export const LearnV2LlmEvalPlannerOutputSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.llm-eval-plan-output.v1"),
  extractionScenarios: z.array(z.object({
    schemaVersion: z.literal("openskill-kit.learn-v2.extraction-golden.v1"),
    id: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    episodeIdIncludes: z.string().min(1).max(160).optional(),
    expectedConceptText: z.array(z.string().min(1).max(240)).default([]),
    expectedKinds: z.array(LearnV2EvalAtomKindSchema).default([]),
    expectedTaskHints: z.array(z.string().min(1).max(160)).default([]),
    expectedPathText: z.array(z.string().min(1).max(200)).default([]),
    forbiddenText: z.array(z.string().min(1).max(240)).default([])
  })).default([]),
  behaviorDeltaScenarios: z.array(z.object({
    schemaVersion: z.literal("openskill-kit.learn-v2.behavior-delta-golden.v1"),
    id: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    task: z.object({
      prompt: z.string().min(1).max(500),
      paths: z.array(z.string().max(200)).default([]),
      commands: z.array(z.string().max(200)).default([]),
      taskTypes: z.array(z.string().max(80)).default([]),
      negativeSignals: z.array(z.string().max(160)).default([])
    }),
    expectedConceptText: z.array(z.string().min(1).max(240)).default([]),
    expectedKinds: z.array(LearnV2EvalAtomKindSchema).default([]),
    expectedPlanIncludes: z.array(z.string().min(1).max(240)).default([]),
    expectedPlanExcludes: z.array(z.string().min(1).max(240)).default([]),
    minActivatedConcepts: z.number().int().min(0).max(20).default(1)
  })).default([]),
  rejected: z.array(z.object({
    reason: z.string().min(1).max(300),
    conceptIds: z.array(z.string().min(1)).default([]),
    evidenceIds: z.array(z.string().min(1)).default([])
  })).default([])
});
export type LearnV2LlmEvalPlannerOutput = z.infer<typeof LearnV2LlmEvalPlannerOutputSchema>;

export const LearnV2ConceptCardSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.concept-card.v1"),
  id: z.string().min(1),
  semanticKey: z.string().min(1).optional(),
  title: z.string().min(1),
  canonicalBehavior: z.string().min(1),
  behaviorDelta: z.string().min(1),
  status: z.enum(["candidate", "staged", "active", "locked", "rejected", "conflict", "superseded", "one-off"]).default("candidate"),
  scope: z.object({
    level: z.enum(["project", "path", "directory", "task"]),
    paths: z.array(z.string()).default([]),
    taskTypes: z.array(z.string()).default([]),
    negativeTriggers: z.array(z.string()).default([]),
    reviewLocked: z.boolean().default(false),
    reviewedAt: z.string().datetime().optional()
  }),
  activation: z.object({
    phrases: z.array(z.string()).default([]),
    pathGlobs: z.array(z.string()).default([]),
    commands: z.array(z.string()).default([])
  }),
  conditions: z.object({
    appliesWhen: z.array(z.string()).default([]),
    doesNotApplyWhen: z.array(z.string()).default([])
  }).optional(),
  confidence: z.number().min(0).max(1),
  durability: z.number().min(0).max(1),
  sourceReliability: z.number().min(0).max(1),
  scoring: z.object({
    schemaVersion: z.literal("openskill-kit.learn-v2.concept-scoring.v1"),
    policyVersion: z.string().min(1),
    calibratedFrom: z.array(z.enum(["deterministic-heuristic", "golden-fixture", "human-review", "activation-outcome"])).default([]),
    supportAtomCount: z.number().int().min(0),
    evidenceCount: z.number().int().min(0),
    rawRefCount: z.number().int().min(0),
    counterevidenceCount: z.number().int().min(0),
    maxAtomConfidence: z.number().min(0).max(1),
    supportBoost: z.number().min(0).max(1),
    reliabilityPenalty: z.number().min(0).max(1),
    counterevidencePenalty: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    durability: z.number().min(0).max(1),
    sourceReliability: z.number().min(0).max(1),
    reasons: z.array(z.string()).default([]),
    penalties: z.array(z.string()).default([])
  }).optional(),
  risk: z.enum(["low", "medium", "high"]).default("medium"),
  evidenceIds: z.array(z.string()).min(1),
  rawRefs: z.array(z.string()).min(1),
  atoms: z.array(LearnV2BehaviorAtomSchema).min(1),
  counterevidence: z.array(z.object({
    evidenceId: z.string().min(1),
    reason: z.string().min(1)
  })).default([]),
  privacy: z.object({
    outputClass: z.enum(["shareable", "project-private"]),
    declassificationRequired: z.literal(true),
    rawRefsExportable: z.literal(false),
    placeholders: z.array(z.string()).default([])
  }),
  lifecycle: z.object({
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    supersedes: z.array(z.string()).default([]),
    supersededBy: z.string().optional()
  })
});
export type LearnV2ConceptCard = z.infer<typeof LearnV2ConceptCardSchema>;

export const LearnV2ReviewQueueSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.review-queue.v1"),
  generatedAt: z.string().datetime(),
  cards: z.array(LearnV2ConceptCardSchema),
  behaviorDeltaFirst: z.literal(true),
  reviewFocus: z.object({
    focusCardIds: z.array(z.string()).default([]),
    omittedCardCount: z.number().int().min(0).default(0),
    reasons: z.record(z.string(), z.array(z.string())).default({})
  }).default({
    focusCardIds: [],
    omittedCardCount: 0,
    reasons: {}
  }),
  safeBulkActions: z.array(z.enum(["accept-low-risk", "reject-one-off", "mark-superseded"])).default([]),
  conflictSummary: z.object({
    unresolvedCount: z.number().int().min(0),
    conflictTypeCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    ledgerPath: z.string().optional()
  }).default({
    unresolvedCount: 0,
    conflictTypeCounts: {}
  }),
  evidenceSnippetSummary: z.object({
    snippetCount: z.number().int().min(0),
    blockedFromCompileCount: z.number().int().min(0),
    residualRiskCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    artifactPath: z.string().optional()
  }).default({
    snippetCount: 0,
    blockedFromCompileCount: 0,
    residualRiskCounts: {}
  }),
  evidenceSnippets: z.array(z.object({
    snippetId: z.string().min(1),
    evidenceId: z.string().min(1),
    text: z.string().min(1).max(1200),
    residualRisk: z.enum(["low", "medium", "high"]),
    blockedFromCompile: z.boolean().default(false)
  })).default([]),
  driftSummary: z.object({
    healthScore: z.number().min(0).max(1),
    staleCandidateCount: z.number().int().min(0),
    reasonCounts: z.record(z.string(), z.number().int().min(0)).default({}),
    reportPath: z.string().optional()
  }).default({
    healthScore: 1,
    staleCandidateCount: 0,
    reasonCounts: {}
  }),
  artifacts: z.object({
    markdown: z.string(),
    conflictLedger: z.string().optional(),
    declassifiedSnippets: z.string().optional(),
    conceptDrift: z.string().optional()
  })
});
export type LearnV2ReviewQueue = z.infer<typeof LearnV2ReviewQueueSchema>;

export const LearnV2EvalReportSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.eval-report.v1"),
  status: z.enum(["pass", "fail"]),
  extractionGoldenCount: z.number().int().min(0),
  behaviorDeltaGoldenCount: z.number().int().min(0).default(0),
  counterfactualTraceCaseCount: z.number().int().min(0).default(0),
  replayEpisodeCount: z.number().int().min(0),
  leakCheck: z.object({
    status: z.enum(["pass", "fail"]),
    issues: z.array(z.string()).default([])
  }),
  tokenBudget: z.object({
    rawChars: z.number().int().min(0),
    compressedChars: z.number().int().min(0),
    compressionRatio: z.number().min(0).max(1)
  }),
  results: z.array(z.object({
    id: z.string(),
    status: z.enum(["pass", "fail"]),
    checks: z.array(z.object({
      name: z.string(),
      status: z.enum(["pass", "fail"]),
      details: z.string()
    }))
  })),
  artifacts: z.object({
    json: z.string(),
    markdown: z.string(),
    counterfactualCases: z.string().optional(),
    behaviorDeltaCases: z.string().optional()
  })
});
export type LearnV2EvalReport = z.infer<typeof LearnV2EvalReportSchema>;

// ---------------------------------------------------------------------------
// Plan §27.7: Conditional command policy
// Distinct from simple command labels; encodes conditional intent with evidence.
// ---------------------------------------------------------------------------

export const LearnV2CommandPolicyRuleSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.command-policy-rule.v1"),
  id: z.string().min(1),
  projectId: z.string().min(1),
  command: z.string().min(1),
  status: z.enum(["available", "suggested", "required", "avoid"]),
  appliesWhen: z.array(z.string()).default([]),
  doesNotApplyWhen: z.array(z.string()).default([]),
  scopePaths: z.array(z.string()).default([]),
  taskTypes: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  evidenceConceptIds: z.array(z.string()).default([]),
  failureModes: z.array(z.string()).default([]),
  costClass: z.enum(["cheap", "normal", "expensive", "destructive"]).default("normal"),
  rationale: z.string().default(""),
  generatedAt: z.string().datetime(),
  sourceEpisodeIds: z.array(z.string()).default([])
});
export type LearnV2CommandPolicyRule = z.infer<typeof LearnV2CommandPolicyRuleSchema>;

export const LearnV2CommandPolicyArtifactSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.command-policy-artifact.v1"),
  projectId: z.string().min(1),
  generatedAt: z.string().datetime(),
  rules: z.array(LearnV2CommandPolicyRuleSchema).default([]),
  artifactPaths: z.object({
    json: z.string(),
    markdown: z.string()
  })
});
export type LearnV2CommandPolicyArtifact = z.infer<typeof LearnV2CommandPolicyArtifactSchema>;

// ---------------------------------------------------------------------------
// Plan §14.4: Concept conflict ledger
// Tracks contradictions, supersession, scope overlap, security-vs-convenience.
// ---------------------------------------------------------------------------

export const LearnV2ConceptConflictSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.concept-conflict.v1"),
  id: z.string().min(1),
  projectId: z.string().min(1),
  conceptIds: z.array(z.string().min(1)).min(1),
  conflictType: z.enum([
    "direct-opposite",
    "scope-overlap",
    "newer-supersedes-older",
    "command-policy-conflict",
    "security-vs-convenience",
    "style-disagreement"
  ]),
  explanation: z.string().min(1),
  evidenceRefs: z.array(z.string()).default([]),
  suggestedResolution: z.enum([
    "narrow-scope",
    "prefer-newer-explicit-user-correction",
    "keep-both-with-conditions",
    "reject-lower-confidence",
    "human-review"
  ]),
  detectedAt: z.string().datetime(),
  resolved: z.boolean().default(false),
  resolutionNote: z.string().optional(),
  resolutionAction: z.enum(["auto-supersede", "auto-narrow", "manual", "none"]).default("none")
});
export type LearnV2ConceptConflict = z.infer<typeof LearnV2ConceptConflictSchema>;

export const LearnV2ConflictLedgerSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.conflict-ledger.v1"),
  projectId: z.string().min(1),
  updatedAt: z.string().datetime(),
  conflicts: z.array(LearnV2ConceptConflictSchema).default([]),
  unresolvedCount: z.number().int().min(0)
});
export type LearnV2ConflictLedger = z.infer<typeof LearnV2ConflictLedgerSchema>;

// ---------------------------------------------------------------------------
// Plan §16.2: Standalone declassified evidence snippet
// Reusable declassification artifact with placeholder maps + residual risk.
// ---------------------------------------------------------------------------

export const LearnV2DeclassifiedEvidenceSnippetSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.declassified-snippet.v1"),
  id: z.string().min(1),
  evidenceId: z.string().min(1),
  rawRef: z.string().min(1),
  text: z.string().min(1),
  placeholderMap: z.record(z.string(), z.object({
    placeholder: z.string().min(1),
    detector: z.string().min(1),
    explanation: z.string().min(1)
  })).default({}),
  risk: z.object({
    redacted: z.boolean().default(true),
    residualRisk: z.enum(["low", "medium", "high"]).default("low"),
    blockedFromCompile: z.boolean().default(false)
  }),
  createdAt: z.string().datetime()
});
export type LearnV2DeclassifiedEvidenceSnippet = z.infer<typeof LearnV2DeclassifiedEvidenceSnippetSchema>;

export const LearnV2DeclassifiedEvidenceSnippetArtifactSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.declassified-snippet-artifact.v1"),
  generatedAt: z.string().datetime(),
  snippets: z.array(LearnV2DeclassifiedEvidenceSnippetSchema).default([]),
  counts: z.object({
    total: z.number().int().min(0),
    redacted: z.number().int().min(0),
    blockedFromCompile: z.number().int().min(0),
    residualRiskCounts: z.record(z.string(), z.number().int().min(0)).default({})
  }),
  artifacts: z.object({
    json: z.string(),
    markdown: z.string()
  })
});
export type LearnV2DeclassifiedEvidenceSnippetArtifact = z.infer<typeof LearnV2DeclassifiedEvidenceSnippetArtifactSchema>;

// ---------------------------------------------------------------------------
// Plan §10.1.1: OskTraceContext — deterministic trace ID propagation
// ---------------------------------------------------------------------------

export const LearnV2OskTraceContextSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.trace-context.v1"),
  projectId: z.string().min(1),
  worktree: z.string().min(1),
  oskSessionId: z.string().min(1),
  oskEpisodeId: z.string().min(1),
  oskTraceId: z.string().min(1),
  opencodeSessionId: z.string().optional(),
  gitBranch: z.string().optional(),
  gitHead: z.string().optional(),
  createdAt: z.string().datetime()
});
export type LearnV2OskTraceContext = z.infer<typeof LearnV2OskTraceContextSchema>;

// ---------------------------------------------------------------------------
// Evidence quality scoring at intake (efficiency improvement)
// ---------------------------------------------------------------------------

export const LearnV2EvidenceQualityScoreSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.evidence-quality.v1"),
  evidenceId: z.string().min(1),
  score: z.number().min(0).max(1),
  tier: z.enum(["critical", "high", "medium", "low", "noise"]),
  signals: z.array(z.string()).default([]),
  estimatedAtomYield: z.number().int().min(0),
  recommendedAction: z.enum(["process-immediately", "process-batch", "defer", "skip"]).default("process-batch")
});
export type LearnV2EvidenceQualityScore = z.infer<typeof LearnV2EvidenceQualityScoreSchema>;

// ---------------------------------------------------------------------------
// Concept drift detection
// ---------------------------------------------------------------------------

export const LearnV2ConceptDriftReportSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.concept-drift.v1"),
  generatedAt: z.string().datetime(),
  totalActiveConcepts: z.number().int().min(0),
  staleCandidates: z.array(z.object({
    conceptId: z.string().min(1),
    reason: z.enum(["stale-no-outcomes", "low-activation", "recent-negative-outcomes", "supersession-candidate", "evidence-expired"]),
    ageDays: z.number().int().min(0),
    lastOutcomeDays: z.number().int().min(0).optional(),
    activationCount: z.number().int().min(0),
    negativeOutcomeCount: z.number().int().min(0),
    suggestion: z.string().min(1)
  })).default([]),
  healthScore: z.number().min(0).max(1)
});
export type LearnV2ConceptDriftReport = z.infer<typeof LearnV2ConceptDriftReportSchema>;
