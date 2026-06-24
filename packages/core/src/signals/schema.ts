import { z } from "zod";

export const SignalSchema = z.object({
  schemaVersion: z.literal("openskill-kit.signal.v1"),
  id: z.string().min(1),
  eventIds: z.array(z.string()).min(1),
  extractedAt: z.string().datetime(),
  kind: z.enum([
    "explicit-preference",
    "acceptance",
    "rejection",
    "edit-delta",
    "tool-choice",
    "test-outcome",
    "review-feedback",
    "repo-pattern"
  ]),
  category: z.enum(["tooling", "architecture", "testing", "frontend", "backend", "api", "security", "workflow", "general"]).default("general"),
  scope: z.object({
    level: z.enum(["project", "path", "user"]),
    paths: z.array(z.string()).default([])
  }),
  statement: z.string().min(1),
  polarity: z.enum(["positive", "negative", "neutral"]).default("positive"),
  weight: z.number().min(0).max(1),
  evidence: z.array(z.object({
    eventId: z.string(),
    quote: z.string().optional(),
    file: z.string().optional(),
    command: z.string().optional()
  })).default([])
});

export type Signal = z.infer<typeof SignalSchema>;
