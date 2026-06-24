import { createHash } from "node:crypto";
import type { PreferenceGraph, PreferenceNode } from "./schema.js";

export function detectConflicts(nodes: PreferenceNode[]): PreferenceGraph["conflicts"] {
  const conflicts: PreferenceGraph["conflicts"] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (!a || !b || a.category !== b.category || a.polarity === b.polarity) continue;
      if (overlaps(a.statement, b.statement)) {
        conflicts.push({
          id: `conf_${shortHash(`${a.id}:${b.id}`)}`,
          nodeIds: [a.id, b.id],
          reason: "Opposing preference statements overlap in same category"
        });
      }
    }
  }
  return conflicts;
}

function overlaps(a: string, b: string): boolean {
  const wordsA = importantWords(a);
  const wordsB = importantWords(b);
  const shared = [...wordsA].filter((word) => wordsB.has(word));
  return shared.length >= Math.min(3, Math.max(1, Math.min(wordsA.size, wordsB.size)));
}

function importantWords(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !["prefer", "never", "avoid", "with", "from", "project"].includes(word)));
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
