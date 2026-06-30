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
  toolName: z.string().min(1),
  status: z.enum(["pass", "fail", "blocked", "timeout", "unknown"]),
  command: z.string().optional(),
  paths: z.array(z.string()).default([]),
  summary: z.string().min(1),
  omittedBytes: z.number().int().min(0).default(0)
});
export type LearnV2ToolCallSummary = z.infer<typeof LearnV2ToolCallSummarySchema>;

export const LearnV2PatchComparisonSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["agent-patch", "manual-edit", "final-patch", "diff-summary"]),
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
  ignoredGenerated: z.boolean().default(false)
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
  stitching: z.object({
    method: z.enum(["explicit-id", "trace-id", "session", "branch-path-time", "single-record"]),
    reasons: z.array(z.string()).default([])
  }),
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
  risk: z.enum(["low", "medium", "high"]).default("medium")
});
export type LearnV2BehaviorAtom = z.infer<typeof LearnV2BehaviorAtomSchema>;

export const LearnV2ConceptCardSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.concept-card.v1"),
  id: z.string().min(1),
  title: z.string().min(1),
  canonicalBehavior: z.string().min(1),
  behaviorDelta: z.string().min(1),
  status: z.enum(["candidate", "active", "locked", "rejected", "conflict", "superseded", "one-off"]).default("candidate"),
  scope: z.object({
    level: z.enum(["project", "path", "directory", "task"]),
    paths: z.array(z.string()).default([]),
    taskTypes: z.array(z.string()).default([]),
    negativeTriggers: z.array(z.string()).default([])
  }),
  activation: z.object({
    phrases: z.array(z.string()).default([]),
    pathGlobs: z.array(z.string()).default([]),
    commands: z.array(z.string()).default([])
  }),
  confidence: z.number().min(0).max(1),
  durability: z.number().min(0).max(1),
  sourceReliability: z.number().min(0).max(1),
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
  safeBulkActions: z.array(z.enum(["accept-low-risk", "reject-one-off", "mark-superseded"])).default([]),
  artifacts: z.object({
    markdown: z.string()
  })
});
export type LearnV2ReviewQueue = z.infer<typeof LearnV2ReviewQueueSchema>;

export const LearnV2EvalReportSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.eval-report.v1"),
  status: z.enum(["pass", "fail"]),
  extractionGoldenCount: z.number().int().min(0),
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
    markdown: z.string()
  })
});
export type LearnV2EvalReport = z.infer<typeof LearnV2EvalReportSchema>;
