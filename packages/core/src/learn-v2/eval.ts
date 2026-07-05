import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { LearnV2EvalReportSchema, type LearnV2ConceptCard, type LearnV2EvalReport, type LearnV2TaskEpisode } from "./schemas.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { scoreLearnV2ActivationEntries } from "./activation.js";
import { buildLearnV2ActivationIndexEntry } from "./activation-signals.js";
import { evaluateLearnV2ConceptQualityGates } from "./concept-quality-gates.js";

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
  expectedPlanIncludes: string[];
  expectedPlanExcludes: string[];
  minActivatedConcepts: number;
}

type LearnV2EvalResultRow = LearnV2EvalReport["results"][number];
type LearnV2EvalSummary = LearnV2EvalReport["summary"];

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
  const goldenFile = options.goldensPath ? await loadLearnV2EvalGoldens(root, options.goldensPath) : { extraction: [], behaviorDelta: [] };
  const goldens = goldenFile.extraction;
  const behaviorDeltaGoldens = goldenFile.behaviorDelta;
  const counterfactualCases = buildCounterfactualTraceCases(episodes, concepts);
  const behaviorDeltaCases = buildBehaviorDeltaEvalCases(concepts, behaviorDeltaGoldens);
  const rawChars = episodes.reduce((sum, episode) => sum + episode.tokenBudget.inputChars, 0);
  const compressedChars = episodes.reduce((sum, episode) => sum + episode.tokenBudget.compressedChars, 0);
  const activationReplay = evaluateActivationReplay(episodes, concepts);
  const counterfactualTrace = evaluateCounterfactualTraceCases(concepts, counterfactualCases);
  const behaviorDeltaResults = behaviorDeltaCases.map((item) => evaluateBehaviorDeltaCase(item));
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
    activationReplay.result,
    counterfactualTrace.result,
    ...behaviorDeltaResults,
    ...goldens.map((golden) => evaluateGolden(golden, episodes, concepts))
  ];
  const summary = summarizeLearnV2Eval(results, activationReplay.summary, counterfactualTrace.summary, behaviorDeltaCases, behaviorDeltaResults);
  const report = LearnV2EvalReportSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.eval-report.v1",
    status: results.every((result) => result.status === "pass") ? "pass" : "fail",
    extractionGoldenCount: goldens.length,
    behaviorDeltaGoldenCount: behaviorDeltaGoldens.length,
    counterfactualTraceCaseCount: counterfactualCases.length,
    replayEpisodeCount: episodes.length,
    proofBoundary: learnV2EvalProofBoundary(),
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
    artifacts: { json, markdown, counterfactualCases: counterfactualCasesPath, behaviorDeltaCases: behaviorDeltaCasesPath }
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
}> {
  const root = path.resolve(rootInput);
  const file = path.resolve(root, goldensPathInput);
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
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
  return { extraction, behaviorDelta };
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

function buildCounterfactualTraceCases(episodes: LearnV2TaskEpisode[], concepts: LearnV2ConceptCard[]): LearnV2CounterfactualTraceEvalCase[] {
  return concepts
    .filter((concept) => concept.status !== "rejected" && concept.status !== "one-off" && concept.status !== "superseded")
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
  const entries = concepts
    .filter((concept) => concept.status !== "rejected" && concept.status !== "one-off" && concept.status !== "superseded")
    .map(buildLearnV2ActivationIndexEntry);
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

function buildBehaviorDeltaEvalCases(
  concepts: LearnV2ConceptCard[],
  scenarios: LearnV2BehaviorDeltaGoldenScenario[]
): LearnV2BehaviorDeltaEvalCase[] {
  const entries = concepts
    .filter((concept) => concept.status !== "rejected" && concept.status !== "one-off" && concept.status !== "superseded")
    .map(buildLearnV2ActivationIndexEntry);
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
      baselinePlan: renderBaselineEvalPlan(scenario),
      withConceptPlan: renderWithConceptEvalPlan(scenario, activatedConcepts),
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
  const replayable = concepts.filter((concept) => concept.status !== "rejected" && concept.status !== "one-off" && concept.status !== "superseded");
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
  behaviorDeltaResults: LearnV2EvalResultRow[]
): LearnV2EvalSummary {
  const failedBehaviorDeltaIds = behaviorDeltaResults
    .filter((result) => result.status === "fail")
    .map((result) => result.id.replace(/^behavior-delta:/, ""));
  const activatedConceptIds = new Set(behaviorDeltaCases.flatMap((item) => item.activatedConceptIds));
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

function learnV2EvalProofBoundary(): LearnV2EvalReport["proofBoundary"] {
  return {
    method: "deterministic-local-replay",
    sandboxExecuted: false,
    agentExecuted: false,
    proves: [
      "concept retrieval from stored episodes",
      "deterministic activation scoring",
      "configured behavior-delta golden checks"
    ],
    doesNotProve: [
      "real agent task success",
      "sandbox execution success",
      "external model judgment quality"
    ]
  };
}
