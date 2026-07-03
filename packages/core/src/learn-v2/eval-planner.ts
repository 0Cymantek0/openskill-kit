import { promises as fs } from "node:fs";
import path from "node:path";
import { readProjectConfig } from "../events/store.js";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";
import { extractFirstJsonObject } from "./extract.js";
import { ensureLearnV2ModelRoutingArtifacts } from "./model-routing.js";
import { validateLearnV2ModelOutputBoundary } from "./output-boundary.js";
import {
  LearnV2LlmEvalPlannerOutputSchema,
  type LearnV2ConceptCard,
  type LearnV2LlmEvalPlannerOutput,
  type LearnV2TaskEpisode
} from "./schemas.js";
import { readLearnV2ConceptStore } from "./store.js";
import { learnV2Hash, learnV2IsInside, learnV2ShortHash, learnV2Snippet } from "./utils.js";

export interface LearnV2EvalPlannerRequest {
  planId: string;
  conceptIds: string[];
  bundlePath: string;
  promptPath: string;
  promptHash: string;
  bundleHash: string;
  manifestPath: string;
  expectedOutputPath: string;
  outputSchema: "openskill-kit.learn-v2.llm-eval-plan-output.v1";
  opencodeAgentId: string;
  agentFile: string;
  routing: { decision: "request"; priority: number; reasons: string[] };
}

export interface LearnV2EvalPlannerRequestResult {
  schemaVersion: "openskill-kit.learn-v2.eval-planner-request-result.v1";
  generatedAt: string;
  requestCount: number;
  requests: LearnV2EvalPlannerRequest[];
  skippedConcepts: Array<{ conceptId: string; decision: "skip"; priority: number; reasons: string[] }>;
  routingManifestPath: string;
  modelRoutingArtifactPath: string;
  opencodeAgentIndexPath: string;
  instructions: string[];
}

export interface LearnV2EvalPlannerApplyResult {
  schemaVersion: "openskill-kit.learn-v2.eval-planner-apply-result.v1";
  appliedAt: string;
  outputFiles: string[];
  proposalPath?: string;
  extractionScenarioCount: number;
  behaviorDeltaScenarioCount: number;
  rejected: Array<{ outputPath: string; id: string; reason: string; detail?: string }>;
  instructions: string[];
}

interface EvalPlannerManifest {
  schemaVersion: "openskill-kit.learn-v2.model-request-manifest.v1";
  generatedAt: string;
  episodeId: string;
  reviewId?: string;
  conceptIds?: string[];
  modelRole: "eval-planner";
  routingPolicy: "learn-v2-roi-v1";
  routingReasons: string[];
  priority: number;
  promptPath: string;
  bundlePath: string;
  promptHash: string;
  bundleHash: string;
  expectedOutputPath: string;
  outputSchema: "openskill-kit.learn-v2.llm-eval-plan-output.v1";
  opencodeAgentId: "osk-learn-v2-eval-planner";
  agentFile: string;
  modelRoutingArtifactPath: string;
  opencodeAgentIndexPath: string;
  executionBoundary: "opencode-host-sanitized-only";
  evidenceIds: string[];
  rawRefsIncluded: false;
}

interface EvalPlannerBundle {
  schemaVersion: "openskill-kit.learn-v2.eval-planner-bundle.v1";
  planId: string;
  concepts: Array<{
    id: string;
    title: string;
    canonicalBehavior: string;
    behaviorDelta: string;
    status: LearnV2ConceptCard["status"];
    risk: LearnV2ConceptCard["risk"];
    confidence: number;
    durability: number;
    sourceReliability: number;
    scope: LearnV2ConceptCard["scope"];
    activation: LearnV2ConceptCard["activation"];
    conditions: LearnV2ConceptCard["conditions"];
    evidenceIds: string[];
    atomKinds: string[];
  }>;
  evidence: Array<{
    episodeId: string;
    evidenceIds: string[];
    taskHints: string[];
    pathCluster: string[];
    commandCluster: string[];
    outcome: LearnV2TaskEpisode["outcome"];
    phaseSummaries: string[];
    patchSummaries: string[];
  }>;
  existingEvalShape: {
    extractionScenarioSchema: "openskill-kit.learn-v2.extraction-golden.v1";
    behaviorDeltaScenarioSchema: "openskill-kit.learn-v2.behavior-delta-golden.v1";
  };
}

type EvalPlannerRoutingDecision =
  | { decision: "request"; priority: number; reasons: string[] }
  | { decision: "skip"; priority: number; reasons: string[] };

export async function writeLearnV2EvalPlannerRequests(
  rootInput: string,
  conceptIds: string[] = [],
  now = new Date()
): Promise<LearnV2EvalPlannerRequestResult> {
  const root = path.resolve(rootInput);
  const store = await readLearnV2ConceptStore(root, now);
  const episodes = await readEvalPlannerEpisodeStore(root);
  const selected = new Set(conceptIds);
  const candidates = store.cards.filter((card) => !selected.size || selected.has(card.id));
  const modelRouting = await ensureLearnV2ModelRoutingArtifacts(root, now);
  const agent = modelRouting.agents["eval-planner"];
  const requests: LearnV2EvalPlannerRequest[] = [];
  const skippedConcepts: LearnV2EvalPlannerRequestResult["skippedConcepts"] = [];

  for (const card of candidates) {
    const routing = routeConceptForEvalPlanner(card, selected.size > 0);
    if (routing.decision === "skip") {
      skippedConcepts.push({ conceptId: card.id, ...routing });
      continue;
    }
    const planId = `eval_${learnV2ShortHash(card.id)}`;
    const bundle = buildEvalPlannerBundle(planId, [card], episodes);
    const prompt = renderEvalPlannerPrompt(bundle);
    const dir = path.join(learnV2ModelRequestsRoot(root), planId);
    const bundlePath = path.join(dir, "eval-planner-bundle.json");
    const promptPath = path.join(dir, "eval-planner-prompt.md");
    const manifestPath = path.join(dir, "request-manifest.json");
    const expectedOutputPath = path.join(dir, "response.json");
    const bundleText = `${JSON.stringify(bundle, null, 2)}\n`;
    const promptHash = learnV2Hash(prompt);
    const bundleHash = learnV2Hash(bundleText);
    const evidenceIds = [...new Set(bundle.evidence.flatMap((item) => item.evidenceIds))].sort();
    await writeFileAtomic(bundlePath, bundleText);
    await writeFileAtomic(promptPath, prompt);
    await writeJsonAtomic(manifestPath, {
      schemaVersion: "openskill-kit.learn-v2.model-request-manifest.v1",
      generatedAt: now.toISOString(),
      episodeId: planId,
      reviewId: planId,
      conceptIds: [card.id],
      modelRole: "eval-planner",
      routingPolicy: "learn-v2-roi-v1",
      routingReasons: routing.reasons,
      priority: routing.priority,
      promptPath: learnV2ProjectRelativePath(root, promptPath),
      bundlePath: learnV2ProjectRelativePath(root, bundlePath),
      promptHash,
      bundleHash,
      expectedOutputPath: learnV2ProjectRelativePath(root, expectedOutputPath),
      outputSchema: "openskill-kit.learn-v2.llm-eval-plan-output.v1",
      opencodeAgentId: agent.opencodeAgentId,
      agentFile: agent.agentFile,
      modelRoutingArtifactPath: modelRouting.artifacts.routingJson,
      opencodeAgentIndexPath: modelRouting.artifacts.opencodeAgentIndex,
      executionBoundary: "opencode-host-sanitized-only",
      evidenceIds,
      rawRefsIncluded: false,
      instructions: [
        `Send eval-planner-prompt.md to the OpenCode agent ${agent.opencodeAgentId}.`,
        `Agent definition: ${agent.agentFile}.`,
        "Save strict JSON output to response.json in this directory.",
        "Output only proposed eval golden scenarios; do not mutate concept state."
      ]
    });
    requests.push({
      planId,
      conceptIds: [card.id],
      bundlePath,
      promptPath,
      promptHash,
      bundleHash,
      manifestPath,
      expectedOutputPath,
      outputSchema: "openskill-kit.learn-v2.llm-eval-plan-output.v1",
      opencodeAgentId: agent.opencodeAgentId,
      agentFile: agent.agentFile,
      routing
    });
  }

  const routingManifestPath = path.join(learnV2ModelRequestsRoot(root), "eval-planner-routing-manifest.json");
  await writeJsonAtomic(routingManifestPath, {
    schemaVersion: "openskill-kit.learn-v2.eval-planner-routing-manifest.v1",
    generatedAt: now.toISOString(),
    routingPolicy: "learn-v2-roi-v1",
    modelRoutingArtifactPath: modelRouting.artifacts.routingJson,
    opencodeAgentIndexPath: modelRouting.artifacts.opencodeAgentIndex,
    opencodeAgentId: agent.opencodeAgentId,
    agentFile: agent.agentFile,
    requestedConceptCount: requests.length,
    skippedConceptCount: skippedConcepts.length,
    requests: requests.map((request) => ({
      planId: request.planId,
      conceptIds: request.conceptIds,
      priority: request.routing.priority,
      reasons: request.routing.reasons,
      opencodeAgentId: request.opencodeAgentId,
      agentFile: request.agentFile,
      manifestPath: learnV2ProjectRelativePath(root, request.manifestPath)
    })),
    skippedConcepts
  });

  return {
    schemaVersion: "openskill-kit.learn-v2.eval-planner-request-result.v1",
    generatedAt: now.toISOString(),
    requestCount: requests.length,
    requests,
    skippedConcepts,
    routingManifestPath,
    modelRoutingArtifactPath: path.join(root, modelRouting.artifacts.routingJson),
    opencodeAgentIndexPath: path.join(root, modelRouting.artifacts.opencodeAgentIndex),
    instructions: [
      `Give each prompt to OpenCode agent ${agent.opencodeAgentId}.`,
      `Use generated agent definition ${agent.agentFile}.`,
      "Save strict JSON response to response.json.",
      "Apply responses with --eval-output to write a proposed goldens file, then run --run-learn-v2-eval --learn-v2-goldens <proposal>."
    ]
  };
}

export function parseLearnV2LlmEvalPlannerOutput(text: string): LearnV2LlmEvalPlannerOutput {
  return LearnV2LlmEvalPlannerOutputSchema.parse(JSON.parse(extractFirstJsonObject(text)));
}

export async function applyLearnV2EvalPlannerOutputs(
  rootInput: string,
  outputPathsInput: string[],
  now = new Date()
): Promise<LearnV2EvalPlannerApplyResult> {
  const root = path.resolve(rootInput);
  const config = await readProjectConfig(root);
  const rejected: LearnV2EvalPlannerApplyResult["rejected"] = [];
  const outputFiles = (await Promise.all(outputPathsInput.map((file) => resolveEvalPlannerOutputInputPath(root, file, rejected)))).filter((file): file is string => Boolean(file));
  const extractionScenarios: LearnV2LlmEvalPlannerOutput["extractionScenarios"] = [];
  const behaviorDeltaScenarios: LearnV2LlmEvalPlannerOutput["behaviorDeltaScenarios"] = [];

  for (const outputPath of outputFiles) {
    const manifest = await readEvalPlannerManifest(root, outputPath, rejected);
    if (!manifest) continue;
    const text = await fs.readFile(outputPath, "utf8").catch((error: unknown) => {
      rejected.push({ outputPath, id: "file", reason: "read-failed", detail: error instanceof Error ? error.message : String(error) });
      return undefined;
    });
    if (text === undefined) continue;
    let parsed: LearnV2LlmEvalPlannerOutput;
    try {
      parsed = parseLearnV2LlmEvalPlannerOutput(text);
    } catch (error) {
      rejected.push({ outputPath, id: "file", reason: "invalid-json-or-schema", detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const validation = validateLearnV2EvalPlannerOutput(root, config, manifest, parsed);
    if (!validation.ok) {
      rejected.push({ outputPath, id: manifest.reviewId ?? manifest.episodeId, reason: validation.reason, detail: validation.detail });
      continue;
    }
    extractionScenarios.push(...parsed.extractionScenarios);
    behaviorDeltaScenarios.push(...parsed.behaviorDeltaScenarios);
  }

  const proposalPath = extractionScenarios.length || behaviorDeltaScenarios.length
    ? await writeEvalPlannerGoldenProposal(root, now, extractionScenarios, behaviorDeltaScenarios)
    : undefined;
  return {
    schemaVersion: "openskill-kit.learn-v2.eval-planner-apply-result.v1",
    appliedAt: now.toISOString(),
    outputFiles,
    proposalPath,
    extractionScenarioCount: extractionScenarios.length,
    behaviorDeltaScenarioCount: behaviorDeltaScenarios.length,
    rejected,
    instructions: proposalPath
      ? [`Run: openskill-kit osk learn --run-learn-v2-eval --learn-v2-goldens ${learnV2ProjectRelativePath(root, proposalPath)}`]
      : ["No eval golden proposal file was written because no valid scenarios were accepted."]
  };
}

export function validateLearnV2EvalPlannerOutput(
  root: string,
  config: Awaited<ReturnType<typeof readProjectConfig>>,
  manifest: Pick<EvalPlannerManifest, "conceptIds" | "evidenceIds">,
  output: LearnV2LlmEvalPlannerOutput
): { ok: true } | { ok: false; reason: "unsafe-output-content" | "invalid-eval-plan-output"; detail: string } {
  const boundary = validateLearnV2ModelOutputBoundary(root, config, output);
  if (!boundary.ok) return boundary;
  const allowedEvidenceIds = new Set(manifest.evidenceIds ?? []);
  const allScenarioIds = [...output.extractionScenarios, ...output.behaviorDeltaScenarios].map((scenario) => scenario.id);
  if (new Set(allScenarioIds).size !== allScenarioIds.length) {
    return { ok: false, reason: "invalid-eval-plan-output", detail: "Scenario ids must be unique within one eval-planner output." };
  }
  const forbiddenRawEvidenceIds = [...allowedEvidenceIds].filter((id) => /^raw_/i.test(id));
  if (forbiddenRawEvidenceIds.length) {
    return { ok: false, reason: "invalid-eval-plan-output", detail: "Eval-planner manifests must not carry raw refs as evidence ids." };
  }
  return { ok: true };
}

async function writeEvalPlannerGoldenProposal(
  root: string,
  now: Date,
  extractionScenarios: LearnV2LlmEvalPlannerOutput["extractionScenarios"],
  behaviorDeltaScenarios: LearnV2LlmEvalPlannerOutput["behaviorDeltaScenarios"]
): Promise<string> {
  const dir = path.join(root, ".openskill-kit", "learn-v2", "evals", "proposals");
  const file = path.join(dir, `eval-goldens-${now.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}.json`);
  await writeJsonAtomic(file, {
    schemaVersion: "openskill-kit.learn-v2.eval-golden-proposal.v1",
    generatedAt: now.toISOString(),
    source: "eval-planner-model-proposal",
    scenarios: extractionScenarios,
    behaviorDeltaScenarios,
    reviewRequired: true,
    instructions: [
      "Model-planned eval goldens are proposal data.",
      "Review before using as a regression gate.",
      "Run with openskill-kit osk learn --run-learn-v2-eval --learn-v2-goldens <this-file>."
    ]
  });
  return file;
}

function routeConceptForEvalPlanner(card: LearnV2ConceptCard, explicitlySelected: boolean): EvalPlannerRoutingDecision {
  const reasons: string[] = [];
  if (card.status !== "active" && card.status !== "locked" && card.status !== "staged" && !explicitlySelected) {
    return { decision: "skip", priority: 0, reasons: [`status:${card.status}`] };
  }
  if (explicitlySelected) reasons.push("explicit-selection");
  if (card.status === "active" || card.status === "locked") reasons.push(`reviewed-status:${card.status}`);
  if (card.status === "staged") reasons.push("staged-for-review");
  if (card.risk !== "low") reasons.push(`risk:${card.risk}`);
  if (card.counterevidence.length) reasons.push("counterevidence-needs-regression");
  if (card.atoms.some((atom) => atom.kind === "command-policy" || atom.kind === "security" || atom.kind === "scope-boundary")) reasons.push("high-impact-kind");
  if (card.scope.paths.length || card.scope.taskTypes.length || card.activation.commands.length) reasons.push("has-activation-surface");
  if (!reasons.length) return { decision: "skip", priority: 0.1, reasons: ["low-roi-eval-planning"] };
  return { decision: "request", priority: Number(Math.min(1, 0.35 + reasons.length * 0.12 + card.confidence * 0.2).toFixed(2)), reasons };
}

async function readEvalPlannerEpisodeStore(root: string): Promise<LearnV2TaskEpisode[]> {
  const file = path.join(root, ".openskill-kit", "learn-v2", "episodes", "store.json");
  const text = await fs.readFile(file, "utf8").catch(() => undefined);
  if (!text) return [];
  const parsed = JSON.parse(text) as { episodes?: LearnV2TaskEpisode[] };
  return Array.isArray(parsed.episodes) ? parsed.episodes : [];
}

function buildEvalPlannerBundle(planId: string, concepts: LearnV2ConceptCard[], episodes: LearnV2TaskEpisode[]): EvalPlannerBundle {
  const evidenceIds = new Set(concepts.flatMap((concept) => concept.evidenceIds));
  const matchingEpisodes = episodes.filter((episode) => episode.evidenceIds.some((id) => evidenceIds.has(id))).slice(0, 8);
  return {
    schemaVersion: "openskill-kit.learn-v2.eval-planner-bundle.v1",
    planId,
    concepts: concepts.map((concept) => ({
      id: concept.id,
      title: concept.title,
      canonicalBehavior: concept.canonicalBehavior,
      behaviorDelta: concept.behaviorDelta,
      status: concept.status,
      risk: concept.risk,
      confidence: concept.confidence,
      durability: concept.durability,
      sourceReliability: concept.sourceReliability,
      scope: concept.scope,
      activation: concept.activation,
      conditions: concept.conditions,
      evidenceIds: concept.evidenceIds,
      atomKinds: [...new Set(concept.atoms.map((atom) => atom.kind))].sort()
    })),
    evidence: matchingEpisodes.map((episode) => ({
      episodeId: episode.id,
      evidenceIds: episode.evidenceIds,
      taskHints: episode.taskHints.slice(0, 12),
      pathCluster: episode.pathCluster.slice(0, 12),
      commandCluster: [...new Set(episode.messages.flatMap((message) => message.commands))].slice(0, 8),
      outcome: episode.outcome,
      phaseSummaries: episode.phases.map((phase) => learnV2Snippet(`${phase.phase}: ${phase.summary}`, 220)).slice(0, 10),
      patchSummaries: episode.patchComparisons.map((patch) => learnV2Snippet(`${patch.kind}: ${patch.summary}`, 220)).slice(0, 10)
    })),
    existingEvalShape: {
      extractionScenarioSchema: "openskill-kit.learn-v2.extraction-golden.v1",
      behaviorDeltaScenarioSchema: "openskill-kit.learn-v2.behavior-delta-golden.v1"
    }
  };
}

function renderEvalPlannerPrompt(bundle: EvalPlannerBundle): string {
  return [
    "# Learn v2 eval planner",
    "",
    "Return strict JSON only. No markdown fences.",
    "Use only attached eval-planner-bundle.json.",
    "Create proposed eval golden scenarios that would catch regressions in learned behavior.",
    "Every scenario must be grounded in supplied concept ids and evidence ids.",
    "Do not include raw refs, raw paths, secrets, private identifiers, or raw transcript text.",
    "",
    "Required output schema:",
    JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-eval-plan-output.v1",
      extractionScenarios: [{
        schemaVersion: "openskill-kit.learn-v2.extraction-golden.v1",
        id: "golden_<short_name>",
        title: "short title",
        episodeIdIncludes: "optional episode id fragment",
        expectedConceptText: ["text that should appear in concept behavior"],
        expectedKinds: ["verification"],
        expectedTaskHints: ["parser"],
        expectedPathText: ["packages/core"],
        forbiddenText: ["raw secret/path text must be absent"]
      }],
      behaviorDeltaScenarios: [{
        schemaVersion: "openskill-kit.learn-v2.behavior-delta-golden.v1",
        id: "delta_<short_name>",
        title: "short title",
        task: { prompt: "future task", paths: [], commands: [], taskTypes: [], negativeSignals: [] },
        expectedConceptText: ["text that should activate"],
        expectedKinds: ["verification"],
        expectedPlanIncludes: ["plan phrase when concept injected"],
        expectedPlanExcludes: ["bad plan phrase"],
        minActivatedConcepts: 1
      }],
      rejected: []
    }, null, 2),
    "",
    `Plan id: ${bundle.planId}`,
    `Concept ids: ${bundle.concepts.map((concept) => concept.id).join(", ")}`,
    `Evidence ids: ${[...new Set(bundle.evidence.flatMap((item) => item.evidenceIds))].join(", ") || "none"}`
  ].join("\n");
}

async function readEvalPlannerManifest(
  root: string,
  outputPath: string,
  rejected: LearnV2EvalPlannerApplyResult["rejected"]
): Promise<EvalPlannerManifest | undefined> {
  const manifestPath = path.join(path.dirname(outputPath), "request-manifest.json");
  if (!isLearnV2ModelRequestManifestPath(root, manifestPath)) {
    rejected.push({ outputPath, id: "file", reason: "request-manifest-outside-model-requests", detail: "Eval-planner outputs must live beside an OSK request manifest." });
    return undefined;
  }
  const text = await fs.readFile(manifestPath, "utf8").catch(() => undefined);
  if (!text) {
    rejected.push({ outputPath, id: "file", reason: "missing-request-manifest" });
    return undefined;
  }
  const manifest = parseEvalPlannerManifest(text);
  if (!manifest) {
    rejected.push({ outputPath, id: "file", reason: "invalid-request-manifest", detail: "Request manifest is not valid eval-planner JSON." });
    return undefined;
  }
  if (!isEvalPlannerManifest(manifest)) {
    rejected.push({ outputPath, id: "file", reason: "stale-request-manifest", detail: "Output is not bound to an eval-planner request." });
    return undefined;
  }
  if (!(await validateEvalPlannerManifestFiles(root, manifest, manifestPath, outputPath, rejected))) return undefined;
  return manifest;
}

async function resolveEvalPlannerOutputInputPath(
  root: string,
  inputPath: string,
  rejected: LearnV2EvalPlannerApplyResult["rejected"]
): Promise<string | undefined> {
  const absolute = path.resolve(root, inputPath);
  if (path.basename(absolute) !== "request-manifest.json") {
    if (!isLearnV2ModelRequestOutputPath(root, absolute)) {
      rejected.push({ outputPath: absolute, id: "file", reason: "unexpected-request-file-path", detail: "Eval-planner output files must be request-local response.json files." });
      return undefined;
    }
    return absolute;
  }
  if (!isLearnV2ModelRequestManifestPath(root, absolute)) {
    rejected.push({ outputPath: absolute, id: "file", reason: "request-manifest-outside-model-requests", detail: "Model request manifests must live in .openskill-kit/learn-v2/model-requests/." });
    return undefined;
  }
  const text = await fs.readFile(absolute, "utf8").catch((error: unknown) => {
    rejected.push({ outputPath: absolute, id: "file", reason: "read-failed", detail: error instanceof Error ? error.message : String(error) });
    return undefined;
  });
  if (!text) return undefined;
  const manifest = parseEvalPlannerManifest(text);
  if (!manifest || !isEvalPlannerManifest(manifest)) {
    rejected.push({ outputPath: absolute, id: "file", reason: "invalid-request-manifest", detail: "Request manifest is not valid eval-planner JSON." });
    return undefined;
  }
  const expectedOutputPath = resolveManifestProjectPath(root, manifest.expectedOutputPath);
  if (!expectedOutputPath || !isLearnV2ModelRequestOutputPath(root, expectedOutputPath)) {
    rejected.push({ outputPath: absolute, id: "file", reason: "unexpected-request-file-path", detail: "Expected output path must be request-local response.json." });
    return undefined;
  }
  return expectedOutputPath;
}

async function validateEvalPlannerManifestFiles(
  root: string,
  manifest: EvalPlannerManifest,
  manifestPath: string,
  outputPath: string,
  rejected: LearnV2EvalPlannerApplyResult["rejected"]
): Promise<boolean> {
  const requestDir = path.dirname(path.resolve(manifestPath));
  const promptPath = resolveManifestProjectPath(root, manifest.promptPath);
  const bundlePath = resolveManifestProjectPath(root, manifest.bundlePath);
  const expectedOutputPath = resolveManifestProjectPath(root, manifest.expectedOutputPath);
  if (!promptPath || !bundlePath || !expectedOutputPath) {
    rejected.push({ outputPath, id: "file", reason: "unexpected-request-file-path", detail: "Request paths must be project-relative and inside the project." });
    return false;
  }
  const expected = [
    { label: "promptPath", file: promptPath, basename: "eval-planner-prompt.md" },
    { label: "bundlePath", file: bundlePath, basename: "eval-planner-bundle.json" },
    { label: "expectedOutputPath", file: expectedOutputPath, basename: "response.json" }
  ];
  for (const item of expected) {
    if (path.dirname(item.file) !== requestDir || path.basename(item.file) !== item.basename) {
      rejected.push({ outputPath, id: "file", reason: "unexpected-request-file-path", detail: `${item.label} must be ${item.basename} inside the request directory.` });
      return false;
    }
  }
  const requestFiles = await Promise.all([
    fs.readFile(promptPath, "utf8").catch((error: unknown) => error),
    fs.readFile(bundlePath, "utf8").catch((error: unknown) => error)
  ]);
  if (requestFiles.some((item) => item instanceof Error)) {
    rejected.push({ outputPath, id: "file", reason: "missing-request-file", detail: "Eval-planner prompt or bundle is missing from the request directory." });
    return false;
  }
  const [promptText, bundleText] = requestFiles as [string, string];
  if (learnV2Hash(promptText) !== manifest.promptHash || learnV2Hash(bundleText) !== manifest.bundleHash) {
    rejected.push({ outputPath, id: "file", reason: "request-file-hash-mismatch", detail: "Eval-planner prompt or bundle hash does not match the request manifest." });
    return false;
  }
  return true;
}

function parseEvalPlannerManifest(text: string): EvalPlannerManifest | undefined {
  try {
    return JSON.parse(text) as EvalPlannerManifest;
  } catch {
    return undefined;
  }
}

function isEvalPlannerManifest(value: Partial<EvalPlannerManifest> | undefined): value is EvalPlannerManifest {
  return value?.schemaVersion === "openskill-kit.learn-v2.model-request-manifest.v1"
    && typeof value.generatedAt === "string"
    && typeof value.episodeId === "string"
    && typeof value.reviewId === "string"
    && Array.isArray(value.conceptIds)
    && value.conceptIds.every((item) => typeof item === "string")
    && value.modelRole === "eval-planner"
    && value.routingPolicy === "learn-v2-roi-v1"
    && Array.isArray(value.routingReasons)
    && value.routingReasons.every((item) => typeof item === "string")
    && typeof value.priority === "number"
    && typeof value.promptPath === "string"
    && typeof value.bundlePath === "string"
    && typeof value.promptHash === "string"
    && typeof value.bundleHash === "string"
    && typeof value.expectedOutputPath === "string"
    && value.outputSchema === "openskill-kit.learn-v2.llm-eval-plan-output.v1"
    && value.opencodeAgentId === "osk-learn-v2-eval-planner"
    && typeof value.agentFile === "string"
    && typeof value.modelRoutingArtifactPath === "string"
    && typeof value.opencodeAgentIndexPath === "string"
    && value.executionBoundary === "opencode-host-sanitized-only"
    && Array.isArray(value.evidenceIds)
    && value.evidenceIds.every((item) => typeof item === "string")
    && value.rawRefsIncluded === false;
}

function learnV2ModelRequestsRoot(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "model-requests");
}

function isLearnV2ModelRequestManifestPath(root: string, manifestPath: string): boolean {
  const requestRoot = path.resolve(learnV2ModelRequestsRoot(root));
  const resolvedManifest = path.resolve(manifestPath);
  const requestDir = path.dirname(resolvedManifest);
  return path.basename(resolvedManifest) === "request-manifest.json"
    && samePath(path.dirname(requestDir), requestRoot)
    && learnV2IsInside(requestRoot, requestDir);
}

function isLearnV2ModelRequestOutputPath(root: string, outputPath: string): boolean {
  const requestRoot = path.resolve(learnV2ModelRequestsRoot(root));
  const resolvedOutput = path.resolve(outputPath);
  const requestDir = path.dirname(resolvedOutput);
  return path.basename(resolvedOutput) === "response.json"
    && samePath(path.dirname(requestDir), requestRoot)
    && learnV2IsInside(requestRoot, requestDir);
}

function resolveManifestProjectPath(root: string, value: string | undefined): string | undefined {
  if (!value || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\") || /(^|\/)\.\.(\/|$)/.test(value)) return undefined;
  const resolved = path.resolve(root, value);
  return learnV2IsInside(path.resolve(root), resolved) ? resolved : undefined;
}

function learnV2ProjectRelativePath(root: string, file: string): string {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
}
