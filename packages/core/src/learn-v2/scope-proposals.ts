import { promises as fs } from "node:fs";
import path from "node:path";
import { readProjectConfig } from "../events/store.js";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";
import { writeLearnV2ConflictLedger } from "./conflicts.js";
import { writeLearnV2DeclassifiedSnippetArtifact } from "./declassify.js";
import { detectLearnV2ConceptDrift } from "./drift.js";
import { extractFirstJsonObject } from "./extract.js";
import { ensureLearnV2ModelRoutingArtifacts } from "./model-routing.js";
import { validateLearnV2ModelOutputBoundary } from "./output-boundary.js";
import { writeLearnV2ReviewQueue } from "./review.js";
import {
  LearnV2ConceptCardSchema,
  LearnV2LlmScopeInferenceOutputSchema,
  type LearnV2ConceptCard,
  type LearnV2LlmScopeInferenceOutput
} from "./schemas.js";
import { readLearnV2ConceptStore, writeLearnV2ConceptStore } from "./store.js";
import { learnV2Hash, learnV2IsInside, learnV2ShortHash } from "./utils.js";

export interface LearnV2ScopeInferenceRequest {
  conceptId: string;
  bundlePath: string;
  promptPath: string;
  promptHash: string;
  bundleHash: string;
  manifestPath: string;
  expectedOutputPath: string;
  outputSchema: "openskill-kit.learn-v2.llm-scope-inference-output.v1";
  opencodeAgentId: string;
  agentFile: string;
  routing: { decision: "request"; priority: number; reasons: string[] };
}

export interface LearnV2ScopeInferenceRequestResult {
  schemaVersion: "openskill-kit.learn-v2.scope-inference-request-result.v1";
  generatedAt: string;
  requestCount: number;
  requests: LearnV2ScopeInferenceRequest[];
  skippedConcepts: Array<{ conceptId: string; decision: "skip"; priority: number; reasons: string[] }>;
  routingManifestPath: string;
  modelRoutingArtifactPath: string;
  opencodeAgentIndexPath: string;
  instructions: string[];
}

export interface LearnV2ScopeInferenceApplyResult {
  schemaVersion: "openskill-kit.learn-v2.scope-inference-apply-result.v1";
  appliedAt: string;
  outputFiles: string[];
  updatedConceptIds: string[];
  rejected: Array<{ outputPath: string; id: string; reason: string; detail?: string }>;
  conceptStorePath: string;
  reviewQueuePath: string;
  conflictLedgerPath: string;
  declassifiedSnippetsPath?: string;
  conceptDriftPath: string;
}

interface LearnV2ScopeBundle {
  schemaVersion: "openskill-kit.learn-v2.concept-scope-bundle.v1";
  conceptId: string;
  title: string;
  canonicalBehavior: string;
  behaviorDelta: string;
  status: LearnV2ConceptCard["status"];
  risk: LearnV2ConceptCard["risk"];
  confidence: number;
  scope: LearnV2ConceptCard["scope"];
  activation: LearnV2ConceptCard["activation"];
  conditions: LearnV2ConceptCard["conditions"];
  evidenceIds: string[];
  atomSummaries: Array<{
    statement: string;
    kind: string;
    polarity: string;
    scope: {
      level: LearnV2ConceptCard["scope"]["level"];
      paths: string[];
      taskTypes: string[];
      negativeTriggers: string[];
    };
    evidenceIds: string[];
  }>;
}

type ScopeRoutingDecision = { decision: "request"; priority: number; reasons: string[] } | { decision: "skip"; priority: number; reasons: string[] };

export async function writeLearnV2ScopeInferenceRequests(
  rootInput: string,
  conceptIds: string[] = [],
  now = new Date()
): Promise<LearnV2ScopeInferenceRequestResult> {
  const root = path.resolve(rootInput);
  const store = await readLearnV2ConceptStore(root, now);
  const requested = new Set(conceptIds);
  const cards = store.cards.filter((card) => !requested.size || requested.has(card.id));
  const modelRouting = await ensureLearnV2ModelRoutingArtifacts(root, now);
  const agent = modelRouting.agents["scope-inferencer"];
  const requests: LearnV2ScopeInferenceRequest[] = [];
  const skippedConcepts: LearnV2ScopeInferenceRequestResult["skippedConcepts"] = [];

  for (const card of cards) {
    const routing = routeLearnV2ConceptForScopeInference(card);
    if (routing.decision === "skip") {
      skippedConcepts.push({ conceptId: card.id, ...routing });
      continue;
    }
    const bundle = buildLearnV2ConceptScopeBundle(card);
    const prompt = renderLearnV2ScopeInferencePrompt(bundle);
    const dir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", `scope_${learnV2ShortHash(card.id)}`);
    const bundlePath = path.join(dir, "concept-scope-bundle.json");
    const promptPath = path.join(dir, "scope-inference-prompt.md");
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
      episodeId: card.id,
      conceptId: card.id,
      modelRole: "scope-inferencer",
      routingPolicy: "learn-v2-roi-v1",
      routingReasons: routing.reasons,
      priority: routing.priority,
      promptPath: learnV2ProjectRelativePath(root, promptPath),
      bundlePath: learnV2ProjectRelativePath(root, bundlePath),
      promptHash,
      bundleHash,
      expectedOutputPath: learnV2ProjectRelativePath(root, expectedOutputPath),
      outputSchema: "openskill-kit.learn-v2.llm-scope-inference-output.v1",
      opencodeAgentId: agent.opencodeAgentId,
      agentFile: agent.agentFile,
      modelRoutingArtifactPath: modelRouting.artifacts.routingJson,
      opencodeAgentIndexPath: modelRouting.artifacts.opencodeAgentIndex,
      executionBoundary: "opencode-host-sanitized-only",
      evidenceIds: card.evidenceIds,
      rawRefsIncluded: false,
      instructions: [
        `Send scope-inference-prompt.md to the OpenCode agent ${agent.opencodeAgentId}.`,
        `Agent definition: ${agent.agentFile}.`,
        "Save strict JSON output to response.json in this directory.",
        "Only propose narrower scope, activation phrases, and negative triggers grounded in the bundle."
      ]
    });
    requests.push({
      conceptId: card.id,
      bundlePath,
      promptPath,
      promptHash,
      bundleHash,
      manifestPath,
      expectedOutputPath,
      outputSchema: "openskill-kit.learn-v2.llm-scope-inference-output.v1",
      opencodeAgentId: agent.opencodeAgentId,
      agentFile: agent.agentFile,
      routing
    });
  }

  const routingManifestPath = path.join(learnV2ModelRequestsRoot(root), "scope-routing-manifest.json");
  await writeJsonAtomic(routingManifestPath, {
    schemaVersion: "openskill-kit.learn-v2.scope-inference-routing-manifest.v1",
    generatedAt: now.toISOString(),
    routingPolicy: "learn-v2-roi-v1",
    modelRoutingArtifactPath: modelRouting.artifacts.routingJson,
    opencodeAgentIndexPath: modelRouting.artifacts.opencodeAgentIndex,
    opencodeAgentId: agent.opencodeAgentId,
    agentFile: agent.agentFile,
    requestedConceptCount: requests.length,
    skippedConceptCount: skippedConcepts.length,
    requests: requests.map((request) => ({
      conceptId: request.conceptId,
      priority: request.routing.priority,
      reasons: request.routing.reasons,
      opencodeAgentId: request.opencodeAgentId,
      agentFile: request.agentFile,
      manifestPath: learnV2ProjectRelativePath(root, request.manifestPath)
    })),
    skippedConcepts
  });

  return {
    schemaVersion: "openskill-kit.learn-v2.scope-inference-request-result.v1",
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
      "Apply responses with --scope-output."
    ]
  };
}

export function parseLearnV2LlmScopeInferenceOutput(text: string): LearnV2LlmScopeInferenceOutput {
  return LearnV2LlmScopeInferenceOutputSchema.parse(JSON.parse(extractFirstJsonObject(text)));
}

export async function applyLearnV2ScopeInferenceOutputs(
  rootInput: string,
  outputPathsInput: string[],
  now = new Date()
): Promise<LearnV2ScopeInferenceApplyResult> {
  const root = path.resolve(rootInput);
  const config = await readProjectConfig(root);
  const store = await readLearnV2ConceptStore(root, now);
  const byId = new Map(store.cards.map((card) => [card.id, card]));
  const rejected: LearnV2ScopeInferenceApplyResult["rejected"] = [];
  const outputFiles = (await Promise.all(outputPathsInput.map((file) => resolveScopeOutputInputPath(root, file, rejected)))).filter((file): file is string => Boolean(file));
  const updated = new Map<string, LearnV2ConceptCard>();

  for (const outputPath of outputFiles) {
    const manifest = await readScopeRequestManifest(root, outputPath, rejected);
    if (!manifest) continue;
    const text = await fs.readFile(outputPath, "utf8").catch((error: unknown) => {
      rejected.push({ outputPath, id: "file", reason: "read-failed", detail: error instanceof Error ? error.message : String(error) });
      return undefined;
    });
    if (text === undefined) continue;
    let parsed: LearnV2LlmScopeInferenceOutput;
    try {
      parsed = parseLearnV2LlmScopeInferenceOutput(text);
    } catch (error) {
      rejected.push({ outputPath, id: "file", reason: "invalid-json-or-schema", detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const conceptId = manifest.conceptId ?? manifest.episodeId;
    const card = byId.get(conceptId);
    if (!card) {
      rejected.push({ outputPath, id: "file", reason: "stale-request-manifest", detail: `Unknown concept ${conceptId}` });
      continue;
    }
    const validation = validateLearnV2ScopeInferenceForCard(root, config, card, parsed);
    if (!validation.ok) {
      rejected.push({ outputPath, id: card.id, reason: validation.reason, detail: validation.detail });
      continue;
    }
    const next = mergeScopeInference(card, validation.output, now);
    byId.set(card.id, next);
    updated.set(card.id, next);
  }

  const written = await writeLearnV2ConceptStore(root, [...byId.values()], now);
  const conflictLedger = await writeLearnV2ConflictLedger(root, written.cards, config.projectId, now);
  const conceptDrift = await detectLearnV2ConceptDrift(root, written.cards, { now });
  const episodes = await readLocalEpisodeStore(root).then((item) => item.episodes, () => []);
  const declassifiedSnippets = episodes.length
    ? await writeLearnV2DeclassifiedSnippetArtifact(root, episodes, now, { blockOnMediumRisk: true, maxChars: 700, maxSnippets: 200 })
    : undefined;
  const reviewQueue = await writeLearnV2ReviewQueue(root, written.cards, now, {
    ledger: conflictLedger.ledger,
    markdownPath: conflictLedger.artifactPaths.markdown,
    declassifiedSnippets,
    conceptDrift
  });

  return {
    schemaVersion: "openskill-kit.learn-v2.scope-inference-apply-result.v1",
    appliedAt: now.toISOString(),
    outputFiles,
    updatedConceptIds: [...updated.keys()].sort(),
    rejected,
    conceptStorePath: path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json"),
    reviewQueuePath: reviewQueue.artifacts.markdown,
    conflictLedgerPath: conflictLedger.artifactPaths.markdown,
    declassifiedSnippetsPath: declassifiedSnippets?.artifacts.markdown,
    conceptDriftPath: conceptDrift.artifactPath
  };
}

export function validateLearnV2ScopeInferenceForCard(
  root: string,
  config: Awaited<ReturnType<typeof readProjectConfig>>,
  card: LearnV2ConceptCard,
  output: LearnV2LlmScopeInferenceOutput
): { ok: true; output: LearnV2LlmScopeInferenceOutput } | { ok: false; reason: string; detail: string } {
  if (output.conceptId !== card.id) return { ok: false, reason: "concept-id-mismatch", detail: `Expected ${card.id}.` };
  const boundary = validateLearnV2ModelOutputBoundary(root, config, output);
  if (!boundary.ok) return boundary;
  const evidenceIds = new Set(card.evidenceIds);
  const badCounterevidence = output.counterevidence.find((item) => !evidenceIds.has(item.evidenceId));
  if (badCounterevidence) return { ok: false, reason: "invalid-counterevidence", detail: `Unknown evidence id ${badCounterevidence.evidenceId}` };
  const reviewLockedChange = findReviewLockedScopeChange(card, output);
  if (reviewLockedChange) return { ok: false, reason: "review-locked-scope-change", detail: reviewLockedChange };
  const allowedPaths = card.scope.reviewLocked
    ? card.scope.paths
    : uniqueStrings([
      ...card.scope.paths,
      ...card.atoms.flatMap((atom) => atom.scope.paths)
    ]);
  const badPath = output.scope.paths.find((item) => !isSafeRelativePath(item) || !isWithinAllowedScope(item, allowedPaths));
  if (badPath) return { ok: false, reason: "scope-broadening-rejected", detail: `Unsafe or broader path: ${badPath}` };
  const badGlob = output.activation.pathGlobs.find((item) => !isSafeRelativeGlob(item) || !isGlobWithinAllowedScope(item, allowedPaths));
  if (badGlob) return { ok: false, reason: "scope-broadening-rejected", detail: `Unsafe or broader path glob: ${badGlob}` };
  const badCommand = output.activation.commands.find((item) => /(?:&&|\|\||;|>|<|\$\(|`)/.test(item) || item.length > 160);
  if (badCommand) return { ok: false, reason: "unsafe-command-trigger", detail: `Unsafe command activation hint: ${badCommand}` };
  return { ok: true, output };
}

function buildLearnV2ConceptScopeBundle(card: LearnV2ConceptCard): LearnV2ScopeBundle {
  return {
    schemaVersion: "openskill-kit.learn-v2.concept-scope-bundle.v1",
    conceptId: card.id,
    title: card.title,
    canonicalBehavior: card.canonicalBehavior,
    behaviorDelta: card.behaviorDelta,
    status: card.status,
    risk: card.risk,
    confidence: card.confidence,
    scope: card.scope,
    activation: card.activation,
    conditions: card.conditions,
    evidenceIds: card.evidenceIds,
    atomSummaries: card.atoms.slice(0, 12).map((atom) => ({
      statement: atom.statement,
      kind: atom.kind,
      polarity: atom.polarity,
      scope: {
        level: atom.scope.level,
        paths: atom.scope.paths,
        taskTypes: atom.scope.taskTypes,
        negativeTriggers: atom.activationHints?.negativeTriggers ?? []
      },
      evidenceIds: atom.evidenceIds
    }))
  };
}

function renderLearnV2ScopeInferencePrompt(bundle: LearnV2ScopeBundle): string {
  return [
    "# OpenSkillKit Learn v2 scope inference",
    "",
    "Infer precise activation scope for one existing Concept Card.",
    "",
    "Return strict JSON only with schemaVersion openskill-kit.learn-v2.llm-scope-inference-output.v1.",
    "Do not quote raw transcripts, raw refs, secrets, local absolute paths, usernames, or machine-local paths.",
    "Only narrow or clarify scope. Do not propose broader paths than existing card/atom paths.",
    bundle.scope.reviewLocked ? "This concept has a reviewer-locked scope. You may add appliesWhen/doesNotApplyWhen only; do not add or change paths, task types, activation phrases, path globs, commands, or negative triggers." : "",
    "Prefer useful appliesWhen, doesNotApplyWhen, activation phrases, pathGlobs, commands, and negativeTriggers.",
    "Use cited evidenceIds only from the bundle when adding counterevidence.",
    "",
    "Expected shape:",
    JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-scope-inference-output.v1",
      conceptId: bundle.conceptId,
      appliesWhen: ["Task is changing parser behavior."],
      doesNotApplyWhen: ["Task only updates docs or unrelated UI copy."],
      scope: { level: "path", paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] },
      activation: {
        phrases: ["parser regression fixture"],
        pathGlobs: ["packages/core/src/**"],
        commands: ["npm test -- parser"],
        negativeTriggers: ["docs-only task"]
      },
      counterevidence: [{ evidenceId: bundle.evidenceIds[0] ?? "ev_...", reason: "Evidence limits this to parser behavior." }],
      confidence: 0.74,
      rationale: "Brief grounded reason.",
      rejected: []
    }, null, 2),
    "",
    "ConceptScopeBundle:",
    JSON.stringify(bundle, null, 2)
  ].join("\n");
}

function routeLearnV2ConceptForScopeInference(card: LearnV2ConceptCard): ScopeRoutingDecision {
  const reasons = new Set<string>();
  if (["rejected", "one-off", "superseded"].includes(card.status)) return { decision: "skip", priority: 0, reasons: ["inactive-concept-status"] };
  if (!card.conditions?.appliesWhen?.length || !card.conditions.doesNotApplyWhen.length) reasons.add("missing-conditions");
  if (!card.scope.reviewLocked) {
    if (!card.scope.negativeTriggers.length) reasons.add("missing-negative-triggers");
    if (card.activation.phrases.length < 3) reasons.add("thin-activation-phrases");
    if (card.scope.paths.length > 3 || card.scope.level === "project") reasons.add("broad-or-unclear-scope");
    if (card.status === "active" || card.status === "locked") reasons.add("reviewed-concept-high-impact");
    if (card.risk !== "low") reasons.add("non-low-risk-scope-needs-review");
  } else if (!reasons.size) {
    return { decision: "skip", priority: 0.2, reasons: ["reviewer-scope-locked"] };
  } else {
    reasons.add("reviewer-scope-locked-conditions-only");
  }
  const priority = Math.min(1, Number((
    0.2
    + Math.min(0.35, reasons.size * 0.08)
    + (card.status === "active" || card.status === "locked" ? 0.14 : 0)
    + (card.scope.level === "project" ? 0.16 : 0)
    + (card.risk === "high" ? 0.14 : card.risk === "medium" ? 0.08 : 0)
  ).toFixed(2)));
  if (!reasons.size) return { decision: "skip", priority, reasons: ["scope-already-rich"] };
  if (priority < 0.3) return { decision: "skip", priority, reasons: [...reasons, "low-routing-priority"] };
  return { decision: "request", priority, reasons: [...reasons].sort() };
}

function mergeScopeInference(card: LearnV2ConceptCard, output: LearnV2LlmScopeInferenceOutput, now: Date): LearnV2ConceptCard {
  const preserveReviewedScope = card.scope.reviewLocked === true;
  const nextPaths = preserveReviewedScope ? card.scope.paths : output.scope.paths.length ? uniqueStrings(output.scope.paths).slice(0, 20) : card.scope.paths;
  const nextTaskTypes = preserveReviewedScope ? card.scope.taskTypes : uniqueStrings([...card.scope.taskTypes, ...output.scope.taskTypes]).slice(0, 16);
  const appliesWhen = uniqueStrings([...(card.conditions?.appliesWhen ?? []), ...output.appliesWhen]).slice(0, 24);
  const doesNotApplyWhen = uniqueStrings([...(card.conditions?.doesNotApplyWhen ?? []), ...output.doesNotApplyWhen]).slice(0, 24);
  return LearnV2ConceptCardSchema.parse({
    ...card,
    scope: {
      level: preserveReviewedScope ? card.scope.level : output.scope.level ?? (nextPaths.length ? "path" : card.scope.level),
      paths: nextPaths,
      taskTypes: nextTaskTypes,
      negativeTriggers: preserveReviewedScope ? card.scope.negativeTriggers : uniqueStrings([
        ...card.scope.negativeTriggers,
        ...output.activation.negativeTriggers,
        ...doesNotApplyWhen
      ]).slice(0, 32),
      reviewLocked: card.scope.reviewLocked,
      reviewedAt: card.scope.reviewedAt
    },
    activation: {
      phrases: preserveReviewedScope ? card.activation.phrases : uniqueStrings([...card.activation.phrases, ...output.activation.phrases, ...appliesWhen]).slice(0, 32),
      pathGlobs: preserveReviewedScope ? card.activation.pathGlobs : uniqueStrings([...card.activation.pathGlobs, ...output.activation.pathGlobs]).slice(0, 32),
      commands: preserveReviewedScope ? card.activation.commands : uniqueStrings([...card.activation.commands, ...output.activation.commands]).slice(0, 20)
    },
    conditions: appliesWhen.length || doesNotApplyWhen.length ? { appliesWhen, doesNotApplyWhen } : card.conditions,
    counterevidence: uniqueCounterevidence([...card.counterevidence, ...output.counterevidence]).slice(0, 32),
    lifecycle: { ...card.lifecycle, updatedAt: now.toISOString() }
  });
}

function findReviewLockedScopeChange(card: LearnV2ConceptCard, output: LearnV2LlmScopeInferenceOutput): string | undefined {
  if (!card.scope.reviewLocked) return undefined;
  if (output.scope.level && output.scope.level !== card.scope.level) return `Reviewer-locked scope level is ${card.scope.level}; proposed ${output.scope.level}.`;
  if (output.scope.paths.length && !isSubsetOfExisting(output.scope.paths, card.scope.paths)) return "Reviewer-locked paths cannot be changed by scope inference.";
  if (output.scope.taskTypes.length && !isSubsetOfExisting(output.scope.taskTypes, card.scope.taskTypes)) return "Reviewer-locked task types cannot be changed by scope inference.";
  if (output.activation.phrases.length && !isSubsetOfExisting(output.activation.phrases, card.activation.phrases)) return "Reviewer-locked activation phrases cannot be changed by scope inference.";
  if (output.activation.pathGlobs.length && !isSubsetOfExisting(output.activation.pathGlobs, card.activation.pathGlobs)) return "Reviewer-locked path globs cannot be changed by scope inference.";
  if (output.activation.commands.length && !isSubsetOfExisting(output.activation.commands, card.activation.commands)) return "Reviewer-locked commands cannot be changed by scope inference.";
  if (output.activation.negativeTriggers.length && !isSubsetOfExisting(output.activation.negativeTriggers, card.scope.negativeTriggers)) return "Reviewer-locked negative triggers cannot be changed by scope inference.";
  return undefined;
}

async function readScopeRequestManifest(
  root: string,
  outputPath: string,
  rejected: LearnV2ScopeInferenceApplyResult["rejected"]
): Promise<Record<string, any> | undefined> {
  const manifestPath = path.join(path.dirname(outputPath), "request-manifest.json");
  if (!isLearnV2ModelRequestOutputPath(root, outputPath) || !isLearnV2ModelRequestManifestPath(root, manifestPath)) {
    rejected.push({ outputPath, id: "file", reason: "unexpected-request-file-path" });
    return undefined;
  }
  const text = await fs.readFile(manifestPath, "utf8").catch(() => undefined);
  if (!text) {
    rejected.push({ outputPath, id: "file", reason: "missing-request-manifest" });
    return undefined;
  }
  const manifest = JSON.parse(text) as Record<string, any>;
  const expectedOutput = resolveManifestProjectPath(root, String(manifest.expectedOutputPath ?? ""));
  if (!expectedOutput || !isLearnV2ModelRequestOutputPath(root, expectedOutput)) {
    rejected.push({ outputPath, id: "file", reason: "unexpected-request-file-path" });
    return undefined;
  }
  if (expectedOutput !== path.resolve(outputPath)) {
    rejected.push({ outputPath, id: "file", reason: "unexpected-output-path", detail: `Expected ${expectedOutput}` });
    return undefined;
  }
  if (
    manifest.schemaVersion !== "openskill-kit.learn-v2.model-request-manifest.v1" ||
    manifest.modelRole !== "scope-inferencer" ||
    manifest.outputSchema !== "openskill-kit.learn-v2.llm-scope-inference-output.v1" ||
    manifest.opencodeAgentId !== "osk-learn-v2-scope-inferencer" ||
    manifest.executionBoundary !== "opencode-host-sanitized-only" ||
    manifest.rawRefsIncluded !== false
  ) {
    rejected.push({ outputPath, id: "file", reason: "invalid-request-manifest" });
    return undefined;
  }
  const requestDir = path.dirname(manifestPath);
  const promptPath = resolveManifestProjectPath(root, String(manifest.promptPath));
  const bundlePath = resolveManifestProjectPath(root, String(manifest.bundlePath));
  if (!promptPath || !bundlePath) {
    rejected.push({ outputPath, id: "file", reason: "unexpected-request-file-path" });
    return undefined;
  }
  if (path.dirname(promptPath) !== requestDir || path.basename(promptPath) !== "scope-inference-prompt.md" || path.dirname(bundlePath) !== requestDir || path.basename(bundlePath) !== "concept-scope-bundle.json") {
    rejected.push({ outputPath, id: "file", reason: "unexpected-request-file-path" });
    return undefined;
  }
  const [promptText, bundleText] = await Promise.all([
    fs.readFile(promptPath, "utf8").catch(() => undefined),
    fs.readFile(bundlePath, "utf8").catch(() => undefined)
  ]);
  if (promptText === undefined || bundleText === undefined) {
    rejected.push({ outputPath, id: "file", reason: "missing-request-file" });
    return undefined;
  }
  if (learnV2Hash(promptText) !== manifest.promptHash || learnV2Hash(bundleText) !== manifest.bundleHash) {
    rejected.push({ outputPath, id: "file", reason: "request-file-hash-mismatch" });
    return undefined;
  }
  return manifest;
}

async function resolveScopeOutputInputPath(root: string, inputPath: string, rejected: LearnV2ScopeInferenceApplyResult["rejected"]): Promise<string | undefined> {
  const absolute = path.resolve(root, inputPath);
  if (path.basename(absolute) !== "request-manifest.json") {
    if (!isLearnV2ModelRequestOutputPath(root, absolute)) {
      rejected.push({ outputPath: absolute, id: "file", reason: "unexpected-request-file-path" });
      return undefined;
    }
    return absolute;
  }
  if (!isLearnV2ModelRequestManifestPath(root, absolute)) {
    rejected.push({ outputPath: absolute, id: "file", reason: "request-manifest-outside-model-requests" });
    return undefined;
  }
  const text = await fs.readFile(absolute, "utf8").catch(() => undefined);
  if (!text) return undefined;
  const manifest = JSON.parse(text) as { expectedOutputPath?: string };
  const outputPath = resolveManifestProjectPath(root, manifest.expectedOutputPath);
  if (!outputPath || !isLearnV2ModelRequestOutputPath(root, outputPath)) {
    rejected.push({ outputPath: absolute, id: "file", reason: "unexpected-request-file-path" });
    return undefined;
  }
  return outputPath;
}

function learnV2ProjectRelativePath(root: string, file: string): string {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
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

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
}

async function readLocalEpisodeStore(root: string): Promise<{ episodes: any[] }> {
  const file = path.join(root, ".openskill-kit", "learn-v2", "episodes", "store.json");
  const text = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(text) as { episodes?: any[] };
  return { episodes: parsed.episodes ?? [] };
}

function isSafeRelativePath(value: string): boolean {
  return Boolean(value)
    && !path.isAbsolute(value)
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !value.startsWith("..")
    && !value.includes("\\")
    && !/[\[\]*?{}]/.test(value)
    && !/(^|\/)\.\.(\/|$)/.test(value);
}

function isSafeRelativeGlob(value: string): boolean {
  return Boolean(value)
    && !path.isAbsolute(value)
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !value.startsWith("..")
    && !value.includes("\\")
    && !/[\[\]{}]/.test(value)
    && !/(^|\/)\.\.(\/|$)/.test(value);
}

function isWithinAllowedScope(value: string, allowedPaths: string[]): boolean {
  if (!allowedPaths.length) return false;
  const normalized = normalizeScopePath(value);
  return allowedPaths.some((allowed) => isSameOrDescendant(normalized, normalizeScopePath(allowed)));
}

function isGlobWithinAllowedScope(value: string, allowedPaths: string[]): boolean {
  if (!allowedPaths.length) return false;
  const prefix = normalizeScopePath(value.split(/[*?]/)[0] ?? "").replace(/\/+$/, "");
  if (!prefix) return false;
  return allowedPaths.some((allowed) => isSameOrDescendant(prefix, normalizeScopePath(allowed)));
}

function isSameOrDescendant(value: string, allowed: string): boolean {
  return value === allowed || value.startsWith(`${allowed.replace(/\/+$/, "")}/`);
}

function normalizeScopePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function isSubsetOfExisting(values: string[], existing: string[]): boolean {
  const allowed = new Set(existing.map(normalizeComparableString));
  return values.every((value) => allowed.has(normalizeComparableString(value)));
}

function normalizeComparableString(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\s+/g, " ").toLowerCase();
}

function uniqueCounterevidence(values: LearnV2ConceptCard["counterevidence"]): LearnV2ConceptCard["counterevidence"] {
  const byKey = new Map<string, LearnV2ConceptCard["counterevidence"][number]>();
  for (const item of values) byKey.set(`${item.evidenceId}\0${item.reason}`, item);
  return [...byKey.values()];
}
