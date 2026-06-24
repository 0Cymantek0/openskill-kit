import { createHash } from "node:crypto";
import path from "node:path";
import { createDefaultProjectConfig, ProjectConfigSchema, type ProjectConfig } from "./schema.js";

export function migrateProjectConfig(input: unknown, projectRoot: string): ProjectConfig {
  const value = input as Record<string, unknown>;
  if (value?.schemaVersion === "openskill-kit.config.v1") return ProjectConfigSchema.parse(value);
  if (value?.schemaVersion === "openskill-kit.config.v0") {
    const root = path.resolve(projectRoot);
    return createDefaultProjectConfig({
      projectId: `osk_${createHash("sha256").update(root).digest("hex").slice(0, 16)}`,
      projectName: path.basename(root),
      createdAt: new Date(0).toISOString()
    });
  }
  throw new Error(`Unsupported OpenSkillKit config schema version: ${String(value?.schemaVersion ?? "missing")}`);
}
