import { PreferenceGraphSchema, type PreferenceGraph } from "./schema.js";

export function migratePreferenceGraph(input: unknown): PreferenceGraph {
  const value = input as Record<string, unknown>;
  if (value?.schemaVersion === "openskill-kit.preference-graph.v1") return PreferenceGraphSchema.parse(value);
  throw new Error(`Unsupported OpenSkillKit preference graph schema version: ${String(value?.schemaVersion ?? "missing")}`);
}
