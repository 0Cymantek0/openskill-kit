import { promises as fs } from "node:fs";
import path from "node:path";
import { readEvents } from "../events/store.js";
import { readPreferenceGraph } from "../preferences/graph.js";
import { writeJsonAtomic, withFileLock } from "../storage/atomic.js";

export type ResetScope = "events" | "signals" | "reviews" | "runtime" | "compiled" | "installs";

export interface MaintenanceResult {
  schemaVersion: "openskill-kit.maintenance.v1";
  status: "planned" | "done" | "blocked";
  action: "reset" | "prune" | "archive" | "compact";
  paths: string[];
  messages: string[];
}

export async function resetProjectState(projectRoot: string, scopes: ResetScope[], options: { yes?: boolean } = {}): Promise<MaintenanceResult> {
  const root = path.resolve(projectRoot);
  const targets = scopes.map((scope) => path.join(root, ".openskill-kit", scope));
  if (!options.yes) return { schemaVersion: "openskill-kit.maintenance.v1", status: "planned", action: "reset", paths: targets, messages: ["Pass --yes to remove selected state"] };
  return withFileLock(path.join(root, ".openskill-kit", ".maintenance.lock"), async () => {
    for (const target of targets) await fs.rm(target, { recursive: true, force: true });
    return { schemaVersion: "openskill-kit.maintenance.v1", status: "done", action: "reset", paths: targets, messages: [`Removed ${targets.length} path(s)`] };
  });
}

export async function pruneProjectState(projectRoot: string, options: { keepRuns?: number; yes?: boolean } = {}): Promise<MaintenanceResult> {
  const root = path.resolve(projectRoot);
  const runDirs = await listChildDirs(path.join(root, ".openskill-kit", "evals", "runs"));
  const keepRuns = options.keepRuns ?? 5;
  const targets = runDirs.sort().slice(0, Math.max(0, runDirs.length - keepRuns));
  if (!options.yes) return { schemaVersion: "openskill-kit.maintenance.v1", status: "planned", action: "prune", paths: targets, messages: [`Would keep newest ${keepRuns} eval run(s)`] };
  return withFileLock(path.join(root, ".openskill-kit", ".maintenance.lock"), async () => {
    for (const target of targets) await fs.rm(target, { recursive: true, force: true });
    return { schemaVersion: "openskill-kit.maintenance.v1", status: "done", action: "prune", paths: targets, messages: [`Pruned ${targets.length} old eval run(s)`] };
  });
}

export async function archiveProjectState(projectRoot: string, options: { yes?: boolean; now?: Date } = {}): Promise<MaintenanceResult> {
  const root = path.resolve(projectRoot);
  const stamp = (options.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const archiveRoot = path.join(root, ".openskill-kit", "archive", stamp);
  const sources = ["events", "signals", "reviews", "runtime"].map((name) => path.join(root, ".openskill-kit", name));
  if (!options.yes) return { schemaVersion: "openskill-kit.maintenance.v1", status: "planned", action: "archive", paths: sources, messages: [`Would archive to ${archiveRoot}`] };
  return withFileLock(path.join(root, ".openskill-kit", ".maintenance.lock"), async () => {
    const copied: string[] = [];
    for (const source of sources) {
      try {
        const destination = path.join(archiveRoot, path.basename(source));
        await fs.cp(source, destination, { recursive: true });
        await fs.rm(source, { recursive: true, force: true });
        copied.push(destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return { schemaVersion: "openskill-kit.maintenance.v1", status: "done", action: "archive", paths: copied, messages: [`Archived ${copied.length} path(s)`] };
  });
}

export async function compactProjectState(projectRoot: string): Promise<MaintenanceResult> {
  const root = path.resolve(projectRoot);
  const events = await readEvents(root).catch(() => []);
  const graph = await readPreferenceGraph(root).catch(() => undefined);
  const summaryPath = path.join(root, ".openskill-kit", "compact", "summary.json");
  const summary = {
    schemaVersion: "openskill-kit.compact-summary.v1",
    generatedAt: new Date().toISOString(),
    events: events.length,
    sessions: new Set(events.map((event) => event.sessionId)).size,
    preferences: graph?.nodes.length ?? 0,
    activePreferences: graph?.nodes.filter((node) => node.status === "active" || node.status === "locked").length ?? 0,
    candidates: graph?.nodes.filter((node) => node.status === "candidate" || node.status === "conflict").length ?? 0
  };
  await writeJsonAtomic(summaryPath, summary);
  return { schemaVersion: "openskill-kit.maintenance.v1", status: "done", action: "compact", paths: [summaryPath], messages: ["Wrote compact project summary"] };
}

async function listChildDirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name));
}
