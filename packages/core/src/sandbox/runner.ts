import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { SandboxPolicy } from "./policy.js";
import { commandName, isPathInside } from "./policy.js";

const execFileAsync = promisify(execFile);

export interface SandboxCommand {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface SandboxCommandResult {
  status: "pass" | "fail" | "blocked" | "timeout";
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  blockedReason?: string;
}

export async function runSandboxCommand(policy: SandboxPolicy, commandInput: SandboxCommand): Promise<SandboxCommandResult> {
  const started = Date.now();
  const args = commandInput.args ?? [];
  const cwd = path.resolve(commandInput.cwd ?? policy.projectRoot);
  const blockedReason = validateCommand(policy, commandInput.command, args, cwd);
  if (blockedReason) {
    return {
      status: "blocked",
      command: commandInput.command,
      args,
      cwd: path.relative(policy.projectRoot, cwd) || ".",
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - started,
      blockedReason
    };
  }

  try {
    const result = await execFileAsync(commandInput.command, args, {
      cwd,
      env: buildSandboxEnv(policy, commandInput.env),
      timeout: policy.timeoutMs,
      maxBuffer: policy.maxOutputBytes,
      windowsHide: true
    });
    return {
      status: "pass",
      command: commandInput.command,
      args,
      cwd: path.relative(policy.projectRoot, cwd) || ".",
      exitCode: 0,
      stdout: truncate(result.stdout, policy.maxOutputBytes),
      stderr: truncate(result.stderr, policy.maxOutputBytes),
      durationMs: Date.now() - started
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string | null; killed?: boolean };
    const timedOut = err.killed === true || err.code === "ETIMEDOUT";
    return {
      status: timedOut ? "timeout" : "fail",
      command: commandInput.command,
      args,
      cwd: path.relative(policy.projectRoot, cwd) || ".",
      exitCode: typeof err.code === "number" ? err.code : null,
      stdout: truncate(err.stdout ?? "", policy.maxOutputBytes),
      stderr: truncate(err.stderr ?? err.message, policy.maxOutputBytes),
      durationMs: Date.now() - started
    };
  }
}

function validateCommand(policy: SandboxPolicy, command: string, args: string[], cwd: string): string | undefined {
  if (!isPathInside(policy.projectRoot, cwd)) {
    return "cwd must stay inside project root";
  }
  const normalizedCommand = commandName(command);
  if (!policy.allowedCommands.map(commandName).includes(normalizedCommand)) {
    return `command not allowed by sandbox policy: ${normalizedCommand}`;
  }
  if (args.some((arg) => /[|;&`]/.test(arg))) {
    return "shell metacharacters are blocked in arguments";
  }
  return undefined;
}

function buildSandboxEnv(policy: SandboxPolicy, extraEnv?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const allowedBaseKeys = new Set(["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE"]);
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowedBaseKeys) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(extraEnv ?? {})) {
    if (!value || shouldRedact(policy, key)) continue;
    env[key] = value;
  }
  env.OPENSKILL_KIT_SANDBOX = "local-process";
  env.OPENSKILL_KIT_NETWORK_POLICY = policy.allowNetwork ? "allow" : "deny-metadata-only";
  return env;
}

function shouldRedact(policy: SandboxPolicy, key: string): boolean {
  return policy.redactEnvPatterns.some((pattern) => key.toUpperCase().includes(pattern));
}

function truncate(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= maxBytes) return value;
  return buffer.subarray(0, maxBytes).toString("utf8") + "\n[truncated]";
}
