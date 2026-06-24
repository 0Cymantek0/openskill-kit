import { z } from "zod";

export const EventFileSchema = z.object({
  path: z.string(),
  action: z.enum(["read", "write", "edit", "delete", "rename", "unknown"]),
  beforeHash: z.string().optional(),
  afterHash: z.string().optional()
});

export const EventCommandSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  exitCode: z.number().nullable().optional(),
  status: z.enum(["pass", "fail", "blocked", "timeout", "unknown"]).default("unknown")
});

export const EventSchema = z.object({
  schemaVersion: z.literal("openskill-kit.event.v1"),
  id: z.string().min(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  turnId: z.string().optional(),
  timestamp: z.string().datetime(),
  source: z.object({
    adapter: z.string(),
    agentName: z.string().optional(),
    agentVersion: z.string().optional(),
    host: z.string().optional()
  }),
  eventType: z.enum([
    "session-start",
    "instructions-loaded",
    "user-prompt-submit",
    "assistant-message",
    "pre-tool-use",
    "post-tool-use",
    "post-tool-use-failure",
    "file-changed",
    "task-created",
    "task-completed",
    "permission-denied",
    "user-accepted",
    "user-rejected",
    "user-edited",
    "test-result",
    "review-comment",
    "session-end"
  ]),
  intent: z.string().optional(),
  rawRef: z.string().optional(),
  normalized: z.record(z.string(), z.unknown()).default({}),
  files: z.array(EventFileSchema).default([]),
  commands: z.array(EventCommandSchema).default([]),
  privacy: z.object({
    redacted: z.boolean(),
    rawStored: z.boolean(),
    containsUserText: z.boolean().default(false),
    containsCode: z.boolean().default(false)
  })
});

export type OpenSkillEvent = z.infer<typeof EventSchema>;

export const EventInputSchema = EventSchema.partial({
  id: true,
  projectId: true,
  timestamp: true,
  source: true,
  normalized: true,
  files: true,
  commands: true,
  privacy: true
}).extend({
  schemaVersion: z.literal("openskill-kit.event.v1").optional()
});

export type OpenSkillEventInput = z.input<typeof EventInputSchema>;
