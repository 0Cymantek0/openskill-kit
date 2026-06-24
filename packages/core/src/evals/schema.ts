import { z } from "zod";

export const BehaviorEvalScenarioSchema = z.object({
  schemaVersion: z.literal("openskill-kit.eval-scenario.v1"),
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  expectedPreferenceText: z.array(z.string().min(1)).default([])
});

export type BehaviorEvalScenario = z.infer<typeof BehaviorEvalScenarioSchema>;

export const BehaviorEvalReportSchema = z.object({
  schemaVersion: z.literal("openskill-kit.eval-report.v1"),
  status: z.enum(["pass", "fail"]),
  scenarioCount: z.number().int().min(0),
  passCount: z.number().int().min(0),
  adherence: z.number().min(0).max(1),
  results: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["pass", "fail"]),
    missing: z.array(z.string())
  })),
  artifacts: z.object({
    json: z.string(),
    markdown: z.string()
  })
});

export type BehaviorEvalReport = z.infer<typeof BehaviorEvalReportSchema>;
