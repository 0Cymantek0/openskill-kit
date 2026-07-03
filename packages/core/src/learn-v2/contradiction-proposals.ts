import { promises as fs } from "node:fs";
import path from "node:path";
import { readProjectConfig } from "../events/store.js";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";
import { writeLearnV2ConflictLedger, type DetectedConflict, detectLearnV2ConceptConflicts } from "./conflicts.js";
import { writeLearnV2DeclassifiedSnippetArtifact } from "./declassify.js";
import { detectLearnV2ConceptDrift } from "./drift.js";
import { extractFirstJsonObject } from "./extract.js";
import { ensureLearnV2ModelRoutingArtifacts } from "./model-routing.js";
import { writeLearnV2ReviewQueue } from "./review.js";
import {
  LearnV2LlmContradictionReviewOutputSchema,
  type LearnV2ConceptCard,
  type LearnV2LlmContradictionReviewOutput
} from "./schemas.js";
import { applyLearnV2ConceptReview, readLearnV2ConceptStore, type LearnV2ConceptReviewOptions } from "./store.js";
import { learnV2DeclassifyText, learnV2Hash, learnV2ShortHash } from "./utils.js";

export interface LearnV2ContradictionReviewRequest {
  reviewId: string;
  conceptIds: string[];
  bundlePath: string;
  promptPath: string;
  promptHash: string;
  bundleHash: string;
  manifestPath: string;
  expectedOutputPath: string;
  outputSchema: "openskill-kit.learn-v2.llm-contradiction-review-output.v1";
  opencodeAgentId: string;
  agentFile: string;
  routing: { decision: "request"; priority: number; reasons: string[] };
}

export interface LearnV2ContradictionReviewRequestResult {
  schemaVersion: "openskill-kit.learn-v2.contradiction-review-request-result.v1";
  generatedAt: string;
  requestCount: number;
  requests: LearnV2ContradictionReviewRequest[];
  skippedConflicts: Array<{ conflictId: string; conceptIds: string[]; decision: "skip"; priority: number; reasons: string[] }>;
  routingManifestPath: string;
  modelRoutingArtifactPath: string;
  opencodeAgentIndexPath: string;
  instructions: string[];
}

export interface LearnV2ContradictionReviewApplyResult {
  schemaVersion: "openskill-kit.learn-v2.contradiction-review-apply-result.v1";
  appliedAt: string;
  outputFiles: string[];
  appliedCounterevidence: number;
  appliedSupersessions: number;
  appliedNarrowings: number;
  rejected: Array<{ outputPath: string; id: string; reason: string; detail?: string }>;
  reviewedCount: number;
  conceptStorePath: string;
  reviewQueuePath: string;
  conflictLedgerPath: string;
  declassifiedSnippetsPath?: string;
  conceptDriftPath: string;
}

interface ContradictionBundle {
  schemaVersion: "openskill-kit.learn-v2.contradiction-review-bundle.v1";
  reviewId: string;
  conflict: Pick<DetectedConflict, "id" | "conceptIds" | "conflictType" | "explanation" | "evidenceRefs" | "suggestedResolution" | "resolutionAction">;
  concepts: Array<{
    id: string;
    title: string;
    canonicalBehavior: string;
    status: LearnV2ConceptCard["status"];
    kind: string;
    polarity: string;
    confidence: number;
    durability: number;
    sourceReliability: number;
    risk: LearnV2ConceptCard["risk"];
    scope: LearnV2ConceptCard["scope"];
    activation: LearnV2ConceptCard["activation"];
    conditions: LearnV2ConceptCard["conditions"];
    evidenceIds: string[];
    counterevidence: LearnV2ConceptCard["counterevidence"];
    lifecycle: LearnV2ConceptCard["lifecycle"];
  }>;
}

type ContradictionManifest = {
  schemaVersion: "openskill-kit.learn-v2.model-request-manifest.v1";
  generatedAt: string;
  episodeId: string;
  reviewId?: string;
  conceptIds?: string[];
  modelRole: "contradiction-reviewer";
  routingPolicy: "learn-v2-roi-v1";
  routingReasons: string[];
  priority: number;
  promptPath: string;
  bundlePath: string;
  promptHash: string;
  bundleHash: string;
  expectedOutputPath: string;
  outputSchema: "openskill-kit.learn-v2.llm-contradiction-review-output.v1";
  opencodeAgentId: "osk-learn-v2-contradiction-reviewer";
  agentFile: string;
  modelRoutingArtifactPath: string;
  opencodeAgentIndexPath: string;
  executionBoundary: "opencode-host-sanitized-only";
  evidenceIds: string[];
  rawRefsIncluded: false;
};

export async function writeLearnV2ContradictionReviewRequests(
  rootInput: string,
  conceptIds: string[] = [],
  now = new Date()
): Promise<LearnV2ContradictionReviewRequestResult> {
  const root = path.resolve(rootInput);
  const config = await readProjectConfig(root);
  const store = await readLearnV2ConceptStore(root, now);
  const selected = new Set(conceptIds);
  const ledger = detectLearnV2ConceptConflicts(store.cards, config.projectId, now);
  const modelRouting = await ensureLearnV2ModelRoutingArtifacts(root, now);
  const agent = modelRouting.agents["contradiction-reviewer"];
  const requests: LearnV2ContradictionReviewRequest[] = [];
  const skippedConflicts: LearnV2ContradictionReviewRequestResult["skippedConflicts"] = [];

  for (const conflict of ledger.conflicts) {
    if (selected.size && !conflict.conceptIds.some((id) => selected.has(id))) continue;
    const cards = conflict.conceptIds.map((id) => store.cards.find((card) => card.id === id)).filter((card): card is LearnV2ConceptCard => Boolean(card));
    const routing = routeContradictionForReview(conflict, cards);
    if (routing.decision === "skip") {
      skippedConflicts.push({ conflictId: conflict.id, conceptIds: conflict.conceptIds, ...routing });
      continue;
    }
    const reviewId = `contradiction_${learnV2ShortHash(conflict.id)}`;
    const bundle = buildContradictionBundle(reviewId, conflict, cards);
    const prompt = renderContradictionReviewPrompt(bundle);
    const dir = path.join(learnV2ModelRequestsRoot(root), reviewId);
    const bundlePath = path.join(dir, "contradiction-review-bundle.json");
    const promptPath = path.join(dir, "contradiction-review-prompt.md");
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
      episodeId: reviewId,
      reviewId,
      conceptIds: conflict.conceptIds,
      modelRole: "contradiction-reviewer",
      routingPolicy: "learn-v2-roi-v1",
      routingReasons: routing.reasons,
      priority: routing.priority,
      promptPath: learnV2ProjectRelativePath(root, promptPath),
      bundlePath: learnV2ProjectRelativePath(root, bundlePath),
      promptHash,
      bundleHash,
      expectedOutputPath: learnV2ProjectRelativePath(root, expectedOutputPath),
      outputSchema: "openskill-kit.learn-v2.llm-contradiction-review-output.v1",
      opencodeAgentId: agent.opencodeAgentId,
      agentFile: agent.agentFile,
      modelRoutingArtifactPath: modelRouting.artifacts.routingJson,
      opencodeAgentIndexPath: modelRouting.artifacts.opencodeAgentIndex,
      executionBoundary: "opencode-host-sanitized-only",
      evidenceIds: conflict.evidenceRefs,
      rawRefsIncluded: false,
      instructions: [
        `Send contradiction-review-prompt.md to the OpenCode agent ${agent.opencodeAgentId}.`,
        `Agent definition: ${agent.agentFile}.`,
        "Save strict JSON output to response.json in this directory.",
        "Treat output as a proposal; deterministic ledger authority still controls supersede/narrow apply."
      ]
    });
    requests.push({
      reviewId,
      conceptIds: conflict.conceptIds,
      bundlePath,
      promptPath,
      promptHash,
      bundleHash,
      manifestPath,
      expectedOutputPath,
      outputSchema: "openskill-kit.learn-v2.llm-contradiction-review-output.v1",
      opencodeAgentId: agent.opencodeAgentId,
      agentFile: agent.agentFile,
      routing
    });
  }

  const routingManifestPath = path.join(learnV2ModelRequestsRoot(root), "contradiction-routing-manifest.json");
  await writeJsonAtomic(routingManifestPath, {
    schemaVersion: "openskill-kit.learn-v2.contradiction-review-routing-manifest.v1",
    generatedAt: now.toISOString(),
    routingPolicy: "learn-v2-roi-v1",
    modelRoutingArtifactPath: modelRouting.artifacts.routingJson,
    opencodeAgentIndexPath: modelRouting.artifacts.opencodeAgentIndex,
    opencodeAgentId: agent.opencodeAgentId,
    agentFile: agent.agentFile,
    requestedConflictCount: requests.length,
    skippedConflictCount: skippedConflicts.length,
    requests: requests.map((request) => ({
      reviewId: request.reviewId,
      conceptIds: request.conceptIds,
      priority: request.routing.priority,
      reasons: request.routing.reasons,
      opencodeAgentId: request.opencodeAgentId,
      agentFile: request.agentFile,
      manifestPath: learnV2ProjectRelativePath(root, request.manifestPath)
    })),
    skippedConflicts
  });

  return {
    schemaVersion: "openskill-kit.learn-v2.contradiction-review-request-result.v1",
    generatedAt: now.toISOString(),
    requestCount: requests.length,
    requests,
    skippedConflicts,
    routingManifestPath,
    modelRoutingArtifactPath: path.join(root, modelRouting.artifacts.routingJson),
    opencodeAgentIndexPath: path.join(root, modelRouting.artifacts.opencodeAgentIndex),
    instructions: [
      `Give each prompt to OpenCode agent ${agent.opencodeAgentId}.`,
      `Use generated agent definition ${agent.agentFile}.`,
      "Save strict JSON response to response.json.",
      "Apply responses with the contradiction-review output apply command/tool."
    ]
  };
}

export function parseLearnV2LlmContradictionReviewOutput(text: string): LearnV2LlmContradictionReviewOutput {
  return LearnV2LlmContradictionReviewOutputSchema.parse(JSON.parse(extractFirstJsonObject(text)));
}

export async function applyLearnV2ContradictionReviewOutputs(
  rootInput: string,
  outputPathsInput: string[],
  now = new Date()
): Promise<LearnV2ContradictionReviewApplyResult> {
  const root = path.resolve(rootInput);
  const config = await readProjectConfig(root);
  const outputFiles = (await Promise.all(outputPathsInput.map((file) => resolveContradictionOutputInputPath(root, file)))).filter((file): file is string => Boolean(file));
  const rejected: LearnV2ContradictionReviewApplyResult["rejected"] = [];
  const addCounterevidence: NonNullable<LearnV2ConceptReviewOptions["addCounterevidence"]> = [];
  const supersedeConcepts: NonNullable<LearnV2ConceptReviewOptions["supersedeConcepts"]> = [];
  const narrowScopes: NonNullable<LearnV2ConceptReviewOptions["narrowScopes"]> = [];

  for (const outputPath of outputFiles) {
    const manifest = await readContradictionRequestManifest(root, outputPath, rejected);
    if (!manifest) continue;
    const text = await fs.readFile(outputPath, "utf8").catch((error: unknown) => {
      rejected.push({ outputPath, id: "file", reason: "read-failed", detail: error instanceof Error ? error.message : String(error) });
      return undefined;
    });
    if (text === undefined) continue;
    let parsed: LearnV2LlmContradictionReviewOutput;
    try {
      parsed = parseLearnV2LlmContradictionReviewOutput(text);
    } catch (error) {
      rejected.push({ outputPath, id: "file", reason: "invalid-json-or-schema", detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const validation = await validateLearnV2ContradictionReviewForManifest(root, config, manifest, parsed);
    if (!validation.ok) {
      rejected.push({ outputPath, id: parsed.reviewId, reason: validation.reason, detail: validation.detail });
      continue;
    }
    for (const finding of validation.output.findings) {
      if (finding.requiresHumanReview) {
        rejected.push({ outputPath, id: finding.id ?? finding.kind, reason: "requires-human-review", detail: finding.rationale });
        continue;
      }
      for (const item of finding.counterevidence) addCounterevidence.push({
        id: item.conceptId,
        evidenceId: item.evidenceId,
        reason: item.reason
      });
      if (finding.supersession) supersedeConcepts.push(finding.supersession);
      narrowScopes.push(...finding.narrowScopes.map((item) => ({
        id: item.conceptId,
        paths: item.paths,
        taskTypes: item.taskTypes,
        negativeTriggers: item.negativeTriggers
      })));
    }
  }

  const reviewed = addCounterevidence.length || supersedeConcepts.length || narrowScopes.length
    ? await applyLearnV2ConceptReview(root, {
        addCounterevidence,
        supersedeConcepts,
        narrowScopes,
        now
      })
    : await applyLearnV2ConceptReview(root, { compileActive: false, now });
  const store = await readLearnV2ConceptStore(root, now);
  const conflictLedger = await writeLearnV2ConflictLedger(root, store.cards, config.projectId, now);
  const conceptDrift = await detectLearnV2ConceptDrift(root, store.cards, { now });
  const episodes = await readLocalEpisodeStore(root).then((item) => item.episodes, () => []);
  const declassifiedSnippets = episodes.length
    ? await writeLearnV2DeclassifiedSnippetArtifact(root, episodes, now, { blockOnMediumRisk: true, maxChars: 700, maxSnippets: 200 })
    : undefined;
  const reviewQueue = await writeLearnV2ReviewQueue(root, store.cards, now, {
    ledger: conflictLedger.ledger,
    markdownPath: conflictLedger.artifactPaths.markdown,
    declassifiedSnippets,
    conceptDrift
  });

  return {
    schemaVersion: "openskill-kit.learn-v2.contradiction-review-apply-result.v1",
    appliedAt: now.toISOString(),
    outputFiles,
    appliedCounterevidence: addCounterevidence.length,
    appliedSupersessions: supersedeConcepts.length,
    appliedNarrowings: narrowScopes.length,
    rejected,
    reviewedCount: reviewed.reviewedCount,
    conceptStorePath: path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json"),
    reviewQueuePath: reviewQueue.artifacts.markdown,
    conflictLedgerPath: conflictLedger.artifactPaths.markdown,
    declassifiedSnippetsPath: declassifiedSnippets?.artifacts.markdown,
    conceptDriftPath: conceptDrift.artifactPath
  };
}

export async function validateLearnV2ContradictionReviewForManifest(
  root: string,
  config: Awaited<ReturnType<typeof readProjectConfig>>,
  manifest: ContradictionManifest,
  output: LearnV2LlmContradictionReviewOutput
): Promise<{ ok: true; output: LearnV2LlmContradictionReviewOutput } | { ok: false; reason: string; detail: string }> {
  if (output.reviewId !== (manifest.reviewId ?? manifest.episodeId)) return { ok: false, reason: "review-id-mismatch", detail: `Expected ${manifest.reviewId ?? manifest.episodeId}.` };
  const declassified = learnV2DeclassifyText(JSON.stringify(output), root, config);
  if (declassified.matches.length) return { ok: false, reason: "unsafe-output-content", detail: `Declassification would redact: ${declassified.matches.slice(0, 5).join(", ")}` };
  const store = await readLearnV2ConceptStore(root);
  const cardsById = new Map(store.cards.map((card) => [card.id, card]));
  const allowedConceptIds = new Set(manifest.conceptIds ?? []);
  const allowedEvidenceIds = new Set((manifest.conceptIds ?? []).flatMap((conceptId) => cardsById.get(conceptId)?.evidenceIds ?? []));
  const ledger = detectLearnV2ConceptConflicts(store.cards, config.projectId, new Date(manifest.generatedAt));

  for (const [index, finding] of output.findings.entries()) {
    const id = finding.id ?? `finding_${index}`;
    if (finding.conceptIds.some((conceptId) => !allowedConceptIds.has(conceptId))) return { ok: false, reason: "unexpected-concept-id", detail: `${id} cites concept outside request.` };
    if (finding.evidenceIds.some((evidenceId) => !allowedEvidenceIds.has(evidenceId))) return { ok: false, reason: "invalid-evidence-id", detail: `${id} cites evidence outside request.` };
    for (const item of finding.counterevidence) {
      if (!allowedConceptIds.has(item.conceptId) || !allowedEvidenceIds.has(item.evidenceId)) return { ok: false, reason: "invalid-counterevidence", detail: `${id} cites invalid counterevidence.` };
    }
    if (finding.supersession) {
      const check = validateSupersession(finding.supersession, ledger.conflicts, cardsById);
      if (!check.ok) return { ok: false, reason: "unsafe-supersession", detail: `${id}: ${check.detail}` };
    }
    for (const narrow of finding.narrowScopes) {
      const card = cardsById.get(narrow.conceptId);
      if (!card || !allowedConceptIds.has(narrow.conceptId)) return { ok: false, reason: "invalid-narrow-scope", detail: `${id} narrows unknown concept.` };
      if (narrow.paths?.some((item) => !isSafeRelativePath(item) || !isWithinAllowedScope(item, card.scope.paths))) return { ok: false, reason: "invalid-narrow-scope", detail: `${id} proposes broader or unsafe path.` };
      const pairConflict = findConflictForConcepts(ledger.conflicts, finding.conceptIds);
      if (!pairConflict || pairConflict.resolutionAction !== "auto-narrow") return { ok: false, reason: "unsafe-narrowing", detail: `${id} lacks deterministic auto-narrow ledger authority.` };
    }
  }
  return { ok: true, output };
}

function validateSupersession(
  supersession: NonNullable<LearnV2LlmContradictionReviewOutput["findings"][number]["supersession"]>,
  conflicts: DetectedConflict[],
  cardsById: Map<string, LearnV2ConceptCard>
): { ok: true } | { ok: false; detail: string } {
  const superseded = cardsById.get(supersession.supersededId);
  const successor = cardsById.get(supersession.supersededById);
  if (!superseded || !successor) return { ok: false, detail: "unknown concept id" };
  if (superseded.status === "locked" || superseded.risk === "high" || superseded.atoms.some((atom) => atom.kind === "security")) return { ok: false, detail: "protected concept cannot be model-superseded" };
  if (successor.confidence < superseded.confidence + 0.1) return { ok: false, detail: "successor is not deterministically stronger" };
  const pairConflict = findConflictForConcepts(conflicts, [supersession.supersededId, supersession.supersededById]);
  if (!pairConflict || pairConflict.resolutionAction !== "auto-supersede") return { ok: false, detail: "missing deterministic auto-supersede ledger authority" };
  return { ok: true };
}

function buildContradictionBundle(reviewId: string, conflict: DetectedConflict, cards: LearnV2ConceptCard[]): ContradictionBundle {
  return {
    schemaVersion: "openskill-kit.learn-v2.contradiction-review-bundle.v1",
    reviewId,
    conflict: {
      id: conflict.id,
      conceptIds: conflict.conceptIds,
      conflictType: conflict.conflictType,
      explanation: conflict.explanation,
      evidenceRefs: conflict.evidenceRefs,
      suggestedResolution: conflict.suggestedResolution,
      resolutionAction: conflict.resolutionAction
    },
    concepts: cards.map((card) => ({
      id: card.id,
      title: card.title,
      canonicalBehavior: card.canonicalBehavior,
      status: card.status,
      kind: card.atoms[0]?.kind ?? "unknown",
      polarity: card.atoms[0]?.polarity ?? "neutral",
      confidence: card.confidence,
      durability: card.durability,
      sourceReliability: card.sourceReliability,
      risk: card.risk,
      scope: card.scope,
      activation: card.activation,
      conditions: card.conditions,
      evidenceIds: card.evidenceIds,
      counterevidence: card.counterevidence,
      lifecycle: card.lifecycle
    }))
  };
}

function renderContradictionReviewPrompt(bundle: ContradictionBundle): string {
  return [
    "# OpenSkillKit Learn v2 contradiction review",
    "",
    "Review one deterministic concept-conflict bundle.",
    "",
    "Return strict JSON only with schemaVersion openskill-kit.learn-v2.llm-contradiction-review-output.v1.",
    "Do not quote raw transcripts, raw refs, secrets, local absolute paths, usernames, or machine-local paths.",
    "Use only conceptIds and evidenceIds from the bundle.",
    "Set requiresHumanReview=true unless the finding is plainly grounded and the deterministic ledger already allows the action.",
    "Supersession and narrowing are proposals only; OpenSkillKit applies them only when deterministic validators allow the action.",
    "",
    "Expected shape:",
    JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-contradiction-review-output.v1",
      reviewId: bundle.reviewId,
      findings: [{
        kind: "counterevidence",
        conceptIds: bundle.conflict.conceptIds,
        evidenceIds: bundle.conflict.evidenceRefs.slice(0, 2),
        rationale: "Why cited evidence limits the concept.",
        counterevidence: [{
          conceptId: bundle.conflict.conceptIds[0] ?? "concept_...",
          evidenceId: bundle.conflict.evidenceRefs[0] ?? "ev_...",
          reason: "Specific limitation."
        }],
        requiresHumanReview: false
      }],
      rejected: []
    }, null, 2),
    "",
    "ContradictionReviewBundle:",
    JSON.stringify(bundle, null, 2)
  ].join("\n");
}

function routeContradictionForReview(conflict: DetectedConflict, cards: LearnV2ConceptCard[]): { decision: "request"; priority: number; reasons: string[] } | { decision: "skip"; priority: number; reasons: string[] } {
  const reasons = new Set<string>();
  if (conflict.resolved) return { decision: "skip", priority: 0, reasons: ["conflict-already-resolved"] };
  if (cards.length !== conflict.conceptIds.length) return { decision: "skip", priority: 0, reasons: ["missing-concept-card"] };
  if (conflict.resolutionAction === "auto-supersede") reasons.add("deterministic-auto-supersede-candidate");
  if (conflict.resolutionAction === "auto-narrow") reasons.add("deterministic-auto-narrow-candidate");
  if (conflict.resolutionAction === "manual") reasons.add("manual-conflict-needs-semantic-summary");
  if (cards.some((card) => card.status === "active" || card.status === "locked")) reasons.add("reviewed-concept-impact");
  if (cards.some((card) => card.risk !== "low")) reasons.add("non-low-risk-conflict");
  const priority = Math.min(1, Number((
    0.24
    + Math.min(0.32, reasons.size * 0.08)
    + (conflict.resolutionAction === "auto-supersede" ? 0.18 : 0)
    + (cards.some((card) => card.status === "active" || card.status === "locked") ? 0.14 : 0)
    + (cards.some((card) => card.risk === "high") ? 0.14 : cards.some((card) => card.risk === "medium") ? 0.08 : 0)
  ).toFixed(2)));
  if (!reasons.size) return { decision: "skip", priority, reasons: ["no-contradiction-review-roi-trigger"] };
  return { decision: "request", priority, reasons: [...reasons].sort() };
}

async function readContradictionRequestManifest(
  root: string,
  outputPath: string,
  rejected: LearnV2ContradictionReviewApplyResult["rejected"]
): Promise<ContradictionManifest | undefined> {
  const manifestPath = path.join(path.dirname(outputPath), "request-manifest.json");
  const text = await fs.readFile(manifestPath, "utf8").catch(() => undefined);
  if (!text) {
    rejected.push({ outputPath, id: "file", reason: "missing-request-manifest" });
    return undefined;
  }
  const manifest = JSON.parse(text) as ContradictionManifest;
  const expectedOutput = path.resolve(root, String(manifest.expectedOutputPath ?? ""));
  if (expectedOutput !== path.resolve(outputPath)) {
    rejected.push({ outputPath, id: "file", reason: "unexpected-output-path", detail: `Expected ${expectedOutput}` });
    return undefined;
  }
  if (
    manifest.schemaVersion !== "openskill-kit.learn-v2.model-request-manifest.v1" ||
    manifest.modelRole !== "contradiction-reviewer" ||
    manifest.outputSchema !== "openskill-kit.learn-v2.llm-contradiction-review-output.v1" ||
    manifest.opencodeAgentId !== "osk-learn-v2-contradiction-reviewer" ||
    manifest.executionBoundary !== "opencode-host-sanitized-only" ||
    manifest.rawRefsIncluded !== false ||
    !manifest.reviewId ||
    !Array.isArray(manifest.conceptIds)
  ) {
    rejected.push({ outputPath, id: "file", reason: "invalid-request-manifest" });
    return undefined;
  }
  const requestDir = path.dirname(manifestPath);
  const promptPath = path.resolve(root, manifest.promptPath);
  const bundlePath = path.resolve(root, manifest.bundlePath);
  if (path.dirname(promptPath) !== requestDir || path.basename(promptPath) !== "contradiction-review-prompt.md" || path.dirname(bundlePath) !== requestDir || path.basename(bundlePath) !== "contradiction-review-bundle.json") {
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

async function resolveContradictionOutputInputPath(root: string, inputPath: string): Promise<string | undefined> {
  const absolute = path.resolve(root, inputPath);
  if (path.basename(absolute) !== "request-manifest.json") return absolute;
  const text = await fs.readFile(absolute, "utf8").catch(() => undefined);
  if (!text) return undefined;
  const manifest = JSON.parse(text) as { expectedOutputPath?: string };
  return manifest.expectedOutputPath ? path.resolve(root, manifest.expectedOutputPath) : undefined;
}

function findConflictForConcepts(conflicts: DetectedConflict[], conceptIds: string[]): DetectedConflict | undefined {
  const wanted = [...conceptIds].sort().join("\0");
  return conflicts.find((conflict) => [...conflict.conceptIds].sort().join("\0") === wanted);
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

function isWithinAllowedScope(value: string, allowedPaths: string[]): boolean {
  if (!allowedPaths.length) return false;
  const normalized = normalizeScopePath(value);
  return allowedPaths.some((allowed) => {
    const allowedNormalized = normalizeScopePath(allowed);
    return normalized === allowedNormalized || normalized.startsWith(`${allowedNormalized}/`);
  });
}

function normalizeScopePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
}

function learnV2ProjectRelativePath(root: string, file: string): string {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
}

function learnV2ModelRequestsRoot(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "model-requests");
}

async function readLocalEpisodeStore(root: string): Promise<{ episodes: any[] }> {
  const file = path.join(root, ".openskill-kit", "learn-v2", "episodes", "store.json");
  const text = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(text) as { episodes?: any[] };
  return { episodes: parsed.episodes ?? [] };
}
