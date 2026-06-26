import { promises as fs } from "node:fs";
import path from "node:path";
import { appendEvent } from "../events/store.js";
import { initAdaptiveProject } from "../lifecycle/init.js";
import { proposeSemanticPreference, type ProposeSemanticPreferenceResult } from "../preferences/proposals.js";
import type { PreferenceCategory, SuggestedCompileTarget } from "../schema/constants.js";
import { auditOpenWorldLeakage } from "./leakage.js";
import { AnchorCardSchema, type AnchorCard, type OpenWorldEvolutionRun, type OpenWorldTask } from "./schema.js";
import { readOpenWorldEvolutionRun, readOpenWorldTask, writeOpenWorldLeakageAudit } from "./store.js";

export interface PromoteOpenWorldRunOptions {
  statement?: string;
  category?: PreferenceCategory;
  dryRun?: boolean;
  now?: Date;
}

export interface PromoteOpenWorldRunResult {
  schemaVersion: "openskill-kit.openworld-promotion.v1";
  status: "planned" | "proposed";
  runId: string;
  taskId: string;
  proposal?: ProposeSemanticPreferenceResult;
  proposalInput: {
    statement: string;
    category: PreferenceCategory;
    scope: { level: "project" | "path"; paths: string[] };
    confidence: number;
    risk: "low" | "medium" | "high";
    suggestedCompileTargets: SuggestedCompileTarget[];
  };
  auditPath?: string;
  messages: string[];
}

export async function promoteOpenWorldRunToReview(
  projectRoot: string,
  runId: string,
  options: PromoteOpenWorldRunOptions = {}
): Promise<PromoteOpenWorldRunResult> {
  const root = path.resolve(projectRoot);
  const now = options.now ?? new Date();
  const run = await readOpenWorldEvolutionRun(root, runId);
  const task = await readOpenWorldTask(root, run.taskId);
  if (run.status !== "passed") {
    throw new Error(`OpenWorld run ${run.id} is ${run.status}; only passed runs can become review proposals.`);
  }
  if (run.rounds.some((round) => round.failureType === "overfit-risk")) {
    throw new Error(`OpenWorld run ${run.id} has overfit risk; review proposal blocked.`);
  }
  const anchors = await readAnchors(root, task, run.anchorIds);
  const statement = options.statement ?? buildPromotionStatement(task, anchors);
  const audit = auditOpenWorldLeakage([
    { source: run.id, surface: "artifact", value: statement },
    ...anchors.map((anchor) => ({ source: anchor.id, surface: "artifact" as const, value: `${anchor.claim}\n${anchor.sourceQuote ?? ""}` }))
  ], task, now);
  if (audit.status === "blocked") throw new Error(`OpenWorld promotion blocked by leakage audit: ${audit.findings.map((finding) => finding.id).join(", ")}`);
  const category = options.category ?? inferCategory(task, anchors);
  const scope = { level: task.paths.length ? "path" as const : "project" as const, paths: task.paths };
  const confidence = promotionConfidence(run, anchors);
  const suggestedCompileTargets: SuggestedCompileTarget[] = ["context-pack", "agent-skills", "review-checklist"];
  const proposalInput = {
    statement,
    category,
    scope,
    confidence,
    risk: "medium" as const,
    suggestedCompileTargets
  };
  if (options.dryRun === true) {
    return {
      schemaVersion: "openskill-kit.openworld-promotion.v1",
      status: "planned",
      runId: run.id,
      taskId: task.id,
      proposalInput,
      messages: ["Dry run only. No review proposal written.", "Passed OpenWorld output remains review-gated and is not active behavior."]
    };
  }
  await initAdaptiveProject({ projectRoot: root, now });
  const auditPath = await writeOpenWorldLeakageAudit(root, audit);
  const event = await appendEvent(root, {
    sessionId: `openworld-${run.id}`,
    eventType: "test-result",
    source: { adapter: "openworld" },
    normalized: {
      text: `OpenWorld run ${run.id} passed visible and holdout virtual verifiers for ${task.title}.`,
      proofLevel: "artifact-verifier",
      hiddenOracleProof: false
    },
    timestamp: now.toISOString(),
    files: [{ path: path.join(".openskill-kit", "evolution", "runs", run.id, "run.json").replace(/\\/g, "/"), action: "write" }],
    commands: run.rounds.map((round) => ({
      command: "openskill-kit openworld run-verifier",
      args: ["--task-id", run.taskId, "--suite-id", round.verifierSuiteId ?? "", "--split", round.split ?? "visible"].filter(Boolean),
      status: round.status === "passed" ? "pass" as const : "fail" as const
    }))
  });
  const proposal = await proposeSemanticPreference(root, {
    schemaVersion: "openskill-kit.semantic-proposal.v1",
    sessionId: `openworld-${run.id}`,
    statement,
    category,
    scope,
    evidence: [{
      eventId: event.event.id,
      quote: `OpenWorld run ${run.id} passed artifact-verifier checks; hidden-oracle proof is false.`,
      file: path.join(".openskill-kit", "evolution", "runs", run.id, "run.json").replace(/\\/g, "/")
    }],
    counterevidence: [{
      eventId: event.event.id,
      reason: "Artifact-verifier proof is not hidden-oracle benchmark proof."
    }],
    confidence,
    risk: "medium",
    suggestedCompileTargets
  }, now);
  return {
    schemaVersion: "openskill-kit.openworld-promotion.v1",
    status: "proposed",
    runId: run.id,
    taskId: task.id,
    proposal,
    proposalInput,
    auditPath,
    messages: ["Review proposal written.", "No active behavior changed; user review still required before compile or install."]
  };
}

async function readAnchors(root: string, task: OpenWorldTask, anchorIds: string[]): Promise<AnchorCard[]> {
  const anchors: AnchorCard[] = [];
  for (const anchorId of anchorIds) {
    const file = path.join(root, ".openskill-kit", "openworld", "tasks", task.id, "anchors", `${anchorId}.json`);
    const parsed = AnchorCardSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
    anchors.push(parsed);
  }
  return anchors;
}

function buildPromotionStatement(task: OpenWorldTask, anchors: AnchorCard[]): string {
  const claims = anchors
    .filter((anchor) => anchor.usableFor.includes("skill"))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 2)
    .map((anchor) => anchor.claim.replace(/\s+/g, " ").trim());
  const body = claims.length ? claims.join("; ") : task.prompt.replace(/\s+/g, " ").trim();
  return `Prefer OpenWorld-verified workflow for ${task.title}: ${body}`.slice(0, 500);
}

function inferCategory(task: OpenWorldTask, anchors: AnchorCard[]): PreferenceCategory {
  if (anchors.some((anchor) => anchor.anchorType === "safety")) return "security";
  if (task.taskType.includes("test")) return "testing";
  if (task.taskType.includes("api")) return "api";
  if (task.taskType.includes("doc")) return "documentation";
  return "workflow";
}

function promotionConfidence(run: OpenWorldEvolutionRun, anchors: AnchorCard[]): number {
  const passedRounds = run.rounds.filter((round) => round.status === "passed").length;
  const avgAnchorConfidence = anchors.length
    ? anchors.reduce((sum, anchor) => sum + anchor.confidence, 0) / anchors.length
    : 0.5;
  const score = 0.35 + Math.min(0.18, passedRounds * 0.09) + Math.min(0.12, avgAnchorConfidence * 0.12);
  return Math.round(Math.min(0.65, score) * 100) / 100;
}
