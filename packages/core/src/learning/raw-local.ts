import type { InteractionImportRun } from "../interactions/importer.js";
import type { LifecycleRunnerResult } from "../lifecycle/runner.js";
import {
  LearnV2RawLearningModelModes,
  runLearnV2RawLocalLearning,
  type LearnV2RawLearningModelMode
} from "../learn-v2/pipeline.js";

export const RawLearningModelModes = LearnV2RawLearningModelModes;
export type RawLearningModelMode = LearnV2RawLearningModelMode;

export interface BehaviorAtom {
  id: string;
  kind: "preference" | "workflow" | "security" | "verification" | "dependency-policy" | "review-policy" | "command-policy";
  statement: string;
  polarity: "positive" | "negative" | "neutral";
  scope: {
    level: "project" | "path" | "directory" | "task";
    paths: string[];
  };
  weight: number;
  evidenceRefs: string[];
}

export interface ConceptCard {
  id: string;
  concept: string;
  canonicalBehavior: string;
  scope: {
    level: "project" | "path" | "directory" | "task";
    paths: string[];
  };
  confidence: number;
  evidenceRefs: string[];
  atoms: BehaviorAtom[];
  reviewStatus: "candidate";
}

export interface RawLocalLearningOptions {
  sourceFiles: string[];
  adapter?: string;
  previewOnly?: boolean;
  maxRawBytes?: number;
  maxTurns?: number;
  allowDuplicateImports?: boolean;
  modelMode?: RawLearningModelMode;
  now?: Date;
}

export interface RawLearningSourceDigest {
  id: string;
  sourcePath: string;
  sourceHash: string;
  byteCount: number;
  lineCount: number;
  projectRelevance: {
    score: number;
    reasons: string[];
    matchedPaths: string[];
    matchedRemotes: string[];
    decision: "include" | "ask" | "exclude";
  };
  rawVaultRecordPath?: string;
  analysisFramePath: string;
  turnCount: number;
  windowCount: number;
  atomCount: number;
  conceptCount: number;
  deidentification: {
    redacted: boolean;
    matches: string[];
  };
  importRun?: InteractionImportRun;
  learnV2?: {
    rawRef: string;
    adapterId: string;
    detectedFormat: string;
    contentKind: string;
    v2AnalysisPath: string;
    v2RawVaultDir: string;
  };
}

export interface RawLocalLearningResult {
  schemaVersion: "openskill-kit.raw-local-learning-run.v1";
  projectRoot: string;
  generatedAt: string;
  previewOnly: boolean;
  modelMode: RawLearningModelMode;
  sources: RawLearningSourceDigest[];
  concepts: ConceptCard[];
  artifacts: {
    digestPath: string;
    reviewMarkdownPath: string;
    rawVaultDir: string;
    analysisFramesDir: string;
    learnV2RawVaultDir?: string;
    learnV2ReviewQueuePath?: string;
    learnV2CompilePreviewPath?: string;
    learnV2EvalReportPath?: string;
  };
  lifecycle?: LifecycleRunnerResult;
  digest: {
    sourcesConsidered: number;
    sourcesIncluded: number;
    sourcesAsk: number;
    sourcesExcluded: number;
    rawVaultRecordsWritten: number;
    analysisFramesWritten: number;
    learningWindows: number;
    behaviorAtoms: number;
    conceptCards: number;
    eventsAppended: number;
    reviewCandidates: number;
  };
  quality: {
    relevanceScore: number;
    conceptYieldScore: number;
    reviewReadinessScore: number;
    propagationSafetyScore: number;
    overallScore: number;
    strengths: string[];
    risks: string[];
  };
  privacy: string[];
  nextActions: string[];
  learnV2?: unknown;
}

export async function runRawLocalLearning(
  projectRootInput: string,
  options: RawLocalLearningOptions
): Promise<RawLocalLearningResult> {
  return await runLearnV2RawLocalLearning(projectRootInput, options) as RawLocalLearningResult;
}

