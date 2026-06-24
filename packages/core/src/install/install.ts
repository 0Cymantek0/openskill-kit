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
  configFiles: string[];
  messages: string[];
}

export async function installSkill(options: InstallOptions): Promise<InstallResult> {
  const pkg = await loadSkillPackage(options.skillPath);
  const report = await verifySkill(pkg.root);
  const targetDir = resolveTargetDir(options);
  const destination = path.join(targetDir, pkg.manifest.name);
  const receiptPath = resolveReceiptPath(options.projectRoot, options.target, pkg.manifest.name);
  const highRiskCount = report.safety.summary.high + report.safety.summary.critical;
  const validationFailed = report.issues.some((issue) => issue.severity === "error");
  const fixtureFailed = report.fixtureResults.some((fixture) => fixture.status === "fail" || fixture.status === "blocked" || fixture.status === "timeout");
  if (validationFailed || fixtureFailed) {
    return {
      status: "blocked",
      targetDir,
      skillDir: destination,
      backups: [],
      configFiles: [],
      messages: [`Blocked install: verifier failed for ${pkg.manifest.name}`]
    };
  }
  if (highRiskCount > 0 && !options.allowCriticalRisk) {
    return {
      status: "blocked",
      targetDir,
      skillDir: destination,
      backups: [],
      configFiles: [],
      messages: [`Blocked install: ${highRiskCount} high/critical safety finding(s)`]
    };
  }
  if (options.dryRun) {
    return {
      status: "planned",
      targetDir,
      skillDir: destination,
      backups: [],
      configFiles: [receiptPath],
      messages: [`Would install ${pkg.manifest.name} to ${destination}`, `Would write install receipt ${receiptPath}`]
    };
  }
  if (!options.yes) {
    return {
      status: "blocked",
      targetDir,
      skillDir: destination,
      backups: [],
      configFiles: [],
      messages: ["Blocked install: pass yes=true or --yes for non-interactive writes"]
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
  await writeInstallReceipt(receiptPath, {
    schemaVersion: "openskill-kit.install-receipt.v0",
    installedAt: new Date().toISOString(),
    skillName: pkg.manifest.name,
    target: options.target,
    sourcePath: pkg.root,
    destination,
    verifierStatus: report.status,
    safetyScore: report.safety.score,
    adapter: adapterName(options.target)
  });
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
    configFiles: [receiptPath],
    messages: [`Installed ${pkg.manifest.name} to ${destination}`, `Wrote install receipt ${receiptPath}`]
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
    const receiptPath = resolveReceiptPath(options.projectRoot, options.target, options.skillName);
    return {
      status: "planned",
      targetDir,
      skillDir: destination,
      backups: [],
      configFiles: [receiptPath],
      messages: [`Would remove ${destination}`, `Would remove install receipt ${receiptPath}`]
    };
  }
  await fs.rm(destination, { recursive: true, force: true });
  const receiptPath = resolveReceiptPath(options.projectRoot, options.target, options.skillName);
  await fs.rm(receiptPath, { force: true });
  return {
    status: "installed",
    targetDir,
    skillDir: destination,
    backups: [],
    configFiles: [receiptPath],
    messages: [`Removed ${destination}`, `Removed install receipt ${receiptPath}`]
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

function resolveReceiptPath(projectRoot: string, target: InstallTarget, skillName: string): string {
  return path.join(projectRoot, ".openskill-kit", "installs", target, `${skillName}.json`);
}

async function writeInstallReceipt(file: string, receipt: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(receipt, null, 2), "utf8");
}

function adapterName(target: InstallTarget): "opencode" | "agents" {
  return target.startsWith("opencode") ? "opencode" : "agents";
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
