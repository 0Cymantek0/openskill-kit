import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSkillPackage } from "../skill/parser.js";
import { verifySkill } from "../verifier/verifier.js";
import { upsertRegistryEntry } from "../registry/registry.js";

export type InstallTarget = "opencode-project" | "opencode-global" | "agents-project" | "agents-global";

export interface InstallOptions {
  skillPath: string;
  target: InstallTarget;
  projectRoot: string;
  homeDir?: string;
  dryRun?: boolean;
  yes?: boolean;
  allowCriticalRisk?: boolean;
}

export interface InstallResult {
  status: "planned" | "installed" | "blocked";
  targetDir: string;
  skillDir: string;
  backups: string[];
  messages: string[];
}

export async function installSkill(options: InstallOptions): Promise<InstallResult> {
  const pkg = await loadSkillPackage(options.skillPath);
  const report = await verifySkill(pkg.root);
  const criticalCount = report.safety.summary.critical;
  if (criticalCount > 0 && !options.allowCriticalRisk) {
    return {
      status: "blocked",
      targetDir: resolveTargetDir(options),
      skillDir: path.join(resolveTargetDir(options), pkg.manifest.name),
      backups: [],
      messages: [`Blocked install: ${criticalCount} critical safety finding(s)`]
    };
  }
  const targetDir = resolveTargetDir(options);
  const destination = path.join(targetDir, pkg.manifest.name);
  if (options.dryRun) {
    return {
      status: "planned",
      targetDir,
      skillDir: destination,
      backups: [],
      messages: [`Would install ${pkg.manifest.name} to ${destination}`]
    };
  }
  const backups: string[] = [];
  await fs.mkdir(targetDir, { recursive: true });
  if (await exists(destination)) {
    const backup = `${destination}.backup-${timestamp()}`;
    await fs.cp(destination, backup, { recursive: true });
    backups.push(backup);
    await fs.rm(destination, { recursive: true, force: true });
  }
  await fs.cp(pkg.root, destination, { recursive: true });
  await upsertRegistryEntry(options.projectRoot, {
    name: pkg.manifest.name,
    sourcePath: pkg.root,
    installedTargets: [options.target],
    status: "installed",
    safetyScore: report.safety.score,
    version: "0.1.0"
  });
  return {
    status: "installed",
    targetDir,
    skillDir: destination,
    backups,
    messages: [`Installed ${pkg.manifest.name} to ${destination}`]
  };
}

export interface UninstallOptions {
  skillName: string;
  target: InstallTarget;
  projectRoot: string;
  homeDir?: string;
  dryRun?: boolean;
}

export async function uninstallSkill(options: UninstallOptions): Promise<InstallResult> {
  const targetDir = resolveTargetDir(options);
  const destination = path.join(targetDir, options.skillName);
  if (options.dryRun) {
    return {
      status: "planned",
      targetDir,
      skillDir: destination,
      backups: [],
      messages: [`Would remove ${destination}`]
    };
  }
  await fs.rm(destination, { recursive: true, force: true });
  return {
    status: "installed",
    targetDir,
    skillDir: destination,
    backups: [],
    messages: [`Removed ${destination}`]
  };
}

export function resolveTargetDir(options: { target: InstallTarget; projectRoot: string; homeDir?: string }): string {
  const home = options.homeDir ?? os.homedir();
  switch (options.target) {
    case "opencode-project":
      return path.join(options.projectRoot, ".opencode", "skills");
    case "opencode-global":
      return path.join(home, ".config", "opencode", "skills");
    case "agents-project":
      return path.join(options.projectRoot, ".agents", "skills");
    case "agents-global":
      return path.join(home, ".agents", "skills");
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
