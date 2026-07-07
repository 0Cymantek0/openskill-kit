import path from "node:path";
import { readLearnV2EpisodeStore } from "./model-proposals.js";
import type { LearnV2PatchComparison, LearnV2TaskEpisode, LearnV2ToolCallSummary } from "./schemas.js";
import { learnV2SafeLocalPath, learnV2ShortHash } from "./utils.js";

export interface LearnV2EpisodeDebugView {
  schemaVersion: "openskill-kit.learn-v2.episode-debug-view.v1";
  generatedAt: string;
  sourcePath: string;
  counts: {
    totalEpisodes: number;
    selectedEpisodes: number;
    outcomeCounts: Record<string, number>;
    stitchingMethodCounts: Record<string, number>;
    riskCounts: Record<string, number>;
    phaseCounts: Record<string, number>;
  };
  episodes: LearnV2EpisodeDebugEntry[];
}

export interface LearnV2EpisodeDebugEntry {
  id: string;
  outcome: LearnV2TaskEpisode["outcome"];
  startedAt?: string;
  endedAt?: string;
  branch?: string;
  traceIds: string[];
  sessionIds: string[];
  evidenceIds: string[];
  rawRefCount: number;
  cwdHints: string[];
  pathCluster: string[];
  taskHints: string[];
  episodeConfidence: number;
  confidenceBreakdown?: LearnV2TaskEpisode["episodeConfidenceBreakdown"];
  stitching: LearnV2TaskEpisode["stitching"];
  phases: Array<{
    phase: LearnV2TaskEpisode["phases"][number]["phase"];
    evidenceIds: string[];
    confidence: number;
    summaryHash: string;
    summaryChars: number;
  }>;
  messageSummary: {
    total: number;
    byActor: Record<string, number>;
    byKind: Record<string, number>;
    byStatus: Record<string, number>;
    pathMentions: number;
    commandMentions: number;
    textChars: number;
  };
  toolSummaries: Array<{
    id: string;
    evidenceId?: string;
    toolName: string;
    status: LearnV2ToolCallSummary["status"];
    commandBase?: string;
    argsShape: string[];
    riskFlags: string[];
    paths: string[];
    omittedBytes: number;
    outputStrategy: LearnV2ToolCallSummary["outputCompression"]["strategy"];
    outputSignatures: string[];
  }>;
  patchComparisons: Array<{
    id: string;
    evidenceId?: string;
    kind: LearnV2PatchComparison["kind"];
    pairedWithIds: string[];
    paths: string[];
    structuralClasses: string[];
    languages: string[];
    changedSymbols: string[];
    changedImports: string[];
    addedLines: number;
    removedLines: number;
    behaviorEligible?: boolean;
    comparison?: LearnV2PatchComparison["comparison"];
  }>;
  tokenBudget: LearnV2TaskEpisode["tokenBudget"];
}

export async function readLearnV2EpisodeDebugView(
  rootInput: string,
  options: { episodeId?: string } = {}
): Promise<LearnV2EpisodeDebugView> {
  const root = path.resolve(rootInput);
  const store = await readLearnV2EpisodeStore(root);
  const episodes = options.episodeId
    ? store.episodes.filter((episode) => episode.id === options.episodeId)
    : store.episodes;
  const selected = episodes.map((episode) => summarizeEpisode(root, episode));
  return {
    schemaVersion: "openskill-kit.learn-v2.episode-debug-view.v1",
    generatedAt: store.updatedAt,
    sourcePath: learnV2SafeLocalPath(path.join(root, ".openskill-kit", "learn-v2", "episodes", "store.json"), root),
    counts: {
      totalEpisodes: store.episodes.length,
      selectedEpisodes: selected.length,
      outcomeCounts: countBy(store.episodes.map((episode) => episode.outcome)),
      stitchingMethodCounts: countBy(store.episodes.map((episode) => episode.stitching.method)),
      riskCounts: countBy(store.episodes.flatMap((episode) => episode.episodeConfidenceBreakdown?.risks ?? [])),
      phaseCounts: countBy(store.episodes.flatMap((episode) => episode.phases.map((phase) => phase.phase)))
    },
    episodes: selected
  };
}

function summarizeEpisode(root: string, episode: LearnV2TaskEpisode): LearnV2EpisodeDebugEntry {
  return {
    id: episode.id,
    outcome: episode.outcome,
    startedAt: episode.startedAt,
    endedAt: episode.endedAt,
    branch: episode.branch,
    traceIds: episode.traceIds,
    sessionIds: episode.sessionIds,
    evidenceIds: episode.evidenceIds,
    rawRefCount: episode.rawRefs.length,
    cwdHints: episode.cwdHints.map((item) => safePath(root, item)),
    pathCluster: episode.pathCluster.map((item) => safePath(root, item)),
    taskHints: episode.taskHints,
    episodeConfidence: episode.episodeConfidence,
    confidenceBreakdown: episode.episodeConfidenceBreakdown,
    stitching: episode.stitching,
    phases: episode.phases.map((phase) => ({
      phase: phase.phase,
      evidenceIds: phase.evidenceIds,
      confidence: phase.confidence,
      summaryHash: `sha256:${learnV2ShortHash(phase.summary)}`,
      summaryChars: phase.summary.length
    })),
    messageSummary: {
      total: episode.messages.length,
      byActor: countBy(episode.messages.map((message) => message.actor)),
      byKind: countBy(episode.messages.map((message) => message.kind)),
      byStatus: countBy(episode.messages.map((message) => message.status)),
      pathMentions: episode.messages.reduce((sum, message) => sum + message.paths.length, 0),
      commandMentions: episode.messages.reduce((sum, message) => sum + message.commands.length, 0),
      textChars: episode.messages.reduce((sum, message) => sum + message.text.length, 0)
    },
    toolSummaries: episode.toolSummaries.map((tool) => ({
      id: tool.id,
      evidenceId: tool.evidenceId,
      toolName: tool.toolName,
      status: tool.status,
      commandBase: tool.commandShape?.base,
      argsShape: tool.commandShape?.argsShape ?? [],
      riskFlags: tool.commandShape?.riskFlags ?? [],
      paths: tool.paths.map((item) => safePath(root, item)),
      omittedBytes: tool.omittedBytes + tool.outputCompression.omittedBytes,
      outputStrategy: tool.outputCompression.strategy,
      outputSignatures: tool.outputCompression.signatures
    })),
    patchComparisons: episode.patchComparisons.map((patch) => ({
      id: patch.id,
      evidenceId: patch.evidenceId,
      kind: patch.kind,
      pairedWithIds: patch.pairedWithIds,
      paths: patch.paths.map((item) => safePath(root, item)),
      structuralClasses: patch.structuralClasses,
      languages: patch.structuralSummary.languages,
      changedSymbols: patch.structuralSummary.changedSymbols,
      changedImports: patch.structuralSummary.changedImports,
      addedLines: patch.addedLines,
      removedLines: patch.removedLines,
      behaviorEligible: patch.behaviorEligible,
      comparison: patch.comparison
    })),
    tokenBudget: episode.tokenBudget
  };
}

function safePath(root: string, value: string): string {
  if (!value) return value;
  if (path.resolve(value) === path.resolve(root)) return "[PROJECT_ROOT]";
  if (path.isAbsolute(value)) return learnV2SafeLocalPath(value, root);
  return value.replace(/\\/g, "/");
}

function countBy(items: string[]): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item] = (counts[item] ?? 0) + 1;
    return counts;
  }, {});
}
