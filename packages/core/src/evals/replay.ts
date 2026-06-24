import { promises as fs } from "node:fs";
import path from "node:path";
import { BehaviorEvalReportSchema, BehaviorEvalScenarioSchema, type BehaviorEvalScenario } from "./schema.js";

export interface RunBehaviorEvalOptions {
  projectRoot: string;
  scenariosPath?: string;
  now?: Date;
}

export async function runBehaviorEval(options: RunBehaviorEvalOptions) {
  const root = path.resolve(options.projectRoot);
  const scenarios = await loadScenarios(root, options.scenariosPath);
  const corpus = await compiledCorpus(root);
  const results = scenarios.map((scenario) => {
    const missing = scenario.expectedPreferenceText.filter((text) => !corpus.toLowerCase().includes(text.toLowerCase()));
    return { id: scenario.id, title: scenario.title, status: missing.length ? "fail" as const : "pass" as const, missing };
  });
  const passCount = results.filter((result) => result.status === "pass").length;
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
    results,
    artifacts: { json, markdown }
  });
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(json, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(markdown, renderMarkdown(report), "utf8");
  return report;
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
    expectedPreferenceText: [node.statement]
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
    `Scenarios: ${report.passCount}/${report.scenarioCount}`,
    "",
    ...report.results.flatMap((result) => [
      `## ${result.title}`,
      "",
      `Status: ${result.status}`,
      result.missing.length ? `Missing: ${result.missing.join(", ")}` : "Missing: none",
      ""
    ])
  ].join("\n");
}
