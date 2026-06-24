import type { Signal } from "../signals/schema.js";

export function scoreConfidence(signals: Signal[], decayHalfLifeDays = 90, now = new Date()): number {
  let alpha = 1;
  let beta = 1;
  for (const signal of signals) {
    const decayed = signal.weight * decayMultiplier(signal.extractedAt, decayHalfLifeDays, now);
    if (signal.polarity === "negative" || signal.kind === "rejection") beta += decayed;
    else alpha += decayed;
  }
  return round(alpha / (alpha + beta));
}

function decayMultiplier(timestamp: string, halfLifeDays: number, now: Date): number {
  const ageMs = Math.max(0, now.getTime() - new Date(timestamp).getTime());
  const ageDays = ageMs / 86_400_000;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
