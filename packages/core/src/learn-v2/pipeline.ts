import { promises as fs } from "node:fs";
import path from "node:path";
import { readProjectConfig } from "../events/store.js";
import { importInteractionSource, type InteractionImportRun } from "../interactions/importer.js";
import { runLifecycleOnce, type LifecycleRunnerResult } from "../lifecycle/runner.js";
import { buildReviewQueue } from "../preferences/proposals.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { scoreLearnV2ProjectRelevance } from "./relevance.js";
import { readLearnV2Surface } from "./surfaces.js";
import { storeLearnV2RawEvidence, learnV2VaultRoot } from "./vault.js";
import { LearnV2RawEvidenceRecordSchema, type LearnV2ConceptCard, type LearnV2NormalizedEvidence, type LearnV2RawEvidenceRecord } from "./schemas.js";
import { normalizeLearnV2Evidence } from "./normalize.js";
import { reconstructLearnV2Episodes } from "./episodes.js";
import { extractLearnV2BehaviorAtoms } from "./extract.js";
import { mergeLearnV2ConceptCards } from "./concepts.js";
import { writeLearnV2ReviewQueue } from "./review.js";
import { compileLearnV2ConceptPreview } from "./compile.js";
import { runLearnV2Eval } from "./eval.js";
import { writeLearnV2ConceptStore } from "./store.js";
import { ensureLearnV2ModelRoutingArtifacts } from "./model-routing.js";
import {
  learnV2DeclassifyText,
  learnV2Hash,
  learnV2SafeLocalPath,
  learnV2ShortHash
} from "./utils.js";

export const LearnV2RawLearningModelModes = ["local-raw", "remote-redacted", "remote-explicit", "heuristic-only"] as const;
export type LearnV2RawLearningModelMode = typeof LearnV2RawLearningModelModes[number];

export interface LearnV2RawLocalLearningOptions {
  sourceFiles: string[];
  adapter?: string;
  previewOnly?: boolean;
  maxRawBytes?: number;
  maxTurns?: number;
  allowDuplicateImports?: boolean;
  modelMode?: LearnV2RawLearningModelMode;
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
    learnV2ModelRoutingPath: string;
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
  quality: ReturnType<typeof buildV2Quality>;
  privacy: string[];
  nextActions: string[];
  learnV2: {
    schemaVersion: "openskill-kit.learn-v2.pipeline-run.v1";
    episodes: ReturnType<typeof reconstructLearnV2Episodes>;
    concepts: LearnV2ConceptCard[];
    rejectedAtoms: ReturnType<typeof extractLearnV2BehaviorAtoms>["rejected"];
    conceptStorePath: string;
    reviewQueuePath: string;
    compilePreviewPath: string;
    evalReportPath: string;
  };
}

export async function runLearnV2RawLocalLearning(projectRootInput: string, options: LearnV2RawLocalLearningOptions): Promise<LearnV2RawLocalLearningRunCompat> {
  if (!options.sourceFiles.length) throw new Error("Raw local learning requires at least one --surface-file path.");
  const root = path.resolve(projectRootInput);
  const config = await readProjectConfig(root);
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const previewOnly = options.previewOnly !== false;
  const modelMode = options.modelMode ?? "heuristic-only";
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
    const relevance = await scoreLearnV2ProjectRelevance(root, sourcePath, surface.rawText);
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
      promptSafe: modelMode !== "local-raw",
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
  const extracted = extractLearnV2BehaviorAtoms(episodes);
  const concepts = mergeLearnV2ConceptCards(extracted.atoms, now);
  await writeLearnV2ConceptStore(root, concepts, now);
  const modelRouting = await ensureLearnV2ModelRoutingArtifacts(root, now);
  for (const source of sourceDigests) {
    const rawRef = source.learnV2.rawRef;
    source.windowCount = episodes.filter((episode) => episode.rawRefs.includes(rawRef)).length;
    source.atomCount = extracted.atoms.filter((atom) => atom.rawRefs.includes(rawRef)).length;
    source.conceptCount = concepts.filter((concept) => concept.rawRefs.includes(rawRef)).length;
  }
  const reviewQueue = await writeLearnV2ReviewQueue(root, concepts, now);
  const compilePreview = await compileLearnV2ConceptPreview(root, config, concepts, now);
  const evalReport = await runLearnV2Eval(root, episodes, concepts, now);
  const lifecycle: LifecycleRunnerResult | undefined = !previewOnly && importRuns.some((run) => run.appendedEventCount > 0)
    ? await runLifecycleOnce({ projectRoot: root, maxEvents: options.maxTurns ?? 500, compileSafe: false, now: options.now })
    : undefined;
  const review = lifecycle ? await buildReviewQueue(root) : undefined;
  const legacyConcepts = concepts.map(toLegacyConceptCard);
  const digestPath = path.join(digestsDir, `raw-learning-${timestampSlug(generatedAt)}.json`);
  const reviewMarkdownPath = path.join(digestsDir, `raw-learning-${timestampSlug(generatedAt)}.md`);
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
      learnV2ConceptStorePath: path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json"),
      learnV2ModelRoutingPath: modelRouting.artifacts.routingJson
    },
    lifecycle,
    digest: {
      sourcesConsidered: sourceDigests.length,
      sourcesIncluded: sourceDigests.filter((source) => source.projectRelevance.decision === "include").length,
      sourcesAsk: sourceDigests.filter((source) => source.projectRelevance.decision === "ask").length,
      sourcesExcluded: sourceDigests.filter((source) => source.projectRelevance.decision === "exclude").length,
      rawVaultRecordsWritten: sourceDigests.filter((source) => source.rawVaultRecordPath).length,
      analysisFramesWritten: sourceDigests.length,
      learningWindows: episodes.length,
      behaviorAtoms: extracted.atoms.length,
      conceptCards: concepts.length,
      eventsAppended,
      reviewCandidates: lifecycle?.graph.candidateCount ?? review?.candidates.length ?? 0
    },
    quality: buildV2Quality(sourceDigests, concepts, extracted.rejected.length, previewOnly, evalReport.status),
    privacy: [
      "Learn v2 reads full supplied raw local evidence and stores it only in the project-local v2 raw vault when --apply is used.",
      "Output-facing analysis frames, digests, review cards, compile previews, eval reports, and staged imports are declassified.",
      "Raw vault refs are local-only and never exportable through compile, pack, or sync artifacts.",
      "Concept cards remain candidates until explicit review activates them.",
      "Model-assisted extraction is deterministic-only here unless routed through OpenCode-configured agents in a later stage."
    ],
    nextActions: previewOnly
      ? [
          "Inspect the raw learning digest and learn-v2 concept review queue, then rerun with --apply to persist raw vault records and staged review evidence.",
          "Review source relevance decisions marked ask/reject before applying."
        ]
      : [
          "Inspect the learn-v2 review queue; accept, edit, narrow, or reject concept cards before compile.",
          "Run /osk review and /osk compile after activation; candidate concepts do not compile."
        ],
    learnV2: {
      schemaVersion: "openskill-kit.learn-v2.pipeline-run.v1",
      episodes,
      concepts,
      conceptStorePath: path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json"),
      rejectedAtoms: extracted.rejected,
      reviewQueuePath: reviewQueue.artifacts.markdown,
      compilePreviewPath: compilePreview.artifacts.markdown,
      evalReportPath: evalReport.artifacts.markdown
    }
  };
  await writeJsonAtomic(digestPath, result);
  await fs.writeFile(reviewMarkdownPath, renderRawLearningDigest(result), "utf8");
  return result;
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
    `- Model routing: ${result.artifacts.learnV2ModelRoutingPath}`,
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
