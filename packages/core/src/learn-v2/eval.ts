import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readProjectConfig } from "../events/store.js";
import {
  LearnV2EvalReportSchema,
  LearnV2LlmBehaviorEvalOutputSchema,
  type LearnV2ConceptCard,
  type LearnV2EvalReport,
  type LearnV2LlmBehaviorEvalOutput,
  type LearnV2TaskEpisode
} from "./schemas.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { scoreLearnV2ActivationEntries } from "./activation.js";
import { buildLearnV2ActivationIndexEntry, filterLearnV2ActivationEligibleConcepts } from "./activation-signals.js";
import { runLearnV2ConditionalLearning } from "./conditional-learning.js";
import { evaluateLearnV2ConceptQualityGates } from "./concept-quality-gates.js";
import { createLocalSandboxPolicy } from "../sandbox/policy.js";
import { runSandboxCommand, type SandboxCommandResult } from "../sandbox/runner.js";
import { ensureLearnV2ModelRoutingArtifacts } from "./model-routing.js";
import { scanLearnV2OutputArtifactBoundary, validateLearnV2ModelOutputBoundary } from "./output-boundary.js";
import { buildLearnV2OpenWorldGroundingAnchors } from "./resource-grounding.js";
import { readLearnV2ConceptStore } from "./store.js";
import { learnV2Hash, learnV2IsInside } from "./utils.js";

export const LearnV2ExtractionGoldenScenarioSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.extraction-golden.v1"),
  id: z.string().min(1),
  title: z.string().min(1),
  episodeIdIncludes: z.string().optional(),
  expectedConceptText: z.array(z.string().min(1)).default([]),
  expectedKinds: z.array(z.enum(["preference", "workflow", "security", "verification", "dependency-policy", "review-policy", "command-policy", "scope-boundary"])).default([]),
  expectedTaskHints: z.array(z.string().min(1)).default([]),
  expectedPathText: z.array(z.string().min(1)).default([]),
  forbiddenText: z.array(z.string().min(1)).default([])
});
export type LearnV2ExtractionGoldenScenario = z.infer<typeof LearnV2ExtractionGoldenScenarioSchema>;

export const LearnV2BehaviorDeltaGoldenScenarioSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.behavior-delta-golden.v1"),
  id: z.string().min(1),
  title: z.string().min(1),
  task: z.object({
    prompt: z.string().min(1),
    paths: z.array(z.string()).default([]),
    commands: z.array(z.string()).default([]),
    taskTypes: z.array(z.string()).default([]),
    negativeSignals: z.array(z.string()).default([])
  }),
  expectedConceptText: z.array(z.string().min(1)).default([]),
  expectedKinds: z.array(z.enum(["preference", "workflow", "security", "verification", "dependency-policy", "review-policy", "command-policy", "scope-boundary"])).default([]),
  expectedPlanIncludes: z.array(z.string().min(1)).default([]),
  expectedPlanExcludes: z.array(z.string().min(1)).default([]),
  minActivatedConcepts: z.number().int().min(0).default(1)
});
export type LearnV2BehaviorDeltaGoldenScenario = z.infer<typeof LearnV2BehaviorDeltaGoldenScenarioSchema>;

export interface LearnV2EvalOptions {
  goldensPath?: string;
  sandboxProbe?: boolean;
  allowUnreviewedProposal?: boolean;
  behaviorAgentEvalPath?: string;
}

export interface LearnV2EvalGoldenLoadOptions {
  allowUnreviewedProposal?: boolean;
}

export interface LearnV2BehaviorEvalRequest {
  evalId: string;
  promptPath: string;
  bundlePath: string;
  promptHash: string;
  bundleHash: string;
  manifestPath: string;
  expectedOutputPath: string;
  outputSchema: "openskill-kit.learn-v2.llm-behavior-eval-output.v1";
  opencodeAgentId: string;
  agentFile: string;
  scenarioCount: number;
}

export interface LearnV2BehaviorEvalRequestResult {
  schemaVersion: "openskill-kit.learn-v2.behavior-eval-request-result.v1";
  generatedAt: string;
  requestCount: number;
  requests: LearnV2BehaviorEvalRequest[];
  skipped: Array<{ id: string; reason: string; detail?: string }>;
  routingManifestPath: string;
  modelRoutingArtifactPath: string;
  opencodeAgentIndexPath: string;
  instructions: string[];
}

export interface LearnV2BehaviorEvalApplyResult {
  schemaVersion: "openskill-kit.learn-v2.behavior-eval-apply-result.v1";
  appliedAt: string;
  outputFiles: string[];
  resultCount: number;
  rejected: Array<{ outputPath: string; id: string; reason: string; detail?: string }>;
  artifactPath?: string;
  markdownPath?: string;
  status: "pass" | "fail" | "needs-review" | "not-run";
}

export interface LearnV2CounterfactualTraceEvalCase {
  schemaVersion: "openskill-kit.counterfactual-trace-eval-case.v1";
  id: string;
  conceptId: string;
  sourceEpisodeId?: string;
  taskPrompt: string;
  paths: string[];
  commands: string[];
  taskTypes: string[];
  expectedBehavior: string;
  negativeSignals: string[];
}

export interface LearnV2BehaviorDeltaEvalCase {
  schemaVersion: "openskill-kit.behavior-delta-eval-case.v1";
  id: string;
  title: string;
  taskPrompt: string;
  paths: string[];
  commands: string[];
  taskTypes: string[];
  activatedConceptIds: string[];
  activatedConceptText: string[];
  activatedKinds: LearnV2ConceptCard["atoms"][number]["kind"][];
  expectedConceptText: string[];
  expectedKinds: LearnV2ConceptCard["atoms"][number]["kind"][];
  baselinePlan: string[];
  withConceptPlan: string[];
  baselinePlanChars: number;
  withConceptPlanChars: number;
  tokenOverheadChars: number;
  tokenOverheadTokens: number;
  regressionFindings: string[];
  expectedPlanIncludes: string[];
  expectedPlanExcludes: string[];
  minActivatedConcepts: number;
}

type LearnV2EvalResultRow = LearnV2EvalReport["results"][number];
type LearnV2EvalSummary = LearnV2EvalReport["summary"];
type LearnV2BehaviorAgentEvalSummary = {
  status: "pass" | "fail" | "needs-review" | "not-run";
  resultCount: number;
  failedScenarioIds: string[];
  needsReviewScenarioIds: string[];
  artifactPath?: string;
};
type LearnV2BehaviorAgentEvalCheck = {
  result?: LearnV2EvalResultRow;
  summary: LearnV2BehaviorAgentEvalSummary;
};

const LearnV2BehaviorAgentEvalArtifactSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.behavior-agent-eval-artifact.v1"),
  generatedAt: z.string().datetime(),
  status: z.enum(["pass", "fail", "needs-review"]),
  agentExecuted: z.literal(true),
  sourceResponseHashes: z.array(z.string()).default([]),
  evals: z.array(z.object({
    evalId: z.string().min(1),
    resultCount: z.number().int().min(0),
    caseIds: z.array(z.string().min(1)).default([]),
    results: LearnV2LlmBehaviorEvalOutputSchema.shape.results,
    rejected: LearnV2LlmBehaviorEvalOutputSchema.shape.rejected.default([])
  })).default([])
});

export async function runLearnV2Eval(
  rootInput: string,
  episodes: LearnV2TaskEpisode[],
  concepts: LearnV2ConceptCard[],
  now: Date,
  options: LearnV2EvalOptions = {}
): Promise<LearnV2EvalReport> {
  const root = path.resolve(rootInput);
  const runDir = path.join(root, ".openskill-kit", "learn-v2", "evals", now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"));
  const json = path.join(runDir, "learn-v2-eval.json");
  const markdown = path.join(runDir, "learn-v2-eval.md");
  const counterfactualCasesPath = path.join(runDir, "counterfactual-trace-cases.json");
  const behaviorDeltaCasesPath = path.join(runDir, "behavior-delta-cases.json");
  const leakIssues = leakIssuesForConcepts(root, concepts);
  const goldenFile = options.goldensPath
    ? await loadLearnV2EvalGoldens(root, options.goldensPath, { allowUnreviewedProposal: options.allowUnreviewedProposal })
    : { extraction: [], behaviorDelta: [], unreviewedProposal: false };
  const goldens = goldenFile.extraction;
  const behaviorDeltaGoldens = goldenFile.behaviorDelta;
  const counterfactualCases = buildCounterfactualTraceCases(episodes, concepts);
  const behaviorDeltaCases = buildLearnV2BehaviorDeltaEvalCases(concepts, behaviorDeltaGoldens);
  const rawChars = episodes.reduce((sum, episode) => sum + episode.tokenBudget.inputChars, 0);
  const compressedChars = episodes.reduce((sum, episode) => sum + episode.tokenBudget.compressedChars, 0);
  const memoryAdmissionBoundary = evaluateMemoryAdmissionBoundary(concepts);
  const conditionalAdmissionBoundary = evaluateConditionalAdmissionBoundary(episodes);
  const openWorldGroundingBoundary = evaluateOpenWorldGroundingBoundary(concepts, now);
  const activationReplay = evaluateActivationReplay(episodes, concepts);
  const counterfactualTrace = evaluateCounterfactualTraceCases(concepts, counterfactualCases);
  const behaviorDeltaResults = behaviorDeltaCases.map((item) => evaluateBehaviorDeltaCase(item));
  const sandboxProbe = options.sandboxProbe
    ? await runLearnV2EvalSandboxProbe(root, runDir, behaviorDeltaCases, counterfactualCases)
    : undefined;
  const behaviorAgentEval: LearnV2BehaviorAgentEvalCheck = options.behaviorAgentEvalPath
    ? await evaluateLearnV2BehaviorAgentEvalArtifact(root, options.behaviorAgentEvalPath, behaviorDeltaCases)
    : { summary: emptyBehaviorAgentEvalSummary() };
  const results = [
    {
      id: "concept-evidence-grounding",
      status: concepts.every((concept) => concept.evidenceIds.length > 0 && concept.rawRefs.length > 0) ? "pass" as const : "fail" as const,
      checks: [{
        name: "evidence",
        status: concepts.every((concept) => concept.evidenceIds.length > 0 && concept.rawRefs.length > 0) ? "pass" as const : "fail" as const,
        details: `${concepts.length} concept(s) checked for local evidence refs`
      }]
    },
    {
      id: "candidate-compile-boundary",
      status: concepts.every((concept) => concept.status === "candidate" || concept.status === "staged" || concept.status === "conflict" || concept.status === "active" || concept.status === "locked") ? "pass" as const : "fail" as const,
      checks: [{
        name: "review-status",
        status: "pass" as const,
        details: "concept status is explicit; activation remains review-gated"
      }]
    },
    {
      id: "leak-check",
      status: leakIssues.length ? "fail" as const : "pass" as const,
      checks: [{
        name: "secret-and-path-patterns",
        status: leakIssues.length ? "fail" as const : "pass" as const,
        details: leakIssues.length ? leakIssues.join("; ") : "no raw secret/path patterns found in concept output"
      }]
    },
    evaluateLearnV2ConceptQualityGates(concepts),
    memoryAdmissionBoundary,
    conditionalAdmissionBoundary,
    openWorldGroundingBoundary,
    activationReplay.result,
    counterfactualTrace.result,
    ...(sandboxProbe ? [sandboxProbe.result] : []),
    ...(behaviorAgentEval.result ? [behaviorAgentEval.result] : []),
    ...behaviorDeltaResults,
    ...goldens.map((golden) => evaluateGolden(golden, episodes, concepts))
  ];
  const summary = summarizeLearnV2Eval(results, activationReplay.summary, counterfactualTrace.summary, behaviorDeltaCases, behaviorDeltaResults, behaviorAgentEval.summary);
  const report = LearnV2EvalReportSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.eval-report.v1",
    status: results.every((result) => result.status === "pass") ? "pass" : "fail",
    extractionGoldenCount: goldens.length,
    behaviorDeltaGoldenCount: behaviorDeltaGoldens.length,
    counterfactualTraceCaseCount: counterfactualCases.length,
    replayEpisodeCount: episodes.length,
    proofBoundary: learnV2EvalProofBoundary({
      behaviorDeltaScenarioCount: behaviorDeltaCases.length,
      counterfactualTraceCaseCount: counterfactualCases.length,
      sandboxProbeStatus: sandboxProbe?.result.status,
      behaviorAgentEvalStatus: behaviorAgentEval.summary.status,
      unreviewedGoldenProposal: goldenFile.unreviewedProposal
    }),
    summary,
    leakCheck: {
      status: leakIssues.length ? "fail" : "pass",
      issues: leakIssues
    },
    tokenBudget: {
      rawChars,
      compressedChars,
      compressionRatio: rawChars ? Number(Math.min(1, compressedChars / rawChars).toFixed(3)) : 1
    },
    results,
    artifacts: {
      json,
      markdown,
      counterfactualCases: counterfactualCasesPath,
      behaviorDeltaCases: behaviorDeltaCasesPath,
      behaviorAgentEval: behaviorAgentEval.summary.artifactPath,
      sandboxProbe: sandboxProbe?.artifactPath
    }
  });
  await writeJsonAtomic(counterfactualCasesPath, {
    schemaVersion: "openskill-kit.counterfactual-trace-eval-cases.v1",
    generatedAt: now.toISOString(),
    cases: counterfactualCases.map((item) => declassifyCounterfactualTraceCase(root, item))
  });
  await writeJsonAtomic(behaviorDeltaCasesPath, {
    schemaVersion: "openskill-kit.behavior-delta-eval-cases.v1",
    generatedAt: now.toISOString(),
    cases: behaviorDeltaCases.map((item) => declassifyBehaviorDeltaCase(root, item))
  });
  await writeJsonAtomic(json, report);
  await fs.writeFile(markdown, renderLearnV2Eval(report), "utf8");
  return report;
}

export async function loadLearnV2ExtractionGoldens(rootInput: string, goldensPathInput: string): Promise<LearnV2ExtractionGoldenScenario[]> {
  return (await loadLearnV2EvalGoldens(rootInput, goldensPathInput)).extraction;
}

export async function loadLearnV2EvalGoldens(rootInput: string, goldensPathInput: string): Promise<{
  extraction: LearnV2ExtractionGoldenScenario[];
  behaviorDelta: LearnV2BehaviorDeltaGoldenScenario[];
  unreviewedProposal: boolean;
}>;
export async function loadLearnV2EvalGoldens(rootInput: string, goldensPathInput: string, options: LearnV2EvalGoldenLoadOptions): Promise<{
  extraction: LearnV2ExtractionGoldenScenario[];
  behaviorDelta: LearnV2BehaviorDeltaGoldenScenario[];
  unreviewedProposal: boolean;
}>;
export async function loadLearnV2EvalGoldens(
  rootInput: string,
  goldensPathInput: string,
  options: LearnV2EvalGoldenLoadOptions = {}
): Promise<{
  extraction: LearnV2ExtractionGoldenScenario[];
  behaviorDelta: LearnV2BehaviorDeltaGoldenScenario[];
  unreviewedProposal: boolean;
}> {
  const root = path.resolve(rootInput);
  const file = path.resolve(root, goldensPathInput);
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  const unreviewedProposal = isUnreviewedEvalGoldenProposal(parsed);
  if (unreviewedProposal && options.allowUnreviewedProposal !== true) {
    throw new Error("Learn v2 eval golden proposal requires review before use. Copy reviewed scenarios into an approved goldens file, or pass allowUnreviewedProposal only for local preview.");
  }
  const topLevelValues = Array.isArray(parsed) ? parsed : [];
  const scenarioValues = Array.isArray(parsed?.scenarios) ? parsed.scenarios : [];
  const behaviorValues = [
    ...(Array.isArray(parsed?.behaviorDeltaScenarios) ? parsed.behaviorDeltaScenarios : []),
    ...(Array.isArray(parsed?.behaviorScenarios) ? parsed.behaviorScenarios : [])
  ];
  const allValues = [...topLevelValues, ...scenarioValues, ...behaviorValues];
  const extraction = allValues
    .filter((item: unknown) => !isBehaviorDeltaGoldenLike(item))
    .map((item: unknown) => LearnV2ExtractionGoldenScenarioSchema.parse(item));
  const behaviorDelta = allValues
    .filter(isBehaviorDeltaGoldenLike)
    .map((item: unknown) => LearnV2BehaviorDeltaGoldenScenarioSchema.parse(item));
  return { extraction, behaviorDelta, unreviewedProposal };
}

export function parseLearnV2LlmBehaviorEvalOutput(text: string): LearnV2LlmBehaviorEvalOutput {
  return LearnV2LlmBehaviorEvalOutputSchema.parse(JSON.parse(extractFirstJsonObject(text)));
}

export async function writeLearnV2BehaviorEvalRequests(
  rootInput: string,
  goldensPathInput: string | undefined,
  now = new Date()
): Promise<LearnV2BehaviorEvalRequestResult> {
  const root = path.resolve(rootInput);
  const routing = await ensureLearnV2ModelRoutingArtifacts(root, now);
  const agent = routing.agents["behavior-evaluator"];
  const skipped: LearnV2BehaviorEvalRequestResult["skipped"] = [];
  const requests: LearnV2BehaviorEvalRequest[] = [];
  const config = await readProjectConfig(root);
  const routingManifestPath = path.join(root, ".openskill-kit", "model-routing", "osk-model-routing.json");

  if (!goldensPathInput) {
    skipped.push({ id: "goldens", reason: "missing-goldens", detail: "Provide --learn-v2-goldens so behavior-delta scenarios are explicit and reviewed." });
  } else {
    const store = await readLearnV2ConceptStore(root);
    const goldens = await loadLearnV2EvalGoldens(root, goldensPathInput, { allowUnreviewedProposal: false });
    const cases = buildLearnV2BehaviorDeltaEvalCases(store.cards, goldens.behaviorDelta);
    if (!cases.length) {
      skipped.push({ id: "behavior-delta", reason: "no-behavior-delta-cases", detail: "Goldens file did not contain behavior-delta scenarios." });
    } else {
      const evalHash = learnV2Hash(JSON.stringify({ goldensPathInput, caseIds: cases.map((item) => item.id) })).replace(/[^a-z0-9]/gi, "").slice(0, 16);
      const evalId = `behavior-eval-${evalHash}`;
      const requestDir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", evalId);
      const promptPath = path.join(requestDir, "behavior-eval-prompt.md");
      const bundlePath = path.join(requestDir, "behavior-eval-bundle.json");
      const manifestPath = path.join(requestDir, "request-manifest.json");
      const expectedOutputPath = path.join(requestDir, "response.json");
      const bundle = {
        schemaVersion: "openskill-kit.learn-v2.behavior-eval-bundle.v1",
        generatedAt: now.toISOString(),
        evalId,
        sourceGoldensPath: scrubEvalText(root, goldensPathInput),
        cases: cases.map((item) => declassifyBehaviorDeltaCase(root, item)),
        policy: {
          rawRefsIncluded: false,
          modelOutputTrusted: false,
          reviewerTask: "Compare baselinePlan and withConceptPlan for behavior improvement, regressions, and token overhead."
        }
      };
      const prompt = renderBehaviorEvalPrompt(evalId, cases.length);
      const boundary = scanLearnV2OutputArtifactBoundary(root, config, [
        { label: "behavior-eval-prompt", content: prompt },
        { label: "behavior-eval-bundle", content: bundle }
      ]);
      if (boundary.status === "fail") {
        skipped.push({ id: evalId, reason: "unsafe-request-content", detail: boundary.issues.slice(0, 8).join("; ") });
      } else {
        await fs.mkdir(requestDir, { recursive: true });
        const bundleText = `${JSON.stringify(bundle, null, 2)}\n`;
        await fs.writeFile(promptPath, prompt, "utf8");
        await fs.writeFile(bundlePath, bundleText, "utf8");
        const manifest = {
          schemaVersion: "openskill-kit.learn-v2.model-request-manifest.v1",
          generatedAt: now.toISOString(),
          episodeId: evalId,
          reviewId: evalId,
          conceptIds: [...new Set(cases.flatMap((item) => item.activatedConceptIds))].sort(),
          modelRole: "behavior-evaluator",
          routingPolicy: "learn-v2-roi-v1",
          routingReasons: ["behavior-delta-golden", "agent-backed-behavior-proof"],
          priority: 0.9,
          promptPath: learnV2ProjectRelativePath(root, promptPath),
          bundlePath: learnV2ProjectRelativePath(root, bundlePath),
          promptHash: learnV2Hash(prompt),
          bundleHash: learnV2Hash(bundleText),
          expectedOutputPath: learnV2ProjectRelativePath(root, expectedOutputPath),
          outputSchema: "openskill-kit.learn-v2.llm-behavior-eval-output.v1",
          opencodeAgentId: agent.opencodeAgentId,
          agentFile: agent.agentFile,
          modelRoutingArtifactPath: learnV2ProjectRelativePath(root, routingManifestPath),
          opencodeAgentIndexPath: routing.artifacts.opencodeAgentIndex,
          executionBoundary: "opencode-host-sanitized-only",
          evidenceIds: [],
          rawRefsIncluded: false
        };
        await writeJsonAtomic(manifestPath, manifest);
        requests.push({
          evalId,
          promptPath: learnV2ProjectRelativePath(root, promptPath),
          bundlePath: learnV2ProjectRelativePath(root, bundlePath),
          promptHash: manifest.promptHash,
          bundleHash: manifest.bundleHash,
          manifestPath: learnV2ProjectRelativePath(root, manifestPath),
          expectedOutputPath: learnV2ProjectRelativePath(root, expectedOutputPath),
          outputSchema: "openskill-kit.learn-v2.llm-behavior-eval-output.v1",
          opencodeAgentId: agent.opencodeAgentId,
          agentFile: agent.agentFile,
          scenarioCount: cases.length
        });
      }
    }
  }

  return {
    schemaVersion: "openskill-kit.learn-v2.behavior-eval-request-result.v1",
    generatedAt: now.toISOString(),
    requestCount: requests.length,
    requests,
    skipped,
    routingManifestPath: learnV2ProjectRelativePath(root, routingManifestPath),
    modelRoutingArtifactPath: learnV2ProjectRelativePath(root, routingManifestPath),
    opencodeAgentIndexPath: routing.artifacts.opencodeAgentIndex,
    instructions: requests.length ? [
      "Run: openskill-kit osk learn --execute-model-requests --model-request <manifest> --apply-model-responses",
      "Or apply a returned response directly with: openskill-kit osk learn --behavior-eval-output <response.json>"
    ] : ["No behavior-evaluator request was written."]
  };
}

export async function applyLearnV2BehaviorEvalOutputs(
  rootInput: string,
  outputPathsInput: string[],
  now = new Date()
): Promise<LearnV2BehaviorEvalApplyResult> {
  const root = path.resolve(rootInput);
  const config = await readProjectConfig(root);
  const rejected: LearnV2BehaviorEvalApplyResult["rejected"] = [];
  const outputFiles = (await Promise.all(outputPathsInput.map((file) => resolveBehaviorEvalOutputInputPath(root, file, rejected)))).filter((file): file is string => Boolean(file));
  const accepted: Array<{ outputPath: string; manifest: BehaviorEvalManifest; output: LearnV2LlmBehaviorEvalOutput; caseIds: string[] }> = [];

  for (const outputPath of outputFiles) {
    const manifestRead = await readBehaviorEvalManifest(root, outputPath, rejected);
    if (!manifestRead) continue;
    const bundle = await readBehaviorEvalBundle(root, manifestRead.manifest, outputPath, rejected);
    if (!bundle) continue;
    const text = await fs.readFile(outputPath, "utf8").catch((error: unknown) => {
      rejected.push({ outputPath, id: "file", reason: "read-failed", detail: error instanceof Error ? error.message : String(error) });
      return undefined;
    });
    if (text === undefined) continue;
    let parsed: LearnV2LlmBehaviorEvalOutput;
    try {
      parsed = parseLearnV2LlmBehaviorEvalOutput(text);
    } catch (error) {
      rejected.push({ outputPath, id: "file", reason: "invalid-json-or-schema", detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const validation = validateLearnV2BehaviorEvalOutput(root, config, manifestRead.manifest, bundle, parsed);
    if (!validation.ok) {
      rejected.push({ outputPath, id: parsed.evalId ?? "file", reason: validation.reason, detail: validation.detail });
      continue;
    }
    accepted.push({ outputPath, manifest: manifestRead.manifest, output: parsed, caseIds: bundle.cases.map((item) => item.id) });
  }

  const status = summarizeBehaviorEvalStatus(accepted.flatMap((item) => item.output.results));
  let artifactPath: string | undefined;
  let markdownPath: string | undefined;
  if (accepted.length) {
    const dir = path.join(root, ".openskill-kit", "learn-v2", "evals", "agent");
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    artifactPath = path.join(dir, `behavior-agent-eval-${stamp}.json`);
    markdownPath = path.join(dir, `behavior-agent-eval-${stamp}.md`);
    const artifact = {
      schemaVersion: "openskill-kit.learn-v2.behavior-agent-eval-artifact.v1",
      generatedAt: now.toISOString(),
      status,
      agentExecuted: true,
      sourceResponseHashes: accepted.map((item) => learnV2Hash(item.outputPath)),
      evals: accepted.map((item) => ({
        evalId: item.output.evalId,
        resultCount: item.output.results.length,
        caseIds: item.caseIds,
        results: item.output.results,
        rejected: item.output.rejected
      }))
    };
    const boundary = scanLearnV2OutputArtifactBoundary(root, config, [{ label: "behavior-agent-eval", content: artifact }]);
    if (boundary.status === "fail") {
      rejected.push({ outputPath: artifactPath, id: "behavior-agent-eval", reason: "unsafe-output-content", detail: boundary.issues.slice(0, 8).join("; ") });
      artifactPath = undefined;
      markdownPath = undefined;
    } else {
      await writeJsonAtomic(artifactPath, artifact);
      await fs.writeFile(markdownPath, renderBehaviorEvalApplyMarkdown(artifact), "utf8");
    }
  }

  return {
    schemaVersion: "openskill-kit.learn-v2.behavior-eval-apply-result.v1",
    appliedAt: now.toISOString(),
    outputFiles,
    resultCount: accepted.reduce((sum, item) => sum + item.output.results.length, 0),
    rejected,
    artifactPath,
    markdownPath,
    status: accepted.length ? status : "not-run"
  };
}

async function evaluateLearnV2BehaviorAgentEvalArtifact(
  root: string,
  artifactPathInput: string,
  behaviorDeltaCases: LearnV2BehaviorDeltaEvalCase[]
): Promise<LearnV2BehaviorAgentEvalCheck> {
  const config = await readProjectConfig(root);
  const artifactPath = path.resolve(root, artifactPathInput);
  const currentCaseIds = new Set(behaviorDeltaCases.map((item) => item.id));
  const relativeArtifactPath = learnV2ProjectRelativePath(root, artifactPath);
  const fail = (name: string, details: string): LearnV2BehaviorAgentEvalCheck => ({
    result: {
      id: "behavior-agent-eval",
      status: "fail",
      checks: [check(name, false, details)]
    },
    summary: {
      status: "fail",
      resultCount: 0,
      failedScenarioIds: [],
      needsReviewScenarioIds: [],
      artifactPath: relativeArtifactPath
    }
  });

  if (!learnV2IsInside(path.resolve(root), artifactPath)) {
    return fail("artifact-path", "behavior agent eval artifact must be inside the project");
  }
  const text = await fs.readFile(artifactPath, "utf8").catch((error: unknown) => {
    return { readError: error instanceof Error ? error.message : String(error) };
  });
  if (typeof text !== "string") return fail("artifact-read", text.readError);
  let artifact: z.infer<typeof LearnV2BehaviorAgentEvalArtifactSchema>;
  try {
    artifact = LearnV2BehaviorAgentEvalArtifactSchema.parse(JSON.parse(text));
  } catch (error) {
    return fail("artifact-schema", error instanceof Error ? error.message : String(error));
  }
  const boundary = scanLearnV2OutputArtifactBoundary(root, config, [{ label: "behavior-agent-eval", content: artifact }]);
  if (boundary.status === "fail") {
    return fail("artifact-boundary", `behavior agent eval artifact crosses output boundary: ${boundary.issues.slice(0, 8).join(", ")}`);
  }
  const results = artifact.evals.flatMap((item) => item.results);
  const resultIds = results.map((item) => item.scenarioId);
  const unknownScenarioIds = resultIds.filter((id) => !currentCaseIds.has(id));
  const missingScenarioIds = [...currentCaseIds].filter((id) => !resultIds.includes(id));
  const duplicateScenarioIds = resultIds.filter((id, index) => resultIds.indexOf(id) !== index);
  const failedScenarioIds = results.filter((item) => item.status === "fail").map((item) => item.scenarioId);
  const needsReviewScenarioIds = results.filter((item) => item.status === "needs-review").map((item) => item.scenarioId);
  const checks = [
    check("agent-executed", artifact.agentExecuted === true, "behavior-evaluator artifact records agent execution"),
    check("scenario-id-match", unknownScenarioIds.length === 0 && duplicateScenarioIds.length === 0, unknownScenarioIds.length || duplicateScenarioIds.length
      ? `unknown=${unknownScenarioIds.slice(0, 6).join(", ") || "none"} duplicate=${duplicateScenarioIds.slice(0, 6).join(", ") || "none"}`
      : "agent scenario ids match behavior-delta cases"),
    check("covers-current-behavior-delta-cases", missingScenarioIds.length === 0 && currentCaseIds.size > 0, missingScenarioIds.length
      ? `missing scenario ids: ${missingScenarioIds.slice(0, 6).join(", ")}`
      : currentCaseIds.size ? "agent artifact covers all current behavior-delta cases" : "no current behavior-delta cases configured"),
    check("agent-status", artifact.status === "pass" && failedScenarioIds.length === 0 && needsReviewScenarioIds.length === 0, `status=${artifact.status}, failed=${failedScenarioIds.length}, needsReview=${needsReviewScenarioIds.length}`)
  ];
  const pass = checks.every((item) => item.status === "pass");
  return {
    result: {
      id: "behavior-agent-eval",
      status: pass ? "pass" : "fail",
      checks
    },
    summary: {
      status: artifact.status,
      resultCount: results.length,
      failedScenarioIds,
      needsReviewScenarioIds,
      artifactPath: relativeArtifactPath
    }
  };
}

function emptyBehaviorAgentEvalSummary(): LearnV2BehaviorAgentEvalSummary {
  return {
    status: "not-run",
    resultCount: 0,
    failedScenarioIds: [],
    needsReviewScenarioIds: []
  };
}

function isUnreviewedEvalGoldenProposal(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as { schemaVersion?: unknown }).schemaVersion === "openskill-kit.learn-v2.eval-golden-proposal.v1"
    && (value as { reviewRequired?: unknown }).reviewRequired === true
  );
}

function evaluateGolden(golden: LearnV2ExtractionGoldenScenario, episodes: LearnV2TaskEpisode[], concepts: LearnV2ConceptCard[]): LearnV2EvalReport["results"][number] {
  const matchingEpisodes = golden.episodeIdIncludes
    ? episodes.filter((episode) => episode.id.includes(golden.episodeIdIncludes!))
    : episodes;
  const conceptsText = JSON.stringify(concepts.map((concept) => ({
    title: concept.title,
    canonicalBehavior: concept.canonicalBehavior,
    kind: concept.atoms.map((atom) => atom.kind),
    paths: concept.scope.paths,
    taskTypes: concept.scope.taskTypes
  }))).toLowerCase();
  const episodeText = JSON.stringify(matchingEpisodes.map((episode) => ({
    id: episode.id,
    taskHints: episode.taskHints,
    paths: episode.pathCluster,
    outcome: episode.outcome
  }))).toLowerCase();
  const expectedKindSet = new Set(concepts.flatMap((concept) => concept.atoms.map((atom) => atom.kind)));
  const checks = [
    check(
      "expected-concept-text",
      golden.expectedConceptText.every((text) => conceptsText.includes(text.toLowerCase())),
      `expected text: ${golden.expectedConceptText.join(", ") || "none"}`
    ),
    check(
      "expected-kinds",
      golden.expectedKinds.every((kind) => expectedKindSet.has(kind)),
      `expected kinds: ${golden.expectedKinds.join(", ") || "none"}`
    ),
    check(
      "expected-task-hints",
      golden.expectedTaskHints.every((hint) => episodeText.includes(hint.toLowerCase())),
      `expected hints: ${golden.expectedTaskHints.join(", ") || "none"}`
    ),
    check(
      "expected-paths",
      golden.expectedPathText.every((text) => `${conceptsText}\n${episodeText}`.includes(text.toLowerCase())),
      `expected paths: ${golden.expectedPathText.join(", ") || "none"}`
    ),
    check(
      "forbidden-text",
      golden.forbiddenText.every((text) => !`${conceptsText}\n${episodeText}`.includes(text.toLowerCase())),
      `forbidden text: ${golden.forbiddenText.join(", ") || "none"}`
    )
  ];
  return {
    id: `golden:${golden.id}`,
    status: checks.every((item) => item.status === "pass") ? "pass" : "fail",
    checks
  };
}

async function runLearnV2EvalSandboxProbe(
  root: string,
  runDir: string,
  behaviorDeltaCases: LearnV2BehaviorDeltaEvalCase[],
  counterfactualCases: LearnV2CounterfactualTraceEvalCase[]
): Promise<{ result: LearnV2EvalResultRow; artifactPath: string }> {
  const artifactPath = path.join(runDir, "sandbox-probe.json");
  const inputPath = path.join(runDir, "sandbox-probe-input.json");
  const runnerPath = path.join(runDir, "sandbox-probe-runner.cjs");
  const input = {
    schemaVersion: "openskill-kit.learn-v2.sandbox-probe-input.v1",
    behaviorDeltaCases: behaviorDeltaCases.map((item) => declassifyBehaviorDeltaCase(root, item)),
    counterfactualCases: counterfactualCases.map((item) => declassifyCounterfactualTraceCase(root, item))
  };
  await writeJsonAtomic(inputPath, input);
  await fs.mkdir(path.dirname(runnerPath), { recursive: true });
  await fs.writeFile(runnerPath, sandboxProbeRunnerSource(), "utf8");
  const sandboxResult = await runSandboxCommand(createLocalSandboxPolicy({
    projectRoot: root,
    allowedCommands: [process.execPath, "node"],
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024
  }), {
    command: process.execPath,
    args: [runnerPath, inputPath],
    cwd: root
  });
  const parsed = parseSandboxProbeStdout(sandboxResult);
  const unsafeInputIssues = sandboxProbeInputIssues(JSON.stringify(input));
  const pass = sandboxResult.status === "pass" && parsed.ok === true && unsafeInputIssues.length === 0;
  await writeJsonAtomic(artifactPath, {
    schemaVersion: "openskill-kit.learn-v2.sandbox-probe-result.v1",
    status: pass ? "pass" : "fail",
    sandboxStatus: sandboxResult.status,
    durationMs: sandboxResult.durationMs,
    behaviorDeltaCaseCount: behaviorDeltaCases.length,
    counterfactualCaseCount: counterfactualCases.length,
    unsafeInputIssues,
    runnerChecks: parsed,
    limitations: [
      "local-process sandbox mode uses execFile without shell expansion but is not a container boundary",
      "probe validates serialized eval cases and verifier plumbing; it does not execute a real coding agent"
    ],
    stderr: sandboxResult.stderr ? "[present]" : ""
  });
  return {
    artifactPath,
    result: {
      id: "sandbox-eval-probe",
      status: pass ? "pass" : "fail",
      checks: [
        check("sandbox-command", sandboxResult.status === "pass", `local-process sandbox command status: ${sandboxResult.status}`),
        check("probe-runner", parsed.ok === true, parsed.detail),
        check("declassified-input", unsafeInputIssues.length === 0, unsafeInputIssues.length ? `unsafe probe input: ${unsafeInputIssues.join(", ")}` : "probe input uses declassified eval cases")
      ]
    }
  };
}

function sandboxProbeRunnerSource(): string {
  return `
const fs = require("node:fs");
const inputPath = process.argv[2];
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const behaviorDeltaCases = Array.isArray(input.behaviorDeltaCases) ? input.behaviorDeltaCases : [];
const counterfactualCases = Array.isArray(input.counterfactualCases) ? input.counterfactualCases : [];
const invalidBehavior = behaviorDeltaCases.filter((item) => !Array.isArray(item.withConceptPlan) || !Array.isArray(item.baselinePlan));
const invalidCounterfactual = counterfactualCases.filter((item) => typeof item.expectedBehavior !== "string" || !Array.isArray(item.paths));
const ok = input.schemaVersion === "openskill-kit.learn-v2.sandbox-probe-input.v1" && invalidBehavior.length === 0 && invalidCounterfactual.length === 0;
console.log(JSON.stringify({
  ok,
  behaviorDeltaCaseCount: behaviorDeltaCases.length,
  counterfactualCaseCount: counterfactualCases.length,
  invalidBehaviorDeltaCaseCount: invalidBehavior.length,
  invalidCounterfactualCaseCount: invalidCounterfactual.length
}));
process.exit(ok ? 0 : 1);
`.trimStart();
}

function parseSandboxProbeStdout(result: SandboxCommandResult): { ok: boolean; detail: string } {
  if (!result.stdout.trim()) return { ok: false, detail: "sandbox probe produced no JSON output" };
  try {
    const parsed = JSON.parse(result.stdout) as {
      ok?: unknown;
      behaviorDeltaCaseCount?: unknown;
      counterfactualCaseCount?: unknown;
      invalidBehaviorDeltaCaseCount?: unknown;
      invalidCounterfactualCaseCount?: unknown;
    };
    return {
      ok: parsed.ok === true,
      detail: `validated behaviorDelta=${parsed.behaviorDeltaCaseCount ?? 0}, counterfactual=${parsed.counterfactualCaseCount ?? 0}, invalidBehavior=${parsed.invalidBehaviorDeltaCaseCount ?? 0}, invalidCounterfactual=${parsed.invalidCounterfactualCaseCount ?? 0}`
    };
  } catch {
    return { ok: false, detail: "sandbox probe output was not valid JSON" };
  }
}

function sandboxProbeInputIssues(text: string): string[] {
  const issues: string[] = [];
  if (/\braw_[A-Za-z0-9][A-Za-z0-9_-]{5,}\b/.test(text)) issues.push("raw-ref-like-token");
  if (/\b[A-Z]:[\\/]Users[\\/]/i.test(text) || /\/(?:Users|home)\/[^/\s"'`]+/i.test(text)) issues.push("absolute-user-path");
  if (/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{16,})\b/.test(text)) issues.push("secret-like-token");
  return [...new Set(issues)].sort();
}

function evaluateMemoryAdmissionBoundary(concepts: LearnV2ConceptCard[]): LearnV2EvalResultRow {
  const eligibleIds = new Set(filterLearnV2ActivationEligibleConcepts(concepts).map((concept) => concept.id));
  const oneOffConcepts = concepts.filter((concept) => concept.status === "one-off");
  const inactiveConcepts = concepts.filter((concept) =>
    concept.status === "rejected" || concept.status === "one-off" || concept.status === "superseded"
  );
  const oneOffEligible = oneOffConcepts.filter((concept) => eligibleIds.has(concept.id));
  const inactiveEligible = inactiveConcepts.filter((concept) => eligibleIds.has(concept.id));
  const checks = [
    check(
      "one-off-excluded-from-activation",
      oneOffEligible.length === 0,
      oneOffEligible.length
        ? `one-off concepts activation-eligible: ${oneOffEligible.map((concept) => concept.id).slice(0, 8).join(", ")}`
        : `${oneOffConcepts.length} one-off concept(s) excluded from activation/counterfactual replay`
    ),
    check(
      "inactive-status-excluded-from-activation",
      inactiveEligible.length === 0,
      inactiveEligible.length
        ? `inactive concepts activation-eligible: ${inactiveEligible.map((concept) => concept.id).slice(0, 8).join(", ")}`
        : `${inactiveConcepts.length} rejected/one-off/superseded concept(s) excluded from activation artifacts`
    )
  ];
  return {
    id: "memory-admission-boundary",
    status: checks.every((entry) => entry.status === "pass") ? "pass" : "fail",
    checks
  };
}

function evaluateConditionalAdmissionBoundary(episodes: LearnV2TaskEpisode[]): LearnV2EvalResultRow {
  const conditional = runLearnV2ConditionalLearning(episodes);
  const observationsById = new Map(conditional.observations.map((observation) => [observation.id, observation]));
  const decisionsByHypothesisId = new Map(conditional.admissionDecisions
    .filter((decision) => decision.subjectKind === "hypothesis")
    .map((decision) => [decision.subjectId, decision]));
  const oneOffObservationDecisions = conditional.observations
    .filter((observation) => observation.durabilitySignals.oneOff && !observation.durabilitySignals.explicitDurable)
    .map((observation) => conditional.admissionDecisions.find((decision) => decision.subjectKind === "observation" && decision.subjectId === observation.id));
  const prematurelyPromoted = conditional.hypotheses.filter((hypothesis) => {
    const decision = decisionsByHypothesisId.get(hypothesis.id);
    const support = hypothesis.supportObservationIds
      .map((id) => observationsById.get(id))
      .filter((observation): observation is NonNullable<typeof observation> => Boolean(observation));
    const durableSupportCount = support.filter((observation) => !observation.durabilitySignals.oneOff).length;
    const explicitlyDurable = support.some((observation) => observation.durabilitySignals.explicitDurable && !observation.durabilitySignals.oneOff);
    return (hypothesis.status === "candidate" || decision?.decision === "candidate-concept" || decision?.decision === "requires-human-review")
      && !explicitlyDurable
      && durableSupportCount < 2;
  });
  const missingWeakReason = conditional.hypotheses.filter((hypothesis) => {
    const decision = decisionsByHypothesisId.get(hypothesis.id);
    const support = hypothesis.supportObservationIds
      .map((id) => observationsById.get(id))
      .filter((observation): observation is NonNullable<typeof observation> => Boolean(observation));
    const durableSupportCount = support.filter((observation) => !observation.durabilitySignals.oneOff).length;
    const explicitlyDurable = support.some((observation) => observation.durabilitySignals.explicitDurable && !observation.durabilitySignals.oneOff);
    return !explicitlyDurable
      && durableSupportCount < 2
      && decision?.decision === "weak-observation"
      && !decision.reasons.includes("single-support-hypothesis-kept-weak");
  });
  const oneOffNotTraceOnly = oneOffObservationDecisions.filter((decision) => decision?.decision !== "episode-note");
  const promotedDecisionCount = conditional.admissionDecisions.filter((decision) =>
    decision.subjectKind === "hypothesis" && (decision.decision === "candidate-concept" || decision.decision === "requires-human-review")
  ).length;
  const checks = [
    check(
      "sparse-hypotheses-kept-weak",
      prematurelyPromoted.length === 0,
      prematurelyPromoted.length
        ? `prematurely promoted hypotheses: ${prematurelyPromoted.map((hypothesis) => hypothesis.id).slice(0, 6).join(", ")}`
        : `${conditional.hypotheses.length} conditional hypothesis/hypotheses checked; promoted=${promotedDecisionCount}`
    ),
    check(
      "weak-hypotheses-explain-admission",
      missingWeakReason.length === 0,
      missingWeakReason.length
        ? `weak hypotheses missing reason: ${missingWeakReason.map((hypothesis) => hypothesis.id).slice(0, 6).join(", ")}`
        : "sparse weak hypotheses carry admission rationale"
    ),
    check(
      "one-off-observations-trace-only",
      oneOffNotTraceOnly.length === 0,
      oneOffNotTraceOnly.length
        ? `${oneOffNotTraceOnly.length} one-off observation(s) escaped episode-note admission`
        : `${oneOffObservationDecisions.length} one-off observation(s) kept trace-only`
    )
  ];
  return {
    id: "conditional-admission-boundary",
    status: checks.every((entry) => entry.status === "pass") ? "pass" : "fail",
    checks
  };
}

function evaluateOpenWorldGroundingBoundary(concepts: LearnV2ConceptCard[], now: Date): LearnV2EvalResultRow {
  const eligibleConcepts = filterLearnV2ActivationEligibleConcepts(concepts);
  const eligibleIds = new Set(eligibleConcepts.map((concept) => concept.id));
  const anchors = buildLearnV2OpenWorldGroundingAnchors(eligibleConcepts, now);
  const missingAuthority = anchors.filter((anchor) =>
    !anchor.resourceKind
    || !anchor.trustTier
    || !anchor.alignment
    || !anchor.precedence
    || !anchor.licenseRisk
  );
  const orphanAnchors = anchors.filter((anchor) =>
    !eligibleIds.has(anchor.conceptId)
    || anchor.evidenceConceptIds.some((conceptId) => !eligibleIds.has(conceptId))
  );
  const reviewOnlyFailures = anchors.filter((anchor) =>
    !anchor.usedFor.includes("eval")
    && anchor.precedence !== "resource-informs-review-only"
    && anchor.precedence !== "project-doc-over-external"
    && anchor.precedence !== "user-correction-over-resource"
  );
  const restrictedUnsafeUse = anchors.filter((anchor) =>
    anchor.licenseRisk === "restricted"
    && (anchor.usedFor.some((item) => item === "title" || item === "conditions" || item === "skill-text") || anchor.alignment !== "possible-conflict")
  );
  const groundedConcepts = new Set(anchors.map((anchor) => anchor.conceptId));
  const groundedWithoutUserEvidence = eligibleConcepts.filter((concept) =>
    groundedConcepts.has(concept.id) && concept.evidenceIds.length === 0
  );
  const localEvidenceRefs = eligibleConcepts.reduce((sum, concept) => sum + concept.evidenceIds.length, 0);
  const modelInterpretationUnits = eligibleConcepts.reduce((sum, concept) => sum + concept.atoms.length + (concept.conditions ? 1 : 0), 0);
  const externalAnchors = anchors.filter((anchor) => anchor.trustTier !== "project").length;
  const projectAnchors = anchors.filter((anchor) => anchor.trustTier === "project").length;
  const precedenceModes = [...new Set(anchors.map((anchor) => anchor.precedence))].sort();
  const checks = [
    check(
      "grounding-anchors-carry-authority",
      missingAuthority.length === 0,
      anchors.length
        ? `${anchors.length} anchor(s) carry resource kind, trust tier, alignment, precedence, and license risk`
        : "no open-world anchors generated for current concepts"
    ),
    check(
      "grounding-stays-attached-to-eligible-concepts",
      orphanAnchors.length === 0,
      orphanAnchors.length
        ? `orphan anchors: ${orphanAnchors.map((anchor) => anchor.id).slice(0, 6).join(", ")}`
        : `${anchors.length} anchor(s) reference only activation-eligible concepts`
    ),
    check(
      "resource-precedence-is-review-only",
      reviewOnlyFailures.length === 0,
      reviewOnlyFailures.length
        ? `anchors with unsafe precedence: ${reviewOnlyFailures.map((anchor) => anchor.id).slice(0, 6).join(", ")}`
        : `precedence modes: ${precedenceModes.length ? precedenceModes.join(", ") : "none"}`
    ),
    check(
      "user-evidence-remains-separate-from-grounding",
      groundedWithoutUserEvidence.length === 0,
      groundedWithoutUserEvidence.length
        ? `grounded concepts without local evidence: ${groundedWithoutUserEvidence.map((concept) => concept.id).slice(0, 6).join(", ")}`
        : `${groundedConcepts.size} grounded concept(s) retain local evidence separately from ${externalAnchors} external and ${projectAnchors} project anchor(s)`
    ),
    check(
      "restricted-license-grounding-is-eval-only",
      restrictedUnsafeUse.length === 0,
      restrictedUnsafeUse.length
        ? `restricted-license anchors with unsafe use: ${restrictedUnsafeUse.map((anchor) => anchor.id).slice(0, 6).join(", ")}`
        : `${anchors.filter((anchor) => anchor.licenseRisk === "restricted").length} restricted-license anchor(s) kept out of title/condition/skill text generation`
    ),
    check(
      "evidence-classes-counted-separately",
      true,
      `local evidence refs=${localEvidenceRefs}, external grounding=${externalAnchors}, project grounding=${projectAnchors}, model interpretation units=${modelInterpretationUnits}`
    )
  ];
  return {
    id: "open-world-grounding-boundary",
    status: checks.every((entry) => entry.status === "pass") ? "pass" : "fail",
    checks
  };
}

function buildCounterfactualTraceCases(episodes: LearnV2TaskEpisode[], concepts: LearnV2ConceptCard[]): LearnV2CounterfactualTraceEvalCase[] {
  return filterLearnV2ActivationEligibleConcepts(concepts)
    .map((concept) => {
      const episode = episodes.find((item) => item.evidenceIds.some((id) => concept.evidenceIds.includes(id)));
      const promptParts = [
        ...concept.scope.taskTypes,
        ...concept.activation.phrases.slice(0, 6),
        concept.title
      ].filter(Boolean);
      return {
        schemaVersion: "openskill-kit.counterfactual-trace-eval-case.v1" as const,
        id: `counterfactual_${concept.id}`,
        conceptId: concept.id,
        sourceEpisodeId: episode?.id,
        taskPrompt: promptParts.join(" "),
        paths: concept.scope.paths,
        commands: concept.activation.commands,
        taskTypes: concept.scope.taskTypes,
        expectedBehavior: concept.canonicalBehavior,
        negativeSignals: [],
        // Negative triggers are intentionally tested separately by passing each one as a suppression signal.
      };
    });
}

function evaluateCounterfactualTraceCases(concepts: LearnV2ConceptCard[], cases: LearnV2CounterfactualTraceEvalCase[]): {
  result: LearnV2EvalResultRow;
  summary: LearnV2EvalSummary["counterfactualTrace"];
} {
  const entries = filterLearnV2ActivationEligibleConcepts(concepts).map(buildLearnV2ActivationIndexEntry);
  const misses: string[] = [];
  const suppressionMisses: string[] = [];
  const behaviorMismatches: string[] = [];
  for (const item of cases) {
    const concept = concepts.find((card) => card.id === item.conceptId);
    if (concept && tokenOverlapRatio(item.expectedBehavior, concept.canonicalBehavior) < 0.72) behaviorMismatches.push(item.conceptId);
    const ranked = scoreLearnV2ActivationEntries(entries, {
      includeCandidates: true,
      query: item.taskPrompt,
      paths: item.paths,
      commands: item.commands,
      taskTypes: item.taskTypes
    });
    if (!ranked.slice(0, 5).some((match) => match.conceptId === item.conceptId && match.score > 0)) misses.push(item.conceptId);
    for (const trigger of concept?.scope.negativeTriggers ?? []) {
      const suppressed = scoreLearnV2ActivationEntries(entries, {
        includeCandidates: true,
        query: item.taskPrompt,
        paths: item.paths,
        commands: item.commands,
        taskTypes: item.taskTypes,
        negativeSignals: [trigger]
      });
      if (!suppressed.some((match) => match.conceptId === item.conceptId && match.suppressed)) suppressionMisses.push(`${item.conceptId}:${trigger}`);
    }
  }
  const pass = misses.length === 0 && suppressionMisses.length === 0 && behaviorMismatches.length === 0;
  const activatedCases = cases.length - misses.length;
  return {
    result: {
      id: "counterfactual-trace-eval",
      status: pass ? "pass" : "fail",
      checks: [
        check(
          "expected-concept-activation",
          misses.length === 0,
          cases.length ? `${activatedCases}/${cases.length} counterfactual case(s) activated expected concept${misses.length ? `; misses: ${misses.slice(0, 6).join(", ")}` : ""}` : "no counterfactual cases"
        ),
        check(
          "negative-trigger-suppression",
          suppressionMisses.length === 0,
          suppressionMisses.length ? `suppression misses: ${suppressionMisses.slice(0, 6).join(", ")}` : "negative triggers suppress matching concepts"
        ),
        check(
          "expected-behavior-consistency",
          behaviorMismatches.length === 0,
          behaviorMismatches.length ? `expected behavior mismatches: ${behaviorMismatches.slice(0, 6).join(", ")}` : "counterfactual expected behavior matches concept behavior"
        )
      ]
    },
    summary: {
      status: pass ? "pass" : "fail",
      caseCount: cases.length,
      activatedCases,
      activationRate: cases.length ? Number((activatedCases / cases.length).toFixed(3)) : 1,
      misses,
      suppressionMisses,
      behaviorMismatches
    }
  };
}

export function buildLearnV2BehaviorDeltaEvalCases(
  concepts: LearnV2ConceptCard[],
  scenarios: LearnV2BehaviorDeltaGoldenScenario[]
): LearnV2BehaviorDeltaEvalCase[] {
  const entries = filterLearnV2ActivationEligibleConcepts(concepts).map(buildLearnV2ActivationIndexEntry);
  return scenarios.map((scenario) => {
    const ranked = scoreLearnV2ActivationEntries(entries, {
      includeCandidates: true,
      query: scenario.task.prompt,
      paths: scenario.task.paths,
      commands: scenario.task.commands,
      taskTypes: scenario.task.taskTypes,
      negativeSignals: scenario.task.negativeSignals
    });
    const activatedConceptIds = ranked
      .filter((match) => match.score > 0 && !match.suppressed)
      .slice(0, 5)
      .map((match) => match.conceptId);
    const activatedConcepts = concepts.filter((concept) => activatedConceptIds.includes(concept.id));
    const baselinePlan = renderBaselineEvalPlan(scenario);
    const withConceptPlan = renderWithConceptEvalPlan(scenario, activatedConcepts);
    const baselinePlanChars = planChars(baselinePlan);
    const withConceptPlanChars = planChars(withConceptPlan);
    const regressionFindings = planRegressionFindings(scenario, withConceptPlan);
    return {
      schemaVersion: "openskill-kit.behavior-delta-eval-case.v1",
      id: scenario.id,
      title: scenario.title,
      taskPrompt: scenario.task.prompt,
      paths: scenario.task.paths,
      commands: scenario.task.commands,
      taskTypes: scenario.task.taskTypes,
      activatedConceptIds,
      activatedConceptText: activatedConcepts.map((concept) => concept.canonicalBehavior),
      activatedKinds: [...new Set(activatedConcepts.flatMap((concept) => concept.atoms.map((atom) => atom.kind)))],
      expectedConceptText: scenario.expectedConceptText,
      expectedKinds: scenario.expectedKinds,
      baselinePlan,
      withConceptPlan,
      baselinePlanChars,
      withConceptPlanChars,
      tokenOverheadChars: Math.max(0, withConceptPlanChars - baselinePlanChars),
      tokenOverheadTokens: estimateTokens(Math.max(0, withConceptPlanChars - baselinePlanChars)),
      regressionFindings,
      expectedPlanIncludes: scenario.expectedPlanIncludes,
      expectedPlanExcludes: scenario.expectedPlanExcludes,
      minActivatedConcepts: scenario.minActivatedConcepts
    };
  });
}

function evaluateBehaviorDeltaCase(item: LearnV2BehaviorDeltaEvalCase): LearnV2EvalReport["results"][number] {
  const withPlan = item.withConceptPlan.join("\n").toLowerCase();
  const baselinePlan = item.baselinePlan.join("\n").toLowerCase();
  const activatedConceptText = item.activatedConceptText.join("\n").toLowerCase();
  const expectedIncludes = item.expectedPlanIncludes.map((value) => value.toLowerCase());
  const expectedExcludes = item.expectedPlanExcludes.map((value) => value.toLowerCase());
  const expectedConceptText = item.expectedConceptText.map((value) => value.toLowerCase());
  const activated = item.activatedConceptIds.length >= item.minActivatedConcepts;
  const withPlanIncludes = expectedIncludes.filter((value) => withPlan.includes(value));
  const baselineAlreadyIncludes = expectedIncludes.filter((value) => baselinePlan.includes(value));
  const forbiddenPresent = expectedExcludes.filter((value) => withPlan.includes(value));
  const activatedTextMatches = expectedConceptText.filter((value) => activatedConceptText.includes(value));
  const kindMatches = item.expectedKinds.filter((kind) => item.activatedKinds.includes(kind));
  const checks = [
    check(
      "activated-learned-context",
      activated,
      activated ? `activated concepts: ${item.activatedConceptIds.join(", ")}` : `${item.activatedConceptIds.length}/${item.minActivatedConcepts} matching learned concept(s) activated`
    ),
    check(
      "activated-concept-text",
      activatedTextMatches.length === expectedConceptText.length,
      expectedConceptText.length ? `${activatedTextMatches.length}/${expectedConceptText.length} expected concept text phrase(s) present in activated concepts` : "no expected concept text configured"
    ),
    check(
      "activated-concept-kinds",
      kindMatches.length === item.expectedKinds.length,
      item.expectedKinds.length ? `${kindMatches.length}/${item.expectedKinds.length} expected concept kind(s) activated` : "no expected concept kinds configured"
    ),
    check(
      "with-concept-plan-includes-expected-deltas",
      withPlanIncludes.length === expectedIncludes.length,
      expectedIncludes.length ? `${withPlanIncludes.length}/${expectedIncludes.length} expected learned plan phrase(s) present` : "no expected plan includes configured"
    ),
    check(
      "baseline-plan-does-not-already-satisfy-deltas",
      baselineAlreadyIncludes.length === 0,
      baselineAlreadyIncludes.length ? `baseline already contained: ${baselineAlreadyIncludes.slice(0, 6).join(", ")}` : "expected learned phrases are absent without concept context"
    ),
    check(
      "with-concept-plan-excludes-forbidden-text",
      forbiddenPresent.length === 0,
      forbiddenPresent.length ? `forbidden plan text present: ${forbiddenPresent.slice(0, 6).join(", ")}` : "no forbidden plan text present"
    ),
    check(
      "learned-context-token-overhead-measured",
      item.withConceptPlanChars >= item.baselinePlanChars && item.tokenOverheadTokens >= 0,
      `baseline=${item.baselinePlanChars} chars, withConcept=${item.withConceptPlanChars} chars, overhead=${item.tokenOverheadTokens} token(s) estimated`
    ),
    check(
      "learned-context-regression-findings",
      item.regressionFindings.length === 0,
      item.regressionFindings.length ? `regression findings: ${item.regressionFindings.slice(0, 6).join(", ")}` : "no learned-plan regression findings"
    )
  ];
  return {
    id: `behavior-delta:${item.id}`,
    status: checks.every((entry) => entry.status === "pass") ? "pass" : "fail",
    checks
  };
}

function evaluateActivationReplay(episodes: LearnV2TaskEpisode[], concepts: LearnV2ConceptCard[]): {
  result: LearnV2EvalResultRow;
  summary: LearnV2EvalSummary["activationReplay"];
} {
  const replayable = filterLearnV2ActivationEligibleConcepts(concepts);
  const entries = replayable.map(buildLearnV2ActivationIndexEntry);
  const misses: string[] = [];
  for (const concept of replayable) {
    const episode = episodes.find((item) => item.evidenceIds.some((id) => concept.evidenceIds.includes(id)));
    if (!episode) {
      misses.push(`${concept.id}:no-origin-episode`);
      continue;
    }
    const result = scoreLearnV2ActivationEntries(entries, {
      includeCandidates: true,
      query: [
        ...episode.taskHints,
        ...episode.messages.slice(0, 6).map((message) => message.text)
      ].join(" "),
      paths: episode.pathCluster,
      commands: episode.toolSummaries.flatMap((tool) => tool.command ? [tool.command] : []),
      taskTypes: episode.taskHints
    });
    if (!result.slice(0, 5).some((match) => match.conceptId === concept.id && match.score > 0)) misses.push(`${concept.id}:not-retrieved`);
  }
  const pass = replayable.length === 0 || ((replayable.length - misses.length) / replayable.length) >= 0.8;
  const retrievedConcepts = replayable.length - misses.length;
  return {
    result: {
      id: "activation-replay",
      status: pass ? "pass" : "fail",
      checks: [check(
        "originating-episode-retrieval",
        pass,
        replayable.length ? `${retrievedConcepts}/${replayable.length} concept(s) retrieved from originating episode context${misses.length ? `; misses: ${misses.slice(0, 6).join(", ")}` : ""}` : "no replayable concepts"
      )]
    },
    summary: {
      status: pass ? "pass" : "fail",
      replayableConcepts: replayable.length,
      retrievedConcepts,
      retrievalRate: replayable.length ? Number((retrievedConcepts / replayable.length).toFixed(3)) : 1,
      misses
    }
  };
}

function summarizeLearnV2Eval(
  results: LearnV2EvalResultRow[],
  activationReplay: LearnV2EvalSummary["activationReplay"],
  counterfactualTrace: LearnV2EvalSummary["counterfactualTrace"],
  behaviorDeltaCases: LearnV2BehaviorDeltaEvalCase[],
  behaviorDeltaResults: LearnV2EvalResultRow[],
  behaviorAgentEval: LearnV2BehaviorAgentEvalSummary
): LearnV2EvalSummary {
  const failedBehaviorDeltaIds = behaviorDeltaResults
    .filter((result) => result.status === "fail")
    .map((result) => result.id.replace(/^behavior-delta:/, ""));
  const activatedConceptIds = new Set(behaviorDeltaCases.flatMap((item) => item.activatedConceptIds));
  const tokenOverheadTokens = behaviorDeltaCases.reduce((sum, item) => sum + item.tokenOverheadTokens, 0);
  const maxTokenOverheadTokens = behaviorDeltaCases.reduce((max, item) => Math.max(max, item.tokenOverheadTokens), 0);
  const regressionFindingCount = behaviorDeltaCases.reduce((sum, item) => sum + item.regressionFindings.length, 0);
  return {
    resultCounts: {
      total: results.length,
      pass: results.filter((result) => result.status === "pass").length,
      fail: results.filter((result) => result.status === "fail").length
    },
    activationReplay,
    counterfactualTrace,
    behaviorDelta: {
      status: behaviorDeltaCases.length === 0 ? "not-configured" : failedBehaviorDeltaIds.length === 0 ? "pass" : "fail",
      scenarioCount: behaviorDeltaCases.length,
      passedScenarios: behaviorDeltaResults.filter((result) => result.status === "pass").length,
      failedScenarios: failedBehaviorDeltaIds.length,
      activatedConceptCount: activatedConceptIds.size,
      agentStatus: behaviorAgentEval.status,
      agentResultCount: behaviorAgentEval.resultCount,
      agentFailedScenarioIds: behaviorAgentEval.failedScenarioIds,
      agentNeedsReviewScenarioIds: behaviorAgentEval.needsReviewScenarioIds,
      tokenOverheadChars: behaviorDeltaCases.reduce((sum, item) => sum + item.tokenOverheadChars, 0),
      tokenOverheadTokens,
      averageTokenOverheadTokens: behaviorDeltaCases.length ? Number((tokenOverheadTokens / behaviorDeltaCases.length).toFixed(2)) : 0,
      maxTokenOverheadTokens,
      regressionFindingCount,
      failedScenarioIds: failedBehaviorDeltaIds
    }
  };
}

function check(name: string, passed: boolean, details: string): LearnV2EvalReport["results"][number]["checks"][number] {
  return { name, status: passed ? "pass" : "fail", details };
}

function isBehaviorDeltaGoldenLike(item: unknown): item is { schemaVersion: string } {
  return typeof item === "object"
    && item !== null
    && "schemaVersion" in item
    && (item as { schemaVersion?: unknown }).schemaVersion === "openskill-kit.learn-v2.behavior-delta-golden.v1";
}

type BehaviorEvalManifest = {
  schemaVersion: "openskill-kit.learn-v2.model-request-manifest.v1";
  episodeId: string;
  reviewId?: string;
  conceptIds?: string[];
  modelRole: "behavior-evaluator";
  promptPath: string;
  bundlePath: string;
  promptHash: string;
  bundleHash: string;
  expectedOutputPath: string;
  outputSchema: "openskill-kit.learn-v2.llm-behavior-eval-output.v1";
  opencodeAgentId: "osk-learn-v2-behavior-evaluator";
  executionBoundary: "opencode-host-sanitized-only";
  rawRefsIncluded: false;
};

type BehaviorEvalBundle = {
  schemaVersion: "openskill-kit.learn-v2.behavior-eval-bundle.v1";
  evalId: string;
  cases: LearnV2BehaviorDeltaEvalCase[];
};

function renderBehaviorEvalPrompt(evalId: string, scenarioCount: number): string {
  return [
    "# Learn v2 behavior evaluator",
    "",
    "Use only `behavior-eval-bundle.json`. Do not inspect repo files, raw vaults, local paths, network, or shell.",
    "Compare each case's `baselinePlan` with `withConceptPlan`.",
    "Return strict JSON only. No markdown fences.",
    "",
    "Output schema:",
    "{",
    '  "schemaVersion": "openskill-kit.learn-v2.llm-behavior-eval-output.v1",',
    `  "evalId": ${JSON.stringify(evalId)},`,
    '  "results": [',
    '    { "scenarioId": "case id", "status": "pass|fail|needs-review", "behaviorImproved": true, "baselineOutcome": "...", "withConceptOutcome": "...", "regressions": [], "tokenOverheadAssessment": "acceptable|too-high|unknown", "rationale": "..." }',
    "  ],",
    '  "rejected": []',
    "}",
    "",
    `Evaluate ${scenarioCount} scenario(s). A pass means learned context changes the plan toward expected behavior without adding forbidden regressions.`
  ].join("\n");
}

function validateLearnV2BehaviorEvalOutput(
  root: string,
  config: Awaited<ReturnType<typeof readProjectConfig>>,
  manifest: BehaviorEvalManifest,
  bundle: BehaviorEvalBundle,
  output: LearnV2LlmBehaviorEvalOutput
): { ok: true } | { ok: false; reason: "unsafe-output-content" | "invalid-behavior-eval-output"; detail: string } {
  const boundary = validateLearnV2ModelOutputBoundary(root, config, output);
  if (!boundary.ok) return boundary;
  if (output.evalId !== manifest.episodeId || output.evalId !== bundle.evalId) {
    return { ok: false, reason: "invalid-behavior-eval-output", detail: "Output evalId must match request manifest and bundle." };
  }
  const caseIds = new Set(bundle.cases.map((item) => item.id));
  const resultIds = output.results.map((item) => item.scenarioId);
  if (new Set(resultIds).size !== resultIds.length) {
    return { ok: false, reason: "invalid-behavior-eval-output", detail: "Scenario ids must be unique in behavior eval output." };
  }
  const unknown = resultIds.filter((id) => !caseIds.has(id));
  if (unknown.length) {
    return { ok: false, reason: "invalid-behavior-eval-output", detail: `Unknown scenario ids: ${unknown.slice(0, 5).join(", ")}` };
  }
  return { ok: true };
}

async function resolveBehaviorEvalOutputInputPath(
  root: string,
  inputPath: string,
  rejected: LearnV2BehaviorEvalApplyResult["rejected"]
): Promise<string | undefined> {
  const absolute = path.resolve(root, inputPath);
  if (path.basename(absolute) !== "request-manifest.json") {
    if (!isBehaviorEvalOutputPath(root, absolute)) {
      rejected.push({ outputPath: absolute, id: "file", reason: "unexpected-request-file-path", detail: "Behavior eval outputs must be request-local response.json files." });
      return undefined;
    }
    return absolute;
  }
  if (!isBehaviorEvalManifestPath(root, absolute)) {
    rejected.push({ outputPath: absolute, id: "file", reason: "request-manifest-outside-model-requests", detail: "Behavior eval manifests must live in .openskill-kit/learn-v2/model-requests/." });
    return undefined;
  }
  const manifest = await readBehaviorEvalManifestFromPath(absolute).catch((error: unknown) => {
    rejected.push({ outputPath: absolute, id: "file", reason: "invalid-request-manifest", detail: error instanceof Error ? error.message : String(error) });
    return undefined;
  });
  if (!manifest) return undefined;
  const expected = path.resolve(root, manifest.expectedOutputPath);
  if (!isBehaviorEvalOutputPath(root, expected)) {
    rejected.push({ outputPath: absolute, id: "file", reason: "unexpected-request-file-path", detail: "Expected output must be a request-local response.json." });
    return undefined;
  }
  return expected;
}

async function readBehaviorEvalManifest(
  root: string,
  outputPath: string,
  rejected: LearnV2BehaviorEvalApplyResult["rejected"]
): Promise<{ manifest: BehaviorEvalManifest; manifestPath: string } | undefined> {
  if (!isBehaviorEvalOutputPath(root, outputPath)) {
    rejected.push({ outputPath, id: "file", reason: "unexpected-request-file-path", detail: "Behavior eval outputs must be response.json files inside model-requests." });
    return undefined;
  }
  const manifestPath = path.join(path.dirname(outputPath), "request-manifest.json");
  const manifest = await readBehaviorEvalManifestFromPath(manifestPath).catch((error: unknown) => {
    rejected.push({ outputPath, id: "file", reason: "invalid-request-manifest", detail: error instanceof Error ? error.message : String(error) });
    return undefined;
  });
  if (!manifest) return undefined;
  const expectedOutput = path.resolve(root, manifest.expectedOutputPath);
  if (path.resolve(outputPath) !== expectedOutput) {
    rejected.push({ outputPath, id: manifest.episodeId, reason: "unexpected-output-path", detail: `Expected ${expectedOutput}` });
    return undefined;
  }
  if (!(await validateBehaviorEvalRequestFiles(root, manifestPath, manifest, outputPath, rejected))) return undefined;
  return { manifest, manifestPath };
}

async function readBehaviorEvalManifestFromPath(manifestPath: string): Promise<BehaviorEvalManifest> {
  const value = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Partial<BehaviorEvalManifest>;
  if (
    value.schemaVersion !== "openskill-kit.learn-v2.model-request-manifest.v1" ||
    typeof value.episodeId !== "string" ||
    value.modelRole !== "behavior-evaluator" ||
    value.outputSchema !== "openskill-kit.learn-v2.llm-behavior-eval-output.v1" ||
    value.opencodeAgentId !== "osk-learn-v2-behavior-evaluator" ||
    typeof value.promptPath !== "string" ||
    typeof value.bundlePath !== "string" ||
    typeof value.promptHash !== "string" ||
    typeof value.bundleHash !== "string" ||
    typeof value.expectedOutputPath !== "string" ||
    value.executionBoundary !== "opencode-host-sanitized-only" ||
    value.rawRefsIncluded !== false
  ) {
    throw new Error(`Invalid Learn v2 behavior eval request manifest: ${manifestPath}`);
  }
  return value as BehaviorEvalManifest;
}

async function readBehaviorEvalBundle(
  root: string,
  manifest: BehaviorEvalManifest,
  outputPath: string,
  rejected: LearnV2BehaviorEvalApplyResult["rejected"]
): Promise<BehaviorEvalBundle | undefined> {
  const bundlePath = path.resolve(root, manifest.bundlePath);
  try {
    const parsed = JSON.parse(await fs.readFile(bundlePath, "utf8")) as Partial<BehaviorEvalBundle>;
    if (parsed.schemaVersion !== "openskill-kit.learn-v2.behavior-eval-bundle.v1" || parsed.evalId !== manifest.episodeId || !Array.isArray(parsed.cases)) {
      rejected.push({ outputPath, id: manifest.episodeId, reason: "invalid-request-bundle", detail: "Behavior eval bundle shape does not match request manifest." });
      return undefined;
    }
    return parsed as BehaviorEvalBundle;
  } catch (error) {
    rejected.push({ outputPath, id: manifest.episodeId, reason: "invalid-request-bundle", detail: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

async function validateBehaviorEvalRequestFiles(
  root: string,
  manifestPath: string,
  manifest: BehaviorEvalManifest,
  outputPath: string,
  rejected: LearnV2BehaviorEvalApplyResult["rejected"]
): Promise<boolean> {
  const requestDir = path.dirname(path.resolve(manifestPath));
  const promptPath = resolveEvalProjectPath(root, manifest.promptPath);
  const bundlePath = resolveEvalProjectPath(root, manifest.bundlePath);
  const expectedOutputPath = resolveEvalProjectPath(root, manifest.expectedOutputPath);
  if (!isBehaviorEvalManifestPath(root, manifestPath) || !promptPath || !bundlePath || !expectedOutputPath) {
    rejected.push({ outputPath, id: manifest.episodeId, reason: "unexpected-request-file-path", detail: "Behavior eval request paths must stay project-relative and request-local." });
    return false;
  }
  const expected = [
    { file: promptPath, basename: "behavior-eval-prompt.md" },
    { file: bundlePath, basename: "behavior-eval-bundle.json" },
    { file: expectedOutputPath, basename: "response.json" }
  ];
  if (expected.some((item) => path.dirname(item.file) !== requestDir || path.basename(item.file) !== item.basename)) {
    rejected.push({ outputPath, id: manifest.episodeId, reason: "unexpected-request-file-path", detail: "Prompt, bundle, and response must be request-local behavior eval files." });
    return false;
  }
  const [promptText, bundleText] = await Promise.all([fs.readFile(promptPath, "utf8"), fs.readFile(bundlePath, "utf8")]);
  if (learnV2Hash(promptText) !== manifest.promptHash || learnV2Hash(bundleText) !== manifest.bundleHash) {
    rejected.push({ outputPath, id: manifest.episodeId, reason: "request-file-hash-mismatch", detail: "Behavior eval prompt or bundle hash does not match manifest." });
    return false;
  }
  return true;
}

function isBehaviorEvalManifestPath(root: string, manifestPath: string): boolean {
  const requestRoot = path.join(path.resolve(root), ".openskill-kit", "learn-v2", "model-requests");
  const resolved = path.resolve(manifestPath);
  return path.basename(resolved) === "request-manifest.json" && path.dirname(path.dirname(resolved)) === requestRoot && learnV2IsInside(requestRoot, path.dirname(resolved));
}

function isBehaviorEvalOutputPath(root: string, outputPath: string): boolean {
  const requestRoot = path.join(path.resolve(root), ".openskill-kit", "learn-v2", "model-requests");
  const resolved = path.resolve(outputPath);
  return path.basename(resolved) === "response.json" && path.dirname(path.dirname(resolved)) === requestRoot && learnV2IsInside(requestRoot, path.dirname(resolved));
}

function resolveEvalProjectPath(root: string, value: string | undefined): string | undefined {
  if (!value || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\") || /(^|\/)\.\.(\/|$)/.test(value)) return undefined;
  const resolved = path.resolve(root, value);
  return learnV2IsInside(path.resolve(root), resolved) ? resolved : undefined;
}

function summarizeBehaviorEvalStatus(results: LearnV2LlmBehaviorEvalOutput["results"]): "pass" | "fail" | "needs-review" | "not-run" {
  if (!results.length) return "not-run";
  if (results.some((item) => item.status === "fail")) return "fail";
  if (results.some((item) => item.status === "needs-review")) return "needs-review";
  return "pass";
}

function renderBehaviorEvalApplyMarkdown(artifact: {
  generatedAt: string;
  status: string;
  evals: Array<{ evalId: string; resultCount: number; results: LearnV2LlmBehaviorEvalOutput["results"] }>;
}): string {
  const lines = [
    "# Learn v2 Agent Behavior Eval",
    "",
    `Generated: ${artifact.generatedAt}`,
    `Status: ${artifact.status}`,
    ""
  ];
  for (const evaluation of artifact.evals) {
    lines.push(`## ${evaluation.evalId}`, "", `Results: ${evaluation.resultCount}`, "");
    for (const result of evaluation.results) {
      lines.push(`- ${result.scenarioId}: ${result.status} (improved=${result.behaviorImproved}, regressions=${result.regressions.length}, overhead=${result.tokenOverheadAssessment})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function extractFirstJsonObject(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Model output is empty");
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("Model output did not contain a JSON object");
  return trimmed.slice(start, end + 1);
}

function renderBaselineEvalPlan(scenario: LearnV2BehaviorDeltaGoldenScenario): string[] {
  return [
    `Task: ${scenario.title}`,
    scenario.task.paths.length ? `Inspect scoped paths: ${scenario.task.paths.join(", ")}` : "Inspect files relevant to the task.",
    "Make the smallest coherent implementation change.",
    scenario.task.commands.length ? `Run supplied verification command shape(s): ${scenario.task.commands.join(", ")}` : "Run appropriate verification for the changed code.",
    "Summarize changed behavior and verification status."
  ];
}

function renderWithConceptEvalPlan(scenario: LearnV2BehaviorDeltaGoldenScenario, concepts: LearnV2ConceptCard[]): string[] {
  const lines = [...renderBaselineEvalPlan(scenario)];
  for (const concept of concepts) {
    lines.push(`Apply learned behavior: ${concept.canonicalBehavior}`);
    if (concept.conditions?.appliesWhen.length) lines.push(`Applies when: ${concept.conditions.appliesWhen.join("; ")}`);
    if (concept.conditions?.doesNotApplyWhen.length) lines.push(`Do not apply when: ${concept.conditions.doesNotApplyWhen.join("; ")}`);
    if (concept.activation.commands.length) lines.push(`Preferred commands: ${concept.activation.commands.join("; ")}`);
  }
  return lines;
}

function planChars(lines: string[]): number {
  return lines.join("\n").length;
}

function estimateTokens(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}

function planRegressionFindings(scenario: LearnV2BehaviorDeltaGoldenScenario, withConceptPlan: string[]): string[] {
  const text = withConceptPlan.join("\n").toLowerCase();
  return scenario.expectedPlanExcludes
    .map((value) => value.toLowerCase())
    .filter((value) => value && text.includes(value))
    .map((value) => `forbidden-text:${value}`);
}

function declassifyBehaviorDeltaCase(root: string, item: LearnV2BehaviorDeltaEvalCase): LearnV2BehaviorDeltaEvalCase {
  const scrub = (value: string) => scrubEvalText(root, value);
  return {
    ...item,
    taskPrompt: scrub(item.taskPrompt),
    paths: item.paths.map(scrub),
    commands: item.commands.map(scrub),
    taskTypes: item.taskTypes.map(scrub),
    activatedConceptText: item.activatedConceptText.map(scrub),
    expectedConceptText: item.expectedConceptText.map(scrub),
    baselinePlan: item.baselinePlan.map(scrub),
    withConceptPlan: item.withConceptPlan.map(scrub),
    regressionFindings: item.regressionFindings.map(scrub),
    expectedPlanIncludes: item.expectedPlanIncludes.map(scrub),
    expectedPlanExcludes: item.expectedPlanExcludes.map(scrub)
  };
}

function declassifyCounterfactualTraceCase(root: string, item: LearnV2CounterfactualTraceEvalCase): LearnV2CounterfactualTraceEvalCase {
  const scrub = (value: string) => scrubEvalText(root, value);
  return {
    ...item,
    taskPrompt: scrub(item.taskPrompt),
    paths: item.paths.map(scrub),
    commands: item.commands.map(scrub),
    taskTypes: item.taskTypes.map(scrub),
    expectedBehavior: scrub(item.expectedBehavior),
    negativeSignals: item.negativeSignals.map(scrub)
  };
}

function scrubEvalText(root: string, value: string): string {
  const escapedRoot = escapeRegExp(root.replace(/\\/g, "/"));
  const normalized = value.replace(/\\/g, "/");
  return normalized
    .replace(new RegExp(escapedRoot, "gi"), "[PROJECT_ROOT]")
    .replace(/\b[A-Z]:\/Users\/[^/\s"'`]+/gi, "[USER_HOME]")
    .replace(/\/(?:Users|home)\/[^/\s"'`]+/gi, "[USER_HOME]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{16,})\b/g, "[SECRET]");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function learnV2ProjectRelativePath(root: string, file: string): string {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
}

function tokenOverlapRatio(expected: string, actual: string): number {
  const expectedTokens = semanticTokens(expected);
  if (!expectedTokens.size) return 1;
  const actualTokens = semanticTokens(actual);
  const overlap = [...expectedTokens].filter((token) => actualTokens.has(token)).length;
  return overlap / expectedTokens.size;
}

function semanticTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
}

function leakIssuesForConcepts(root: string, concepts: LearnV2ConceptCard[]): string[] {
  const text = JSON.stringify(concepts.map((concept) => ({
    id: concept.id,
    title: concept.title,
    canonicalBehavior: concept.canonicalBehavior,
    behaviorDelta: concept.behaviorDelta,
    scope: concept.scope,
    conditions: concept.conditions,
    activation: concept.activation,
    counterevidence: concept.counterevidence,
    evidenceIds: concept.evidenceIds
  })));
  const issues: string[] = [];
  const normalizedText = text.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/");
  if (normalizedRoot && normalizedText.toLowerCase().includes(normalizedRoot.toLowerCase())) issues.push("project root leaked");
  if (/\b[A-Z]:[\\/]Users[\\/]/i.test(text) || /\b[A-Z]:\/Users\//i.test(normalizedText) || /\/(?:Users|home)\/[^/\s"'`]+/i.test(normalizedText)) issues.push("absolute user path leaked");
  if (/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{16,})\b/.test(text)) issues.push("secret-like token leaked");
  if (/raw_[a-f0-9]{8,}/i.test(text)) issues.push("raw vault ref leaked into output-facing concept text");
  return issues;
}

function renderLearnV2Eval(report: LearnV2EvalReport): string {
  return [
    "# Learn v2 Eval",
    "",
    `Status: ${report.status}`,
    `Episodes replayed: ${report.replayEpisodeCount}`,
    `Extraction goldens: ${report.extractionGoldenCount}`,
    `Behavior delta goldens: ${report.behaviorDeltaGoldenCount}`,
    `Counterfactual trace cases: ${report.counterfactualTraceCaseCount}`,
    `Proof boundary: ${report.proofBoundary.method} (sandbox=${report.proofBoundary.sandboxExecuted}, agent=${report.proofBoundary.agentExecuted})`,
    `Leak check: ${report.leakCheck.status}`,
    `Compression ratio: ${report.tokenBudget.compressionRatio}`,
    `Result rows: ${report.summary.resultCounts.pass}/${report.summary.resultCounts.total} pass`,
    "",
    "## Proof Boundary",
    "",
    `Method: ${report.proofBoundary.method}`,
    `Sandbox executed: ${report.proofBoundary.sandboxExecuted}`,
    `Agent executed: ${report.proofBoundary.agentExecuted}`,
    `Proves: ${report.proofBoundary.proves.join("; ")}`,
    `Does not prove: ${report.proofBoundary.doesNotProve.join("; ")}`,
    "",
    "## Behavior Delta",
    "",
    `Status: ${report.summary.behaviorDelta.status}`,
    `Scenarios: ${report.summary.behaviorDelta.passedScenarios}/${report.summary.behaviorDelta.scenarioCount} pass`,
    `Activated concepts: ${report.summary.behaviorDelta.activatedConceptCount}`,
    `Agent eval: ${report.summary.behaviorDelta.agentStatus} (${report.summary.behaviorDelta.agentResultCount} result(s))`,
    report.summary.behaviorDelta.agentFailedScenarioIds.length ? `Agent failed scenarios: ${report.summary.behaviorDelta.agentFailedScenarioIds.join(", ")}` : "Agent failed scenarios: none",
    report.summary.behaviorDelta.agentNeedsReviewScenarioIds.length ? `Agent needs-review scenarios: ${report.summary.behaviorDelta.agentNeedsReviewScenarioIds.join(", ")}` : "Agent needs-review scenarios: none",
    `Token overhead: ${report.summary.behaviorDelta.tokenOverheadTokens} estimated token(s) total, average ${report.summary.behaviorDelta.averageTokenOverheadTokens}, max ${report.summary.behaviorDelta.maxTokenOverheadTokens}`,
    `Regression findings: ${report.summary.behaviorDelta.regressionFindingCount}`,
    report.summary.behaviorDelta.failedScenarioIds.length ? `Failed scenarios: ${report.summary.behaviorDelta.failedScenarioIds.join(", ")}` : "Failed scenarios: none",
    "",
    "## Activation Replay",
    "",
    `Status: ${report.summary.activationReplay.status}`,
    `Retrieved: ${report.summary.activationReplay.retrievedConcepts}/${report.summary.activationReplay.replayableConcepts}`,
    `Retrieval rate: ${report.summary.activationReplay.retrievalRate}`,
    report.summary.activationReplay.misses.length ? `Misses: ${report.summary.activationReplay.misses.slice(0, 10).join(", ")}` : "Misses: none",
    "",
    "## Counterfactual Trace",
    "",
    `Status: ${report.summary.counterfactualTrace.status}`,
    `Activated cases: ${report.summary.counterfactualTrace.activatedCases}/${report.summary.counterfactualTrace.caseCount}`,
    `Activation rate: ${report.summary.counterfactualTrace.activationRate}`,
    report.summary.counterfactualTrace.misses.length ? `Misses: ${report.summary.counterfactualTrace.misses.slice(0, 10).join(", ")}` : "Misses: none",
    report.summary.counterfactualTrace.suppressionMisses.length ? `Suppression misses: ${report.summary.counterfactualTrace.suppressionMisses.slice(0, 10).join(", ")}` : "Suppression misses: none",
    "",
    "## Results",
    "",
    ...report.results.flatMap((result) => [
      `### ${result.id}`,
      "",
      `Status: ${result.status}`,
      ...result.checks.map((check) => `- ${check.name}: ${check.status} (${check.details})`),
      ""
    ])
  ].join("\n");
}

function learnV2EvalProofBoundary(input: {
  behaviorDeltaScenarioCount: number;
  counterfactualTraceCaseCount: number;
  sandboxProbeStatus?: "pass" | "fail";
  behaviorAgentEvalStatus?: "pass" | "fail" | "needs-review" | "not-run";
  unreviewedGoldenProposal?: boolean;
}): LearnV2EvalReport["proofBoundary"] {
  const proves = [
    "concept retrieval from stored episodes",
    "deterministic activation scoring",
    "memory-admission activation exclusion for one-off/rejected/superseded concepts",
    "conditional memory admission non-overlearning checks",
    "open-world grounding authority and evidence-separation checks"
  ];
  const doesNotProve = [
    "real agent task success",
    "external model judgment quality"
  ];
  if (input.behaviorDeltaScenarioCount > 0) {
    proves.push("configured behavior-delta golden checks");
  } else {
    doesNotProve.push("configured behavior-delta golden checks");
  }
  if (input.counterfactualTraceCaseCount > 0) {
    proves.push("deterministic counterfactual trace activation checks");
  } else {
    doesNotProve.push("counterfactual trace activation checks");
  }
  const sandboxExecuted = input.sandboxProbeStatus === "pass";
  if (sandboxExecuted) {
    proves.push("local sandbox verifier command execution");
  } else {
    doesNotProve.push("sandbox execution success");
  }
  const agentExecuted = input.behaviorAgentEvalStatus === "pass";
  if (agentExecuted) {
    proves.push("agent-backed behavior-delta judgment");
  } else if (input.behaviorAgentEvalStatus === "fail" || input.behaviorAgentEvalStatus === "needs-review") {
    doesNotProve.push(`passing agent-backed behavior judgment (${input.behaviorAgentEvalStatus})`);
  } else {
    doesNotProve.push("agent-backed behavior judgment");
  }
  if (input.unreviewedGoldenProposal) {
    doesNotProve.push("reviewed eval golden quality");
  }
  return {
    method: "deterministic-local-replay",
    sandboxExecuted,
    agentExecuted,
    proves,
    doesNotProve
  };
}
