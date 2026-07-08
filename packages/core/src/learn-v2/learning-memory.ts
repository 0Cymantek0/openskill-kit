import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "../storage/atomic.js";
import {
  LearnV2ConditionalHypothesisSchema,
  LearnV2LearningObservationSchema,
  LearnV2MemoryAdmissionDecisionSchema,
  type LearnV2ConditionalLearningArtifact,
  type LearnV2ConditionalHypothesis,
  type LearnV2LearningObservation,
  type LearnV2MemoryAdmissionDecision
} from "./schemas.js";
import { learnV2SafeLocalPath } from "./utils.js";

export const LearnV2LearningMemoryStoreSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.learning-memory-store.v1"),
  updatedAt: z.string().datetime(),
  observations: z.array(LearnV2LearningObservationSchema).default([]),
  hypotheses: z.array(LearnV2ConditionalHypothesisSchema).default([]),
  admissionDecisions: z.array(LearnV2MemoryAdmissionDecisionSchema).default([]),
  counts: z.object({
    observations: z.number().int().min(0),
    hypotheses: z.number().int().min(0),
    admissionDecisions: z.number().int().min(0),
    candidateConcepts: z.number().int().min(0),
    requiresHumanReview: z.number().int().min(0),
    weakObservations: z.number().int().min(0),
    rejectedNoise: z.number().int().min(0),
    latestRunObservations: z.number().int().min(0),
    latestRunHypotheses: z.number().int().min(0),
    latestRunAdmissionDecisions: z.number().int().min(0)
  }),
  artifacts: z.object({
    json: z.string(),
    markdown: z.string()
  })
});

export type LearnV2LearningMemoryStore = z.infer<typeof LearnV2LearningMemoryStoreSchema>;

export function learnV2LearningMemoryStorePath(rootInput: string): string {
  return path.join(path.resolve(rootInput), ".openskill-kit", "learn-v2", "learning-memory", "store.json");
}

export async function readLearnV2LearningMemoryStore(rootInput: string, now = new Date()): Promise<LearnV2LearningMemoryStore> {
  const root = path.resolve(rootInput);
  const json = learnV2LearningMemoryStorePath(root);
  const markdown = json.replace(/\.json$/, ".md");
  const text = await fs.readFile(json, "utf8").catch(() => undefined);
  if (!text) return emptyLearningMemoryStore(json, markdown, now);
  return LearnV2LearningMemoryStoreSchema.parse(JSON.parse(text));
}

export async function writeLearnV2LearningMemoryStore(
  rootInput: string,
  run: Pick<LearnV2ConditionalLearningArtifact, "observations" | "hypotheses" | "admissionDecisions">,
  now = new Date()
): Promise<LearnV2LearningMemoryStore> {
  const root = path.resolve(rootInput);
  const json = learnV2LearningMemoryStorePath(root);
  const markdown = json.replace(/\.json$/, ".md");
  const existing = await readLearnV2LearningMemoryStore(root, now);
  const observations = mergeById(existing.observations, run.observations);
  const hypotheses = mergeById(existing.hypotheses, run.hypotheses);
  const admissionDecisions = mergeById(existing.admissionDecisions, run.admissionDecisions);
  const store = LearnV2LearningMemoryStoreSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.learning-memory-store.v1",
    updatedAt: now.toISOString(),
    observations,
    hypotheses,
    admissionDecisions,
    counts: {
      observations: observations.length,
      hypotheses: hypotheses.length,
      admissionDecisions: admissionDecisions.length,
      candidateConcepts: admissionDecisions.filter((item) => item.decision === "candidate-concept").length,
      requiresHumanReview: admissionDecisions.filter((item) => item.decision === "requires-human-review").length,
      weakObservations: admissionDecisions.filter((item) => item.decision === "weak-observation").length,
      rejectedNoise: admissionDecisions.filter((item) => item.decision === "reject-noise").length,
      latestRunObservations: run.observations.length,
      latestRunHypotheses: run.hypotheses.length,
      latestRunAdmissionDecisions: run.admissionDecisions.length
    },
    artifacts: { json, markdown }
  });
  await fs.mkdir(path.dirname(json), { recursive: true });
  await writeJsonAtomic(json, store);
  await fs.writeFile(markdown, renderLearnV2LearningMemoryStore(root, store), "utf8");
  return store;
}

function emptyLearningMemoryStore(json: string, markdown: string, now: Date): LearnV2LearningMemoryStore {
  return LearnV2LearningMemoryStoreSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.learning-memory-store.v1",
    updatedAt: now.toISOString(),
    observations: [],
    hypotheses: [],
    admissionDecisions: [],
    counts: {
      observations: 0,
      hypotheses: 0,
      admissionDecisions: 0,
      candidateConcepts: 0,
      requiresHumanReview: 0,
      weakObservations: 0,
      rejectedNoise: 0,
      latestRunObservations: 0,
      latestRunHypotheses: 0,
      latestRunAdmissionDecisions: 0
    },
    artifacts: { json, markdown }
  });
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function renderLearnV2LearningMemoryStore(root: string, store: LearnV2LearningMemoryStore): string {
  return [
    "# Learn v2 Learning Memory Store",
    "",
    `Updated: ${store.updatedAt}`,
    "",
    "## Counts",
    "",
    `- Observations: ${store.counts.observations} (${store.counts.latestRunObservations} latest run)`,
    `- Hypotheses: ${store.counts.hypotheses} (${store.counts.latestRunHypotheses} latest run)`,
    `- Admission decisions: ${store.counts.admissionDecisions} (${store.counts.latestRunAdmissionDecisions} latest run)`,
    `- Candidate concepts: ${store.counts.candidateConcepts}`,
    `- Requires human review: ${store.counts.requiresHumanReview}`,
    `- Weak observations: ${store.counts.weakObservations}`,
    `- Rejected noise: ${store.counts.rejectedNoise}`,
    "",
    "## Observation Summary",
    "",
    ...store.observations.slice(0, 40).map((observation) =>
      `- ${observation.id}: target=${observation.target}; outcome=${observation.desiredOutcome ?? "none"}; factors=${observation.factors.map((factor) => `${factor.key}=${factor.value}`).join(", ") || "none"}; paths=${observation.paths.map((file) => learnV2SafeLocalPath(file, root)).join(", ") || "none"}`
    ),
    ...(store.observations.length > 40 ? [`- ${store.observations.length - 40} more observation(s) omitted from markdown summary.`] : []),
    "",
    "## Hypothesis Summary",
    "",
    ...store.hypotheses.slice(0, 40).map((hypothesis) =>
      `- ${hypothesis.id}: status=${hypothesis.status}; confidence=${hypothesis.confidence}; target=${hypothesis.target}; outcome=${hypothesis.desiredOutcome}; factors=${hypothesis.factorSet.map((factor) => `${factor.key}=${factor.value}`).join(", ") || "none"}`
    ),
    ...(store.hypotheses.length > 40 ? [`- ${store.hypotheses.length - 40} more hypothesis/hypotheses omitted from markdown summary.`] : []),
    "",
    "## Privacy",
    "",
    "- JSON store is local-only because observations retain declassified user/action text for future cross-run hypothesis updates.",
    "- Markdown summary omits observation text and raw refs; use debug commands locally for focused inspection."
  ].join("\n") + "\n";
}
