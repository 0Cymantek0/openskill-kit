import { promises as fs } from "node:fs";
import path from "node:path";
import { reconstructLearnV2Episodes } from "./episodes.js";
import { extractLearnV2BehaviorAtoms } from "./extract.js";
import { writeLearnV2ConditionalLearningArtifact } from "./conditional-learning.js";
import { writeLearnV2SkillOntologyArtifact } from "./skill-ontology.js";
import { writeLearnV2OpenWorldGroundingArtifact } from "./resource-grounding.js";
import { writeLearnV2ConceptDebugTraceArtifact } from "./concept-debug-trace.js";
import { mergeLearnV2ConceptCards } from "./concepts.js";
import { readLearnV2ConceptStore, writeLearnV2ConceptStore } from "./store.js";
import { runLearnV2Eval, type LearnV2EvalOptions } from "./eval.js";
import { learnV2ModelRequestsRoot, readLearnV2EpisodeStore, writeLearnV2EpisodeStore, writeLearnV2ModelRequests } from "./model-proposals.js";
import { type LearnV2EvalReport, type LearnV2NormalizedEvidence } from "./schemas.js";

export interface LearnV2EpisodeReconstructionResult {
  schemaVersion: "openskill-kit.learn-v2.reconstruct-episodes-result.v1";
  reconstructedAt: string;
  analysisFrameCount: number;
  normalizedEvidenceCount: number;
  episodeCount: number;
  episodeStorePath: string;
  modelRequestDir: string;
  modelRequestCount: number;
}

export interface LearnV2ConceptExtractionResult {
  schemaVersion: "openskill-kit.learn-v2.extract-concepts-result.v1";
  extractedAt: string;
  episodeCount: number;
  atomCount: number;
  conditionalObservationCount: number;
  conditionalHypothesisCount: number;
  promotedConditionalHypothesisCount: number;
  skillNamespaceCount: number;
  openWorldAnchorCount: number;
  conceptDebugTraceCount: number;
  rejectedAtomCount: number;
  conceptCount: number;
  conceptStorePath: string;
  conditionalLearningPath: string;
  skillOntologyPath: string;
  openWorldGroundingPath: string;
  conceptDebugTracePath: string;
}

export interface LearnV2PersistedEvalResult {
  schemaVersion: "openskill-kit.learn-v2.persisted-eval-result.v1";
  evaluatedAt: string;
  episodeCount: number;
  conceptCount: number;
  evalReportPath: string;
  evalStatus: "pass" | "fail";
  proofBoundary: LearnV2EvalReport["proofBoundary"];
  summary: LearnV2EvalReport["summary"];
  leakCheck: LearnV2EvalReport["leakCheck"];
  tokenBudget: LearnV2EvalReport["tokenBudget"];
}

export async function reconstructPersistedLearnV2Episodes(rootInput: string, now = new Date()): Promise<LearnV2EpisodeReconstructionResult> {
  const root = path.resolve(rootInput);
  const frames = await readAnalysisFrames(root);
  const normalizedEvidence = frames.flatMap((frame) => frame.normalizedEvidence);
  const episodes = reconstructLearnV2Episodes(normalizedEvidence);
  const episodeStorePath = await writeLearnV2EpisodeStore(root, episodes, now);
  const modelRequests = await writeLearnV2ModelRequests(root, episodes, now);
  return {
    schemaVersion: "openskill-kit.learn-v2.reconstruct-episodes-result.v1",
    reconstructedAt: now.toISOString(),
    analysisFrameCount: frames.length,
    normalizedEvidenceCount: normalizedEvidence.length,
    episodeCount: episodes.length,
    episodeStorePath,
    modelRequestDir: learnV2ModelRequestsRoot(root),
    modelRequestCount: modelRequests.requestCount
  };
}

export async function extractPersistedLearnV2Concepts(rootInput: string, now = new Date()): Promise<LearnV2ConceptExtractionResult> {
  const root = path.resolve(rootInput);
  const episodeStore = await readLearnV2EpisodeStore(root);
  const extracted = extractLearnV2BehaviorAtoms(episodeStore.episodes);
  const conditionalLearning = await writeLearnV2ConditionalLearningArtifact(root, episodeStore.episodes, now);
  const atoms = [...extracted.atoms, ...conditionalLearning.atoms];
  const concepts = mergeLearnV2ConceptCards(atoms, now);
  const store = await writeLearnV2ConceptStore(root, concepts, now);
  const skillOntology = await writeLearnV2SkillOntologyArtifact(root, store.cards, now);
  const openWorldGrounding = await writeLearnV2OpenWorldGroundingArtifact(root, store.cards, now);
  const conceptDebugTrace = await writeLearnV2ConceptDebugTraceArtifact(root, store.cards, now, {
    conditionalLearning,
    skillOntology,
    openWorldGrounding
  });
  return {
    schemaVersion: "openskill-kit.learn-v2.extract-concepts-result.v1",
    extractedAt: now.toISOString(),
    episodeCount: episodeStore.episodes.length,
    atomCount: atoms.length,
    conditionalObservationCount: conditionalLearning.counts.observations,
    conditionalHypothesisCount: conditionalLearning.counts.hypotheses,
    promotedConditionalHypothesisCount: conditionalLearning.counts.promotedHypotheses,
    skillNamespaceCount: skillOntology.counts.namespaces,
    openWorldAnchorCount: openWorldGrounding.counts.anchors,
    conceptDebugTraceCount: conceptDebugTrace.counts.tracedConcepts,
    rejectedAtomCount: extracted.rejected.length,
    conceptCount: store.cards.length,
    conceptStorePath: path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json"),
    conditionalLearningPath: conditionalLearning.artifacts.markdown,
    skillOntologyPath: skillOntology.artifacts.markdown,
    openWorldGroundingPath: openWorldGrounding.artifacts.markdown,
    conceptDebugTracePath: conceptDebugTrace.artifacts.markdown
  };
}

export async function runPersistedLearnV2Eval(rootInput: string, options: LearnV2EvalOptions = {}, now = new Date()): Promise<LearnV2PersistedEvalResult> {
  const root = path.resolve(rootInput);
  const episodeStore = await readLearnV2EpisodeStore(root);
  const conceptStore = await readLearnV2ConceptStore(root, now);
  const report = await runLearnV2Eval(root, episodeStore.episodes, conceptStore.cards, now, options);
  return {
    schemaVersion: "openskill-kit.learn-v2.persisted-eval-result.v1",
    evaluatedAt: now.toISOString(),
    episodeCount: episodeStore.episodes.length,
    conceptCount: conceptStore.cards.length,
    evalReportPath: report.artifacts.markdown,
    evalStatus: report.status,
    proofBoundary: report.proofBoundary,
    summary: report.summary,
    leakCheck: report.leakCheck,
    tokenBudget: report.tokenBudget
  };
}

interface AnalysisFrame {
  normalizedEvidence: LearnV2NormalizedEvidence[];
}

async function readAnalysisFrames(root: string): Promise<AnalysisFrame[]> {
  const dir = path.join(root, ".openskill-kit", "learn-v2", "analysis");
  const files = await fs.readdir(dir).catch(() => []);
  const frames: AnalysisFrame[] = [];
  for (const file of files.filter((item) => item.endsWith(".json")).sort()) {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
    if (Array.isArray(parsed.normalizedEvidence)) frames.push({ normalizedEvidence: parsed.normalizedEvidence as LearnV2NormalizedEvidence[] });
  }
  return frames;
}
