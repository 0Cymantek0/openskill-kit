import { promises as fs } from "node:fs";
import path from "node:path";

export interface RegistryEntry {
  name: string;
  sourcePath: string;
  installedTargets: string[];
  createdAt: string;
  updatedAt: string;
  status: "candidate" | "audited" | "trusted" | "installed" | "blocked";
  safetyScore?: number;
  lastVerifierReportPath?: string;
  version: string;
}

export interface RegistryFile {
  version: 1;
  skills: RegistryEntry[];
}

export async function readRegistry(projectRoot: string): Promise<RegistryFile> {
  const file = registryPath(projectRoot);
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as RegistryFile;
  } catch {
    return { version: 1, skills: [] };
  }
}

export async function upsertRegistryEntry(projectRoot: string, entry: Omit<RegistryEntry, "createdAt" | "updatedAt">): Promise<RegistryFile> {
  const registry = await readRegistry(projectRoot);
  const now = new Date().toISOString();
  const existing = registry.skills.find((item) => item.name === entry.name);
  if (existing) {
    Object.assign(existing, entry, { updatedAt: now });
  } else {
    registry.skills.push({ ...entry, createdAt: now, updatedAt: now });
  }
  await fs.mkdir(path.dirname(registryPath(projectRoot)), { recursive: true });
  await fs.writeFile(registryPath(projectRoot), JSON.stringify(registry, null, 2), "utf8");
  return registry;
}

export function registryPath(projectRoot: string): string {
  return path.join(projectRoot, ".openskill-kit", "registry.json");
}
