import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { LearnV2EvalReportSchema, type LearnV2ConceptCard, type LearnV2EvalReport, type LearnV2TaskEpisode } from "./schemas.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { scoreLearnV2ActivationEntries } from "./activation.js";

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
  const leakIssues = leakIssuesForConcepts(concepts);
  const goldens = options.goldensPath ? await loadLearnV2ExtractionGoldens(root, options.goldensPath) : [];
  const counterfactualCases = buildCounterfactualTraceCases(episodes, concepts);
  const rawChars = episodes.reduce((sum, episode) => sum + episode.tokenBudget.inputChars, 0);
  const compressedChars = episodes.reduce((sum, episode) => sum + episode.tokenBudget.compressedChars, 0);
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
    evaluateActivationReplay(episodes, concepts),
    evaluateCounterfactualTraceCases(concepts, counterfactualCases),
    ...goldens.map((golden) => evaluateGolden(golden, episodes, concepts))
  ];
  const report = LearnV2EvalReportSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.eval-report.v1",
    status: results.every((result) => result.status === "pass") ? "pass" : "fail",
    extractionGoldenCount: goldens.length,
    counterfactualTraceCaseCount: counterfactualCases.length,
    replayEpisodeCount: episodes.length,
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
    artifacts: { json, markdown, counterfactualCases: counterfactualCasesPath }
  });
  await writeJsonAtomic(counterfactualCasesPath, {
    schemaVersion: "openskill-kit.counterfactual-trace-eval-cases.v1",
    generatedAt: now.toISOString(),
    cases: counterfactualCases
  });
  await writeJsonAtomic(json, report);
  await fs.writeFile(markdown, renderLearnV2Eval(report), "utf8");
  return report;
}

export async function loadLearnV2ExtractionGoldens(rootInput: string, goldensPathInput: string): Promise<LearnV2ExtractionGoldenScenario[]> {
  const root = path.resolve(rootInput);
  const file = path.resolve(root, goldensPathInput);
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  const values = Array.isArray(parsed) ? parsed : parsed.scenarios;
  return (values ?? []).map((item: unknown) => LearnV2ExtractionGoldenScenarioSchema.parse(item));
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

function evaluateCounterfactualTraceCases(concepts: LearnV2ConceptCard[], cases: LearnV2CounterfactualTraceEvalCase[]): LearnV2EvalReport["results"][number] {
  const entries = concepts
    .filter((concept) => concept.status !== "rejected" && concept.status !== "one-off" && concept.status !== "superseded")
    .map((concept) => ({
      conceptId: concept.id,
      status: concept.status,
      title: concept.title,
      phrases: concept.activation.phrases,
      pathGlobs: concept.activation.pathGlobs,
      commands: concept.activation.commands,
      taskTypes: concept.scope.taskTypes,
      negativeTriggers: concept.scope.negativeTriggers,
      confidence: concept.confidence,
      risk: concept.risk
    }));
  const misses: string[] = [];
  const suppressionMisses: string[] = [];
  for (const item of cases) {
    const ranked = scoreLearnV2ActivationEntries(entries, {
      includeCandidates: true,
      query: item.taskPrompt,
      paths: item.paths,
      commands: item.commands,
      taskTypes: item.taskTypes
    });
    if (!ranked.slice(0, 5).some((match) => match.conceptId === item.conceptId && match.score > 0)) misses.push(item.conceptId);
    const concept = concepts.find((card) => card.id === item.conceptId);
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
  const pass = misses.length === 0 && suppressionMisses.length === 0;
  return {
    id: "counterfactual-trace-eval",
    status: pass ? "pass" : "fail",
    checks: [
      check(
        "expected-concept-activation",
        misses.length === 0,
        cases.length ? `${cases.length - misses.length}/${cases.length} counterfactual case(s) activated expected concept${misses.length ? `; misses: ${misses.slice(0, 6).join(", ")}` : ""}` : "no counterfactual cases"
      ),
      check(
        "negative-trigger-suppression",
        suppressionMisses.length === 0,
        suppressionMisses.length ? `suppression misses: ${suppressionMisses.slice(0, 6).join(", ")}` : "negative triggers suppress matching concepts"
      )
    ]
  };
}

function evaluateActivationReplay(episodes: LearnV2TaskEpisode[], concepts: LearnV2ConceptCard[]): LearnV2EvalReport["results"][number] {
  const replayable = concepts.filter((concept) => concept.status !== "rejected" && concept.status !== "one-off" && concept.status !== "superseded");
  const entries = replayable.map((concept) => ({
    conceptId: concept.id,
    status: concept.status,
    title: concept.title,
    phrases: concept.activation.phrases,
    pathGlobs: concept.activation.pathGlobs,
    commands: concept.activation.commands,
    taskTypes: concept.scope.taskTypes,
    negativeTriggers: concept.scope.negativeTriggers,
    confidence: concept.confidence,
    risk: concept.risk
  }));
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
  return {
    id: "activation-replay",
    status: pass ? "pass" : "fail",
    checks: [check(
      "originating-episode-retrieval",
      pass,
      replayable.length ? `${replayable.length - misses.length}/${replayable.length} concept(s) retrieved from originating episode context${misses.length ? `; misses: ${misses.slice(0, 6).join(", ")}` : ""}` : "no replayable concepts"
    )]
  };
}

function check(name: string, passed: boolean, details: string): LearnV2EvalReport["results"][number]["checks"][number] {
  return { name, status: passed ? "pass" : "fail", details };
}

function leakIssuesForConcepts(concepts: LearnV2ConceptCard[]): string[] {
  const text = JSON.stringify(concepts.map((concept) => ({
    id: concept.id,
    title: concept.title,
    canonicalBehavior: concept.canonicalBehavior,
    behaviorDelta: concept.behaviorDelta,
    activation: concept.activation,
    evidenceIds: concept.evidenceIds
  })));
  const issues: string[] = [];
  if (/\b[A-Z]:\\Users\\/i.test(text)) issues.push("absolute user path leaked");
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
    `Counterfactual trace cases: ${report.counterfactualTraceCaseCount}`,
    `Leak check: ${report.leakCheck.status}`,
    `Compression ratio: ${report.tokenBudget.compressionRatio}`,
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
