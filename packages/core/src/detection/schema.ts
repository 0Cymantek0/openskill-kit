import { z } from "zod";

export const AgentSurfaceSchema = z.object({
  schemaVersion: z.literal("openskill-kit.agent-surface.v1"),
  id: z.string().min(1),
  detectedAt: z.string().datetime(),
  adapter: z.enum(["agents-md", "codex", "claude-code", "cursor", "mcp", "skills", "hooks", "openskill-kit", "other"]),
  surfaceType: z.enum([
    "instruction-file",
    "override-file",
    "rule-file",
    "rule-directory",
    "mcp-config",
    "skill",
    "skill-directory",
    "hook-config",
    "memory-store",
    "interaction-export",
    "compiled-artifact",
    "unknown"
  ]),
  scope: z.enum(["project", "user", "global"]),
  path: z.string().min(1),
  relativePath: z.string().optional(),
  exists: z.boolean(),
  readPolicy: z.enum(["metadata-only", "safe-read", "explicit-import"]),
  writePolicy: z.enum(["managed-block", "generated-only", "preview-only", "explicit-apply", "never"]),
  privacyRisk: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
  metadata: z.object({
    byteCount: z.number().int().min(0).optional(),
    lineCount: z.number().int().min(0).optional(),
    mtime: z.string().datetime().optional(),
    managedBlockPresent: z.boolean().optional(),
    oskGenerated: z.boolean().optional(),
    directory: z.boolean().optional(),
    childCount: z.number().int().min(0).optional(),
    mcpConfigValid: z.boolean().optional(),
    mcpServerNames: z.array(z.string()).optional(),
    openskillKitAttached: z.boolean().optional(),
    openskillKitCommand: z.string().optional(),
    mcpRemoteServerCount: z.number().int().min(0).optional(),
    mcpIssue: z.string().optional()
  }).default({}),
  notes: z.array(z.string()).default([])
});

export type AgentSurface = z.infer<typeof AgentSurfaceSchema>;

export const AgentDetectionIssueSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "warn", "block"]),
  surfaceIds: z.array(z.string().min(1)).default([]),
  message: z.string().min(1),
  recommendation: z.string().min(1)
});

export type AgentDetectionIssue = z.infer<typeof AgentDetectionIssueSchema>;

export const AgentEnvironmentDetectionReportSchema = z.object({
  schemaVersion: z.literal("openskill-kit.agent-environment-detection.v1"),
  projectRoot: z.string().min(1),
  detectedAt: z.string().datetime(),
  includeUserSurfaces: z.boolean(),
  includeSensitivePreview: z.boolean(),
  surfaces: z.array(AgentSurfaceSchema),
  summary: z.object({
    total: z.number().int().min(0),
    byAdapter: z.record(z.string(), z.number().int().min(0)),
    bySurfaceType: z.record(z.string(), z.number().int().min(0)),
    writableManagedBlocks: z.number().int().min(0),
    previewOnly: z.number().int().min(0),
    metadataOnly: z.number().int().min(0),
    highPrivacyRisk: z.number().int().min(0),
    issueCount: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    blockedCount: z.number().int().min(0)
  }),
  issues: z.array(AgentDetectionIssueSchema).default([]),
  nextActions: z.array(z.string().min(1)).default([]),
  artifacts: z.object({
    surfacesPath: z.string().optional(),
    lastScanPath: z.string().optional(),
    reportPath: z.string().optional()
  }).default({})
});

export type AgentEnvironmentDetectionReport = z.infer<typeof AgentEnvironmentDetectionReportSchema>;
