import { promises as fs } from "node:fs";
import path from "node:path";
import { BehaviorEvalReportSchema, type BehaviorEvalScenario } from "./schema.js";
import { loadBehaviorEvalScenarios, runBehaviorEval, type RunBehaviorEvalOptions } from "./replay.js";
import { recordEvalCalibrationOutcome } from "../preferences/calibration.js";

export interface BehaviorCompareReport {
  schemaVersion: "openskill-kit.eval-compare.v1";
  status: "pass" | "fail";
  scenarioCount: number;
  baseline: {
    adherence: number;
    passCount: number;
  };
  openskillKit: {
    adherence: number;
    passCount: number;
    reportPath: string;
  };
  improvement: number;
  results: Array<{
    id: string;
    title: string;
    baselineStatus: "pass" | "fail";
    openskillKitStatus: "pass" | "fail";
    delta: "improved" | "unchanged" | "regressed";
  }>;
  artifacts: {
    json: string;
    markdown: string;
  };
}

export async function runBehaviorCompareEval(options: RunBehaviorEvalOptions): Promise<BehaviorCompareReport> {
  const root = path.resolve(options.projectRoot);
  const now = options.now ?? new Date();
  const scenarios = await loadBehaviorEvalScenarios(root, options.scenariosPath);
  const baselineResults = scenarios.map(evaluateBaselineScenario);
  const baselinePassCount = baselineResults.filter((result) => result.status === "pass").length;
  const oskReport = BehaviorEvalReportSchema.parse(await runBehaviorEval({ ...options, now }));
  const oskById = new Map(oskReport.results.map((result) => [result.id, result]));
  const results = baselineResults.map((baseline) => {
    const osk = oskById.get(baseline.id);
    const oskStatus = osk?.status ?? "fail";
    return {
      id: baseline.id,
      title: baseline.title,
      baselineStatus: baseline.status,
      openskillKitStatus: oskStatus,
      delta: baseline.status === oskStatus ? "unchanged" as const : oskStatus === "pass" ? "improved" as const : "regressed" as const
    };
  });
  const baselineAdherence = scenarios.length ? round(baselinePassCount / scenarios.length) : 1;
  const improvement = round(oskReport.adherence - baselineAdherence);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const runDir = path.join(root, ".openskill-kit", "evals", "runs", stamp);
  const report: BehaviorCompareReport = {
    schemaVersion: "openskill-kit.eval-compare.v1",
    status: improvement >= 0 && oskReport.status === "pass" ? "pass" : "fail",
    scenarioCount: scenarios.length,
    baseline: { adherence: baselineAdherence, passCount: baselinePassCount },
    openskillKit: { adherence: oskReport.adherence, passCount: oskReport.passCount, reportPath: oskReport.artifacts.json },
    improvement,
    results,
    artifacts: {
      json: path.join(runDir, "behavior-compare.json"),
      markdown: path.join(runDir, "behavior-compare.md")
    }
  };
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(report.artifacts.json, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(report.artifacts.markdown, renderCompareMarkdown(report), "utf8");
  await recordEvalCalibrationOutcome(root, {
    suite: "agent-ab",
    status: report.improvement < 0 ? "regressed" : report.improvement > 0 ? "improved" : report.status,
    scenarioCount: report.scenarioCount,
    passCount: report.openskillKit.passCount
  }, now);
  return report;
}

function evaluateBaselineScenario(scenario: BehaviorEvalScenario): { id: string; title: string; status: "pass" | "fail" } {
  const prompt = scenario.prompt.toLowerCase();
  const expectedPresent = scenario.expectedPreferenceText.every((text) => prompt.includes(text.toLowerCase()));
  const forbiddenAbsent = scenario.forbiddenBehaviorText.every((text) => !prompt.includes(text.toLowerCase()));
  const commandsPresent = scenario.expectedCommandText.every((text) => prompt.includes(text.toLowerCase()));
  return { id: scenario.id, title: scenario.title, status: expectedPresent && commandsPresent && forbiddenAbsent ? "pass" : "fail" };
}

function renderCompareMarkdown(report: BehaviorCompareReport): string {
  return [
    "# Behavior Eval Baseline Compare",
    "",
    `Status: ${report.status}`,
    `Baseline adherence: ${report.baseline.adherence}`,
    `OpenSkillKit adherence: ${report.openskillKit.adherence}`,
    `Improvement: ${report.improvement}`,
    "",
    ...report.results.flatMap((result) => [
      `## ${result.title}`,
      "",
      `Baseline: ${result.baselineStatus}`,
      `OpenSkillKit: ${result.openskillKitStatus}`,
      `Delta: ${result.delta}`,
      ""
    ])
  ].join("\n");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
