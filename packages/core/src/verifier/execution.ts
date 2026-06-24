import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { SandboxPolicy } from "../sandbox/policy.js";
import type { SandboxCommandResult } from "../sandbox/runner.js";
import type { FixtureCheckResult } from "./fixture.js";

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
    mode: z.enum(["local-process", "docker"]),
    allowNetwork: z.boolean(),
    dockerImage: z.string().optional(),
    timeoutMs: z.number().int().min(100),
    maxOutputBytes: z.number().int().min(1024),
    limitations: z.array(z.string())
  }).optional(),
  visibleResults: z.array(AssertionResultSchema),
  holdoutResults: z.array(AssertionResultSchema),
  fixtureResults: z.array(z.object({
    id: z.string().min(1),
    status: z.enum(["pass", "fail", "blocked", "timeout", "missing"]),
    message: z.string().min(1)
  })),
  commandResults: z.array(z.object({
    id: z.string().min(1),
    assertionId: z.string().min(1),
    status: z.enum(["pass", "fail", "blocked", "timeout", "skipped"]),
    message: z.string().min(1),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    exitCode: z.number().nullable().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional()
  })).default([]),
  mutationResults: z.array(z.object({
    id: z.string().min(1),
    status: z.enum(["killed", "survived", "skipped", "error"]),
    message: z.string().min(1)
  })).default([]),
  summary: z.object({
    pass: z.number().int().min(0),
    fail: z.number().int().min(0),
    warning: z.number().int().min(0),
    visible: z.number().int().min(0),
    holdout: z.number().int().min(0),
    fixtures: z.number().int().min(0),
    commands: z.number().int().min(0),
    mutations: z.number().int().min(0)
  }),
  limitations: z.array(z.string())
});

export type AssertionResult = z.infer<typeof AssertionResultSchema>;
export interface VerifierCommandResult {
  id: string;
  assertionId: string;
  status: "pass" | "fail" | "blocked" | "timeout" | "skipped";
  message: string;
  command?: SandboxCommandResult;
}
export interface VerifierMutationResult {
  id: string;
  status: "killed" | "survived" | "skipped" | "error";
  message: string;
}
export type VerifierExecution = z.infer<typeof VerifierExecutionSchema>;

export function buildVerifierExecution(input: {
  skillName?: string;
  generatedAt?: Date;
  assertionResults: AssertionResult[];
  visibleAssertionIds: string[];
  holdoutAssertionIds: string[];
  sandboxPolicy?: SandboxPolicy;
  fixtureResults?: FixtureCheckResult[];
  commandResults?: VerifierCommandResult[];
  mutationResults?: VerifierMutationResult[];
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
      dockerImage: input.sandboxPolicy.dockerImage,
      timeoutMs: input.sandboxPolicy.timeoutMs,
      maxOutputBytes: input.sandboxPolicy.maxOutputBytes,
      limitations: input.sandboxPolicy.limitations
    } : undefined,
    visibleResults,
    holdoutResults,
    fixtureResults: (input.fixtureResults ?? []).map((fixture) => ({
      id: fixture.id,
      status: fixture.status,
      message: fixture.message
    })),
    commandResults: (input.commandResults ?? []).map((result) => ({
      id: result.id,
      assertionId: result.assertionId,
      status: result.status,
      message: result.message,
      command: result.command?.command,
      args: result.command?.args,
      cwd: result.command?.cwd,
      exitCode: result.command?.exitCode,
      stdout: result.command?.stdout,
      stderr: result.command?.stderr
    })),
    mutationResults: input.mutationResults ?? [],
    summary: {
      pass: all.filter((result) => result.status === "pass").length,
      fail: all.filter((result) => result.status === "fail").length,
      warning: all.filter((result) => result.status === "warning").length,
      visible: visibleResults.length,
      holdout: holdoutResults.length,
      fixtures: input.fixtureResults?.length ?? 0,
      commands: input.commandResults?.length ?? 0,
      mutations: input.mutationResults?.length ?? 0
    },
    limitations: [
      input.commandResults?.some((result) => result.status !== "skipped")
        ? "This execution includes explicit repository command checks."
        : "This execution validates package-level assertions only unless repo command checks are enabled.",
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
