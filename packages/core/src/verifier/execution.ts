import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { SandboxPolicy } from "../sandbox/policy.js";

export const AssertionResultSchema = z.object({
  assertionId: z.string().min(1),
  status: z.enum(["pass", "fail", "warning"]),
  message: z.string().min(1)
});

export const VerifierExecutionSchema = z.object({
  schemaVersion: z.literal("openskill-kit.verifier-execution.v0"),
  skillName: z.string().min(1).optional(),
  generatedAt: z.string().datetime(),
  sandbox: z.object({
    mode: z.literal("local-process"),
    allowNetwork: z.boolean(),
    timeoutMs: z.number().int().min(100),
    maxOutputBytes: z.number().int().min(1024),
    limitations: z.array(z.string())
  }).optional(),
  visibleResults: z.array(AssertionResultSchema),
  holdoutResults: z.array(AssertionResultSchema),
  summary: z.object({
    pass: z.number().int().min(0),
    fail: z.number().int().min(0),
    warning: z.number().int().min(0),
    visible: z.number().int().min(0),
    holdout: z.number().int().min(0)
  }),
  limitations: z.array(z.string())
});

export type AssertionResult = z.infer<typeof AssertionResultSchema>;
export type VerifierExecution = z.infer<typeof VerifierExecutionSchema>;

export function buildVerifierExecution(input: {
  skillName?: string;
  generatedAt?: Date;
  assertionResults: AssertionResult[];
  visibleAssertionIds: string[];
  holdoutAssertionIds: string[];
  sandboxPolicy?: SandboxPolicy;
}): VerifierExecution {
  const visible = new Set(input.visibleAssertionIds);
  const holdout = new Set(input.holdoutAssertionIds);
  const visibleResults = input.assertionResults.filter((result) => visible.has(result.assertionId));
  const holdoutResults = input.assertionResults.filter((result) => holdout.has(result.assertionId));
  const all = [...visibleResults, ...holdoutResults];
  return {
    schemaVersion: "openskill-kit.verifier-execution.v0",
    skillName: input.skillName,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    sandbox: input.sandboxPolicy ? {
      mode: input.sandboxPolicy.mode,
      allowNetwork: input.sandboxPolicy.allowNetwork,
      timeoutMs: input.sandboxPolicy.timeoutMs,
      maxOutputBytes: input.sandboxPolicy.maxOutputBytes,
      limitations: input.sandboxPolicy.limitations
    } : undefined,
    visibleResults,
    holdoutResults,
    summary: {
      pass: all.filter((result) => result.status === "pass").length,
      fail: all.filter((result) => result.status === "fail").length,
      warning: all.filter((result) => result.status === "warning").length,
      visible: visibleResults.length,
      holdout: holdoutResults.length
    },
    limitations: [
      "This execution validates package-level assertions only.",
      "Holdout assertions are deterministic local checks, not hidden benchmark tests."
    ]
  };
}

export async function writeVerifierExecution(file: string, execution: VerifierExecution): Promise<void> {
  VerifierExecutionSchema.parse(execution);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(execution, null, 2), "utf8");
}

export async function readVerifierExecution(file: string): Promise<VerifierExecution> {
  return VerifierExecutionSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
}
