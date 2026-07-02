import { promises as fs } from "node:fs";
import path from "node:path";
import { readProjectConfig } from "../events/store.js";
import { importInteractionSource, type InteractionImportRun } from "../interactions/importer.js";
import { runLifecycleOnce, type LifecycleRunnerResult } from "../lifecycle/runner.js";
import { buildReviewQueue } from "../preferences/proposals.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { ensureLearnV2ProjectRelevanceCalibration, scoreLearnV2ProjectRelevance } from "./relevance.js";
import { readLearnV2Surface } from "./surfaces.js";
import { storeLearnV2RawEvidence, learnV2VaultRoot } from "./vault.js";
import { LearnV2RawEvidenceRecordSchema, type LearnV2ConceptCard, type LearnV2NormalizedEvidence, type LearnV2RawEvidenceRecord } from "./schemas.js";
import { normalizeLearnV2Evidence } from "./normalize.js";
import { reconstructLearnV2Episodes } from "./episodes.js";
import { extractLearnV2BehaviorAtoms } from "./extract.js";
import { mergeLearnV2ConceptCards } from "./concepts.js";
import { writeLearnV2ConflictLedger } from "./conflicts.js";
import { writeLearnV2ReviewQueue } from "./review.js";
import { compileLearnV2ConceptPreview } from "./compile.js";
import { runLearnV2Eval } from "./eval.js";
import { writeLearnV2PipelineObservabilityReport } from "./observability.js";
import { learnV2EvidenceQualityArtifactPath, writeLearnV2EvidenceQualityArtifact } from "./quality.js";
import { mergeLearnV2ConceptStoreCards, readLearnV2ConceptStore, writeLearnV2ConceptStore, type LearnV2ConceptStore } from "./store.js";
import { writeLearnV2DeclassifiedSnippetArtifact } from "./declassify.js";
import { detectLearnV2ConceptDrift } from "./drift.js";
import { ensureLearnV2ModelRoutingArtifacts } from "./model-routing.js";
import { learnV2ModelRequestsRoot, writeLearnV2EpisodeStore, writeLearnV2ModelRequests } from "./model-proposals.js";
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
    detectedFormat: string;
    contentKind: string;
    v2AnalysisPath: string;
    v2RawVaultDir: string;
  };
}

interface LearnV2RawLocalLearningRunCompat {
  schemaVersion: "openskill-kit.raw-local-learning-run.v1";
  projectRoot: string;
  generatedAt: string;
  previewOnly: boolean;
  modelMode: LearnV2RawLearningModelMode;
  sources: LearnV2SourceDigestCompat[];
  concepts: ReturnType<typeof toLegacyConceptCard>[];
  artifacts: {
    digestPath: string;
    reviewMarkdownPath: string;
    rawVaultDir: string;
    analysisFramesDir: string;
    learnV2RawVaultDir: string;
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
    learnV2DeclassifiedSnippetsPath: string;
    learnV2ConceptDriftPath: string;
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
    conceptCards: number;
    eventsAppended: number;
    reviewCandidates: number;
    learningInputBoundary: "minimal-secret-path-placeholdering";
  };
  quality: ReturnType<typeof buildV2Quality>;
  privacy: string[];
  nextActions: string[];
  learnV2: {
    schemaVersion: "openskill-kit.learn-v2.pipeline-run.v1";
    learningInputBoundary: "minimal-secret-path-placeholdering";
    episodes: ReturnType<typeof reconstructLearnV2Episodes>;
    concepts: LearnV2ConceptCard[];
    rejectedAtoms: ReturnType<typeof extractLearnV2BehaviorAtoms>["rejected"];
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
  const learningInputBoundary = "minimal-secret-path-placeholdering" as const;
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
  const allEvidence: LearnV2NormalizedEvidence[] = [];
  let eventsAppended = 0;
  const importRuns: InteractionImportRun[] = [];

  for (const sourceFile of options.sourceFiles) {
    const sourcePath = path.resolve(sourceFile);
    const stat = await fs.stat(sourcePath).catch(() => undefined);
    if (!stat?.isFile()) throw new Error(`Raw learning source is not a file: ${sourcePath}`);
    const maxBytes = options.maxRawBytes ?? 5_000_000;
    if (stat.size > maxBytes) throw new Error(`Raw learning source exceeds maxRawBytes=${maxBytes}: ${sourcePath}`);
    const surface = await readLearnV2Surface(sourcePath, options.adapter);
    const relevance = await scoreLearnV2ProjectRelevance(root, sourcePath, surface.rawText, undefined, {
      calibration: relevanceCalibration.calibration,
      explicitlySelected: true,
      now
    });
    const declassified = learnV2DeclassifyText(surface.rawText, root, config);
    const rawRecord = previewOnly
      ? makePreviewRawRecord(config.projectId, sourcePath, surface.adapterId, surface.rawText, surface.contentKind, relevance, generatedAt, root, declassified)
      : (await storeLearnV2RawEvidence({
          root,
          config,
          now,
          maxHotBytes: 50_000_000,
          retentionDays: relevance.decision === "accept" ? 90 : 14
        }, {
          adapterId: surface.adapterId,
          sourcePath,
          text: surface.rawText,
          contentKind: surface.contentKind,
          relevance
        })).record;
    const normalized = normalizeLearnV2Evidence(surface, rawRecord, declassified.text).slice(0, options.maxTurns ?? 500);
    allEvidence.push(...normalized);
    const short = rawRecord.source.contentHash.replace(/^sha256:/, "").slice(0, 16);
    const legacyRawVaultRecordPath = previewOnly ? undefined : path.join(legacyRawVaultDir, "records", `${short}.json`);
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
      modelMode,
      learningInputBoundary,
      promptSafe: true,
      normalizedEvidence: normalized
    };
    await writeJsonAtomic(analysisFramePath, analysisPayload);
    await writeJsonAtomic(v2AnalysisPath, analysisPayload);

    let importRun: InteractionImportRun | undefined;
    if (!previewOnly && relevance.decision === "accept") {
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
      turnCount: normalized.length,
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
        detectedFormat: surface.detectedFormat,
        contentKind: surface.contentKind,
        v2AnalysisPath,
        v2RawVaultDir: learnV2VaultRoot(root)
      }
    });
  }

  const episodes = reconstructLearnV2Episodes(allEvidence);
  const evidenceQuality = await writeLearnV2EvidenceQualityArtifact(root, allEvidence, now);
  const evidenceQualityPath = learnV2EvidenceQualityArtifactPath(root, now);
  const declassifiedSnippets = await writeLearnV2DeclassifiedSnippetArtifact(root, episodes, now, {
    blockOnMediumRisk: true,
    maxChars: 700,
    maxSnippets: 200
  });
  const episodeStorePath = await writeLearnV2EpisodeStore(root, episodes, now);
  const modelRequests = await writeLearnV2ModelRequests(root, episodes, now);
  const extracted = extractLearnV2BehaviorAtoms(episodes);
  const concepts = mergeLearnV2ConceptCards(extracted.atoms, now);
  const conceptStore = previewOnly
    ? await writePreviewLearnV2ConceptStore(root, config.projectId, concepts, now)
    : await writeLearnV2ConceptStore(root, concepts, now);
  const conceptCardsForArtifacts = conceptStore.cards;
  const conceptStorePath = previewOnly
    ? previewLearnV2ConceptStorePath(root, generatedAt)
    : path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json");
  const conceptDrift = await detectLearnV2ConceptDrift(root, conceptCardsForArtifacts, { now });
  const conflictLedger = await writeLearnV2ConflictLedger(root, conceptCardsForArtifacts, config.projectId, now);
  const modelRouting = await ensureLearnV2ModelRoutingArtifacts(root, now);
  for (const source of sourceDigests) {
    const rawRef = source.learnV2.rawRef;
    source.windowCount = episodes.filter((episode) => episode.rawRefs.includes(rawRef)).length;
    source.atomCount = extracted.atoms.filter((atom) => atom.rawRefs.includes(rawRef)).length;
    source.conceptCount = concepts.filter((concept) => concept.rawRefs.includes(rawRef)).length;
  }
  const reviewQueue = await writeLearnV2ReviewQueue(root, conceptCardsForArtifacts, now, {
    ledger: conflictLedger.ledger,
    markdownPath: conflictLedger.artifactPaths.markdown,
    declassifiedSnippets,
    conceptDrift
  });
  const compilePreview = await compileLearnV2ConceptPreview(root, config, conceptCardsForArtifacts, now);
  const evalReport = await runLearnV2Eval(root, episodes, conceptCardsForArtifacts, now, { goldensPath: options.learnV2GoldensPath });
  const lifecycle: LifecycleRunnerResult | undefined = !previewOnly && importRuns.some((run) => run.appendedEventCount > 0)
    ? await runLifecycleOnce({ projectRoot: root, maxEvents: options.maxTurns ?? 500, compileSafe: false, now: options.now })
    : undefined;
  const review = lifecycle ? await buildReviewQueue(root) : undefined;
  const legacyConcepts = concepts.map(toLegacyConceptCard);
  const digestPath = path.join(digestsDir, `raw-learning-${timestampSlug(generatedAt)}.json`);
  const reviewMarkdownPath = path.join(digestsDir, `raw-learning-${timestampSlug(generatedAt)}.md`);
  const nextActions = previewOnly
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
    reviewQueue,
    evalReport,
    eventsAppended,
    modelRequestCount: modelRequests.requestCount,
    artifacts: {
      digestPath,
      reviewMarkdownPath,
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
      learnV2DeclassifiedSnippetsPath: declassifiedSnippets.artifacts.markdown,
      learnV2ConceptDriftPath: conceptDrift.artifactPath
    },
    conflictLedger: conflictLedger.ledger,
    conceptDrift: conceptDrift.report,
    declassifiedSnippets,
    evidenceQualityScores: evidenceQuality.scores,
    nextActions
  });
  const result: LearnV2RawLocalLearningRunCompat = {
    schemaVersion: "openskill-kit.raw-local-learning-run.v1",
    projectRoot: root,
    generatedAt,
    previewOnly,
    modelMode,
    sources: sourceDigests,
    concepts: legacyConcepts,
    artifacts: {
      digestPath,
      reviewMarkdownPath,
      rawVaultDir: legacyRawVaultDir,
      analysisFramesDir: legacyAnalysisFramesDir,
      learnV2RawVaultDir: learnV2VaultRoot(root),
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
      learnV2DeclassifiedSnippetsPath: declassifiedSnippets.artifacts.markdown,
      learnV2ConceptDriftPath: conceptDrift.artifactPath
    },
    lifecycle,
    digest: {
      sourcesConsidered: sourceDigests.length,
      sourcesIncluded: sourceDigests.filter((source) => source.projectRelevance.decision === "include").length,
      sourcesAsk: sourceDigests.filter((source) => source.projectRelevance.decision === "ask").length,
      sourcesExcluded: sourceDigests.filter((source) => source.projectRelevance.decision === "exclude").length,
      previewWritesLocalArtifacts: previewOnly,
      rawVaultRecordsWritten: sourceDigests.filter((source) => source.rawVaultRecordPath).length,
      canonicalConceptStateWritten: !previewOnly,
      analysisFramesWritten: sourceDigests.length,
      learningWindows: episodes.length,
      behaviorAtoms: extracted.atoms.length,
      conceptCards: concepts.length,
      eventsAppended,
      reviewCandidates: lifecycle?.graph.candidateCount ?? review?.candidates.length ?? 0,
      learningInputBoundary
    },
    quality: buildV2Quality(sourceDigests, conceptCardsForArtifacts, extracted.rejected.length, previewOnly, evalReport.status),
    privacy: [
      ...(previewOnly
        ? ["Preview writes generated/private analysis, review, eval, model-request, digest, and observability artifacts for inspection, but does not persist canonical concept state, activation index, raw vault records, events, or lifecycle graph changes."]
        : []),
      "Learn v2 reads full supplied raw local evidence; deterministic extraction currently normalizes minimally declassified learner text where secrets and machine-local paths are replaced with typed placeholders.",
      "Full raw evidence is stored only in the project-local v2 raw vault when --apply is used.",
      "Output-facing analysis frames, digests, review cards, compile previews, eval reports, and staged imports are declassified.",
      "Raw vault refs are local-only and never exportable through compile, pack, or sync artifacts.",
      "Concept cards remain candidates until explicit review activates them.",
      `Model execution policy is ${modelMode}: deterministic extraction and prompt-safe OpenCode request artifacts are supported; raw-evidence-to-model execution is rejected until implemented.`,
      "Model outputs are untrusted until schema and evidence validation pass."
    ],
    nextActions,
    learnV2: {
      schemaVersion: "openskill-kit.learn-v2.pipeline-run.v1",
      learningInputBoundary,
      episodes,
      concepts: conceptCardsForArtifacts,
      conceptStorePath,
      rejectedAtoms: extracted.rejected,
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
  return result;
}

export function resolveLearnV2RawLearningModelMode(mode: LearnV2RawLearningModelModeInput | undefined): LearnV2RawLearningModelMode {
  if (!mode) return "deterministic-only";
  if ((LearnV2RawLearningModelModes as readonly string[]).includes(mode)) return mode as LearnV2RawLearningModelMode;
  const mapped = LearnV2RawLearningModelModeAliases[mode as LearnV2RawLearningLegacyModelMode];
  if (mapped) return mapped;
  throw new Error(`Invalid Learn v2 raw learning model mode: ${mode}`);
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
  const propagationSafetyScore = evalStatus === "pass" && rejectedAtoms === 0 ? 1 : 0.82;
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
    `- Concept cards: ${result.digest.conceptCards}`,
    `- Events appended: ${result.digest.eventsAppended}`,
    `- Overall quality: ${result.quality.overallScore.toFixed(2)}`,
    "",
    "## Learn v2 Artifacts",
    "",
    `- Review queue: ${result.artifacts.learnV2ReviewQueuePath}`,
    `- Compile preview: ${result.artifacts.learnV2CompilePreviewPath}`,
    `- Eval report: ${result.artifacts.learnV2EvalReportPath}`,
    `- Relevance calibration: ${result.artifacts.learnV2RelevanceCalibrationPath}`,
    `- Model routing: ${result.artifacts.learnV2ModelRoutingPath}`,
    `- Episode store: ${result.artifacts.learnV2EpisodeStorePath}`,
    `- Evidence quality: ${result.artifacts.learnV2EvidenceQualityPath}`,
    `- Conflict ledger: ${result.artifacts.learnV2ConflictLedgerPath}`,
    `- Declassified snippets: ${result.artifacts.learnV2DeclassifiedSnippetsPath}`,
    `- Concept drift: ${result.artifacts.learnV2ConceptDriftPath}`,
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
