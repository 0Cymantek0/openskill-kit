import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { readProjectConfig } from "../events/store.js";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";
import { mergeLearnV2ConceptCards } from "./concepts.js";
import { writeLearnV2ConflictLedger } from "./conflicts.js";
import { writeLearnV2DeclassifiedSnippetArtifact } from "./declassify.js";
import { detectLearnV2ConceptDrift } from "./drift.js";
import { runLearnV2Eval } from "./eval.js";
import {
  buildLearnV2EpisodeLearningBundle,
  parseLearnV2LlmConceptExtractionOutput,
  renderLearnV2ConceptExtractionPrompt,
  validateLearnV2LlmConceptExtractionOutput
} from "./extract.js";
import { ensureLearnV2ModelRoutingArtifacts } from "./model-routing.js";
import { writeLearnV2ReviewQueue } from "./review.js";
import { readLearnV2ConceptStore, writeLearnV2ConceptStore } from "./store.js";
import {
  type LearnV2BehaviorAtom,
  type LearnV2LlmConceptExtractionOutput,
  type LearnV2LlmScopeInferenceOutput,
  type LearnV2TaskEpisode
} from "./schemas.js";
import { parseLearnV2LlmScopeInferenceOutput, validateLearnV2ScopeInferenceForCard } from "./scope-proposals.js";
import { learnV2Hash } from "./utils.js";

const execFileAsync = promisify(execFile);

export interface LearnV2EpisodeStore {
  schemaVersion: "openskill-kit.learn-v2.episode-store.v1";
  updatedAt: string;
  episodes: LearnV2TaskEpisode[];
}

export interface LearnV2ModelRequest {
  episodeId: string;
  bundlePath: string;
  promptPath: string;
  promptHash: string;
  bundleHash: string;
  manifestPath: string;
  expectedOutputPath: string;
  outputSchema: "openskill-kit.learn-v2.llm-concept-extraction-output.v1";
  opencodeAgentId: string;
  agentFile: string;
  routing: LearnV2ModelRequestRoutingDecision & { decision: "request" };
}

export interface LearnV2ModelRequestResult {
  schemaVersion: "openskill-kit.learn-v2.model-request-result.v1";
  generatedAt: string;
  requestCount: number;
  requests: LearnV2ModelRequest[];
  skippedEpisodes: Array<LearnV2ModelRequestRoutingDecision & { episodeId: string; decision: "skip" }>;
  routingManifestPath: string;
  modelRoutingArtifactPath: string;
  opencodeAgentIndexPath: string;
  instructions: string[];
}

export interface LearnV2ModelProposalApplyResult {
  schemaVersion: "openskill-kit.learn-v2.model-proposal-apply-result.v1";
  appliedAt: string;
  outputFiles: string[];
  atomCount: number;
  rejected: Array<{ outputPath: string; id: string; reason: string; detail?: string }>;
  conceptCount: number;
  conceptStorePath: string;
  reviewQueuePath: string;
  conflictLedgerPath: string;
  declassifiedSnippetsPath: string;
  conceptDriftPath: string;
  evalReportPath: string;
  evalStatus: "pass" | "fail";
}

export interface LearnV2OpenCodeInvocation {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface LearnV2OpenCodeRunResult {
  exitCode: number;
  signal?: string;
  stdout: string;
  stderr: string;
}

export type LearnV2OpenCodeRunner = (invocation: LearnV2OpenCodeInvocation) => Promise<LearnV2OpenCodeRunResult>;

export interface LearnV2ModelRequestExecutionOptions {
  requestManifests?: string[];
  opencodeCommand?: string;
  opencodeAttachUrl?: string;
  timeoutMs?: number;
  runner?: LearnV2OpenCodeRunner;
  now?: Date;
}

export interface LearnV2ModelRequestExecutionResult {
  schemaVersion: "openskill-kit.learn-v2.model-request-execution-result.v1";
  executedAt: string;
  attemptedCount: number;
  writtenCount: number;
  failedCount: number;
  skippedCount: number;
  executionReportPath: string;
  results: Array<{
    manifestPath: string;
    outputPath?: string;
    episodeId?: string;
    status: "written" | "failed" | "skipped";
    reason?: string;
    detail?: string;
    durationMs?: number;
    stdoutBytes?: number;
    stderrBytes?: number;
    stdoutHash?: string;
    stderrHash?: string;
    responseHash?: string;
    command?: string;
    argsShape?: string[];
  }>;
}

interface LearnV2ModelRequestManifest {
  schemaVersion: "openskill-kit.learn-v2.model-request-manifest.v1";
  generatedAt: string;
  episodeId: string;
  conceptId?: string;
  modelRole: "concept-extractor" | "scope-inferencer";
  routingPolicy: "learn-v2-roi-v1";
  routingReasons: string[];
  priority: number;
  promptPath: string;
  bundlePath: string;
  promptHash: string;
  bundleHash: string;
  expectedOutputPath: string;
  outputSchema: "openskill-kit.learn-v2.llm-concept-extraction-output.v1" | "openskill-kit.learn-v2.llm-scope-inference-output.v1";
  opencodeAgentId: string;
  agentFile: string;
  modelRoutingArtifactPath: string;
  opencodeAgentIndexPath: string;
  executionBoundary: "opencode-host-sanitized-only";
  evidenceIds: string[];
  rawRefsIncluded: false;
}

type LearnV2ModelRequestRoutingDecision = {
  decision: "request";
  priority: number;
  reasons: string[];
} | {
  decision: "skip";
  priority: number;
  reasons: string[];
};

export async function writeLearnV2EpisodeStore(rootInput: string, episodes: LearnV2TaskEpisode[], now = new Date()): Promise<string> {
  const root = path.resolve(rootInput);
  const store: LearnV2EpisodeStore = {
    schemaVersion: "openskill-kit.learn-v2.episode-store.v1",
    updatedAt: now.toISOString(),
    episodes
  };
  const file = learnV2EpisodeStorePath(root);
  await writeJsonAtomic(file, store);
  return file;
}

export async function readLearnV2EpisodeStore(rootInput: string): Promise<LearnV2EpisodeStore> {
  const root = path.resolve(rootInput);
  const text = await fs.readFile(learnV2EpisodeStorePath(root), "utf8");
  return JSON.parse(text) as LearnV2EpisodeStore;
}

export async function writeLearnV2ModelRequests(rootInput: string, episodes?: LearnV2TaskEpisode[], now = new Date()): Promise<LearnV2ModelRequestResult> {
  const root = path.resolve(rootInput);
  const sourceEpisodes = episodes ?? (await readLearnV2EpisodeStore(root)).episodes;
  const modelRouting = await ensureLearnV2ModelRoutingArtifacts(root, now);
  const conceptExtractorAgent = modelRouting.agents["concept-extractor"];
  await pruneStaleModelRequestDirs(root, new Set(sourceEpisodes.map((episode) => episode.id)));
  const requests: LearnV2ModelRequest[] = [];
  const skippedEpisodes: LearnV2ModelRequestResult["skippedEpisodes"] = [];
  for (const episode of sourceEpisodes) {
    const routing = routeLearnV2EpisodeForModelRequest(episode);
    if (routing.decision === "skip") {
      skippedEpisodes.push({ episodeId: episode.id, ...routing });
      continue;
    }
    const bundle = buildLearnV2EpisodeLearningBundle(episode);
    const prompt = renderLearnV2ConceptExtractionPrompt(bundle);
    const dir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", episode.id);
    const bundlePath = path.join(dir, "episode-learning-bundle.json");
    const promptPath = path.join(dir, "concept-extraction-prompt.md");
    const manifestPath = path.join(dir, "request-manifest.json");
    const expectedOutputPath = path.join(dir, "response.json");
    const bundleText = `${JSON.stringify(bundle, null, 2)}\n`;
    const promptHash = learnV2Hash(prompt);
    const bundleHash = learnV2Hash(bundleText);
    await writeFileAtomic(bundlePath, bundleText);
    await writeFileAtomic(promptPath, prompt);
    await writeJsonAtomic(manifestPath, {
      schemaVersion: "openskill-kit.learn-v2.model-request-manifest.v1",
      generatedAt: now.toISOString(),
      episodeId: episode.id,
      modelRole: "concept-extractor",
      routingPolicy: "learn-v2-roi-v1",
      routingReasons: routing.reasons,
      priority: routing.priority,
      promptPath: learnV2ProjectRelativePath(root, promptPath),
      bundlePath: learnV2ProjectRelativePath(root, bundlePath),
      promptHash,
      bundleHash,
      expectedOutputPath: learnV2ProjectRelativePath(root, expectedOutputPath),
      outputSchema: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
      opencodeAgentId: conceptExtractorAgent.opencodeAgentId,
      agentFile: conceptExtractorAgent.agentFile,
      modelRoutingArtifactPath: modelRouting.artifacts.routingJson,
      opencodeAgentIndexPath: modelRouting.artifacts.opencodeAgentIndex,
      executionBoundary: "opencode-host-sanitized-only",
      evidenceIds: episode.evidenceIds,
      rawRefsIncluded: false,
      instructions: [
        `Send concept-extraction-prompt.md to the OpenCode agent ${conceptExtractorAgent.opencodeAgentId}.`,
        `Agent definition: ${conceptExtractorAgent.agentFile}.`,
        "Save strict JSON output to response.json in this directory.",
        "Do not include raw vault refs, raw paths, secrets, or raw transcript text in the response."
      ]
    });
    requests.push({
      episodeId: episode.id,
      bundlePath,
      promptPath,
      promptHash,
      bundleHash,
      manifestPath,
      expectedOutputPath,
      outputSchema: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
      opencodeAgentId: conceptExtractorAgent.opencodeAgentId,
      agentFile: conceptExtractorAgent.agentFile,
      routing
    });
  }
  const routingManifestPath = path.join(learnV2ModelRequestsRoot(root), "routing-manifest.json");
  await writeJsonAtomic(routingManifestPath, {
    schemaVersion: "openskill-kit.learn-v2.model-request-routing-manifest.v1",
    generatedAt: now.toISOString(),
    routingPolicy: "learn-v2-roi-v1",
    modelRoutingArtifactPath: modelRouting.artifacts.routingJson,
    opencodeAgentIndexPath: modelRouting.artifacts.opencodeAgentIndex,
    opencodeAgentId: conceptExtractorAgent.opencodeAgentId,
    agentFile: conceptExtractorAgent.agentFile,
    requestedEpisodeCount: requests.length,
    skippedEpisodeCount: skippedEpisodes.length,
    requests: requests.map((request) => ({
      episodeId: request.episodeId,
        priority: request.routing.priority,
        reasons: request.routing.reasons,
        opencodeAgentId: request.opencodeAgentId,
        agentFile: request.agentFile,
        manifestPath: learnV2ProjectRelativePath(root, request.manifestPath)
      })),
    skippedEpisodes
  });
  return {
    schemaVersion: "openskill-kit.learn-v2.model-request-result.v1",
    generatedAt: now.toISOString(),
    requestCount: requests.length,
    requests,
    skippedEpisodes,
    routingManifestPath,
    modelRoutingArtifactPath: path.join(root, modelRouting.artifacts.routingJson),
    opencodeAgentIndexPath: path.join(root, modelRouting.artifacts.opencodeAgentIndex),
    instructions: [
      `Give each prompt to OpenCode agent ${conceptExtractorAgent.opencodeAgentId}.`,
      `Use generated agent definition ${conceptExtractorAgent.agentFile}.`,
      "Save the agent's strict JSON response to a local file.",
      "Apply responses with the Learn v2 model proposal ingestion command/tool.",
      "Do not paste raw vault content into prompts or responses."
    ]
  };
}

export async function applyLearnV2ModelProposalOutputs(
  rootInput: string,
  outputPathsInput: string[],
  now = new Date()
): Promise<LearnV2ModelProposalApplyResult> {
  const root = path.resolve(rootInput);
  const episodeStore = await readLearnV2EpisodeStore(root);
  const episodesById = new Map(episodeStore.episodes.map((episode) => [episode.id, episode]));
  const atoms: LearnV2BehaviorAtom[] = [];
  const rejected: LearnV2ModelProposalApplyResult["rejected"] = [];
  const outputFiles = (await Promise.all(outputPathsInput.map((file) => resolveModelOutputInputPath(root, file, rejected))))
    .filter((file): file is string => Boolean(file));
  for (const outputPath of outputFiles) {
    const text = await fs.readFile(outputPath, "utf8").catch((error: unknown) => {
      rejected.push({ outputPath, id: "file", reason: "read-failed", detail: error instanceof Error ? error.message : String(error) });
      return undefined;
    });
    if (text === undefined) continue;
    const parsed = safeParseModelOutput(text, outputPath, rejected) as LearnV2LlmConceptExtractionOutput | undefined;
    if (!parsed) continue;
    const rejectedBeforeResolve = rejected.length;
    const episode = await resolveEpisodeForModelOutput(root, outputPath, episodesById, rejected);
    if (!episode) {
      if (rejected.length === rejectedBeforeResolve) {
        for (const [index] of parsed.atoms.entries()) rejected.push({ outputPath, id: `llm_atom_${index}`, reason: "no-matching-episode" });
      }
      continue;
    }
    const result = validateLearnV2LlmConceptExtractionOutput(episode, parsed);
    atoms.push(...result.atoms);
    rejected.push(...result.rejected.map((item) => ({ outputPath, ...item })));
  }
  const concepts = mergeLearnV2ConceptCards(atoms, now);
  const existing = await readLearnV2ConceptStore(root, now).catch(() => undefined);
  const store = await writeLearnV2ConceptStore(root, [...(existing?.cards ?? []), ...concepts], now);
  const config = await readProjectConfig(root);
  const conflictLedger = await writeLearnV2ConflictLedger(root, store.cards, config.projectId, now);
  const declassifiedSnippets = await writeLearnV2DeclassifiedSnippetArtifact(root, episodeStore.episodes, now, {
    blockOnMediumRisk: true,
    maxChars: 700,
    maxSnippets: 200
  });
  const conceptDrift = await detectLearnV2ConceptDrift(root, store.cards, { now });
  const evalReport = await runLearnV2Eval(root, episodeStore.episodes, store.cards, now);
  const reviewQueue = await writeLearnV2ReviewQueue(root, store.cards, now, {
    ledger: conflictLedger.ledger,
    markdownPath: conflictLedger.artifactPaths.markdown,
    declassifiedSnippets,
    conceptDrift
  });
  return {
    schemaVersion: "openskill-kit.learn-v2.model-proposal-apply-result.v1",
    appliedAt: now.toISOString(),
    outputFiles,
    atomCount: atoms.length,
    rejected,
    conceptCount: store.cards.length,
    conceptStorePath: path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json"),
    reviewQueuePath: reviewQueue.artifacts.markdown,
    conflictLedgerPath: conflictLedger.artifactPaths.markdown,
    declassifiedSnippetsPath: declassifiedSnippets.artifacts.markdown,
    conceptDriftPath: conceptDrift.artifactPath,
    evalReportPath: evalReport.artifacts.markdown,
    evalStatus: evalReport.status
  };
}

export async function executeLearnV2ModelRequests(
  rootInput: string,
  options: LearnV2ModelRequestExecutionOptions = {}
): Promise<LearnV2ModelRequestExecutionResult> {
  const root = path.resolve(rootInput);
  const now = options.now ?? new Date();
  const runner = options.runner ?? defaultOpenCodeRunner;
  const command = options.opencodeCommand ?? process.env.OSK_OPENCODE_COMMAND ?? process.env.OPENCODE_COMMAND ?? "opencode";
  const timeoutMs = Math.max(5_000, Math.min(options.timeoutMs ?? 300_000, 1_800_000));
  const manifestPaths = await resolveModelRequestManifestInputs(root, options.requestManifests ?? []);
  const results: LearnV2ModelRequestExecutionResult["results"] = [];

  for (const manifestPath of manifestPaths) {
    const started = Date.now();
    const outputPathForManifest = path.join(path.dirname(manifestPath), "response.json");
    const manifestRead = await fs.readFile(manifestPath, "utf8").catch((error: unknown) => {
      results.push({
        manifestPath,
        outputPath: outputPathForManifest,
        status: "failed",
        reason: "read-failed",
        detail: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    });
    if (manifestRead === undefined) continue;

    let manifest: LearnV2ModelRequestManifest;
    try {
      manifest = parseModelRequestManifest(manifestRead, manifestPath);
    } catch (error) {
      results.push({
        manifestPath,
        outputPath: outputPathForManifest,
        status: "failed",
        reason: "invalid-request-manifest",
        detail: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    const outputPath = path.resolve(root, manifest.expectedOutputPath);
    const rejected: LearnV2ModelProposalApplyResult["rejected"] = [];
    const manifestOk = await validateModelRequestManifestFiles(root, manifest, manifestPath, outputPath, rejected);
    if (!manifestOk) {
      results.push({
        manifestPath,
        outputPath,
        episodeId: manifest.episodeId,
        status: "failed",
        reason: rejected[0]?.reason ?? "invalid-request-manifest",
        detail: rejected[0]?.detail
      });
      continue;
    }
    if (manifest.executionBoundary !== "opencode-host-sanitized-only" || manifest.rawRefsIncluded !== false) {
      results.push({
        manifestPath,
        outputPath,
        episodeId: manifest.episodeId,
        status: "failed",
        reason: "unsafe-request-boundary",
        detail: "Only opencode-host-sanitized-only requests with rawRefsIncluded=false can be executed."
      });
      continue;
    }

    const promptPath = path.resolve(root, manifest.promptPath);
    const bundlePath = path.resolve(root, manifest.bundlePath);
    let invocation: LearnV2OpenCodeInvocation;
    try {
      const agent = await resolveRequestAgent(root, manifest);
      invocation = buildOpenCodeInvocation({
        root,
        command,
        manifest,
        promptPath,
        bundlePath,
        timeoutMs,
        attachUrl: options.opencodeAttachUrl,
        agent
      });
    } catch (error) {
      results.push({
        manifestPath,
        outputPath,
        episodeId: manifest.episodeId,
        status: "failed",
        reason: "routing-artifact-read-failed",
        detail: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    let run: LearnV2OpenCodeRunResult;
    try {
      run = await runner(invocation);
    } catch (error) {
      results.push({
        manifestPath,
        outputPath,
        episodeId: manifest.episodeId,
        status: "failed",
        reason: "opencode-invocation-failed",
        detail: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
        command: invocation.command,
        argsShape: shapeOpenCodeArgs(invocation.args)
      });
      continue;
    }

    const stdout = run.stdout ?? "";
    const stderr = run.stderr ?? "";
    if (run.exitCode !== 0) {
      results.push({
        manifestPath,
        outputPath,
        episodeId: manifest.episodeId,
        status: "failed",
        reason: "opencode-nonzero-exit",
        detail: run.signal ? `signal=${run.signal}` : `exitCode=${run.exitCode}`,
        durationMs: Date.now() - started,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        stdoutHash: learnV2Hash(stdout),
        stderrHash: learnV2Hash(stderr),
        command: invocation.command,
        argsShape: shapeOpenCodeArgs(invocation.args)
      });
      continue;
    }

    const parsed = safeParseModelOutput(stdout, outputPath, [], manifest.outputSchema);
    if (!parsed) {
      results.push({
        manifestPath,
        outputPath,
        episodeId: manifest.episodeId,
        status: "failed",
        reason: "invalid-json-or-schema",
        detail: "OpenCode stdout must be strict Learn v2 model proposal JSON.",
        durationMs: Date.now() - started,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        stdoutHash: learnV2Hash(stdout),
        stderrHash: learnV2Hash(stderr),
        command: invocation.command,
        argsShape: shapeOpenCodeArgs(invocation.args)
      });
      continue;
    }
    const validation = await validateExecutedModelOutput(root, manifest, parsed);
    if (!validation.ok) {
      results.push({
        manifestPath,
        outputPath,
        episodeId: manifest.episodeId,
        status: "failed",
        reason: validation.reason,
        detail: validation.detail,
        durationMs: Date.now() - started,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        stdoutHash: learnV2Hash(stdout),
        stderrHash: learnV2Hash(stderr),
        command: invocation.command,
        argsShape: shapeOpenCodeArgs(invocation.args)
      });
      continue;
    }

    const text = `${JSON.stringify(parsed, null, 2)}\n`;
    await writeFileAtomic(outputPath, text);
    results.push({
      manifestPath,
      outputPath,
      episodeId: manifest.episodeId,
      status: "written",
      durationMs: Date.now() - started,
      stdoutBytes: Buffer.byteLength(stdout),
      stderrBytes: Buffer.byteLength(stderr),
      stdoutHash: learnV2Hash(stdout),
      stderrHash: learnV2Hash(stderr),
      responseHash: learnV2Hash(text),
      command: invocation.command,
      argsShape: shapeOpenCodeArgs(invocation.args)
    });
  }

  const executionReportPath = path.join(learnV2ModelRequestsRoot(root), "execution-report.json");
  const result: LearnV2ModelRequestExecutionResult = {
    schemaVersion: "openskill-kit.learn-v2.model-request-execution-result.v1",
    executedAt: now.toISOString(),
    attemptedCount: manifestPaths.length,
    writtenCount: results.filter((item) => item.status === "written").length,
    failedCount: results.filter((item) => item.status === "failed").length,
    skippedCount: results.filter((item) => item.status === "skipped").length,
    executionReportPath,
    results
  };
  await writeJsonAtomic(executionReportPath, result);
  return result;
}

async function validateExecutedModelOutput(
  root: string,
  manifest: LearnV2ModelRequestManifest,
  parsed: LearnV2LlmConceptExtractionOutput | LearnV2LlmScopeInferenceOutput
): Promise<{ ok: true } | { ok: false; reason: "missing-episode-store" | "missing-concept-store" | "stale-request-manifest" | "model-output-evidence-validation-failed"; detail: string }> {
  if (manifest.modelRole === "scope-inferencer" && manifest.outputSchema === "openskill-kit.learn-v2.llm-scope-inference-output.v1") {
    const config = await readProjectConfig(root);
    const store = await readLearnV2ConceptStore(root).catch((error: unknown) => ({
      schemaVersion: "openskill-kit.learn-v2.concept-store.v1" as const,
      projectId: "",
      updatedAt: "",
      cards: [],
      error
    }));
    if ("error" in store) {
      return {
        ok: false,
        reason: "missing-concept-store",
        detail: store.error instanceof Error ? store.error.message : String(store.error)
      };
    }
    const conceptId = manifest.conceptId ?? manifest.episodeId;
    const card = store.cards.find((item) => item.id === conceptId);
    if (!card) return { ok: false, reason: "stale-request-manifest", detail: `Unknown concept ${conceptId}` };
    const cardEvidenceIds = new Set(card.evidenceIds);
    const staleEvidence = manifest.evidenceIds.filter((id) => !cardEvidenceIds.has(id));
    if (staleEvidence.length) {
      return {
        ok: false,
        reason: "stale-request-manifest",
        detail: `Evidence no longer belongs to concept: ${staleEvidence.slice(0, 5).join(", ")}`
      };
    }
    const validation = validateLearnV2ScopeInferenceForCard(root, config, card, parsed as LearnV2LlmScopeInferenceOutput);
    if (!validation.ok) {
      return { ok: false, reason: "model-output-evidence-validation-failed", detail: `${validation.reason}: ${validation.detail}` };
    }
    return { ok: true };
  }

  const episodeStore = await readLearnV2EpisodeStore(root).catch((error: unknown) => ({
    schemaVersion: "openskill-kit.learn-v2.episode-store.v1" as const,
    updatedAt: "",
    episodes: [],
    error
  }));
  if ("error" in episodeStore) {
    return {
      ok: false,
      reason: "missing-episode-store",
      detail: episodeStore.error instanceof Error ? episodeStore.error.message : String(episodeStore.error)
    };
  }
  const episode = episodeStore.episodes.find((item) => item.id === manifest.episodeId);
  if (!episode) {
    return { ok: false, reason: "stale-request-manifest", detail: `Unknown episode ${manifest.episodeId}` };
  }
  const episodeEvidenceIds = new Set(episode.evidenceIds);
  const staleEvidence = manifest.evidenceIds.filter((id) => !episodeEvidenceIds.has(id));
  if (staleEvidence.length) {
    return {
      ok: false,
      reason: "stale-request-manifest",
      detail: `Evidence no longer belongs to episode: ${staleEvidence.slice(0, 5).join(", ")}`
    };
  }
  const validation = validateLearnV2LlmConceptExtractionOutput(episode, parsed as LearnV2LlmConceptExtractionOutput);
  if (validation.rejected.length) {
    return {
      ok: false,
      reason: "model-output-evidence-validation-failed",
      detail: validation.rejected.slice(0, 5).map((item) => `${item.id}:${item.reason}`).join("; ")
    };
  }
  return { ok: true };
}

export function learnV2EpisodeStorePath(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "episodes", "store.json");
}

export function learnV2ModelRequestsRoot(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "model-requests");
}

function learnV2ProjectRelativePath(root: string, file: string): string {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
}

function safeParseModelOutput(
  text: string,
  outputPath: string,
  rejected: LearnV2ModelProposalApplyResult["rejected"],
  outputSchema: LearnV2ModelRequestManifest["outputSchema"] = "openskill-kit.learn-v2.llm-concept-extraction-output.v1"
): LearnV2LlmConceptExtractionOutput | LearnV2LlmScopeInferenceOutput | undefined {
  try {
    return outputSchema === "openskill-kit.learn-v2.llm-scope-inference-output.v1"
      ? parseLearnV2LlmScopeInferenceOutput(text)
      : parseLearnV2LlmConceptExtractionOutput(text);
  } catch (error) {
    rejected.push({ outputPath, id: "file", reason: "invalid-json-or-schema", detail: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

async function pruneStaleModelRequestDirs(root: string, currentEpisodeIds: Set<string>): Promise<void> {
  const requestRoot = learnV2ModelRequestsRoot(root);
  const entries = await fs.readdir(requestRoot, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !currentEpisodeIds.has(entry.name))
    .map((entry) => fs.rm(path.join(requestRoot, entry.name), { recursive: true, force: true })));
}

async function resolveModelRequestManifestInputs(root: string, inputs: string[]): Promise<string[]> {
  if (inputs.length) {
    return inputs.map((input) => path.resolve(root, input)).map((file) => {
      if (path.basename(file) === "request-manifest.json") return file;
      return path.join(file, "request-manifest.json");
    });
  }
  const requestRoot = learnV2ModelRequestsRoot(root);
  const entries = await fs.readdir(requestRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(requestRoot, entry.name, "request-manifest.json"))
    .sort();
}

async function resolveEpisodeForModelOutput(
  root: string,
  outputPath: string,
  episodesById: Map<string, LearnV2TaskEpisode>,
  rejected: LearnV2ModelProposalApplyResult["rejected"]
): Promise<LearnV2TaskEpisode | undefined> {
  const manifestRead = await readSiblingModelRequestManifest(outputPath).catch((error: unknown) => {
    rejected.push({ outputPath, id: "file", reason: "invalid-request-manifest", detail: error instanceof Error ? error.message : String(error) });
    return undefined;
  });
  if (rejected.some((item) => item.outputPath === outputPath && item.reason === "invalid-request-manifest")) return undefined;
  if (!manifestRead) {
    rejected.push({ outputPath, id: "file", reason: "missing-request-manifest", detail: "Model outputs must be applied from a request directory containing request-manifest.json." });
    return undefined;
  }
  const { manifest, manifestPath } = manifestRead;

  const expectedOutput = path.resolve(root, manifest.expectedOutputPath);
  const actualOutput = path.resolve(outputPath);
  if (expectedOutput !== actualOutput) {
    rejected.push({
      outputPath,
      id: "file",
      reason: "unexpected-output-path",
      detail: `Expected ${expectedOutput}`
    });
    return undefined;
  }
  if (!(await validateModelRequestManifestFiles(root, manifest, manifestPath, outputPath, rejected))) return undefined;
  const episode = episodesById.get(manifest.episodeId);
  if (!episode) {
    rejected.push({ outputPath, id: "file", reason: "stale-request-manifest", detail: `Unknown episode ${manifest.episodeId}` });
    return undefined;
  }
  if (manifest.modelRole !== "concept-extractor" || manifest.outputSchema !== "openskill-kit.learn-v2.llm-concept-extraction-output.v1") {
    rejected.push({ outputPath, id: "file", reason: "stale-request-manifest", detail: `Unexpected output schema ${manifest.outputSchema}` });
    return undefined;
  }
  if (manifest.rawRefsIncluded !== false) {
    rejected.push({ outputPath, id: "file", reason: "unsafe-request-manifest", detail: "Manifest claims raw refs may be included." });
    return undefined;
  }
  const episodeEvidenceIds = new Set(episode.evidenceIds);
  const staleEvidence = manifest.evidenceIds.filter((id) => !episodeEvidenceIds.has(id));
  if (staleEvidence.length) {
    rejected.push({ outputPath, id: "file", reason: "stale-request-manifest", detail: `Evidence no longer belongs to episode: ${staleEvidence.slice(0, 5).join(", ")}` });
    return undefined;
  }
  return episode;
}

async function readSiblingModelRequestManifest(outputPath: string): Promise<{ manifest: LearnV2ModelRequestManifest; manifestPath: string } | undefined> {
  const manifestPath = path.join(path.dirname(outputPath), "request-manifest.json");
  const text = await fs.readFile(manifestPath, "utf8").catch(() => undefined);
  if (!text) return undefined;
  return { manifest: parseModelRequestManifest(text, manifestPath), manifestPath };
}

async function resolveModelOutputInputPath(
  root: string,
  inputPath: string,
  rejected: LearnV2ModelProposalApplyResult["rejected"]
): Promise<string | undefined> {
  const absolute = path.resolve(root, inputPath);
  if (path.basename(absolute) !== "request-manifest.json") return absolute;
  const text = await fs.readFile(absolute, "utf8").catch((error: unknown) => {
    rejected.push({ outputPath: absolute, id: "file", reason: "read-failed", detail: error instanceof Error ? error.message : String(error) });
    return undefined;
  });
  if (!text) return undefined;
  try {
    return path.resolve(root, parseModelRequestManifest(text, absolute).expectedOutputPath);
  } catch (error) {
    rejected.push({ outputPath: absolute, id: "file", reason: "invalid-request-manifest", detail: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

function parseModelRequestManifest(text: string, manifestPath: string): LearnV2ModelRequestManifest {
  const value = JSON.parse(text) as Partial<LearnV2ModelRequestManifest>;
  const roleSchemaAgentOk = (
    value.modelRole === "concept-extractor" &&
    value.outputSchema === "openskill-kit.learn-v2.llm-concept-extraction-output.v1" &&
    value.opencodeAgentId === "osk-learn-v2-concept-extractor"
  ) || (
    value.modelRole === "scope-inferencer" &&
    value.outputSchema === "openskill-kit.learn-v2.llm-scope-inference-output.v1" &&
    value.opencodeAgentId === "osk-learn-v2-scope-inferencer" &&
    typeof value.conceptId === "string"
  );
  if (
    value.schemaVersion !== "openskill-kit.learn-v2.model-request-manifest.v1" ||
    typeof value.generatedAt !== "string" ||
    typeof value.episodeId !== "string" ||
    !roleSchemaAgentOk ||
    value.routingPolicy !== "learn-v2-roi-v1" ||
    !Array.isArray(value.routingReasons) ||
    value.routingReasons.some((item) => typeof item !== "string") ||
    typeof value.priority !== "number" ||
    typeof value.promptPath !== "string" ||
    typeof value.bundlePath !== "string" ||
    typeof value.promptHash !== "string" ||
    typeof value.bundleHash !== "string" ||
    typeof value.expectedOutputPath !== "string" ||
    typeof value.agentFile !== "string" ||
    typeof value.modelRoutingArtifactPath !== "string" ||
    typeof value.opencodeAgentIndexPath !== "string" ||
    value.executionBoundary !== "opencode-host-sanitized-only" ||
    !Array.isArray(value.evidenceIds) ||
    value.evidenceIds.some((item) => typeof item !== "string") ||
    value.rawRefsIncluded !== false
  ) {
    throw new Error(`Invalid Learn v2 model request manifest: ${manifestPath}`);
  }
  return value as LearnV2ModelRequestManifest;
}

async function resolveRequestAgent(root: string, manifest: LearnV2ModelRequestManifest): Promise<{
  model: string;
  purpose: string;
  prompt: string;
  maxSteps?: number;
  reasoningEffort?: string;
}> {
  const routingPath = path.resolve(root, manifest.modelRoutingArtifactPath);
  const routing = JSON.parse(await fs.readFile(routingPath, "utf8")) as Awaited<ReturnType<typeof ensureLearnV2ModelRoutingArtifacts>>;
  const agent = routing.agents[manifest.modelRole];
  if (!agent || agent.opencodeAgentId !== manifest.opencodeAgentId) throw new Error(`Missing Learn v2 OpenCode agent for ${manifest.modelRole}`);
  return {
    model: agent.model,
    purpose: agent.purpose,
    maxSteps: agent.maxSteps,
    reasoningEffort: agent.reasoningEffort,
    prompt: [
      `You are ${manifest.opencodeAgentId}.`,
      agent.purpose,
      "Return strict JSON only. Do not include markdown fences.",
      "Use only attached declassified prompt/bundle files.",
      "Do not modify files, run shell commands, or access raw vault content.",
      "Treat output as untrusted proposal data that OpenSkillKit will validate."
    ].join("\n")
  };
}

function buildOpenCodeInvocation(input: {
  root: string;
  command: string;
  manifest: LearnV2ModelRequestManifest;
  promptPath: string;
  bundlePath: string;
  timeoutMs: number;
  attachUrl?: string;
  agent: { model: string; purpose: string; prompt: string; maxSteps?: number; reasoningEffort?: string };
}): LearnV2OpenCodeInvocation {
  const promptFile = input.manifest.modelRole === "scope-inferencer" ? "scope-inference-prompt.md" : "concept-extraction-prompt.md";
  const bundleFile = input.manifest.modelRole === "scope-inferencer" ? "concept-scope-bundle.json" : "episode-learning-bundle.json";
  const args = [
    "run",
    "--agent", input.manifest.opencodeAgentId,
    "--model", input.agent.model,
    "--dir", input.root,
    "--title", `OSK Learn v2 ${input.manifest.modelRole} ${input.manifest.episodeId}`,
    "--file", input.promptPath,
    "--file", input.bundlePath
  ];
  if (input.attachUrl) args.push("--attach", input.attachUrl);
  if (input.agent.reasoningEffort) args.push("--variant", input.agent.reasoningEffort);
  args.push([
    `Read attached ${promptFile} and ${bundleFile}.`,
    `Return only strict JSON matching ${input.manifest.outputSchema}.`,
    "Do not edit files, run shell commands, reveal raw refs, or include markdown fences."
  ].join(" "));
  return {
    command: input.command,
    args,
    cwd: input.root,
    timeoutMs: input.timeoutMs,
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(buildOpenCodeConfigContent(input.manifest.opencodeAgentId, input.agent))
    }
  };
}

function buildOpenCodeConfigContent(agentId: string, agent: { model: string; prompt: string; maxSteps?: number }) {
  return {
    $schema: "https://opencode.ai/config.json",
    snapshot: false,
    agent: {
      [agentId]: {
        description: "OpenSkillKit Learn v2 sanitized model proposal.",
        model: agent.model,
        mode: "all",
        prompt: agent.prompt,
        steps: agent.maxSteps,
        permission: {
          read: "allow",
          glob: "deny",
          grep: "deny",
          list: "deny",
          bash: "deny",
          edit: "deny",
          write: "deny",
          webfetch: "deny",
          websearch: "deny",
          task: "deny",
          external_directory: "deny"
        }
      }
    }
  };
}

async function defaultOpenCodeRunner(invocation: LearnV2OpenCodeInvocation): Promise<LearnV2OpenCodeRunResult> {
  try {
    const commandIsWindowsShim = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(invocation.command);
    const commandIsNodeShim = /\.(?:cjs|mjs|js)$/i.test(invocation.command);
    const output = await execFileAsync(
      commandIsNodeShim ? process.execPath : commandIsWindowsShim ? (process.env.ComSpec ?? "cmd.exe") : invocation.command,
      commandIsNodeShim ? [invocation.command, ...invocation.args] : commandIsWindowsShim ? ["/d", "/s", "/c", windowsShellCommand(invocation.command, invocation.args)] : invocation.args,
      {
      cwd: invocation.cwd,
      env: invocation.env,
      timeout: invocation.timeoutMs,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
      }
    );
    return { exitCode: 0, stdout: output.stdout, stderr: output.stderr };
  } catch (error) {
    const childError = error as Error & { code?: number | string; signal?: string; stdout?: string | Buffer; stderr?: string | Buffer };
    if (typeof childError.code === "number") {
      return {
        exitCode: childError.code,
        signal: childError.signal,
        stdout: bufferOrString(childError.stdout),
        stderr: bufferOrString(childError.stderr)
      };
    }
    throw error;
  }
}

function windowsShellCommand(command: string, args: string[]): string {
  return [command, ...args].map(windowsShellQuote).join(" ");
}

function windowsShellQuote(value: string): string {
  return `"${value.replace(/(["^&|<>])/g, "^$1")}"`;
}

function bufferOrString(value: string | Buffer | undefined): string {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return value ?? "";
}

function shapeOpenCodeArgs(args: string[]): string[] {
  return args.map((arg, index) => {
    if (index > 0 && args[index - 1] === "--file") return "[ATTACHED_FILE]";
    if (index > 0 && args[index - 1] === "--title") return "[TITLE]";
    if (index === args.length - 1 && !arg.startsWith("--")) return "[PROMPT]";
    return arg;
  });
}

async function validateModelRequestManifestFiles(
  root: string,
  manifest: LearnV2ModelRequestManifest,
  manifestPath: string,
  outputPath: string,
  rejected: LearnV2ModelProposalApplyResult["rejected"]
): Promise<boolean> {
  const requestDir = path.dirname(path.resolve(manifestPath));
  const promptPath = path.resolve(root, manifest.promptPath);
  const bundlePath = path.resolve(root, manifest.bundlePath);
  const expectedOutputPath = path.resolve(root, manifest.expectedOutputPath);
  const expectedPromptBasename = manifest.modelRole === "scope-inferencer" ? "scope-inference-prompt.md" : "concept-extraction-prompt.md";
  const expectedBundleBasename = manifest.modelRole === "scope-inferencer" ? "concept-scope-bundle.json" : "episode-learning-bundle.json";
  const expectedFiles = [
    { label: "promptPath", file: promptPath, basename: expectedPromptBasename },
    { label: "bundlePath", file: bundlePath, basename: expectedBundleBasename },
    { label: "expectedOutputPath", file: expectedOutputPath, basename: "response.json" }
  ];
  for (const item of expectedFiles) {
    if (path.dirname(item.file) !== requestDir || path.basename(item.file) !== item.basename) {
      rejected.push({
        outputPath,
        id: "file",
        reason: "unexpected-request-file-path",
        detail: `${item.label} must be ${item.basename} inside the request directory.`
      });
      return false;
    }
  }
  for (const item of expectedFiles.slice(0, 2)) {
    const stat = await fs.stat(item.file).catch(() => undefined);
    if (!stat?.isFile()) {
      rejected.push({
        outputPath,
        id: "file",
        reason: "missing-request-file",
        detail: `${item.label} is missing from the request directory.`
      });
      return false;
    }
  }
  const [promptText, bundleText] = await Promise.all([
    fs.readFile(promptPath, "utf8"),
    fs.readFile(bundlePath, "utf8")
  ]);
  const actualHashes = [
    { label: "promptHash", actual: learnV2Hash(promptText), expected: manifest.promptHash },
    { label: "bundleHash", actual: learnV2Hash(bundleText), expected: manifest.bundleHash }
  ];
  for (const item of actualHashes) {
    if (item.actual !== item.expected) {
      rejected.push({
        outputPath,
        id: "file",
        reason: "request-file-hash-mismatch",
        detail: `${item.label} does not match the request manifest.`
      });
      return false;
    }
  }
  return true;
}

function routeLearnV2EpisodeForModelRequest(episode: LearnV2TaskEpisode): LearnV2ModelRequestRoutingDecision {
  const reasons = new Set<string>();
  const text = [
    ...episode.messages.map((message) => message.text),
    ...episode.phases.map((phase) => phase.summary),
    ...episode.patchComparisons.map((patch) => patch.summary)
  ].join("\n");
  if (episode.outcome === "edited" || episode.outcome === "rejected") reasons.add("user-correction-or-rejection");
  if (episode.outcome === "failed") reasons.add("failed-attempt");
  if (episode.phases.some((phase) => phase.phase === "review/correction")) reasons.add("review-correction-phase");
  if (/\b(?:wrong|instead|avoid|never|prefer|must|should not|reject|manual edit|review|blocker|security|secret|credential|regression|fixture)\b/i.test(text)) reasons.add("durable-language-signal");
  if (episode.patchComparisons.some((patch) => patch.behaviorEligible !== false && (patch.kind === "manual-edit" || patch.addedLines + patch.removedLines >= 8))) reasons.add("semantic-patch-signal");
  if (episode.taskHints.some((hint) => ["security", "refactor-boundary", "parser-change", "testing", "dependency"].includes(hint))) reasons.add("high-value-task-hint");
  if ((episode.episodeConfidenceBreakdown?.linkage.outcomeLink ?? 0) > 0.8) reasons.add("strong-outcome-link");
  if (episode.episodeConfidence >= 0.65 && reasons.size) reasons.add("sufficient-stitching-confidence");

  const priority = Math.min(1, Number((
    Math.min(0.45, reasons.size * 0.09)
    + (episode.outcome === "edited" || episode.outcome === "rejected" ? 0.22 : 0)
    + (episode.outcome === "failed" ? 0.12 : 0)
    + (episode.episodeConfidence * 0.25)
    + Math.min(0.08, episode.tokenBudget.compressedChars / 20_000)
  ).toFixed(2)));

  if (!reasons.size) return { decision: "skip", priority, reasons: ["no-semantic-roi-trigger"] };
  if (episode.episodeConfidence < 0.35 && !reasons.has("user-correction-or-rejection") && !reasons.has("durable-language-signal")) return { decision: "skip", priority, reasons: [...reasons, "weak-stitching-confidence"] };
  if (priority < 0.3 && !reasons.has("durable-language-signal")) return { decision: "skip", priority, reasons: [...reasons, "low-routing-priority"] };
  return { decision: "request", priority, reasons: [...reasons].sort() };
}
