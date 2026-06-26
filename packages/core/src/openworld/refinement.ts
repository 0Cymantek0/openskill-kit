import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readOpenWorldTask, readVirtualTestSuite, writeOpenWorldEvolutionRun } from "./store.js";
import { runVirtualTestSuite } from "./verifier-runner.js";
import {
  OpenWorldEvolutionRunSchema,
  type OpenWorldEvolutionRun,
  type VirtualTestSuiteExecution
} from "./schema.js";

export interface RunOpenWorldRefinementOptions {
  maxRounds?: number;
  timeoutMs?: number;
  now?: Date;
}

export async function runOpenWorldRefinement(
  projectRoot: string,
  taskId: string,
  suiteId: string,
  options: RunOpenWorldRefinementOptions = {}
): Promise<OpenWorldEvolutionRun> {
  const root = path.resolve(projectRoot);
  const startedAt = options.now ?? new Date();
  const task = await readOpenWorldTask(root, taskId);
  const suite = await readVirtualTestSuite(root, taskId, suiteId);
  const maxRounds = Math.max(1, Math.min(options.maxRounds ?? 3, 5));
  const runId = `owrun_${shortHash(`${taskId}:${suiteId}:${startedAt.toISOString()}`)}`;
  const rounds: OpenWorldEvolutionRun["rounds"] = [];
  let status: OpenWorldEvolutionRun["status"] = "running";
  let wallClockMs = 0;
  const sourceIds = await readSuiteSourceIds(root, suite.artifacts.traceabilityMapPath);

  for (let index = 0; index < maxRounds; index += 1) {
    const visible = await runVirtualTestSuite(root, taskId, suiteId, {
      split: "visible",
      timeoutMs: options.timeoutMs,
      now: new Date(startedAt.getTime() + index)
    });
    const diagnosis = diagnoseVirtualExecution(visible, "visible");
    wallClockMs += visible.results.reduce((sum, result) => sum + result.durationMs, 0);
    rounds.push({
      index,
      status: diagnosis.status,
      verifierSuiteId: suiteId,
      verifierExecutionId: visible.id,
      verifierResultPath: visible.resultPath,
      split: "visible",
      failureType: diagnosis.failureType,
      summary: visible.summary,
      notes: diagnosis.notes
    });
    if (diagnosis.status === "passed") {
      const holdout = await runVirtualTestSuite(root, taskId, suiteId, {
        split: "holdout",
        timeoutMs: options.timeoutMs,
        now: new Date(startedAt.getTime() + maxRounds + index)
      });
      const holdoutDiagnosis = diagnoseVirtualExecution(holdout, "holdout");
      wallClockMs += holdout.results.reduce((sum, result) => sum + result.durationMs, 0);
      rounds.push({
        index: index + 1,
        status: holdoutDiagnosis.status === "passed" ? "passed" : "failed",
        verifierSuiteId: suiteId,
        verifierExecutionId: holdout.id,
        verifierResultPath: holdout.resultPath,
        split: "holdout",
        failureType: holdoutDiagnosis.status === "passed" ? undefined : "overfit-risk",
        summary: holdout.summary,
        notes: holdoutDiagnosis.status === "passed"
          ? ["Holdout verifier passed after visible verifier success."]
          : ["Holdout verifier failed after visible pass; treat as overfit risk and do not promote automatically.", ...holdoutDiagnosis.notes]
      });
      status = holdoutDiagnosis.status === "passed" ? "passed" : "failed";
      break;
    }
    if (diagnosis.failureType !== "sandbox-error" || index >= 1) {
      status = diagnosis.status === "blocked" ? "blocked" : "failed";
      break;
    }
    rounds[rounds.length - 1]!.notes.push("Retrying once because sandbox errors can be transient.");
  }

  if (status === "running") status = "failed";
  const completedAt = new Date(startedAt.getTime() + rounds.length).toISOString();
  const run = OpenWorldEvolutionRunSchema.parse({
    schemaVersion: "openskill-kit.evolution-run.v1",
    id: runId,
    taskId: task.id,
    startedAt: startedAt.toISOString(),
    completedAt,
    status,
    maxRounds,
    rounds,
    sourceIds,
    anchorIds: suite.generatedFromAnchorIds,
    virtualTestSuiteIds: [suiteId],
    leakageAuditIds: suite.leakageAuditId ? [suite.leakageAuditId] : [],
    cost: {
      wallClockMs,
      estimatedTokens: 0
    }
  });
  await writeOpenWorldEvolutionRun(root, run);
  return run;
}

async function readSuiteSourceIds(projectRoot: string, traceabilityMapPath: string | undefined): Promise<string[]> {
  if (!traceabilityMapPath) return [];
  const absolute = path.isAbsolute(traceabilityMapPath) ? traceabilityMapPath : path.join(projectRoot, traceabilityMapPath);
  const text = await fs.readFile(absolute, "utf8").catch(() => "");
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { entries?: Array<{ sourceId?: string }> };
    return Array.from(new Set((parsed.entries ?? []).map((entry) => entry.sourceId).filter((value): value is string => Boolean(value)))).sort();
  } catch {
    return [];
  }
}

export function diagnoseVirtualExecution(
  execution: VirtualTestSuiteExecution,
  split: "visible" | "holdout"
): { status: "passed" | "failed" | "blocked"; failureType?: OpenWorldEvolutionRun["rounds"][number]["failureType"]; notes: string[] } {
  if (execution.summary.blocked > 0 || execution.summary.timeout > 0) {
    return {
      status: "blocked",
      failureType: "sandbox-error",
      notes: [`${split} verifier hit sandbox block/timeout; inspect ${execution.resultPath ?? execution.id}.`]
    };
  }
  if (execution.results.length === 0) {
    return { status: "failed", failureType: "verifier-bug", notes: [`${split} verifier split has no executable cases.`] };
  }
  if (execution.summary.fail === 0 && execution.summary.skipped === 0) {
    return {
      status: "passed",
      notes: [`${split} verifier passed all ${execution.summary.pass} executable case(s).`]
    };
  }
  if (hasFailedCheck(execution, "oracle-marker")) {
    return { status: "blocked", failureType: "leakage", notes: ["Verifier output indicates a hidden-oracle marker risk."] };
  }
  if (hasFailedCheck(execution, "source-hash") || hasFailedCheck(execution, "quote-trace")) {
    return { status: "failed", failureType: "source-conflict", notes: ["Cached source content no longer matches anchor/source trace expectations."] };
  }
  if (hasFailedCheck(execution, "source-cache")) {
    return { status: "failed", failureType: "missing-knowledge", notes: ["Verifier could not find required source cache evidence."] };
  }
  if (execution.summary.skipped > 0) {
    return { status: "failed", failureType: "verifier-bug", notes: ["Verifier suite includes skipped or not-ready cases."] };
  }
  return { status: "failed", failureType: "unknown", notes: [`${split} verifier failed; inspect ${execution.resultPath ?? execution.id}.`] };
}

function hasFailedCheck(execution: VirtualTestSuiteExecution, name: string): boolean {
  for (const result of execution.results) {
    if (!result.stdout) continue;
    try {
      const parsed = JSON.parse(result.stdout) as { checks?: Array<{ name?: string; status?: string }> };
      if ((parsed.checks ?? []).some((check) => check.name === name && check.status === "fail")) return true;
    } catch {
      if (result.status !== "pass" && result.stdout.toLowerCase().includes(name.toLowerCase())) return true;
    }
  }
  return false;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
