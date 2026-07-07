import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../storage/atomic.js";
import {
  LearnV2OutcomePolicyArtifactSchema,
  type LearnV2ConceptCard,
  type LearnV2OutcomePolicyArtifact
} from "./schemas.js";
import { readLearnV2ConceptOutcomeRecords, type LearnV2ConceptOutcomeFeedback } from "./activation.js";
import { decideLearnV2OutcomePolicy, LearnV2OutcomePolicyThresholds } from "./outcome-policy-core.js";
import { learnV2SafeLocalPath } from "./utils.js";

export async function writeLearnV2OutcomePolicyArtifact(
  rootInput: string,
  concepts: LearnV2ConceptCard[],
  now = new Date()
): Promise<LearnV2OutcomePolicyArtifact> {
  const root = path.resolve(rootInput);
  const stamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const dir = path.join(root, ".openskill-kit", "learn-v2", "outcome-policy");
  const json = path.join(dir, `outcome-policy-${stamp}.json`);
  const markdown = path.join(dir, `outcome-policy-${stamp}.md`);
  const feedbackByConcept = await readOutcomeFeedback(root);
  const decisions = concepts.map((concept) => decideLearnV2OutcomePolicy(concept.id, feedbackByConcept.get(concept.id)));
  const artifact = LearnV2OutcomePolicyArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.outcome-policy-artifact.v1",
    generatedAt: now.toISOString(),
    decisions,
    thresholds: LearnV2OutcomePolicyThresholds,
    counts: {
      concepts: concepts.length,
      decisions: decisions.length,
      suppressed: decisions.filter((decision) => decision.action === "suppress-activation").length,
      demoteReview: decisions.filter((decision) => decision.action === "demote-review").length,
      monitoring: decisions.filter((decision) => decision.action === "keep-monitoring").length
    },
    artifacts: { json, markdown }
  });
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(json, artifact);
  await fs.writeFile(markdown, renderOutcomePolicy(root, artifact), "utf8");
  return artifact;
}

async function readOutcomeFeedback(root: string): Promise<Map<string, LearnV2ConceptOutcomeFeedback>> {
  const records = await readLearnV2ConceptOutcomeRecords(root);
  const out = new Map<string, LearnV2ConceptOutcomeFeedback>();
  for (const record of records) {
    const current = out.get(record.conceptId) ?? { helpful: 0, ignored: 0, wrong: 0, harmful: 0, superseded: 0 };
    current[record.outcome] += 1;
    if (!current.lastRecordedAt || current.lastRecordedAt < record.recordedAt) current.lastRecordedAt = record.recordedAt;
    out.set(record.conceptId, current);
  }
  return out;
}

function renderOutcomePolicy(root: string, artifact: LearnV2OutcomePolicyArtifact): string {
  const lines = [
    "# Learn v2 Outcome Policy",
    "",
    `Generated: ${artifact.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Concepts: ${artifact.counts.concepts}`,
    `- Decisions: ${artifact.counts.decisions}`,
    `- Suppressed: ${artifact.counts.suppressed}`,
    `- Demote review: ${artifact.counts.demoteReview}`,
    `- Monitoring: ${artifact.counts.monitoring}`,
    "",
    "## Thresholds",
    "",
    `- Suppress wrong count: ${artifact.thresholds.suppressWrongCount}`,
    `- Suppress ignored count: ${artifact.thresholds.suppressIgnoredCount}`,
    `- Suppress harmful count: ${artifact.thresholds.suppressHarmfulCount}`,
    `- Suppress superseded count: ${artifact.thresholds.suppressSupersededCount}`,
    "",
    "## Decisions",
    ""
  ];
  for (const decision of artifact.decisions) {
    lines.push(`### ${decision.conceptId}`);
    lines.push("");
    lines.push(`Action: ${decision.action}`);
    lines.push(`Reasons: ${decision.reasons.join(", ") || "none"}`);
    lines.push(`Counts: helpful=${decision.counts.helpful}, ignored=${decision.counts.ignored}, wrong=${decision.counts.wrong}, harmful=${decision.counts.harmful}, superseded=${decision.counts.superseded}`);
    lines.push(`Last outcome: ${decision.lastRecordedAt ?? "none"}`);
    lines.push("");
  }
  lines.push("## Artifacts");
  lines.push("");
  lines.push(`- JSON: ${learnV2SafeLocalPath(artifact.artifacts.json, root)}`);
  lines.push(`- Markdown: ${learnV2SafeLocalPath(artifact.artifacts.markdown, root)}`);
  return `${lines.join("\n")}\n`;
}
