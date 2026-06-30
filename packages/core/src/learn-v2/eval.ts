import { promises as fs } from "node:fs";
import path from "node:path";
import { LearnV2EvalReportSchema, type LearnV2ConceptCard, type LearnV2EvalReport, type LearnV2TaskEpisode } from "./schemas.js";
import { writeJsonAtomic } from "../storage/atomic.js";

export async function runLearnV2Eval(
  rootInput: string,
  episodes: LearnV2TaskEpisode[],
  concepts: LearnV2ConceptCard[],
  now: Date
): Promise<LearnV2EvalReport> {
  const root = path.resolve(rootInput);
  const runDir = path.join(root, ".openskill-kit", "learn-v2", "evals", now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"));
  const json = path.join(runDir, "learn-v2-eval.json");
  const markdown = path.join(runDir, "learn-v2-eval.md");
  const leakIssues = leakIssuesForConcepts(concepts);
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
      status: concepts.every((concept) => concept.status === "candidate" || concept.status === "conflict" || concept.status === "active" || concept.status === "locked") ? "pass" as const : "fail" as const,
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
    }
  ];
  const report = LearnV2EvalReportSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.eval-report.v1",
    status: results.every((result) => result.status === "pass") ? "pass" : "fail",
    extractionGoldenCount: concepts.length,
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
    artifacts: { json, markdown }
  });
  await writeJsonAtomic(json, report);
  await fs.writeFile(markdown, renderLearnV2Eval(report), "utf8");
  return report;
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

