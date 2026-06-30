import { promises as fs } from "node:fs";
import path from "node:path";
import type { LearnV2ConceptCard, LearnV2ReviewQueue } from "./schemas.js";
import { LearnV2ReviewQueueSchema } from "./schemas.js";
import { writeJsonAtomic } from "../storage/atomic.js";

export async function writeLearnV2ReviewQueue(rootInput: string, cards: LearnV2ConceptCard[], now: Date): Promise<LearnV2ReviewQueue> {
  const root = path.resolve(rootInput);
  const reviewDir = path.join(root, ".openskill-kit", "learn-v2", "review");
  const markdown = path.join(reviewDir, "concept-review-queue.md");
  const json = path.join(reviewDir, "concept-review-queue.json");
  const queue = LearnV2ReviewQueueSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.review-queue.v1",
    generatedAt: now.toISOString(),
    cards,
    behaviorDeltaFirst: true,
    safeBulkActions: ["accept-low-risk", "reject-one-off", "mark-superseded"],
    artifacts: { markdown }
  });
  await fs.mkdir(reviewDir, { recursive: true });
  await writeJsonAtomic(json, queue);
  await fs.writeFile(markdown, renderLearnV2ReviewQueue(queue), "utf8");
  return queue;
}

export function renderLearnV2ReviewQueue(queue: LearnV2ReviewQueue): string {
  const lines = [
    "# Learn v2 Concept Review Queue",
    "",
    `Generated: ${queue.generatedAt}`,
    `Cards: ${queue.cards.length}`,
    `Behavior delta first: ${queue.behaviorDeltaFirst}`,
    "",
    "## Safe Bulk Actions",
    "",
    ...queue.safeBulkActions.map((action) => `- ${action}`),
    "",
    "## Cards",
    ""
  ];
  for (const card of queue.cards) {
    lines.push(`### ${card.title}`);
    lines.push("");
    lines.push(`Status: ${card.status}`);
    lines.push(`Delta: ${card.behaviorDelta}`);
    lines.push(`Behavior: ${card.canonicalBehavior}`);
    lines.push(`Confidence: ${card.confidence.toFixed(2)} Durability: ${card.durability.toFixed(2)} Reliability: ${card.sourceReliability.toFixed(2)} Risk: ${card.risk}`);
    if (card.scope.paths.length) lines.push(`Scope paths: ${card.scope.paths.join(", ")}`);
    if (card.scope.taskTypes.length) lines.push(`Task types: ${card.scope.taskTypes.join(", ")}`);
    if (card.activation.phrases.length) lines.push(`Activation: ${card.activation.phrases.join(", ")}`);
    if (card.activation.commands.length) lines.push(`Commands: ${card.activation.commands.join(", ")}`);
    lines.push(`Evidence: ${card.evidenceIds.join(", ")}`);
    lines.push("Raw refs: local-only, not exportable");
    if (card.counterevidence.length) {
      lines.push("Counterevidence:");
      for (const item of card.counterevidence) lines.push(`- ${item.evidenceId}: ${item.reason}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

