import { promises as fs } from "node:fs";
import path from "node:path";
import { BehaviorEvalReportSchema, BehaviorEvalScenarioSchema, type BehaviorEvalScenario } from "./schema.js";
import { retrieveRelevantPreferences } from "../preferences/retrieval.js";

export interface RunBehaviorEvalOptions {
  projectRoot: string;
  scenariosPath?: string;
  now?: Date;
}

export async function runBehaviorEval(options: RunBehaviorEvalOptions) {
  const root = path.resolve(options.projectRoot);
  const scenarios = await loadScenarios(root, options.scenariosPath);
  const corpus = await compiledCorpus(root);
  const commandPolicy = await fs.readFile(path.join(root, ".openskill-kit", "compiled", "behavior", "command-policy.md"), "utf8").catch(() => "");
  const results = await Promise.all(scenarios.map(async (scenario) => evaluateScenario(root, scenario, corpus, commandPolicy, options.now ?? new Date())));
  const passCount = results.filter((result) => result.status === "pass").length;
  const retrievalPassCount = results.filter((result) => result.checks.find((check) => check.name === "retrieval")?.status === "pass").length;
  const privacyLeakCount = results.filter((result) => result.checks.find((check) => check.name === "privacy")?.status === "fail").length;
  const stamp = (options.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const runDir = path.join(root, ".openskill-kit", "evals", "runs", stamp);
  const json = path.join(runDir, "behavior-eval.json");
  const markdown = path.join(runDir, "behavior-eval.md");
  const report = BehaviorEvalReportSchema.parse({
    schemaVersion: "openskill-kit.eval-report.v1",
    status: passCount === scenarios.length ? "pass" : "fail",
    scenarioCount: scenarios.length,
    passCount,
    adherence: scenarios.length ? Math.round((passCount / scenarios.length) * 1000) / 1000 : 1,
    retrievalPrecision: scenarios.length ? Math.round((retrievalPassCount / scenarios.length) * 1000) / 1000 : 1,
    privacyLeakRate: scenarios.length ? Math.round((privacyLeakCount / scenarios.length) * 1000) / 1000 : 0,
    results,
    artifacts: { json, markdown }
  });
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(json, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(markdown, renderMarkdown(report), "utf8");
  return report;
}

async function evaluateScenario(root: string, scenario: BehaviorEvalScenario, corpus: string, commandPolicy: string, now: Date) {
  const bundle = await retrieveRelevantPreferences({ projectRoot: root, query: scenario.prompt, paths: scenario.paths, limit: 8, now });
  const retrievedIds = new Set(bundle.items.map((item) => item.node.id));
  const retrievedText = bundle.compactMarkdown.toLowerCase();
  const simulatedPlan = [
    `Task: ${scenario.prompt}`,
    "Selected behavior:",
    bundle.compactMarkdown,
    "Command policy:",
    commandPolicy
  ].join("\n");
  const checks = [
    check(
      "retrieval",
      scenario.expectedPreferenceIds.every((id) => retrievedIds.has(id)) && scenario.expectedPreferenceText.every((text) => retrievedText.includes(text.toLowerCase())),
      `retrieved ${bundle.items.length} preference(s)`
    ),
    check(
      "plan",
      scenario.expectedPreferenceText.every((text) => simulatedPlan.toLowerCase().includes(text.toLowerCase())),
      "simulated plan applies expected preferences"
    ),
    check(
      "command-policy",
      scenario.expectedCommandText.every((text) => commandPolicy.toLowerCase().includes(text.toLowerCase())),
      "compiled command policy contains expected commands"
    ),
    check(
      "avoidance",
      scenario.forbiddenBehaviorText.every((text) => !simulatedPlan.toLowerCase().includes(text.toLowerCase())),
      "simulated plan avoids forbidden behavior"
    ),
    check(
      "privacy",
      !/(TOKEN=|SECRET=|PASSWORD=|PRIVATE KEY)/i.test(`${corpus}\n${simulatedPlan}`),
      "compiled artifacts and plan contain no obvious secret markers"
    )
  ];
  const missing = [
    ...scenario.expectedPreferenceIds.filter((id) => !retrievedIds.has(id)),
    ...scenario.expectedPreferenceText.filter((text) => !simulatedPlan.toLowerCase().includes(text.toLowerCase())),
    ...scenario.expectedCommandText.filter((text) => !commandPolicy.toLowerCase().includes(text.toLowerCase())),
    ...scenario.forbiddenBehaviorText.filter((text) => simulatedPlan.toLowerCase().includes(text.toLowerCase())).map((text) => `forbidden:${text}`)
  ];
  return { id: scenario.id, title: scenario.title, status: checks.every((item) => item.status === "pass") ? "pass" as const : "fail" as const, missing, checks };
}

function check(name: string, passed: boolean, details: string) {
  return { name, status: passed ? "pass" as const : "fail" as const, details };
}

async function loadScenarios(root: string, scenariosPath?: string): Promise<BehaviorEvalScenario[]> {
  if (scenariosPath) {
    const parsed = JSON.parse(await fs.readFile(path.resolve(root, scenariosPath), "utf8"));
    const values = Array.isArray(parsed) ? parsed : parsed.scenarios;
    return values.map((item: unknown) => BehaviorEvalScenarioSchema.parse(item));
  }
  const graph = JSON.parse(await fs.readFile(path.join(root, ".openskill-kit", "preferences", "graph.json"), "utf8").catch(() => "{\"nodes\":[]}"));
  const active = (graph.nodes ?? []).filter((node: any) => node.status === "active" || node.status === "locked").slice(0, 12);
  return active.map((node: any) => BehaviorEvalScenarioSchema.parse({
    schemaVersion: "openskill-kit.eval-scenario.v1",
    id: `scenario-${node.id}`,
    title: node.title,
    prompt: `Agent should respect: ${node.statement}`,
    paths: node.scope?.paths ?? [],
    expectedPreferenceText: [node.statement],
    expectedPreferenceIds: [node.id],
    expectedCommandText: /command|npm|test|build|lint|typecheck/i.test(node.statement) ? [node.statement] : [],
    forbiddenBehaviorText: []
  }));
}

async function compiledCorpus(root: string): Promise<string> {
  const files = [
    path.join(root, ".openskill-kit", "compiled", "context-pack.md"),
    path.join(root, ".openskill-kit", "compiled", "skills", "project-behavior", "SKILL.md"),
    path.join(root, ".openskill-kit", "compiled", "skills", "project-behavior", "references", "active-preferences.md")
  ];
  const chunks = await Promise.all(files.map((file) => fs.readFile(file, "utf8").catch(() => "")));
  return chunks.join("\n");
}

function renderMarkdown(report: ReturnType<typeof BehaviorEvalReportSchema.parse>): string {
  return [
    "# Behavior Eval",
    "",
    `Status: ${report.status}`,
    `Adherence: ${report.adherence}`,
    `Retrieval precision: ${report.retrievalPrecision}`,
    `Privacy leak rate: ${report.privacyLeakRate}`,
    `Scenarios: ${report.passCount}/${report.scenarioCount}`,
    "",
    ...report.results.flatMap((result) => [
      `## ${result.title}`,
      "",
      `Status: ${result.status}`,
      result.missing.length ? `Missing: ${result.missing.join(", ")}` : "Missing: none",
      ...result.checks.map((check) => `- ${check.name}: ${check.status} (${check.details})`),
      ""
    ])
  ].join("\n");
}
