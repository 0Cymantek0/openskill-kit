import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createLocalSandboxPolicy } from "../sandbox/policy.js";
import { readProjectConfig } from "../events/store.js";
import { validateRedactionConfig } from "../events/redaction.js";
import { CompileTargets, PreferenceCategories } from "../schema/constants.js";
import { explainAdaptiveStatus } from "../status/status.js";
import { readRegistry } from "../registry/registry.js";
import { verifyProjectBehaviorPack } from "../sync/bundle.js";

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
  checks.push(await writableCheck(path.join(projectRoot, ".local-agent", "skills"), "Local project skill target"));
  checks.push(await writableCheck(path.join(projectRoot, ".agents", "skills"), "Agents project skill target"));
  checks.push(await writableCheck(path.join(homeDir, ".config", "local-agent", "skills"), "Local global skill target"));
  checks.push(await writableCheck(path.join(homeDir, ".agents", "skills"), "Agents global skill target"));
  checks.push(sandboxPolicyCheck(projectRoot));
  checks.push(optionalSecretCheck("MODEL_PROVIDER_API_KEY"));
  const status = checks.some((check) => check.status === "fail") ? "fail" : checks.some((check) => check.status === "warn") ? "warn" : "pass";
  return { status, checks };
}

export async function runFullDoctor(projectRoot: string, homeDir = os.homedir()): Promise<DoctorReport> {
  const root = path.resolve(projectRoot);
  const base = await runDoctor(root, homeDir);
  const checks = [...base.checks];
  const status = await explainAdaptiveStatus(root);
  checks.push({
    name: "Adaptive initialized",
    status: status.status.initialized ? "pass" : "fail",
    message: status.status.initialized ? "Initialized" : "Missing .openskill-kit/config.json"
  });
  const config = await readProjectConfig(root).catch(() => undefined);
  if (config) {
    checks.push(schemaConstantsCheck());
    checks.push(compileTargetsCheck(config.compileTargets));
    const redaction = validateRedactionConfig(config);
    checks.push({
      name: "Custom redaction config",
      status: redaction.status === "pass" ? "pass" : "fail",
      message: redaction.issues.length ? redaction.issues.map((issue) => `${issue.id}: ${issue.message}`).join("; ") : "All custom redactions compile"
    });
  }
  checks.push({
    name: "Compiled context pack",
    status: status.status.compiled.contextPack ? "pass" : "warn",
    message: status.status.compiled.contextPack ? "Found" : "Run compile after activating preferences"
  });
  checks.push({
    name: "Compiled project behavior skill",
    status: status.status.compiled.projectBehaviorSkill ? "pass" : "warn",
    message: status.status.compiled.projectBehaviorSkill ? "Found" : "Run compile before install"
  });
  checks.push({
    name: "Graph freshness",
    status: status.stale ? "warn" : "pass",
    message: status.stale ? "Compiled artifacts older than graph" : "Compiled artifacts current or not required"
  });
  checks.push({
    name: "Interaction imports",
    status: status.status.blockedInteractionImportCount > 0 ? "warn" : "pass",
    message: status.status.interactionImportCount
      ? `${status.status.interactionImportCount} run(s), ${status.status.importedInteractionEventCount} imported event(s), ${status.status.blockedInteractionImportCount} blocked`
      : "No interaction import runs"
  });
  checks.push(await fileCheck(path.join(root, ".openskill-kit", "compiled", "hooks", "hooks.json"), "Compiled hooks"));
  checks.push(await fileCheck(path.join(root, ".openskill-kit", "compiled", "mcp", "server-config.json"), "Compiled MCP config"));
  const registry = await readRegistry(root);
  checks.push({
    name: "Install registry",
    status: registry.skills.length ? "pass" : "warn",
    message: `${registry.skills.length} registry entr${registry.skills.length === 1 ? "y" : "ies"}`
  });
  const packPath = path.join(root, ".openskill-kit", "compiled", "project-behavior-pack");
  if (await exists(path.join(packPath, "manifest.json"))) {
    const pack = await verifyProjectBehaviorPack(packPath);
    checks.push({ name: "Behavior pack", status: pack.status === "pass" ? "pass" : "fail", message: pack.issues.join("; ") || `Signature ${pack.signature.status}` });
  } else {
    checks.push({ name: "Behavior pack", status: "warn", message: "No exported pack" });
  }
  const finalStatus = checks.some((check) => check.status === "fail") ? "fail" : checks.some((check) => check.status === "warn") ? "warn" : "pass";
  return { status: finalStatus, checks };
}

function schemaConstantsCheck(): DoctorCheck {
  return PreferenceCategories.includes("api-design")
    ? { name: "Shared schema constants", status: "pass", message: `${PreferenceCategories.length} categories; api-design available to adapters` }
    : { name: "Shared schema constants", status: "fail", message: "api-design category missing" };
}

function compileTargetsCheck(targets: string[]): DoctorCheck {
  const allowed = new Set<string>(CompileTargets);
  const unsupported = targets.filter((target) => !allowed.has(target));
  return unsupported.length
    ? { name: "Compile targets", status: "fail", message: `Unsupported target(s): ${unsupported.join(", ")}` }
    : { name: "Compile targets", status: "pass", message: targets.length ? targets.join(", ") : "default target set" };
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

async function fileCheck(file: string, name: string): Promise<DoctorCheck> {
  return exists(file)
    .then((found) => found ? { name, status: "pass" as const, message: "Found" } : { name, status: "warn" as const, message: "Missing" });
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function optionalSecretCheck(name: string): DoctorCheck {
  return process.env[name]
    ? { name: `Optional ${name}`, status: "pass", message: "Configured (value hidden)" }
    : { name: `Optional ${name}`, status: "warn", message: "Not configured" };
}

function sandboxPolicyCheck(projectRoot: string): DoctorCheck {
  const policy = createLocalSandboxPolicy({ projectRoot });
  return {
    name: "Local sandbox policy",
    status: "warn",
    message: `${policy.mode}; no shell; cwd constrained; network isolation metadata only`
  };
}
