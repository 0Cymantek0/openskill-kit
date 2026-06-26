import path from "node:path";
import { createHash } from "node:crypto";
import { createLocalSandboxPolicy } from "../sandbox/policy.js";
import { runSandboxCommand } from "../sandbox/runner.js";
import { readVirtualTestSuite, writeVirtualTestSuiteExecution } from "./store.js";
import {
  VirtualTestSuiteExecutionSchema,
  type VirtualTestCase,
  type VirtualTestSuiteExecution
} from "./schema.js";

export interface RunVirtualTestSuiteOptions {
  split?: "visible" | "holdout" | "all";
  timeoutMs?: number;
  maxOutputBytes?: number;
  now?: Date;
}

export async function runVirtualTestSuite(
  projectRoot: string,
  taskId: string,
  suiteId: string,
  options: RunVirtualTestSuiteOptions = {}
): Promise<VirtualTestSuiteExecution> {
  const root = path.resolve(projectRoot);
  const split = options.split ?? "visible";
  const suite = await readVirtualTestSuite(root, taskId, suiteId);
  const selected = suite.cases.filter((testCase) => split === "all" || testCase.split === split);
  const policy = createLocalSandboxPolicy({
    projectRoot: root,
    allowNetwork: false,
    allowedCommands: [process.execPath, "node"],
    timeoutMs: options.timeoutMs ?? 30000,
    maxOutputBytes: options.maxOutputBytes ?? 256 * 1024
  });
  const results = [];
  for (const testCase of selected) {
    if (testCase.runner !== "node" || testCase.status !== "ready") {
      results.push({
        caseId: testCase.id,
        split: testCase.split,
        status: "skipped" as const,
        args: [],
        durationMs: 0,
        message: `Skipped ${testCase.runner} case with status ${testCase.status}`
      });
      continue;
    }
    const command = resolveCaseCommand(testCase);
    if (!command) {
      results.push({
        caseId: testCase.id,
        split: testCase.split,
        status: "blocked" as const,
        args: [],
        durationMs: 0,
        message: "Verifier case has no executable command"
      });
      continue;
    }
    const result = await runSandboxCommand(policy, {
      command: command.command,
      args: command.args,
      cwd: root
    });
    results.push({
      caseId: testCase.id,
      split: testCase.split,
      status: result.status,
      command: command.label,
      args: command.args,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      message: result.blockedReason ?? (result.status === "pass" ? "Verifier case passed" : "Verifier case failed")
    });
  }
  const summary = {
    pass: results.filter((result) => result.status === "pass").length,
    fail: results.filter((result) => result.status === "fail").length,
    blocked: results.filter((result) => result.status === "blocked").length,
    timeout: results.filter((result) => result.status === "timeout").length,
    skipped: results.filter((result) => result.status === "skipped").length
  };
  const executedAt = (options.now ?? new Date()).toISOString();
  const execution = VirtualTestSuiteExecutionSchema.parse({
    schemaVersion: "openskill-kit.virtual-test-execution.v1",
    id: `vtexec_${shortHash(`${suiteId}:${split}:${executedAt}`)}`,
    taskId,
    suiteId,
    split,
    executedAt,
    results,
    summary
  });
  const absolutePath = await writeVirtualTestSuiteExecution(root, execution);
  const withPath = VirtualTestSuiteExecutionSchema.parse({
    ...execution,
    resultPath: path.relative(root, absolutePath).replace(/\\/g, "/")
  });
  await writeVirtualTestSuiteExecution(root, withPath);
  return withPath;
}

function resolveCaseCommand(testCase: VirtualTestCase): { command: string; args: string[]; label: string } | undefined {
  const [rawCommand, ...rawArgs] = testCase.command;
  if (!rawCommand) return undefined;
  const normalized = rawCommand.toLowerCase();
  if (normalized === "node" || normalized.endsWith("/node") || normalized.endsWith("\\node") || normalized.endsWith("node.exe")) {
    return { command: process.execPath, args: rawArgs, label: "node" };
  }
  return { command: rawCommand, args: rawArgs, label: rawCommand };
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
