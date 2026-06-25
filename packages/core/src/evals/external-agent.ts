import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { loadBehaviorEvalScenarios, type RunBehaviorEvalOptions } from "./replay.js";
import { retrieveRelevantPreferences } from "../preferences/retrieval.js";

const execFileAsync = promisify(execFile);

export interface ExternalAgentEvalReport {
  schemaVersion: "openskill-kit.external-agent-eval.v1";
  status: "planned" | "pass" | "fail";
  mode: "dry-run" | "executed";
  scenarioCount: number;
  passCount: number;
  results: Array<{
    id: string;
    title: string;
    status: "planned" | "pass" | "fail";
    promptPath: string;
    outputPath?: string;
    missing: string[];
  }>;
  artifacts: {
    json: string;
    markdown: string;
  };
}

export interface RunExternalAgentEvalOptions extends RunBehaviorEvalOptions {
  agentCommand?: string;
  agentArgs?: string[];
  dryRun?: boolean;
  timeoutMs?: number;
}

export async function runExternalAgentEval(options: RunExternalAgentEvalOptions): Promise<ExternalAgentEvalReport> {
  const root = path.resolve(options.projectRoot);
  const now = options.now ?? new Date();
  const scenarios = await loadBehaviorEvalScenarios(root, options.scenariosPath);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const runDir = path.join(root, ".openskill-kit", "evals", "runs", stamp, "external-agent");
  await fs.mkdir(path.join(runDir, "prompts"), { recursive: true });
  await fs.mkdir(path.join(runDir, "outputs"), { recursive: true });
  const execute = Boolean(options.agentCommand && options.dryRun !== true);
  const results = [];
  for (const scenario of scenarios) {
    const bundle = await retrieveRelevantPreferences({ projectRoot: root, query: scenario.prompt, paths: scenario.paths, limit: 8, now });
    const promptPath = path.join(runDir, "prompts", `${safeName(scenario.id)}.md`);
    const outputPath = path.join(runDir, "outputs", `${safeName(scenario.id)}.txt`);
    await fs.writeFile(promptPath, renderAgentPrompt(scenario.prompt, bundle.compactMarkdown), "utf8");
    if (!execute) {
      results.push({ id: scenario.id, title: scenario.title, status: "planned" as const, promptPath, missing: [] });
      continue;
    }
    const output = await execFileAsync(options.agentCommand!, [...(options.agentArgs ?? []), promptPath], {
      cwd: root,
      timeout: options.timeoutMs ?? 30_000,
      windowsHide: true,
      maxBuffer: 1_000_000
    }).then((result) => `${result.stdout}\n${result.stderr}`).catch((error) => `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message}`);
    await fs.writeFile(outputPath, output, "utf8");
    const lower = output.toLowerCase();
    const missing = [
      ...scenario.expectedPreferenceText.filter((text) => !lower.includes(text.toLowerCase())),
      ...scenario.expectedCommandText.filter((text) => !lower.includes(text.toLowerCase())),
      ...scenario.forbiddenBehaviorText.filter((text) => lower.includes(text.toLowerCase())).map((text) => `forbidden:${text}`)
    ];
    results.push({ id: scenario.id, title: scenario.title, status: missing.length ? "fail" as const : "pass" as const, promptPath, outputPath, missing });
  }
  const passCount = results.filter((result) => result.status === "pass").length;
  const report: ExternalAgentEvalReport = {
    schemaVersion: "openskill-kit.external-agent-eval.v1",
    status: execute ? passCount === scenarios.length ? "pass" : "fail" : "planned",
    mode: execute ? "executed" : "dry-run",
    scenarioCount: scenarios.length,
    passCount,
    results,
    artifacts: {
      json: path.join(runDir, "external-agent-eval.json"),
      markdown: path.join(runDir, "external-agent-eval.md")
    }
  };
  await fs.writeFile(report.artifacts.json, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(report.artifacts.markdown, renderMarkdown(report), "utf8");
  return report;
}

function renderAgentPrompt(task: string, preferences: string): string {
  return [
    "# External Agent Behavior Eval",
    "",
    "Apply the project behavior below while answering the task.",
    "",
    "## Task",
    "",
    task,
    "",
    "## Project Behavior",
    "",
    preferences,
    ""
  ].join("\n");
}

function renderMarkdown(report: ExternalAgentEvalReport): string {
  return [
    "# External Agent Eval",
    "",
    `Status: ${report.status}`,
    `Mode: ${report.mode}`,
    `Scenarios: ${report.passCount}/${report.scenarioCount}`,
    "",
    ...report.results.flatMap((result) => [
      `## ${result.title}`,
      "",
      `Status: ${result.status}`,
      `Prompt: ${result.promptPath}`,
      result.outputPath ? `Output: ${result.outputPath}` : "Output: not executed",
      result.missing.length ? `Missing: ${result.missing.join(", ")}` : "Missing: none",
      ""
    ])
  ].join("\n");
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80) || "scenario";
}
