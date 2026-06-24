import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "../storage/atomic.js";

export type AgentHookTarget = "project" | "global";

export interface AgentDoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface AgentDoctorReport {
  schemaVersion: "openskill-kit.agent-doctor.v1";
  status: "pass" | "warn" | "fail";
  checks: AgentDoctorCheck[];
}

export interface InstallAgentHooksOptions {
  projectRoot: string;
  target: AgentHookTarget;
  homeDir?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export interface InstallAgentHooksResult {
  schemaVersion: "openskill-kit.agent-hooks.v1";
  status: "planned" | "installed" | "blocked";
  target: AgentHookTarget;
  configPath: string;
  sourceHooksPath: string;
  messages: string[];
}

export async function runAgentDoctor(projectRootInput: string, homeDir = os.homedir()): Promise<AgentDoctorReport> {
  const projectRoot = path.resolve(projectRootInput);
  const checks: AgentDoctorCheck[] = [
    await existsCheck(path.join(projectRoot, ".openskill-kit", "config.json"), "Adaptive config"),
    await existsCheck(path.join(projectRoot, ".openskill-kit", "compiled", "hooks", "hooks.json"), "Compiled hook config"),
    await existsCheck(path.join(projectRoot, ".openskill-kit", "compiled", "hooks", "scripts", "osk-prompt-submit.cjs"), "Prompt hook script"),
    await writableDirCheck(path.join(projectRoot, ".agents", "hooks"), "Project agent hooks"),
    await writableDirCheck(path.join(homeDir, ".agents", "hooks"), "Global agent hooks")
  ];
  const status = checks.some((check) => check.status === "fail") ? "fail" : checks.some((check) => check.status === "warn") ? "warn" : "pass";
  return { schemaVersion: "openskill-kit.agent-doctor.v1", status, checks };
}

export async function installAgentHooks(options: InstallAgentHooksOptions): Promise<InstallAgentHooksResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const sourceHooksPath = path.join(projectRoot, ".openskill-kit", "compiled", "hooks", "hooks.json");
  const configPath = path.join(resolveAgentHooksDir(projectRoot, options.target, options.homeDir), "openskill-kit.json");
  const sourceHooks = await readJson(sourceHooksPath).catch(() => undefined) as { hooks?: Array<{ event: string; command: string }> } | undefined;
  if (!sourceHooks?.hooks?.length) {
    return { schemaVersion: "openskill-kit.agent-hooks.v1", status: "blocked", target: options.target, configPath, sourceHooksPath, messages: ["Blocked: compile behavior layer before installing hooks"] };
  }
  const config = {
    schemaVersion: "openskill-kit.agent-hooks.v1",
    target: options.target,
    projectRoot,
    sourceHooksPath,
    installedAt: new Date().toISOString(),
    hooks: sourceHooks.hooks.map((hook) => ({
      event: hook.event,
      command: hook.command,
      cwd: projectRoot
    }))
  };
  if (options.dryRun) {
    return { schemaVersion: "openskill-kit.agent-hooks.v1", status: "planned", target: options.target, configPath, sourceHooksPath, messages: [`Would write agent hook config ${configPath}`] };
  }
  if (!options.yes) {
    return { schemaVersion: "openskill-kit.agent-hooks.v1", status: "blocked", target: options.target, configPath, sourceHooksPath, messages: ["Blocked: pass yes=true or --yes for non-interactive writes"] };
  }
  await writeJsonAtomic(configPath, config);
  return { schemaVersion: "openskill-kit.agent-hooks.v1", status: "installed", target: options.target, configPath, sourceHooksPath, messages: [`Installed agent hook config ${configPath}`] };
}

function resolveAgentHooksDir(projectRoot: string, target: AgentHookTarget, homeDir = os.homedir()): string {
  return target === "project" ? path.join(projectRoot, ".agents", "hooks") : path.join(homeDir, ".agents", "hooks");
}

async function existsCheck(file: string, name: string): Promise<AgentDoctorCheck> {
  try {
    await fs.stat(file);
    return { name, status: "pass", message: "Found" };
  } catch {
    return { name, status: "warn", message: `${file} not found` };
  }
}

async function writableDirCheck(dir: string, name: string): Promise<AgentDoctorCheck> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.openskill-kit-hook-probe-${process.pid}`);
    await fs.writeFile(probe, "ok", "utf8");
    await fs.rm(probe, { force: true });
    return { name, status: "pass", message: "Writable" };
  } catch (error) {
    return { name, status: "fail", message: error instanceof Error ? error.message : String(error) };
  }
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}
