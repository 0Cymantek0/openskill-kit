import { EventSchema, type OpenSkillEvent } from "./schema.js";

export function migrateEvent(input: unknown): OpenSkillEvent {
  const value = input as Record<string, unknown>;
  if (value?.schemaVersion === "openskill-kit.event.v1") return EventSchema.parse(value);
  throw new Error(`Unsupported OpenSkillKit event schema version: ${String(value?.schemaVersion ?? "missing")}`);
}
