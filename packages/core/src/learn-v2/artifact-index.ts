import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "../storage/atomic.js";
import { LEARN_V2_STABLE_ARTIFACT_PATHS } from "./paths.js";
import { learnV2SafeLocalPath } from "./utils.js";

const LearnV2ProductIndexSectionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  category: z.enum(["source", "evidence", "learning", "review", "activation", "eval", "debug", "model", "privacy"]),
  path: z.string().min(1).optional(),
  status: z.enum(["written", "planned-path", "missing"]),
  sharePolicy: z.enum(["shareable-reviewed", "local-only", "local-declassified", "prompt-safe-request"]),
  command: z.string().min(1),
  purpose: z.string().min(1)
});

export const LearnV2ProductIndexArtifactSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.product-index.v1"),
  generatedAt: z.string().datetime(),
  run: z.object({
    previewOnly: z.boolean(),
    modelMode: z.string().min(1),
    sourcesConsidered: z.number().int().min(0),
    sourcesIncluded: z.number().int().min(0),
    concepts: z.number().int().min(0),
    observations: z.number().int().min(0),
    hypotheses: z.number().int().min(0),
    promotedHypotheses: z.number().int().min(0),
    namespaces: z.number().int().min(0),
    openWorldAnchors: z.number().int().min(0),
    tracedConcepts: z.number().int().min(0),
    evalStatus: z.string().min(1),
    healthStatus: z.string().min(1).optional()
  }),
  sections: z.array(LearnV2ProductIndexSectionSchema),
  privacy: z.object({
    localOnlyPaths: z.array(z.string()),
    notes: z.array(z.string())
  }),
  nextActions: z.array(z.string()),
  artifacts: z.object({
    json: z.string(),
    markdown: z.string()
  })
});

export type LearnV2ProductIndexArtifact = z.infer<typeof LearnV2ProductIndexArtifactSchema>;

export interface LearnV2ProductIndexInput {
  generatedAt: string;
  previewOnly: boolean;
  modelMode: string;
  summary: {
    sourcesConsidered: number;
    sourcesIncluded: number;
    concepts: number;
    observations: number;
    hypotheses: number;
    promotedHypotheses: number;
    namespaces: number;
    openWorldAnchors: number;
    tracedConcepts: number;
    evalStatus: string;
    healthStatus?: string;
  };
  artifacts: Record<string, string | undefined>;
  nextActions: string[];
  privacyNotes: string[];
}

interface SectionSpec {
  key: string;
  artifactKey?: string;
  fallbackPath?: string;
  category: z.infer<typeof LearnV2ProductIndexSectionSchema>["category"];
  purpose: string;
}

const sectionSpecs: SectionSpec[] = [
  { key: "source-gate", artifactKey: "learnV2SourceGateReviewPath", category: "source", purpose: "Accepted, rejected, and review-needed source decisions without raw source content." },
  { key: "raw-vault", artifactKey: "learnV2RawVaultDir", category: "privacy", purpose: "Project-local raw evidence retention; never compile, pack, or share." },
  { key: "episode-store", artifactKey: "learnV2EpisodeStorePath", category: "evidence", purpose: "Local reconstructed task episodes that feed learning and debug views." },
  { key: "conditional-learning", artifactKey: "learnV2ConditionalLearningPath", category: "learning", purpose: "Observation, context-factor, hypothesis, and memory-admission trace." },
  { key: "learning-memory", artifactKey: "learnV2LearningMemoryStorePath", category: "learning", purpose: "Accumulated local-only observation, hypothesis, and admission memory across applied runs." },
  { key: "skill-ontology", artifactKey: "learnV2SkillOntologyPath", category: "learning", purpose: "Emergent namespace candidates and create/merge/split/attach operations." },
  { key: "skill-ontology-memory", artifactKey: "learnV2SkillOntologyMemoryStorePath", category: "learning", purpose: "Accumulated local-only namespace and ontology operation memory across applied runs." },
  { key: "open-world-grounding", artifactKey: "learnV2OpenWorldGroundingPath", category: "learning", purpose: "Project/external authority-tier anchors kept separate from user preference evidence." },
  { key: "concept-store", artifactKey: "learnV2ConceptStorePath", category: "review", purpose: "Canonical candidate/reviewed concept cards." },
  { key: "review-queue", artifactKey: "learnV2ReviewQueuePath", category: "review", purpose: "Developer review surface for accepting, rejecting, narrowing, and locking concepts." },
  { key: "concept-debug-trace", artifactKey: "learnV2ConceptDebugTracePath", category: "debug", purpose: "Joined why-learned and why-active trace for each concept." },
  { key: "outcome-policy", artifactKey: "learnV2OutcomePolicyPath", category: "activation", purpose: "Suppression, demotion, and monitoring decisions from concept outcomes." },
  { key: "activation-index", fallbackPath: ".openskill-kit/learn-v2/activation-index.json", category: "activation", purpose: "Runtime concept activation index used by task context and replay eval." },
  { key: "eval-report", artifactKey: "learnV2EvalReportPath", category: "eval", purpose: "Extraction, activation, behavior-delta, leak, and token-budget proof boundary." },
  { key: "observability", artifactKey: "learnV2ObservabilityReportPath", category: "debug", purpose: "Pipeline health, counts, warnings, blockers, and artifact pointers." },
  { key: "model-requests", artifactKey: "learnV2ModelRequestDir", category: "model", purpose: "Prompt-safe OpenCode-routed model request manifests." },
  { key: "compile-preview", artifactKey: "learnV2CompilePreviewPath", category: "review", purpose: "Declassified compiled behavior preview before sharing or install." },
  { key: "raw-learning-digest", artifactKey: "reviewMarkdownPath", category: "debug", purpose: "Run digest for the raw-local learning invocation." }
];

export async function writeLearnV2ProductIndex(
  rootInput: string,
  input: LearnV2ProductIndexInput
): Promise<LearnV2ProductIndexArtifact> {
  const root = path.resolve(rootInput);
  const json = path.join(root, ".openskill-kit", "learn-v2", "index.json");
  const markdown = path.join(root, ".openskill-kit", "learn-v2", "index.md");
  const stableByKey = new Map(LEARN_V2_STABLE_ARTIFACT_PATHS.map((item) => [item.key, item]));
  const sections = await Promise.all(sectionSpecs.map(async (spec) => {
    const stable = stableByKey.get(spec.key);
    const artifactPath = spec.artifactKey ? input.artifacts[spec.artifactKey] : undefined;
    const resolvedPath = artifactPath ?? (spec.fallbackPath ? path.join(root, spec.fallbackPath) : undefined);
    const exists = resolvedPath ? await pathExists(resolvedPath) : false;
    return LearnV2ProductIndexSectionSchema.parse({
      key: spec.key,
      label: stable?.label ?? titleCase(spec.key),
      category: spec.category,
      path: resolvedPath ? learnV2SafeLocalPath(resolvedPath, root) : undefined,
      status: exists ? "written" : resolvedPath ? "planned-path" : "missing",
      sharePolicy: stable?.sharePolicy ?? "local-declassified",
      command: stable?.cli ?? "openskill-kit osk learn --raw --surface-file <path>",
      purpose: spec.purpose
    });
  }));
  const artifact = LearnV2ProductIndexArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.product-index.v1",
    generatedAt: input.generatedAt,
    run: {
      previewOnly: input.previewOnly,
      modelMode: input.modelMode,
      sourcesConsidered: input.summary.sourcesConsidered,
      sourcesIncluded: input.summary.sourcesIncluded,
      concepts: input.summary.concepts,
      observations: input.summary.observations,
      hypotheses: input.summary.hypotheses,
      promotedHypotheses: input.summary.promotedHypotheses,
      namespaces: input.summary.namespaces,
      openWorldAnchors: input.summary.openWorldAnchors,
      tracedConcepts: input.summary.tracedConcepts,
      evalStatus: input.summary.evalStatus,
      healthStatus: input.summary.healthStatus
    },
    sections,
    privacy: {
      localOnlyPaths: LEARN_V2_STABLE_ARTIFACT_PATHS
        .filter((item) => item.sharePolicy === "local-only")
        .map((item) => item.relativePath),
      notes: input.privacyNotes
    },
    nextActions: input.nextActions,
    artifacts: {
      json,
      markdown
    }
  });
  await fs.mkdir(path.dirname(json), { recursive: true });
  await writeJsonAtomic(json, artifact);
  await fs.writeFile(markdown, renderLearnV2ProductIndex(artifact), "utf8");
  return artifact;
}

async function pathExists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true, () => false);
}

function titleCase(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderLearnV2ProductIndex(index: LearnV2ProductIndexArtifact): string {
  return [
    "# Learn v2 Product Index",
    "",
    `Generated: ${index.generatedAt}`,
    `Preview only: ${index.run.previewOnly}`,
    `Model mode: ${index.run.modelMode}`,
    `Health: ${index.run.healthStatus ?? "unknown"}`,
    "",
    "## Run Summary",
    "",
    `- Sources: ${index.run.sourcesIncluded} included / ${index.run.sourcesConsidered} considered`,
    `- Concepts: ${index.run.concepts}`,
    `- Observations: ${index.run.observations}`,
    `- Hypotheses: ${index.run.hypotheses} (${index.run.promotedHypotheses} promoted)`,
    `- Namespaces: ${index.run.namespaces}`,
    `- Open-world anchors: ${index.run.openWorldAnchors}`,
    `- Concept debug traces: ${index.run.tracedConcepts}`,
    `- Eval: ${index.run.evalStatus}`,
    "",
    "## Artifact Map",
    "",
    ...index.sections.map((section) => [
      `### ${section.label}`,
      "",
      `- Key: ${section.key}`,
      `- Category: ${section.category}`,
      `- Status: ${section.status}`,
      `- Path: ${section.path ?? "none"}`,
      `- Share policy: ${section.sharePolicy}`,
      `- Command: ${section.command}`,
      `- Purpose: ${section.purpose}`,
      ""
    ].join("\n")),
    "## Privacy",
    "",
    `- Local-only paths: ${index.privacy.localOnlyPaths.join(", ") || "none"}`,
    ...index.privacy.notes.map((note) => `- ${note}`),
    "",
    "## Next Actions",
    "",
    ...index.nextActions.map((action) => `- ${action}`)
  ].join("\n") + "\n";
}
