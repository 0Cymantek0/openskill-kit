import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DoctorReport {
  status: "pass" | "warn" | "fail";
  checks: DoctorCheck[];
}

export async function runDoctor(projectRoot: string, homeDir = os.homedir()): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  checks.push(checkNode());
  checks.push(await commandCheck("git", ["--version"], "Git availability"));
  checks.push(await npmCheck());
  checks.push(await commandCheck("docker", ["--version"], "optional Docker availability", true));
  checks.push(await repoCheck(projectRoot));
  checks.push(await writableCheck(path.join(projectRoot, ".opencode", "skills"), "OpenCode project skill target"));
  checks.push(await writableCheck(path.join(projectRoot, ".agents", "skills"), "Agents project skill target"));
  checks.push(await writableCheck(path.join(homeDir, ".config", "opencode", "skills"), "OpenCode global skill target"));
  checks.push(await writableCheck(path.join(homeDir, ".agents", "skills"), "Agents global skill target"));
  checks.push(optionalSecretCheck("OPENAI_API_KEY"));
  checks.push(optionalSecretCheck("ANTHROPIC_API_KEY"));
  const status = checks.some((check) => check.status === "fail") ? "fail" : checks.some((check) => check.status === "warn") ? "warn" : "pass";
  return { status, checks };
}

function checkNode(): DoctorCheck {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  return major >= 20
    ? { name: "Node version", status: "pass", message: `Node ${process.versions.node}` }
    : { name: "Node version", status: "fail", message: `Node 20+ required, found ${process.versions.node}` };
}

async function commandCheck(command: string, args: string[], name: string, optional = false): Promise<DoctorCheck> {
  const candidates = process.platform === "win32" ? [command, `${command}.cmd`, `${command}.exe`] : [command];
  for (const candidate of candidates) {
    try {
      const result = await execFileAsync(candidate, args, { timeout: 5000 });
      return { name, status: "pass", message: result.stdout.trim() || `${command} available` };
    } catch {
      // Try next platform-specific command name.
    }
  }
  return { name, status: optional ? "warn" : "fail", message: `${command} not available` };
}

async function npmCheck(): Promise<DoctorCheck> {
  if (process.env.npm_execpath) {
    return { name: "npm availability", status: "pass", message: "npm available" };
  }
  return commandCheck("npm", ["--version"], "npm availability");
}

async function repoCheck(projectRoot: string): Promise<DoctorCheck> {
  try {
    await execFileAsync("git", ["-C", projectRoot, "rev-parse", "--show-toplevel"], { timeout: 5000 });
    return { name: "Git repository", status: "pass", message: "Git worktree detected" };
  } catch {
    return { name: "Git repository", status: "warn", message: "No Git worktree detected" };
  }
}

async function writableCheck(targetDir: string, name: string): Promise<DoctorCheck> {
  try {
    await fs.mkdir(targetDir, { recursive: true });
    const probe = path.join(targetDir, `.openskill-kit-write-probe-${process.pid}`);
    await fs.writeFile(probe, "ok", "utf8");
    await fs.rm(probe, { force: true });
    return { name, status: "pass", message: "Writable" };
  } catch (error) {
    return { name, status: "fail", message: error instanceof Error ? error.message : String(error) };
  }
}

function optionalSecretCheck(name: string): DoctorCheck {
  return process.env[name]
    ? { name: `Optional ${name}`, status: "pass", message: "Configured (value hidden)" }
    : { name: `Optional ${name}`, status: "warn", message: "Not configured" };
}
