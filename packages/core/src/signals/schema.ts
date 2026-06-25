import { z } from "zod";
import { PreferenceCategories, PreferencePolarities, ScopeLevels, SignalKinds } from "../schema/constants.js";

export const SignalSchema = z.object({
  schemaVersion: z.literal("openskill-kit.signal.v1"),
  id: z.string().min(1),
  eventIds: z.array(z.string()).min(1),
  extractedAt: z.string().datetime(),
  kind: z.enum(SignalKinds),
  category: z.enum(PreferenceCategories).default("general"),
  scope: z.object({
    level: z.enum(ScopeLevels),
    paths: z.array(z.string()).default([])
  }),
  statement: z.string().min(1),
  polarity: z.enum(PreferencePolarities).default("positive"),
  weight: z.number().min(0).max(1),
  evidence: z.array(z.object({
    eventId: z.string(),
    quote: z.string().optional(),
    file: z.string().optional(),
    command: z.string().optional()
  })).default([])
});

export type Signal = z.infer<typeof SignalSchema>;
