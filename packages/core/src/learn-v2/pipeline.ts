import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProjectConfig } from "../config/schema.js";
import { readProjectConfig } from "../events/store.js";
import { importInteractionSource, type InteractionImportRun } from "../interactions/importer.js";
import { runLifecycleOnce, type LifecycleRunnerResult } from "../lifecycle/runner.js";
import { buildReviewQueue } from "../preferences/proposals.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { ensureLearnV2ProjectRelevanceCalibration, scoreLearnV2ProjectRelevance } from "./relevance.js";
import { readLearnV2Surface, type LearnV2SurfaceAdapterDetection, type LearnV2SurfaceAdapterPolicy } from "./surfaces.js";
import { storeLearnV2RawEvidence, learnV2VaultRoot } from "./vault.js";
import {
  LearnV2ConceptCardSchema,
  LearnV2ConditionalLearningArtifactSchema,
  LearnV2ConceptDriftReportSchema,
  LearnV2ConflictLedgerSchema,
  LearnV2CounterevidenceLedgerSchema,
  LearnV2ConceptDebugTraceArtifactSchema,
  LearnV2DeclassifiedEvidenceSnippetArtifactSchema,
  LearnV2EvalReportSchema,
  LearnV2RawEvidenceRecordSchema,
  LearnV2ReviewQueueSchema,
  LearnV2SkillOntologyArtifactSchema,
  LearnV2OpenWorldGroundingArtifactSchema,
  LearnV2OutcomePolicyArtifactSchema,
  type LearnV2BehaviorAtom,
  type LearnV2ConceptCard,
  type LearnV2ConditionalLearningArtifact,
  type LearnV2ConceptDriftReport,
  type LearnV2ConflictLedger,
  type LearnV2CounterevidenceLedger,
  type LearnV2ConceptDebugTraceArtifact,
  type LearnV2DeclassifiedEvidenceSnippetArtifact,
  type LearnV2EvalReport,
  type LearnV2NormalizedEvidence,
  type LearnV2RawEvidenceRecord,
  type LearnV2ReviewQueue,
  type LearnV2SkillOntologyArtifact,
  type LearnV2OpenWorldGroundingArtifact,
  type LearnV2OutcomePolicyArtifact,
  type LearnV2TaskEpisode
} from "./schemas.js";
import { normalizeLearnV2Evidence } from "./normalize.js";
import { reconstructLearnV2Episodes } from "./episodes.js";
import { extractLearnV2BehaviorAtoms } from "./extract.js";
import { writeLearnV2ConditionalLearningArtifact } from "./conditional-learning.js";
import { learnV2LearningMemoryStorePath, writeLearnV2LearningMemoryStore } from "./learning-memory.js";
import { writeLearnV2SkillOntologyArtifact } from "./skill-ontology.js";
import { learnV2SkillOntologyMemoryStorePath, writeLearnV2SkillOntologyMemoryStore } from "./skill-ontology-memory.js";
import { writeLearnV2OpenWorldGroundingArtifact } from "./resource-grounding.js";
import { writeLearnV2ConceptDebugTraceArtifact } from "./concept-debug-trace.js";
import { writeLearnV2OutcomePolicyArtifact } from "./outcome-policy.js";
import { mergeLearnV2ConceptCards } from "./concepts.js";
import { writeLearnV2ConflictLedger } from "./conflicts.js";
import { writeLearnV2CounterevidenceLedger } from "./counterevidence-ledger.js";
import { writeLearnV2ReviewQueue } from "./review.js";
import { compileLearnV2ConceptPreview, type LearnV2CompilePreview } from "./compile.js";
import { runLearnV2Eval } from "./eval.js";
import { writeLearnV2PipelineObservabilityReport } from "./observability.js";
import { writeLearnV2ProductIndex } from "./artifact-index.js";
import { learnV2EvidenceQualityArtifactPath, writeLearnV2EvidenceQualityArtifact } from "./quality.js";
import { mergeLearnV2ConceptStoreCards, readLearnV2ConceptStore, writeLearnV2ConceptStore, type LearnV2ConceptStore } from "./store.js";
import { writeLearnV2DeclassifiedSnippetArtifact } from "./declassify.js";
import { detectLearnV2ConceptDrift } from "./drift.js";
import { ensureLearnV2ModelRoutingArtifacts } from "./model-routing.js";
import { learnV2ModelRequestsRoot, writeLearnV2EpisodeStore, writeLearnV2ModelRequests } from "./model-proposals.js";
import { buildLearnV2SourceGateReviewEntry, writeLearnV2SourceGateReviewArtifact, type LearnV2SourceGateReviewEntry } from "./source-gate.js";
import {
  learnV2DeclassifyText,
  learnV2Hash,
  learnV2SafeLocalPath,
  learnV2ShortHash
} from "./utils.js";

export const LearnV2RawLearningModelModes = [
  "deterministic-only",
  "opencode-host-sanitized-only",
  "opencode-host-raw-allowed"
] as const;
export type LearnV2RawLearningModelMode = typeof LearnV2RawLearningModelModes[number];
export const LearnV2RawLearningModelModeAliases = {
  "heuristic-only": "deterministic-only",
  "remote-redacted": "opencode-host-sanitized-only",
  "remote-explicit": "opencode-host-sanitized-only",
  "local-raw": "opencode-host-raw-allowed"
} as const;
export type LearnV2RawLearningLegacyModelMode = keyof typeof LearnV2RawLearningModelModeAliases;
export type LearnV2RawLearningModelModeInput = LearnV2RawLearningModelMode | LearnV2RawLearningLegacyModelMode;
export type LearnV2LearningInputBoundary = "raw-local-in-memory-declassified-artifacts";

export interface LearnV2ModelExecutionPolicyReport {
  requestedPolicy: LearnV2RawLearningModelMode;
  deterministicExtraction: {
    supported: true;
    status: "always-on";
  };
  requestArtifacts: {
    status: "written" | "skipped-preview" | "skipped-no-accepted-evidence" | "skipped-no-routable-episodes";
    requestCount: number;
    requestDir: string;
    routingManifestPath: string;
    firstManifestPath?: string;
  };
  sanitizedOpenCodeExecution: {
    supported: true;
    requiresExplicitApproval: true;
    command: string;
    applyCommand: string;
  };
  rawToModelExecution: {
    supported: false;
    status: "rejected";
    reason: string;
    saferPolicy: "opencode-host-sanitized-only";
  };
}

export interface LearnV2RawLocalLearningOptions {
  sourceFiles: string[];
  adapter?: string;
  previewOnly?: boolean;
  maxRawBytes?: number;
  maxTurns?: number;
  allowDuplicateImports?: boolean;
  modelMode?: LearnV2RawLearningModelModeInput;
  learnV2GoldensPath?: string;
  now?: Date;
}

interface LearnV2SourceDigestCompat {
  id: string;
  sourcePath: string;
  sourceHash: string;
  byteCount: number;
  lineCount: number;
  projectRelevance: ReturnType<typeof legacyRelevance>;
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
  learnV2: {
    rawRef: string;
    adapterId: string;
    adapterLabel?: string;
    adapterDetection?: LearnV2SurfaceAdapterDetection;
    detectedFormat: string;
    normalizationProfile?: string;
    contentKind: string;
    surfacePolicy?: LearnV2SurfaceAdapterPolicy;
    v2AnalysisPath: string;
    v2RawVaultDir: string;
    sourceGateReviewJsonPath?: string;
    sourceGateReviewPath?: string;
  };
}

interface LearnV2RawLocalLearningRunCompat {
  schemaVersion: "openskill-kit.raw-local-learning-run.v1";
  projectRoot: string;
  generatedAt: string;
  previewOnly: boolean;
  modelMode: LearnV2RawLearningModelMode;
  modelExecution: LearnV2ModelExecutionPolicyReport;
  sources: LearnV2SourceDigestCompat[];
  concepts: ReturnType<typeof toLegacyConceptCard>[];
  artifacts: {
    digestPath: string;
    reviewMarkdownPath: string;
    rawVaultDir: string;
    analysisFramesDir: string;
    learnV2RawVaultDir: string;
    learnV2ProductIndexPath: string;
    learnV2ReviewQueuePath: string;
    learnV2CompilePreviewPath: string;
    learnV2EvalReportPath: string;
    learnV2ConceptStorePath: string;
    learnV2RelevanceCalibrationPath: string;
    learnV2ModelRoutingPath: string;
    learnV2EpisodeStorePath: string;
    learnV2ModelRequestDir: string;
    learnV2ObservabilityReportPath: string;
    learnV2EvidenceQualityPath: string;
    learnV2ConflictLedgerPath: string;
    learnV2CounterevidenceLedgerPath: string;
    learnV2DeclassifiedSnippetsPath: string;
    learnV2ConceptDriftPath: string;
    learnV2SourceGateReviewJsonPath: string;
    learnV2SourceGateReviewPath: string;
    learnV2ConditionalLearningPath: string;
    learnV2LearningMemoryStorePath: string;
    learnV2SkillOntologyPath: string;
    learnV2SkillOntologyMemoryStorePath: string;
    learnV2OpenWorldGroundingPath: string;
    learnV2ConceptDebugTracePath: string;
    learnV2OutcomePolicyPath: string;
  };
  lifecycle?: LifecycleRunnerResult;
  digest: {
    sourcesConsidered: number;
    sourcesIncluded: number;
    sourcesAsk: number;
    sourcesExcluded: number;
    previewWritesLocalArtifacts: boolean;
    rawVaultRecordsWritten: number;
    canonicalConceptStateWritten: boolean;
    analysisFramesWritten: number;
    learningWindows: number;
    behaviorAtoms: number;
    conditionalObservations: number;
    conditionalHypotheses: number;
    promotedConditionalHypotheses: number;
    skillNamespaces: number;
    skillOntologyOperations: number;
    openWorldAnchors: number;
    conceptDebugTraces: number;
    outcomePolicySuppressions: number;
    conceptCards: number;
    currentRunConceptCards: number;
    mergedConceptCards: number;
    topLevelConceptsScope: "current-run-legacy-projection";
    eventsAppended: number;
    reviewCandidates: number;
    learningInputBoundary: LearnV2LearningInputBoundary;
  };
  quality: ReturnType<typeof buildV2Quality>;
  privacy: string[];
  nextActions: string[];
  learnV2: {
    schemaVersion: "openskill-kit.learn-v2.pipeline-run.v1";
    learningInputBoundary: LearnV2LearningInputBoundary;
    episodes: ReturnType<typeof reconstructLearnV2Episodes>;
    currentRunConcepts: LearnV2ConceptCard[];
    concepts: LearnV2ConceptCard[];
    conceptCounts: {
      currentRun: number;
      mergedForArtifacts: number;
    };
    rejectedAtoms: ReturnType<typeof extractLearnV2BehaviorAtoms>["rejected"];
    conditionalLearning: LearnV2ConditionalLearningArtifact;
    skillOntology: LearnV2SkillOntologyArtifact;
    openWorldGrounding: LearnV2OpenWorldGroundingArtifact;
    conceptDebugTrace: LearnV2ConceptDebugTraceArtifact;
    outcomePolicy: LearnV2OutcomePolicyArtifact;
    conceptStorePath: string;
    reviewQueuePath: string;
    compilePreviewPath: string;
    evalReportPath: string;
    episodeStorePath: string;
    modelRequestDir: string;
    modelRequestCount: number;
  };
}

export async function runLearnV2RawLocalLearning(projectRootInput: string, options: LearnV2RawLocalLearningOptions): Promise<LearnV2RawLocalLearningRunCompat> {
  if (!options.sourceFiles.length) throw new Error("Raw local learning requires at least one --surface-file path.");
  const root = path.resolve(projectRootInput);
  const config = await readProjectConfig(root);
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const learningInputBoundary: LearnV2LearningInputBoundary = "raw-local-in-memory-declassified-artifacts";
  const previewOnly = options.previewOnly !== false;
  const modelMode = resolveLearnV2RawLearningModelMode(options.modelMode ?? config.learning.rawEvidence.extractionExecution);
  if (modelMode === "opencode-host-raw-allowed") {
    throw new Error("Learn v2 model mode opencode-host-raw-allowed is not implemented yet; use deterministic-only or opencode-host-sanitized-only.");
  }
  const legacyRawVaultDir = path.join(root, ".openskill-kit", "raw-vault");
  const legacyAnalysisFramesDir = path.join(root, ".openskill-kit", "learning", "analysis-frames");
  const v2AnalysisDir = path.join(root, ".openskill-kit", "learn-v2", "analysis");
  const stagedImportsDir = path.join(root, ".openskill-kit", "learning", "staged-imports");
  const digestsDir = path.join(root, ".openskill-kit", "learning", "digests");
  await fs.mkdir(legacyAnalysisFramesDir, { recursive: true });
  await fs.mkdir(v2AnalysisDir, { recursive: true });
  await fs.mkdir(digestsDir, { recursive: true });
  if (!previewOnly) {
    await fs.mkdir(path.join(legacyRawVaultDir, "records"), { recursive: true });
    await fs.mkdir(stagedImportsDir, { recursive: true });
  }
  const relevanceCalibration = await ensureLearnV2ProjectRelevanceCalibration(root, now);

  const sourceDigests: LearnV2SourceDigestCompat[] = [];
  const acceptedRawEvidence: LearnV2NormalizedEvidence[] = [];
  const acceptedDeclassifiedEvidence: LearnV2NormalizedEvidence[] = [];
  const sourceGateEntries: LearnV2SourceGateReviewEntry[] = [];
  let eventsAppended = 0;
  const importRuns: InteractionImportRun[] = [];

  for (const sourceFile of options.sourceFiles) {
    const sourcePath = path.resolve(sourceFile);
    const stat = await fs.stat(sourcePath).catch(() => undefined);
    if (!stat?.isFile()) throw new Error(`Raw learning source is not a file: ${sourcePath}`);
    const maxBytes = Math.min(options.maxRawBytes ?? config.learning.rawEvidence.maxRawBytesPerRun, config.learning.rawEvidence.maxRawBytesPerRun);
    if (stat.size > maxBytes) throw new Error(`Raw learning source exceeds maxRawBytes=${maxBytes}: ${sourcePath}`);
    const surface = await readLearnV2Surface(sourcePath, options.adapter);
    const scoredRelevance = await scoreLearnV2ProjectRelevance(root, sourcePath, surface.rawText, undefined, {
      calibration: relevanceCalibration.calibration,
      explicitlySelected: true,
      now
    });
    const relevance = trustPrivacySafeOpenCodeAmbientSource(root, sourcePath, surface.rawText, surface.adapterId, scoredRelevance);
    const declassified = learnV2DeclassifyText(surface.rawText, root, config);
    const sourceAcceptedForLearning = relevance.decision === "accept";
    const shouldPersistRawRecord = !previewOnly && sourceAcceptedForLearning;
    const rawRecord = !shouldPersistRawRecord
      ? makePreviewRawRecord(config.projectId, sourcePath, surface.adapterId, surface.rawText, surface.contentKind, relevance, generatedAt, root, declassified)
      : (await storeLearnV2RawEvidence({
          root,
          config,
          now,
          maxHotBytes: Math.min(50_000_000, config.learning.rawEvidence.maxRawBytesTotal),
          maxTotalBytes: config.learning.rawEvidence.maxRawBytesTotal,
          retentionDays: config.learning.rawEvidence.retainRawDays
        }, {
          adapterId: surface.adapterId,
          sourcePath,
          text: surface.rawText,
          contentKind: surface.contentKind,
          relevance
        })).record;
    const learnerText = normalizeRawLearnerLocalPaths(surface.rawText, root);
    const normalizedRaw = normalizeLearnV2Evidence(surface, rawRecord, learnerText).slice(0, options.maxTurns ?? 500);
    const normalized = normalizedRaw.map((item) => declassifyLearnV2NormalizedEvidence(item, root, config));
    const gatedNormalized = sourceAcceptedForLearning ? normalized : [];
    if (sourceAcceptedForLearning) {
      acceptedRawEvidence.push(...normalizedRaw);
      acceptedDeclassifiedEvidence.push(...normalized);
    }
    const short = rawRecord.source.contentHash.replace(/^sha256:/, "").slice(0, 16);
    const legacyRawVaultRecordPath = shouldPersistRawRecord ? path.join(legacyRawVaultDir, "records", `${short}.json`) : undefined;
    if (legacyRawVaultRecordPath) {
      await writeJsonAtomic(legacyRawVaultRecordPath, {
        schemaVersion: "openskill-kit.raw-vault-record.v1",
        supersededBy: rawRecord.id,
        v2RecordPath: path.join(learnV2VaultRoot(root), "records", `${rawRecord.id}.json`),
        id: `raw_${short}`,
        projectId: config.projectId,
        sourcePath: learnV2SafeLocalPath(sourcePath, root),
        sourcePathHash: learnV2Hash(sourcePath),
        sourceHash: rawRecord.source.contentHash,
        capturedAt: generatedAt,
        byteCount: stat.size,
        lineCount: surface.rawText.split(/\r?\n/).length,
        projectRelevance: legacyRelevance(relevance),
        deidentification: {
          redacted: declassified.matches.length > 0,
          matches: declassified.matches
        },
        contentEncoding: "utf8",
        contentKind: "deidentified-raw-transcript",
        content: declassified.text
      });
    }
    const analysisFramePath = path.join(legacyAnalysisFramesDir, `${short}.json`);
    const v2AnalysisPath = path.join(v2AnalysisDir, `${rawRecord.id}.json`);
    const analysisPayload = {
      schemaVersion: "openskill-kit.learn-v2.analysis-frame.v1",
      id: `frame_${short}`,
      rawRef: rawRecord.id,
      sourceHash: rawRecord.source.contentHash,
      sourcePath: learnV2SafeLocalPath(sourcePath, root),
      projectRelevance: relevance,
      surfaceAdapter: {
        id: surface.adapterId,
        label: surface.adapterLabel,
        detection: surface.adapterDetection,
        contentKind: surface.contentKind,
        detectedFormat: surface.detectedFormat,
        normalizationProfile: surface.normalizationProfile,
        policy: surface.policy
      },
      modelMode,
      learningInputBoundary,
      promptSafe: sourceAcceptedForLearning,
      sourceGate: {
        extractionEligible: sourceAcceptedForLearning,
        normalizedEvidenceSuppressed: !sourceAcceptedForLearning,
        decision: relevance.decision
      },
      normalizedEvidence: gatedNormalized
    };
    await writeJsonAtomic(analysisFramePath, analysisPayload);
    await writeJsonAtomic(v2AnalysisPath, analysisPayload);
    sourceGateEntries.push(buildLearnV2SourceGateReviewEntry({
      id: `source_${short}`,
      root,
      sourcePath,
      sourceHash: rawRecord.source.contentHash,
      byteCount: stat.size,
      lineCount: surface.rawText.split(/\r?\n/).length,
      surface,
      relevance,
      declassifiedText: declassified.text,
      declassificationMatches: declassified.matches,
      rawVaultRecordWritten: Boolean(legacyRawVaultRecordPath)
    }));

    let importRun: InteractionImportRun | undefined;
    if (!previewOnly && sourceAcceptedForLearning) {
      const stagedImportPath = path.join(stagedImportsDir, `${short}.txt`);
      await fs.writeFile(stagedImportPath, declassified.text, "utf8");
      importRun = await importInteractionSource(root, stagedImportPath, {
        adapter: options.adapter ?? "manual-import",
        dryRun: false,
        allowDuplicate: options.allowDuplicateImports === true,
        maxEvents: options.maxTurns ?? 500,
        now: options.now
      });
      eventsAppended += importRun.appendedEventCount;
      importRuns.push(importRun);
    }
    sourceDigests.push({
      id: `source_${short}`,
      sourcePath,
      sourceHash: rawRecord.source.contentHash,
      byteCount: stat.size,
      lineCount: surface.rawText.split(/\r?\n/).length,
      projectRelevance: legacyRelevance(relevance),
      rawVaultRecordPath: legacyRawVaultRecordPath,
      analysisFramePath,
      turnCount: gatedNormalized.length,
      windowCount: 0,
      atomCount: 0,
      conceptCount: 0,
      deidentification: {
        redacted: declassified.matches.length > 0,
        matches: declassified.matches
      },
      importRun,
      learnV2: {
        rawRef: rawRecord.id,
        adapterId: surface.adapterId,
        adapterLabel: surface.adapterLabel,
        adapterDetection: surface.adapterDetection,
        detectedFormat: surface.detectedFormat,
        normalizationProfile: surface.normalizationProfile,
        contentKind: surface.contentKind,
        surfacePolicy: surface.policy,
        v2AnalysisPath,
        v2RawVaultDir: learnV2VaultRoot(root)
      }
    });
  }
  const sourceGateReview = await writeLearnV2SourceGateReviewArtifact(root, sourceGateEntries, now);
  for (const source of sourceDigests) {
    source.learnV2.sourceGateReviewJsonPath = sourceGateReview.paths.json;
    source.learnV2.sourceGateReviewPath = sourceGateReview.paths.markdown;
  }

  const hasAcceptedEvidence = acceptedRawEvidence.length > 0;
  const shouldWriteDerivedArtifacts = hasAcceptedEvidence;
  const shouldWriteModelRequests = !previewOnly && hasAcceptedEvidence;
  const rawEpisodes = hasAcceptedEvidence ? reconstructLearnV2Episodes(acceptedRawEvidence) : [];
  const episodes = rawEpisodes.map((episode) => declassifyLearnV2TaskEpisode(episode, root, config));
  const evidenceQuality = shouldWriteDerivedArtifacts
    ? await writeLearnV2EvidenceQualityArtifact(root, acceptedDeclassifiedEvidence, now)
    : { scores: [] };
  const evidenceQualityPath = learnV2EvidenceQualityArtifactPath(root, now);
  const declassifiedSnippets = shouldWriteDerivedArtifacts
    ? await writeLearnV2DeclassifiedSnippetArtifact(root, episodes, now, {
        blockOnMediumRisk: true,
        maxChars: 700,
        maxSnippets: 200
      })
    : emptyDeclassifiedSnippets(root, now);
  const episodeStorePath = shouldWriteDerivedArtifacts
    ? await writeLearnV2EpisodeStore(root, episodes, now)
    : path.join(root, ".openskill-kit", "learn-v2", "episodes", "store.json");
  const modelRequests = shouldWriteModelRequests
    ? await writeLearnV2ModelRequests(root, episodes, now)
    : {
        schemaVersion: "openskill-kit.learn-v2.model-request-result.v1" as const,
        generatedAt,
        requestCount: 0,
        requests: [],
        skippedEpisodes: [],
        routingManifestPath: path.join(root, ".openskill-kit", "learn-v2", "model-requests", "routing-manifest.json")
      };
  const modelExecution = buildLearnV2ModelExecutionPolicyReport(root, {
    modelMode,
    previewOnly,
    hasAcceptedEvidence,
    requestCount: modelRequests.requestCount,
    requestDir: learnV2ModelRequestsRoot(root),
    routingManifestPath: modelRequests.routingManifestPath,
    firstManifestPath: modelRequests.requests[0]?.manifestPath
  });
  const conditionalLearning = shouldWriteDerivedArtifacts
    ? await writeLearnV2ConditionalLearningArtifact(root, episodes, now)
    : emptyConditionalLearningArtifact(root, now);
  const learningMemoryPath = learnV2LearningMemoryStorePath(root);
  if (shouldWriteDerivedArtifacts && !previewOnly) {
    await writeLearnV2LearningMemoryStore(root, conditionalLearning, now);
  }
  const extracted = extractLearnV2BehaviorAtoms(rawEpisodes);
  const behaviorAtoms = [...extracted.atoms, ...conditionalLearning.atoms];
  const concepts = declassifyLearnV2ConceptCards(mergeLearnV2ConceptCards(behaviorAtoms, now), root, config);
  const canonicalConceptStateWritten = !previewOnly && concepts.length > 0;
  const conceptStore = previewOnly
    ? await writePreviewLearnV2ConceptStore(root, config.projectId, concepts, now)
    : canonicalConceptStateWritten
      ? await writeLearnV2ConceptStore(root, concepts, now)
      : await readLearnV2ConceptStore(root, now);
  const conceptCardsForArtifacts = conceptStore.cards;
  const skillOntology = shouldWriteDerivedArtifacts
    ? await writeLearnV2SkillOntologyArtifact(root, conceptCardsForArtifacts, now)
    : emptySkillOntologyArtifact(root, now);
  const skillOntologyMemoryPath = learnV2SkillOntologyMemoryStorePath(root);
  if (shouldWriteDerivedArtifacts && !previewOnly) {
    await writeLearnV2SkillOntologyMemoryStore(root, skillOntology, now);
  }
  const openWorldGrounding = shouldWriteDerivedArtifacts
    ? await writeLearnV2OpenWorldGroundingArtifact(root, conceptCardsForArtifacts, now)
    : emptyOpenWorldGroundingArtifact(root, now);
  const conceptStorePath = previewOnly
    ? previewLearnV2ConceptStorePath(root, generatedAt)
    : path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json");
  const conceptDrift = shouldWriteDerivedArtifacts
    ? await detectLearnV2ConceptDrift(root, conceptCardsForArtifacts, { now })
    : {
        report: emptyConceptDriftReport(now),
        artifactPath: path.join(root, ".openskill-kit", "learn-v2", "drift", "concept-drift.json")
      };
  const conflictLedger = shouldWriteDerivedArtifacts
    ? await writeLearnV2ConflictLedger(root, conceptCardsForArtifacts, config.projectId, now)
    : {
        ledger: emptyConflictLedger(config.projectId, now),
        artifactPaths: {
          json: path.join(root, ".openskill-kit", "learn-v2", "conflicts", "conflict-ledger.json"),
          markdown: path.join(root, ".openskill-kit", "learn-v2", "conflicts", "conflict-ledger.md")
        }
      };
  const counterevidenceLedger = shouldWriteDerivedArtifacts
    ? await writeLearnV2CounterevidenceLedger(root, conceptCardsForArtifacts, now)
    : {
        ledger: emptyCounterevidenceLedger(root, now),
        artifactPaths: {
          json: path.join(root, ".openskill-kit", "learn-v2", "counterevidence", "counterevidence-ledger.json"),
          markdown: path.join(root, ".openskill-kit", "learn-v2", "counterevidence", "counterevidence-ledger.md")
        }
      };
  const modelRouting = await ensureLearnV2ModelRoutingArtifacts(root, now);
  for (const source of sourceDigests) {
    const rawRef = source.learnV2.rawRef;
    source.windowCount = episodes.filter((episode) => episode.rawRefs.includes(rawRef)).length;
    source.atomCount = behaviorAtoms.filter((atom) => atom.rawRefs.includes(rawRef)).length;
    source.conceptCount = concepts.filter((concept) => concept.rawRefs.includes(rawRef)).length;
  }
  let reviewQueue = shouldWriteDerivedArtifacts
    ? await writeLearnV2ReviewQueue(root, conceptCardsForArtifacts, now, {
        ledger: conflictLedger.ledger,
        markdownPath: conflictLedger.artifactPaths.markdown,
        declassifiedSnippets,
        counterevidenceLedger: {
          ledger: counterevidenceLedger.ledger,
          markdownPath: counterevidenceLedger.artifactPaths.markdown
        },
        conceptDrift
    })
    : emptyReviewQueue(root, now);
  const outcomePolicy = shouldWriteDerivedArtifacts
    ? await writeLearnV2OutcomePolicyArtifact(root, conceptCardsForArtifacts, now)
    : emptyOutcomePolicyArtifact(root, now);
  const conceptDebugTrace = shouldWriteDerivedArtifacts
    ? await writeLearnV2ConceptDebugTraceArtifact(root, conceptCardsForArtifacts, now, {
        conditionalLearning,
        skillOntology,
        openWorldGrounding,
        outcomePolicy,
        reviewQueue
      })
    : emptyConceptDebugTraceArtifact(root, now);
  const compilePreview = shouldWriteDerivedArtifacts
    ? await compileLearnV2ConceptPreview(root, config, conceptCardsForArtifacts, now)
    : emptyCompilePreview(root, now);
  const evalReport = shouldWriteDerivedArtifacts
    ? await runLearnV2Eval(root, episodes, conceptCardsForArtifacts, now, { goldensPath: options.learnV2GoldensPath })
    : emptyEvalReport(root);
  const lifecycle: LifecycleRunnerResult | undefined = !previewOnly && importRuns.some((run) => run.appendedEventCount > 0)
    ? await runLifecycleOnce({ projectRoot: root, maxEvents: options.maxTurns ?? 500, compileSafe: false, now: options.now })
    : undefined;
  const review = lifecycle ? await buildReviewQueue(root) : undefined;
  if (shouldWriteDerivedArtifacts) {
    reviewQueue = await writeLearnV2ReviewQueue(root, conceptCardsForArtifacts, now, {
      ledger: conflictLedger.ledger,
      markdownPath: conflictLedger.artifactPaths.markdown,
      declassifiedSnippets,
      counterevidenceLedger: {
        ledger: counterevidenceLedger.ledger,
        markdownPath: counterevidenceLedger.artifactPaths.markdown
      },
      conceptDrift,
      conceptDebugTrace
    });
  }
  const legacyConcepts = concepts.map(toLegacyConceptCard);
  const digestPath = path.join(digestsDir, `raw-learning-${timestampSlug(generatedAt)}.json`);
  const reviewMarkdownPath = path.join(digestsDir, `raw-learning-${timestampSlug(generatedAt)}.md`);
  const productIndexPath = path.join(root, ".openskill-kit", "learn-v2", "index.md");
  const nextActions = !hasAcceptedEvidence
    ? [
        "Inspect the Learn v2 source-gate review artifact; no source was accepted for extraction.",
        "Provide a project-anchored raw source or explicitly review/approve ambiguous source evidence before extraction."
      ]
    : previewOnly
    ? [
        "Inspect the raw learning digest and learn-v2 concept review queue, then rerun with --apply to persist raw vault records and staged review evidence.",
        "Review source relevance decisions marked ask/reject before applying."
      ]
    : [
        "Inspect the learn-v2 review queue; accept, edit, narrow, or reject concept cards before compile.",
        "Optionally run an OpenCode-configured concept extractor on generated prompt-safe learn-v2 model request artifacts, then ingest validated JSON outputs.",
        "Run /osk review and /osk compile after activation; candidate concepts do not compile."
      ];
  const observability = await writeLearnV2PipelineObservabilityReport(root, {
    generatedAt,
    previewOnly,
    modelMode,
    sources: sourceDigests,
    episodes,
    concepts: conceptCardsForArtifacts,
    rejectedAtoms: extracted.rejected,
    reviewQueue,
    evalReport,
    eventsAppended,
    modelRequestCount: modelRequests.requestCount,
    modelExecution,
    artifacts: {
      digestPath,
      reviewMarkdownPath,
      learnV2ProductIndexPath: productIndexPath,
      learnV2ReviewQueuePath: reviewQueue.artifacts.markdown,
      learnV2CompilePreviewPath: compilePreview.artifacts.markdown,
      learnV2EvalReportPath: evalReport.artifacts.markdown,
      learnV2ConceptStorePath: conceptStorePath,
      learnV2RelevanceCalibrationPath: relevanceCalibration.path,
      learnV2ModelRoutingPath: modelRouting.artifacts.routingJson,
      learnV2EpisodeStorePath: episodeStorePath,
      learnV2ModelRequestDir: learnV2ModelRequestsRoot(root),
      learnV2EvidenceQualityPath: evidenceQualityPath,
      learnV2ConflictLedgerPath: conflictLedger.artifactPaths.markdown,
      learnV2CounterevidenceLedgerPath: counterevidenceLedger.artifactPaths.markdown,
      learnV2DeclassifiedSnippetsPath: declassifiedSnippets.artifacts.markdown,
      learnV2ConceptDriftPath: conceptDrift.artifactPath,
      learnV2SourceGateReviewJsonPath: sourceGateReview.paths.json,
      learnV2SourceGateReviewPath: sourceGateReview.paths.markdown,
      learnV2ConditionalLearningPath: conditionalLearning.artifacts.markdown,
      learnV2LearningMemoryStorePath: learningMemoryPath,
      learnV2SkillOntologyPath: skillOntology.artifacts.markdown,
      learnV2SkillOntologyMemoryStorePath: skillOntologyMemoryPath,
      learnV2OpenWorldGroundingPath: openWorldGrounding.artifacts.markdown,
      learnV2ConceptDebugTracePath: conceptDebugTrace.artifacts.markdown,
      learnV2OutcomePolicyPath: outcomePolicy.artifacts.markdown
    },
    conflictLedger: conflictLedger.ledger,
    conceptDrift: conceptDrift.report,
    declassifiedSnippets,
    evidenceQualityScores: evidenceQuality.scores,
    conditionalLearning,
    skillOntology,
    openWorldGrounding,
    conceptDebugTrace,
    outcomePolicy,
    nextActions
  });
  const result: LearnV2RawLocalLearningRunCompat = {
    schemaVersion: "openskill-kit.raw-local-learning-run.v1",
    projectRoot: root,
    generatedAt,
    previewOnly,
    modelMode,
    modelExecution,
    sources: sourceDigests,
    concepts: legacyConcepts,
    artifacts: {
      digestPath,
      reviewMarkdownPath,
      rawVaultDir: legacyRawVaultDir,
      analysisFramesDir: legacyAnalysisFramesDir,
      learnV2RawVaultDir: learnV2VaultRoot(root),
      learnV2ProductIndexPath: productIndexPath,
      learnV2ReviewQueuePath: reviewQueue.artifacts.markdown,
      learnV2CompilePreviewPath: compilePreview.artifacts.markdown,
      learnV2EvalReportPath: evalReport.artifacts.markdown,
      learnV2ConceptStorePath: conceptStorePath,
      learnV2RelevanceCalibrationPath: relevanceCalibration.path,
      learnV2ModelRoutingPath: modelRouting.artifacts.routingJson,
      learnV2EpisodeStorePath: episodeStorePath,
      learnV2ModelRequestDir: learnV2ModelRequestsRoot(root),
      learnV2ObservabilityReportPath: path.resolve(root, observability.artifactsWritten.json.replace(/^\[PROJECT_ROOT\]\//, "")),
      learnV2EvidenceQualityPath: evidenceQualityPath,
      learnV2ConflictLedgerPath: conflictLedger.artifactPaths.markdown,
      learnV2CounterevidenceLedgerPath: counterevidenceLedger.artifactPaths.markdown,
      learnV2DeclassifiedSnippetsPath: declassifiedSnippets.artifacts.markdown,
      learnV2ConceptDriftPath: conceptDrift.artifactPath,
      learnV2SourceGateReviewJsonPath: sourceGateReview.paths.json,
      learnV2SourceGateReviewPath: sourceGateReview.paths.markdown,
      learnV2ConditionalLearningPath: conditionalLearning.artifacts.markdown,
      learnV2LearningMemoryStorePath: learningMemoryPath,
      learnV2SkillOntologyPath: skillOntology.artifacts.markdown,
      learnV2SkillOntologyMemoryStorePath: skillOntologyMemoryPath,
      learnV2OpenWorldGroundingPath: openWorldGrounding.artifacts.markdown,
      learnV2ConceptDebugTracePath: conceptDebugTrace.artifacts.markdown,
      learnV2OutcomePolicyPath: outcomePolicy.artifacts.markdown
    },
    lifecycle,
    digest: {
      sourcesConsidered: sourceDigests.length,
      sourcesIncluded: sourceDigests.filter((source) => source.projectRelevance.decision === "include").length,
      sourcesAsk: sourceDigests.filter((source) => source.projectRelevance.decision === "ask").length,
      sourcesExcluded: sourceDigests.filter((source) => source.projectRelevance.decision === "exclude").length,
      previewWritesLocalArtifacts: previewOnly,
      rawVaultRecordsWritten: sourceDigests.filter((source) => source.rawVaultRecordPath).length,
      canonicalConceptStateWritten,
      analysisFramesWritten: sourceDigests.length,
      learningWindows: episodes.length,
      behaviorAtoms: behaviorAtoms.length,
      conditionalObservations: conditionalLearning.counts.observations,
      conditionalHypotheses: conditionalLearning.counts.hypotheses,
      promotedConditionalHypotheses: conditionalLearning.counts.promotedHypotheses,
      skillNamespaces: skillOntology.counts.namespaces,
      skillOntologyOperations: skillOntology.counts.operations,
      openWorldAnchors: openWorldGrounding.counts.anchors,
      conceptDebugTraces: conceptDebugTrace.counts.tracedConcepts,
      outcomePolicySuppressions: outcomePolicy.counts.suppressed,
      conceptCards: concepts.length,
      currentRunConceptCards: concepts.length,
      mergedConceptCards: conceptCardsForArtifacts.length,
      topLevelConceptsScope: "current-run-legacy-projection",
      eventsAppended,
      reviewCandidates: lifecycle?.graph.candidateCount ?? review?.candidates.length ?? 0,
      learningInputBoundary
    },
    quality: buildV2Quality(sourceDigests, conceptCardsForArtifacts, extracted.rejected.length, previewOnly, evalReport.status),
    privacy: [
      ...(previewOnly
        ? ["Preview writes generated/private analysis, review, eval, model-request, digest, and observability artifacts for inspection, but does not persist canonical concept state, activation index, raw vault records, events, or lifecycle graph changes."]
        : []),
      ...(!hasAcceptedEvidence
        ? ["No accepted source entered extraction; Learn v2 preserved canonical episode stores, model request directories, review queues, compile previews, eval reports, concept state, activation indexes, raw vault records, events, and lifecycle graph state."]
        : []),
      "Learn v2 reads and normalizes full supplied raw local evidence in memory for deterministic extraction.",
      "Project relevance is a hard extraction gate: only accepted sources enter episode reconstruction, atom extraction, model requests, concept stores, activation indexes, and compile previews.",
      "Machine-local path prefixes are normalized in learner memory to avoid temp-directory or home-directory noise influencing concepts.",
      "Full raw evidence is stored only for accepted sources in the project-local v2 raw vault when --apply is used.",
      "Output-facing analysis frames, episode stores, model requests, digests, review cards, compile previews, eval reports, and staged imports are declassified.",
      "Raw vault refs are local-only and never exportable through compile, pack, or sync artifacts.",
      "Concept cards remain candidates until explicit review activates them.",
      `Model execution policy is ${modelMode}: deterministic extraction and prompt-safe OpenCode request artifacts are supported; explicit sanitized execution is available through the model-request executor, while raw-evidence-to-model execution is rejected until implemented.`,
      "Model outputs are untrusted until schema and evidence validation pass."
    ],
    nextActions,
    learnV2: {
      schemaVersion: "openskill-kit.learn-v2.pipeline-run.v1",
      learningInputBoundary,
      episodes,
      currentRunConcepts: concepts,
      concepts: conceptCardsForArtifacts,
      conceptCounts: {
        currentRun: concepts.length,
        mergedForArtifacts: conceptCardsForArtifacts.length
      },
      conceptStorePath,
      rejectedAtoms: extracted.rejected,
      conditionalLearning,
      skillOntology,
      openWorldGrounding,
      conceptDebugTrace,
      outcomePolicy,
      reviewQueuePath: reviewQueue.artifacts.markdown,
      compilePreviewPath: compilePreview.artifacts.markdown,
      evalReportPath: evalReport.artifacts.markdown,
      episodeStorePath,
      modelRequestDir: learnV2ModelRequestsRoot(root),
      modelRequestCount: modelRequests.requestCount
    }
  };
  await writeJsonAtomic(digestPath, result);
  await fs.writeFile(reviewMarkdownPath, renderRawLearningDigest(result), "utf8");
  await writeLearnV2ProductIndex(root, {
    generatedAt,
    previewOnly,
    modelMode,
    summary: {
      sourcesConsidered: result.digest.sourcesConsidered,
      sourcesIncluded: result.digest.sourcesIncluded,
      concepts: result.digest.mergedConceptCards,
      observations: result.digest.conditionalObservations,
      hypotheses: result.digest.conditionalHypotheses,
      promotedHypotheses: result.digest.promotedConditionalHypotheses,
      namespaces: result.digest.skillNamespaces,
      openWorldAnchors: result.digest.openWorldAnchors,
      tracedConcepts: result.digest.conceptDebugTraces,
      evalStatus: evalReport.status,
      healthStatus: observability.health.status
    },
    artifacts: result.artifacts,
    nextActions,
    privacyNotes: result.privacy
  });
  return result;
}

function emptyReviewQueue(root: string, now: Date): LearnV2ReviewQueue {
  return LearnV2ReviewQueueSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.review-queue.v1",
    generatedAt: now.toISOString(),
    cards: [],
    behaviorDeltaFirst: true,
    safeBulkActions: ["accept-low-risk", "reject-one-off", "mark-superseded"],
    artifacts: {
      markdown: path.join(root, ".openskill-kit", "learn-v2", "review", "concept-review-queue.md")
    }
  });
}

function emptyEvalReport(root: string): LearnV2EvalReport {
  return LearnV2EvalReportSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.eval-report.v1",
    status: "pass",
    extractionGoldenCount: 0,
    behaviorDeltaGoldenCount: 0,
    counterfactualTraceCaseCount: 0,
    replayEpisodeCount: 0,
    leakCheck: {
      status: "pass",
      issues: []
    },
    tokenBudget: {
      rawChars: 0,
      compressedChars: 0,
      compressionRatio: 0
    },
    results: [],
    artifacts: {
      json: path.join(root, ".openskill-kit", "learn-v2", "evals", "source-gate-only", "learn-v2-eval.json"),
      markdown: path.join(root, ".openskill-kit", "learn-v2", "evals", "source-gate-only", "learn-v2-eval.md")
    }
  });
}

function emptyConditionalLearningArtifact(root: string, now: Date): LearnV2ConditionalLearningArtifact & { atoms: LearnV2BehaviorAtom[] } {
  const json = path.join(root, ".openskill-kit", "learn-v2", "conditional-learning", "conditional-learning.json");
  const markdown = path.join(root, ".openskill-kit", "learn-v2", "conditional-learning", "conditional-learning.md");
  return {
    ...LearnV2ConditionalLearningArtifactSchema.parse({
      schemaVersion: "openskill-kit.learn-v2.conditional-learning-artifact.v1",
      generatedAt: now.toISOString(),
      observations: [],
      hypotheses: [],
      admissionDecisions: [],
      counts: {
        observations: 0,
        hypotheses: 0,
        promotedHypotheses: 0,
        observeOnly: 0,
        rejectedNoise: 0,
        episodeNotes: 0,
        weakObservations: 0,
        candidateConcepts: 0,
        requiresHumanReview: 0
      },
      artifacts: {
        json,
        markdown
      }
    }),
    atoms: []
  };
}

function emptySkillOntologyArtifact(root: string, now: Date): LearnV2SkillOntologyArtifact {
  const json = path.join(root, ".openskill-kit", "learn-v2", "skill-ontology", "skill-ontology.json");
  const markdown = path.join(root, ".openskill-kit", "learn-v2", "skill-ontology", "skill-ontology.md");
  return LearnV2SkillOntologyArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.skill-ontology-artifact.v1",
    generatedAt: now.toISOString(),
    namespaces: [],
    counts: {
      namespaces: 0,
      candidateNamespaces: 0,
      reviewNamespaces: 0,
      representedConcepts: 0
    },
    artifacts: { json, markdown }
  });
}

function emptyOpenWorldGroundingArtifact(root: string, now: Date): LearnV2OpenWorldGroundingArtifact {
  const json = path.join(root, ".openskill-kit", "learn-v2", "open-world-grounding", "open-world-grounding.json");
  const markdown = path.join(root, ".openskill-kit", "learn-v2", "open-world-grounding", "open-world-grounding.md");
  return LearnV2OpenWorldGroundingArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.openworld-grounding-artifact.v1",
    generatedAt: now.toISOString(),
    anchors: [],
    recommendations: [],
    counts: {
      anchors: 0,
      conceptCount: 0,
      officialAnchors: 0,
      projectAnchors: 0,
      reviewOnlyAnchors: 0,
      restrictedLicenseAnchors: 0,
      recommendations: 0
    },
    artifacts: { json, markdown }
  });
}

function emptyConceptDebugTraceArtifact(root: string, now: Date): LearnV2ConceptDebugTraceArtifact {
  const json = path.join(root, ".openskill-kit", "learn-v2", "concept-debug-trace", "concept-debug-trace.json");
  const markdown = path.join(root, ".openskill-kit", "learn-v2", "concept-debug-trace", "concept-debug-trace.md");
  return LearnV2ConceptDebugTraceArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.concept-debug-trace-artifact.v1",
    generatedAt: now.toISOString(),
    traces: [],
    counts: {
      concepts: 0,
      tracedConcepts: 0,
      conditionalLinks: 0,
      openWorldLinks: 0,
      reviewBlockedConcepts: 0
    },
    artifacts: { json, markdown }
  });
}

function emptyOutcomePolicyArtifact(root: string, now: Date): LearnV2OutcomePolicyArtifact {
  const json = path.join(root, ".openskill-kit", "learn-v2", "outcome-policy", "outcome-policy.json");
  const markdown = path.join(root, ".openskill-kit", "learn-v2", "outcome-policy", "outcome-policy.md");
  return LearnV2OutcomePolicyArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.outcome-policy-artifact.v1",
    generatedAt: now.toISOString(),
    decisions: [],
    thresholds: {
      suppressWrongCount: 2,
      suppressIgnoredCount: 3,
      suppressHarmfulCount: 1,
      suppressSupersededCount: 1
    },
    counts: {
      concepts: 0,
      decisions: 0,
      suppressed: 0,
      demoteReview: 0,
      monitoring: 0
    },
    artifacts: { json, markdown }
  });
}

function emptyCompilePreview(root: string, now: Date): LearnV2CompilePreview {
  return {
    schemaVersion: "openskill-kit.learn-v2.compile-preview.v1",
    generatedAt: now.toISOString(),
    activeConceptCount: 0,
    candidateConceptCount: 0,
    preferenceNodes: [],
    workflowNodes: [],
    declassificationReport: {
      rawRefsExported: false,
      blockedPrivatePaths: [],
      placeholders: [],
      status: "pass",
      issues: []
    },
    artifacts: {
      json: path.join(root, ".openskill-kit", "learn-v2", "compiled-preview", "concept-compile-preview.json"),
      markdown: path.join(root, ".openskill-kit", "learn-v2", "compiled-preview", "concept-compile-preview.md")
    }
  };
}

function emptyDeclassifiedSnippets(root: string, now: Date): LearnV2DeclassifiedEvidenceSnippetArtifact {
  return LearnV2DeclassifiedEvidenceSnippetArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.declassified-snippet-artifact.v1",
    generatedAt: now.toISOString(),
    snippets: [],
    counts: {
      total: 0,
      redacted: 0,
      blockedFromCompile: 0,
      residualRiskCounts: {}
    },
    artifacts: {
      json: path.join(root, ".openskill-kit", "learn-v2", "declassified-snippets", "snippets.json"),
      markdown: path.join(root, ".openskill-kit", "learn-v2", "declassified-snippets", "snippets.md")
    }
  });
}

function emptyConflictLedger(projectId: string, now: Date): LearnV2ConflictLedger {
  return LearnV2ConflictLedgerSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.conflict-ledger.v1",
    projectId,
    updatedAt: now.toISOString(),
    conflicts: [],
    unresolvedCount: 0
  });
}

function emptyCounterevidenceLedger(root: string, now: Date): LearnV2CounterevidenceLedger {
  return LearnV2CounterevidenceLedgerSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.counterevidence-ledger.v1",
    generatedAt: now.toISOString(),
    totalItems: 0,
    conceptCount: 0,
    activationBlockingCount: 0,
    statusCounts: {},
    riskCounts: {},
    reasonCounts: {},
    entries: [],
    artifacts: {
      json: learnV2SafeLocalPath(path.join(root, ".openskill-kit", "learn-v2", "counterevidence", "counterevidence-ledger.json"), root),
      markdown: learnV2SafeLocalPath(path.join(root, ".openskill-kit", "learn-v2", "counterevidence", "counterevidence-ledger.md"), root)
    }
  });
}

function emptyConceptDriftReport(now: Date): LearnV2ConceptDriftReport {
  return LearnV2ConceptDriftReportSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.concept-drift.v1",
    generatedAt: now.toISOString(),
    totalActiveConcepts: 0,
    staleCandidates: [],
    healthScore: 1
  });
}

export function resolveLearnV2RawLearningModelMode(mode: LearnV2RawLearningModelModeInput | undefined): LearnV2RawLearningModelMode {
  if (!mode) return "deterministic-only";
  if ((LearnV2RawLearningModelModes as readonly string[]).includes(mode)) return mode as LearnV2RawLearningModelMode;
  const mapped = LearnV2RawLearningModelModeAliases[mode as LearnV2RawLearningLegacyModelMode];
  if (mapped) return mapped;
  throw new Error(`Invalid Learn v2 raw learning model mode: ${mode}`);
}

function buildLearnV2ModelExecutionPolicyReport(
  root: string,
  input: {
    modelMode: LearnV2RawLearningModelMode;
    previewOnly: boolean;
    hasAcceptedEvidence: boolean;
    requestCount: number;
    requestDir: string;
    routingManifestPath: string;
    firstManifestPath?: string;
  }
): LearnV2ModelExecutionPolicyReport {
  const firstManifest = input.firstManifestPath ? learnV2ProjectRelativePath(root, input.firstManifestPath) : undefined;
  const requestStatus: LearnV2ModelExecutionPolicyReport["requestArtifacts"]["status"] = input.requestCount > 0
    ? "written"
    : !input.hasAcceptedEvidence
      ? "skipped-no-accepted-evidence"
      : input.previewOnly
        ? "skipped-preview"
        : "skipped-no-routable-episodes";
  const manifestArg = firstManifest ?? ".openskill-kit/learn-v2/model-requests/<request>/request-manifest.json";
  return {
    requestedPolicy: input.modelMode,
    deterministicExtraction: {
      supported: true,
      status: "always-on"
    },
    requestArtifacts: {
      status: requestStatus,
      requestCount: input.requestCount,
      requestDir: input.requestDir,
      routingManifestPath: input.routingManifestPath,
      firstManifestPath: input.firstManifestPath
    },
    sanitizedOpenCodeExecution: {
      supported: true,
      requiresExplicitApproval: true,
      command: `openskill-kit osk learn --execute-model-requests --model-request ${manifestArg}`,
      applyCommand: `openskill-kit osk learn --apply-model-responses --model-output ${manifestArg}`
    },
    rawToModelExecution: {
      supported: false,
      status: "rejected",
      reason: "Raw evidence is never sent directly to model execution. Use prompt-safe request artifacts plus explicit sanitized OpenCode execution.",
      saferPolicy: "opencode-host-sanitized-only"
    }
  };
}

function learnV2ProjectRelativePath(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

async function writePreviewLearnV2ConceptStore(root: string, projectId: string, concepts: LearnV2ConceptCard[], now: Date): Promise<LearnV2ConceptStore> {
  const existing = await readLearnV2ConceptStore(root, now);
  const store: LearnV2ConceptStore = {
    schemaVersion: "openskill-kit.learn-v2.concept-store.v1",
    projectId,
    updatedAt: now.toISOString(),
    cards: mergeLearnV2ConceptStoreCards(existing.cards, concepts, now)
  };
  await writeJsonAtomic(previewLearnV2ConceptStorePath(root, now.toISOString()), store);
  return store;
}

function previewLearnV2ConceptStorePath(root: string, generatedAt: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "compiled-preview", `concept-store-preview-${timestampSlug(generatedAt)}.json`);
}

function normalizeRawLearnerLocalPaths(text: string, root: string): string {
  const rootVariants = [root, root.replace(/\\/g, "\\\\"), root.replace(/\\/g, "/")];
  let current = text;
  for (const variant of rootVariants) {
    if (variant) current = current.split(variant).join("[PROJECT_ROOT]");
  }
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home) {
    for (const variant of [home, home.replace(/\\/g, "\\\\"), home.replace(/\\/g, "/")]) {
      if (variant) current = current.split(variant).join("[USER_HOME]");
    }
  }
  return current;
}

function trustPrivacySafeOpenCodeAmbientSource(
  root: string,
  sourcePath: string,
  rawText: string,
  adapterId: string,
  relevance: Awaited<ReturnType<typeof scoreLearnV2ProjectRelevance>>
): Awaited<ReturnType<typeof scoreLearnV2ProjectRelevance>> {
  const relativePath = learnV2ProjectRelativePath(root, sourcePath).toLowerCase();
  if (
    adapterId !== "opencode" ||
    relativePath !== ".openskill-kit/ambient/opencode-events.jsonl" ||
    relevance.decision === "reject" ||
    !isPrivacySafeOpenCodeAmbientJsonl(rawText)
  ) {
    return relevance;
  }
  return {
    ...relevance,
    decision: "accept",
    gate: "hard-accept",
    score: Math.max(relevance.score, 0.86),
    reasons: [...new Set([...relevance.reasons, "hard-accept:trusted-privacy-safe-opencode-ambient"])].sort(),
    matchedPaths: [...new Set([...relevance.matchedPaths, ".openskill-kit/ambient/opencode-events.jsonl"])].sort()
  };
}

function isPrivacySafeOpenCodeAmbientJsonl(rawText: string): boolean {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 10_000) return false;
  return lines.every((line) => {
    try {
      const record = JSON.parse(line) as unknown;
      if (!isJsonObject(record)) return false;
      if (record.schemaVersion !== "openskill-kit.opencode-ambient-event.v1") return false;
      if (record.containsRawFields !== false) return false;
      if (isJsonObject(record.rawInput) || isJsonObject(record.rawOutput)) return false;
      if (hasRawProneOpenCodeAmbientKey(record)) return false;
      return isJsonObject(record.traceContext) &&
        record.traceContext.schemaVersion === "openskill-kit.learn-v2.trace-context.v1";
    } catch {
      return false;
    }
  });
}

function hasRawProneOpenCodeAmbientKey(value: unknown, pathPrefix = ""): boolean {
  if (Array.isArray(value)) return value.some((item, index) => hasRawProneOpenCodeAmbientKey(item, `${pathPrefix}[${index}]`));
  if (!isJsonObject(value)) return false;
  for (const [key, item] of Object.entries(value)) {
    const fullKey = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (/^(rawInput|rawOutput|command|cmd|args|argv|path|file|filePath|filename|rawPrompt|prompt|output|diff|patch|cwd|env|url)$/i.test(key)) return true;
    if (/^(metadata\.)?(input|output)\.(command|cmd|args|argv|path|file|filePath|filename|rawPrompt|prompt|output|diff|patch|cwd|env|url)$/i.test(fullKey)) return true;
    if (hasRawProneOpenCodeAmbientKey(item, fullKey)) return true;
  }
  return false;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function declassifyLearnV2NormalizedEvidence(item: LearnV2NormalizedEvidence, root: string, config: ProjectConfig): LearnV2NormalizedEvidence {
  return {
    ...item,
    text: declassifyArtifactText(item.text, root, config),
    toolName: item.toolName ? declassifyArtifactText(item.toolName, root, config) : undefined,
    cwdHint: item.cwdHint ? declassifyArtifactText(item.cwdHint, root, config) : undefined,
    branch: item.branch ? declassifyArtifactText(item.branch, root, config) : undefined,
    paths: item.paths.map((file) => declassifyArtifactText(file, root, config)),
    commands: item.commands.map((command) => declassifyArtifactText(command, root, config)),
    metadata: declassifyJsonLikeMetadata(item.metadata, root, config)
  };
}

function declassifyLearnV2TaskEpisode(episode: LearnV2TaskEpisode, root: string, config: ProjectConfig): LearnV2TaskEpisode {
  return {
    ...episode,
    cwdHints: episode.cwdHints.map((hint) => declassifyArtifactText(hint, root, config)),
    branch: episode.branch ? declassifyArtifactText(episode.branch, root, config) : undefined,
    pathCluster: episode.pathCluster.map((file) => declassifyArtifactText(file, root, config)),
    taskHints: episode.taskHints.map((hint) => declassifyArtifactText(hint, root, config)),
    messages: episode.messages.map((message) => declassifyLearnV2NormalizedEvidence(message, root, config)),
    toolSummaries: episode.toolSummaries.map((tool) => ({
      ...tool,
      toolName: declassifyArtifactText(tool.toolName, root, config),
      command: tool.command ? declassifyArtifactText(tool.command, root, config) : undefined,
      summary: declassifyArtifactText(tool.summary, root, config),
      commandShape: tool.commandShape ? {
        ...tool.commandShape,
        rendered: declassifyArtifactText(tool.commandShape.rendered, root, config),
        base: declassifyArtifactText(tool.commandShape.base, root, config),
        argsShape: tool.commandShape.argsShape.map((item) => declassifyArtifactText(item, root, config))
      } : undefined,
      paths: tool.paths.map((file) => declassifyArtifactText(file, root, config)),
      outputCompression: {
        ...tool.outputCompression,
        summary: declassifyArtifactText(tool.outputCompression.summary, root, config),
        signatures: tool.outputCompression.signatures.map((item) => declassifyArtifactText(item, root, config))
      }
    })),
    patchComparisons: episode.patchComparisons.map((patch) => ({
      ...patch,
      paths: patch.paths.map((file) => declassifyArtifactText(file, root, config)),
      summary: declassifyArtifactText(patch.summary, root, config),
      structuralSummary: {
        ...patch.structuralSummary,
        ignoredFiles: patch.structuralSummary.ignoredFiles.map((file) => declassifyArtifactText(file, root, config)),
        changedSymbols: patch.structuralSummary.changedSymbols.map((symbol) => declassifyArtifactText(symbol, root, config)),
        changedImports: patch.structuralSummary.changedImports.map((item) => declassifyArtifactText(item, root, config)),
        fileSummaries: patch.structuralSummary.fileSummaries.map((file) => ({
          ...file,
          path: declassifyArtifactText(file.path, root, config),
          changedSymbols: file.changedSymbols.map((symbol) => declassifyArtifactText(symbol, root, config)),
          changedImports: file.changedImports.map((item) => declassifyArtifactText(item, root, config))
        }))
      }
    })),
    phases: episode.phases.map((phase) => ({
      ...phase,
      summary: declassifyArtifactText(phase.summary, root, config)
    }))
  };
}

function declassifyLearnV2ConceptCards(cards: LearnV2ConceptCard[], root: string, config: ProjectConfig): LearnV2ConceptCard[] {
  return cards.map((card) => LearnV2ConceptCardSchema.parse({
    ...card,
    title: declassifyArtifactText(card.title, root, config),
    canonicalBehavior: declassifyArtifactText(card.canonicalBehavior, root, config),
    behaviorDelta: declassifyArtifactText(card.behaviorDelta, root, config),
    scope: {
      ...card.scope,
      paths: card.scope.paths.map((file) => declassifyArtifactText(file, root, config)),
      taskTypes: card.scope.taskTypes.map((item) => declassifyArtifactText(item, root, config)),
      negativeTriggers: card.scope.negativeTriggers.map((item) => declassifyArtifactText(item, root, config))
    },
    activation: {
      phrases: card.activation.phrases.map((phrase) => declassifyArtifactText(phrase, root, config)),
      pathGlobs: card.activation.pathGlobs.map((glob) => declassifyArtifactText(glob, root, config)),
      commands: card.activation.commands.map((command) => declassifyArtifactText(command, root, config))
    },
    conditions: card.conditions ? {
      appliesWhen: card.conditions.appliesWhen.map((item) => declassifyArtifactText(item, root, config)),
      doesNotApplyWhen: card.conditions.doesNotApplyWhen.map((item) => declassifyArtifactText(item, root, config))
    } : undefined,
    atoms: card.atoms.map((atom) => declassifyLearnV2BehaviorAtom(atom, root, config)),
    counterevidence: card.counterevidence.map((item) => ({
      ...item,
      reason: declassifyArtifactText(item.reason, root, config)
    })),
    privacy: {
      ...card.privacy,
      placeholders: [...new Set([
        ...card.privacy.placeholders,
        ...learnV2DeclassifyText([
          card.title,
          card.canonicalBehavior,
          card.behaviorDelta,
          ...card.scope.paths,
          ...card.activation.commands,
          ...(card.conditions?.appliesWhen ?? []),
          ...(card.conditions?.doesNotApplyWhen ?? []),
          ...card.atoms.map((atom) => atom.statement)
        ].join("\n"), root, config).placeholders
      ])].sort()
    }
  }));
}

function declassifyLearnV2BehaviorAtom(atom: LearnV2BehaviorAtom, root: string, config: ProjectConfig): LearnV2BehaviorAtom {
  return {
    ...atom,
    statement: declassifyArtifactText(atom.statement, root, config),
    scope: {
      ...atom.scope,
      paths: atom.scope.paths.map((file) => declassifyArtifactText(file, root, config)),
      taskTypes: atom.scope.taskTypes.map((item) => declassifyArtifactText(item, root, config))
    },
    rationale: declassifyArtifactText(atom.rationale, root, config),
    conditions: atom.conditions ? {
      appliesWhen: atom.conditions.appliesWhen.map((item) => declassifyArtifactText(item, root, config)),
      doesNotApplyWhen: atom.conditions.doesNotApplyWhen.map((item) => declassifyArtifactText(item, root, config))
    } : undefined,
    activationHints: atom.activationHints ? {
      phrases: atom.activationHints.phrases.map((item) => declassifyArtifactText(item, root, config)),
      pathGlobs: atom.activationHints.pathGlobs.map((item) => declassifyArtifactText(item, root, config)),
      commands: atom.activationHints.commands.map((item) => declassifyArtifactText(item, root, config)),
      negativeTriggers: atom.activationHints.negativeTriggers.map((item) => declassifyArtifactText(item, root, config))
    } : undefined,
    counterevidence: (atom.counterevidence ?? []).map((item) => ({
      ...item,
      reason: declassifyArtifactText(item.reason, root, config)
    }))
  };
}

function declassifyJsonLikeMetadata(metadata: Record<string, unknown>, root: string, config: ProjectConfig): Record<string, unknown> {
  return JSON.parse(declassifyArtifactText(JSON.stringify(metadata), root, config)) as Record<string, unknown>;
}

function declassifyArtifactText(text: string, root: string, config: ProjectConfig): string {
  return learnV2DeclassifyText(text, root, config).text;
}

function makePreviewRawRecord(
  projectId: string,
  sourcePath: string,
  adapterId: string,
  text: string,
  contentKind: LearnV2RawEvidenceRecord["content"]["kind"],
  relevance: Awaited<ReturnType<typeof scoreLearnV2ProjectRelevance>>,
  generatedAt: string,
  root: string,
  declassified: { matches: string[]; placeholders: string[] }
): LearnV2RawEvidenceRecord {
  const contentHash = learnV2Hash(text);
  return LearnV2RawEvidenceRecordSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.raw-evidence-record.v1",
    id: `raw_${learnV2ShortHash(`${adapterId}:${sourcePath}:${contentHash}`)}`,
    projectId,
    source: {
      adapterId,
      uri: `file://${learnV2SafeLocalPath(sourcePath, root)}`,
      path: learnV2SafeLocalPath(sourcePath, root),
      pathHash: learnV2Hash(sourcePath),
      contentHash
    },
    capturedAt: generatedAt,
    content: {
      kind: contentKind,
      encoding: "utf8",
      byteCount: Buffer.byteLength(text, "utf8"),
      lineCount: text.split(/\r?\n/).length,
      blobRef: "preview-only",
      blobHash: contentHash
    },
    retention: {
      tier: "hot-spool",
      pinnedBy: [],
      expiresAt: new Date(new Date(generatedAt).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
    },
    privacy: {
      rawLocalOnly: true,
      declassified: false,
      redactionMatches: declassified.matches,
      placeholders: declassified.placeholders
    },
    relevance,
    trace: {}
  });
}

interface LegacyConceptCardCompat {
  id: string;
  concept: string;
  canonicalBehavior: string;
  scope: {
    level: "project" | "path" | "directory" | "task";
    paths: string[];
  };
  confidence: number;
  evidenceRefs: string[];
  atoms: Array<{
    id: string;
    kind: string;
    statement: string;
    polarity: "positive" | "negative" | "neutral";
    scope: {
      level: "project" | "path" | "directory" | "task";
      paths: string[];
    };
    weight: number;
    evidenceRefs: string[];
  }>;
  reviewStatus: "candidate";
}

interface LegacyRelevanceCompat {
  score: number;
  reasons: string[];
  matchedPaths: string[];
  matchedRemotes: string[];
  decision: "include" | "ask" | "exclude";
}

interface LearnV2QualityReportCompat {
  relevanceScore: number;
  conceptYieldScore: number;
  reviewReadinessScore: number;
  propagationSafetyScore: number;
  overallScore: number;
  strengths: string[];
  risks: string[];
}

function toLegacyConceptCard(card: LearnV2ConceptCard): LegacyConceptCardCompat {
  return {
    id: card.id,
    concept: card.title,
    canonicalBehavior: card.canonicalBehavior,
    scope: {
      level: card.scope.level,
      paths: card.scope.paths
    },
    confidence: card.confidence,
    evidenceRefs: card.evidenceIds,
    atoms: card.atoms.map((atom) => ({
      id: atom.id,
      kind: atom.kind === "scope-boundary" ? "review-policy" : atom.kind,
      statement: atom.statement,
      polarity: atom.polarity,
      scope: {
        level: atom.scope.level,
        paths: atom.scope.paths
      },
      weight: atom.confidence,
      evidenceRefs: atom.evidenceIds
    })),
    reviewStatus: "candidate"
  };
}

function legacyRelevance(relevance: Awaited<ReturnType<typeof scoreLearnV2ProjectRelevance>>): LegacyRelevanceCompat {
  return {
    score: relevance.score,
    reasons: relevance.reasons,
    matchedPaths: relevance.matchedPaths,
    matchedRemotes: relevance.matchedRemotes,
    decision: relevance.decision === "accept" ? "include" : relevance.decision === "review" ? "ask" : "exclude"
  };
}

function buildV2Quality(sources: LearnV2SourceDigestCompat[], concepts: LearnV2ConceptCard[], rejectedAtoms: number, previewOnly: boolean, evalStatus: string): LearnV2QualityReportCompat {
  const included = sources.filter((source) => source.projectRelevance.decision === "include");
  const relevanceScore = sources.length ? included.reduce((sum, source) => sum + source.projectRelevance.score, 0) / sources.length : 0;
  const conceptYieldScore = sources.length ? Math.min(1, concepts.length / Math.max(1, sources.length * 2)) : 0;
  const reviewReadinessScore = concepts.length ? concepts.filter((concept) => concept.evidenceIds.length && concept.confidence >= 0.55).length / concepts.length : 0;
  const propagationSafetyScore = evalStatus === "pass" ? 1 : 0.82;
  const overallScore = (relevanceScore * 0.3) + (conceptYieldScore * 0.25) + (reviewReadinessScore * 0.25) + (propagationSafetyScore * 0.2);
  const strengths: string[] = [];
  const risks: string[] = [];
  if (included.length) strengths.push(`${included.length} source(s) matched this project strongly enough for project-scoped learning.`);
  if (concepts.length) strengths.push(`${concepts.length} reviewable concept card(s) mined with learn-v2 evidence, activation, review, compile preview, and eval artifacts.`);
  if (sources.some((source) => source.deidentification.redacted)) strengths.push("Declassification ran before analysis frames, digests, staged imports, and review cards.");
  if (!previewOnly) strengths.push("Raw local evidence was stored in the v2 content-addressed local vault while compatibility deidentified records were written for legacy tooling.");
  if (sources.some((source) => source.projectRelevance.decision === "ask")) risks.push("Some sources are ambiguous and should be reviewed before apply.");
  if (sources.some((source) => source.projectRelevance.decision === "exclude")) risks.push("Some sources were excluded as unrelated to this project.");
  if (rejectedAtoms) risks.push(`${rejectedAtoms} atom proposal(s) were rejected by safety validation.`);
  if (!concepts.length) risks.push("No concepts mined; evidence may be sparse or lack corrections/preferences.");
  if (!risks.length) risks.push("No blocking risk detected; human review still required before activation.");
  return {
    relevanceScore: Number(relevanceScore.toFixed(2)),
    conceptYieldScore: Number(conceptYieldScore.toFixed(2)),
    reviewReadinessScore: Number(reviewReadinessScore.toFixed(2)),
    propagationSafetyScore: Number(propagationSafetyScore.toFixed(2)),
    overallScore: Number(overallScore.toFixed(2)),
    strengths,
    risks
  };
}

function renderRawLearningDigest(result: LearnV2RawLocalLearningRunCompat): string {
  const lines = [
    "# Raw Local Learning Digest",
    "",
    `Generated: ${result.generatedAt}`,
    `Preview only: ${result.previewOnly}`,
    `Model mode: ${result.modelMode}`,
    "",
    "## Summary",
    "",
    `- Sources considered: ${result.digest.sourcesConsidered}`,
    `- Sources included: ${result.digest.sourcesIncluded}`,
    `- Preview writes local generated artifacts: ${result.digest.previewWritesLocalArtifacts}`,
    `- Canonical concept state written: ${result.digest.canonicalConceptStateWritten}`,
    `- Learning input boundary: ${result.digest.learningInputBoundary}`,
    `- Task episodes: ${result.digest.learningWindows}`,
    `- Behavior atoms: ${result.digest.behaviorAtoms}`,
    `- Conditional observations: ${result.digest.conditionalObservations}`,
    `- Conditional hypotheses: ${result.digest.conditionalHypotheses}`,
    `- Promoted conditional hypotheses: ${result.digest.promotedConditionalHypotheses}`,
    `- Skill namespaces: ${result.digest.skillNamespaces}`,
    `- Skill ontology operations: ${result.digest.skillOntologyOperations}`,
    `- Open-world grounding anchors: ${result.digest.openWorldAnchors}`,
    `- Concept debug traces: ${result.digest.conceptDebugTraces}`,
    `- Outcome policy suppressions: ${result.digest.outcomePolicySuppressions}`,
    `- Concept cards: ${result.digest.conceptCards}`,
    `- Events appended: ${result.digest.eventsAppended}`,
    `- Overall quality: ${result.quality.overallScore.toFixed(2)}`,
    "",
    "## Learn v2 Artifacts",
    "",
    `- Product index: ${result.artifacts.learnV2ProductIndexPath}`,
    `- Review queue: ${result.artifacts.learnV2ReviewQueuePath}`,
    `- Compile preview: ${result.artifacts.learnV2CompilePreviewPath}`,
    `- Eval report: ${result.artifacts.learnV2EvalReportPath}`,
    `- Relevance calibration: ${result.artifacts.learnV2RelevanceCalibrationPath}`,
    `- Model routing: ${result.artifacts.learnV2ModelRoutingPath}`,
    `- Episode store: ${result.artifacts.learnV2EpisodeStorePath}`,
    `- Evidence quality: ${result.artifacts.learnV2EvidenceQualityPath}`,
    `- Conflict ledger: ${result.artifacts.learnV2ConflictLedgerPath}`,
    `- Counterevidence ledger: ${result.artifacts.learnV2CounterevidenceLedgerPath}`,
    `- Declassified snippets: ${result.artifacts.learnV2DeclassifiedSnippetsPath}`,
    `- Concept drift: ${result.artifacts.learnV2ConceptDriftPath}`,
    `- Source gate review: ${result.artifacts.learnV2SourceGateReviewPath}`,
    `- Source gate review JSON: ${result.artifacts.learnV2SourceGateReviewJsonPath}`,
    `- Conditional learning: ${result.artifacts.learnV2ConditionalLearningPath}`,
    `- Learning memory: ${result.artifacts.learnV2LearningMemoryStorePath}`,
    `- Skill ontology: ${result.artifacts.learnV2SkillOntologyPath}`,
    `- Skill ontology memory: ${result.artifacts.learnV2SkillOntologyMemoryStorePath}`,
    `- Open-world grounding: ${result.artifacts.learnV2OpenWorldGroundingPath}`,
    `- Concept debug trace: ${result.artifacts.learnV2ConceptDebugTracePath}`,
    `- Outcome policy: ${result.artifacts.learnV2OutcomePolicyPath}`,
    `- Model requests: ${result.artifacts.learnV2ModelRequestDir}`,
    "",
    "## Quality",
    "",
    `- Relevance: ${result.quality.relevanceScore.toFixed(2)}`,
    `- Concept yield: ${result.quality.conceptYieldScore.toFixed(2)}`,
    `- Review readiness: ${result.quality.reviewReadinessScore.toFixed(2)}`,
    `- Propagation safety: ${result.quality.propagationSafetyScore.toFixed(2)}`,
    "",
    "Strengths:",
    ...result.quality.strengths.map((item: string) => `- ${item}`),
    "",
    "Risks:",
    ...result.quality.risks.map((item: string) => `- ${item}`),
    "",
    "## Concepts",
    ""
  ];
  if (!result.concepts.length) lines.push("No concept cards mined.");
  for (const concept of result.concepts) {
    lines.push(`### ${concept.concept}`);
    lines.push("");
    lines.push(`Behavior: ${concept.canonicalBehavior}`);
    lines.push(`Confidence: ${concept.confidence.toFixed(2)}`);
    if (concept.scope.paths.length) lines.push(`Paths: ${concept.scope.paths.join(", ")}`);
    lines.push(`Evidence: ${concept.evidenceRefs.join(", ")}`);
    lines.push("");
  }
  lines.push("## Privacy Boundary");
  lines.push("");
  for (const item of result.privacy) lines.push(`- ${item}`);
  return `${lines.join("\n")}\n`;
}

function timestampSlug(timestamp: string): string {
  return timestamp.replace(/[^0-9]/g, "").slice(0, 14);
}
