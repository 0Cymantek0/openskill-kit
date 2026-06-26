import path from "node:path";
import { createHash } from "node:crypto";
import { readProjectConfig } from "../events/store.js";
import { readPreferenceGraph } from "../preferences/graph.js";
import { retrieveRelevantPreferences } from "../preferences/retrieval.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { readWorkflowGraph } from "../workflows/store.js";
import type { WorkflowGraph, WorkflowNode } from "../workflows/schema.js";
import { BehaviorRoutePlanSchema, type BehaviorRoutePlan } from "./schema.js";

export interface RouteBehaviorInput {
  projectRoot: string;
  query?: string;
  paths?: string[];
  changedFiles?: string[];
  commands?: string[];
  now?: Date;
}

export async function routeBehavior(input: RouteBehaviorInput): Promise<BehaviorRoutePlan> {
  const root = path.resolve(input.projectRoot);
  const now = input.now ?? new Date();
  const graph = await readPreferenceGraph(root);
  const config = await readProjectConfig(root);
  const workflowGraph = await readWorkflowGraph(root, config.projectId, now);
  const paths = normalizeList(input.paths ?? []);
  const changedFiles = normalizeList(input.changedFiles ?? []);
  const query = input.query?.trim() || undefined;
  const retrieval = await retrieveRelevantPreferences({ projectRoot: root, query, paths: [...paths, ...changedFiles], limit: 12 });
  const risk = classifyRisk(query, paths, changedFiles, input.commands ?? []);
  const workflowMatches = matchWorkflows(workflowGraph, query, [...paths, ...changedFiles], input.commands ?? []);
  const novelty = estimateNovelty(query, paths, [
    ...graph.nodes.map((node) => [node.category, node.statement, ...node.scope.paths].join(" ")),
    ...workflowGraph.nodes.map((node) => [node.name, node.description, ...node.trigger.paths, ...node.trigger.taskTypes, ...node.trigger.commands].join(" "))
  ]);
  const preferenceCoverage = estimateLocalCoverage(retrieval.items.length, retrieval.trace.consideredCount, novelty.score);
  const workflowCoverage = workflowMatches.activeMatchedCount > 0
    ? Math.min(1, 0.68 + workflowMatches.activeMatchedCount * 0.12)
    : 0;
  const localCoverage = Math.max(preferenceCoverage, workflowCoverage);
  const relevantConflictIds = new Set(retrieval.items.flatMap((item) => graph.conflicts.filter((conflict) => conflict.nodeIds.includes(item.node.id)).map((conflict) => conflict.id)));
  const conflicts = graph.conflicts.filter((conflict) => relevantConflictIds.has(conflict.id));
  const gates = new Set<BehaviorRoutePlan["gates"][number]>(["privacy"]);
  const reasons: string[] = [];

  if (risk.level !== "low") gates.add("review").add("integrity");
  if (conflicts.length) gates.add("review");
  if (workflowMatches.reviewMatchedCount > 0) gates.add("review");

  let decision: BehaviorRoutePlan["decision"];
  if (conflicts.length) {
    decision = "review-needed";
    reasons.push("Relevant active or pending behavior conflicts need review before use.");
  } else if (workflowMatches.activeMatchedCount > 0 && risk.level === "low") {
    decision = "local-only";
    reasons.push("Reviewed Workflow Graph entries cover the task sequence.");
  } else if (localCoverage >= 0.7 && novelty.score < 0.35) {
    decision = "local-only";
    reasons.push("Active project behavior has enough task/path coverage.");
  } else if (workflowMatches.reviewMatchedCount > 0) {
    decision = "project-evidence";
    reasons.push("Workflow Graph candidates match this task but need review before active use.");
  } else if (novelty.score >= 0.65 || (risk.level === "high" && localCoverage < 0.6)) {
    decision = "openworld-research";
    gates.add("leakage").add("sandbox").add("review");
    reasons.push("Task appears novel or high-risk with weak local behavior coverage.");
  } else if (localCoverage >= 0.35) {
    decision = "project-evidence";
    gates.add("review");
    reasons.push("Some local behavior exists, but evidence is incomplete.");
  } else {
    decision = "review-needed";
    gates.add("review");
    reasons.push("No strong local behavior route found.");
  }

  const openWorldRecommended = decision === "openworld-research";
  const tracePath = path.join(root, ".openskill-kit", "retrieval", "route-plans", `${timestampId(now)}-${shortHash(`${query ?? ""}:${paths.join(",")}`)}.json`);
  const plan = BehaviorRoutePlanSchema.parse({
    schemaVersion: "openskill-kit.behavior-route-plan.v1",
    id: `route_${shortHash(`${now.toISOString()}:${query ?? ""}:${paths.join(",")}`)}`,
    createdAt: now.toISOString(),
    projectRoot: root,
    query,
    paths,
    changedFiles,
    decision,
    risk,
    novelty,
    localCoverage,
    gates: [...gates],
    reasons,
    retrieval: {
      consideredCount: retrieval.trace.consideredCount,
      returnedCount: retrieval.items.length,
      omittedCount: retrieval.trace.omitted.length,
      compactMarkdown: retrieval.compactMarkdown
    },
    workflows: {
      consideredCount: workflowGraph.nodes.length,
      matchedCount: workflowMatches.matched.length,
      activeMatchedCount: workflowMatches.activeMatchedCount,
      reviewMatchedCount: workflowMatches.reviewMatchedCount,
      compactMarkdown: renderWorkflowRouteMarkdown(workflowMatches.matched)
    },
    conflicts,
    openWorld: {
      recommended: openWorldRecommended,
      maxSources: openWorldRecommended ? risk.level === "high" ? 8 : 12 : 0,
      requireVerifier: openWorldRecommended,
      reason: openWorldRecommended ? "OpenWorld should use leakage-audited sources and anchor-backed verifier scaffolds before promotion." : undefined
    },
    tracePath
  });
  await writeJsonAtomic(tracePath, plan);
  return plan;
}

function classifyRisk(query: string | undefined, paths: string[], changedFiles: string[], commands: string[]): BehaviorRoutePlan["risk"] {
  const text = [query, ...paths, ...changedFiles, ...commands].filter(Boolean).join(" ").toLowerCase();
  const reasons: string[] = [];
  if (/\b(secret|token|credential|auth|permission|payment|billing|delete|drop|truncate|migration|prod|production)\b/.test(text)) reasons.push("Sensitive, destructive, or production-adjacent terms.");
  if (/\b(rm\s+-rf|drop\s+table|delete\s+from|format)\b/.test(text)) reasons.push("Destructive command pattern.");
  if (/\b(security|crypto|encryption|oauth|session)\b/.test(text)) reasons.push("Security-sensitive domain.");
  const level = reasons.some((reason) => reason.includes("Destructive")) || reasons.length > 1 ? "high" : reasons.length ? "medium" : "low";
  return { level, reasons };
}

function estimateNovelty(query: string | undefined, paths: string[], corpus: string[]): BehaviorRoutePlan["novelty"] {
  const tokens = tokenize([query, ...paths].join(" "));
  if (tokens.length === 0) return { score: 0.5, reasons: ["No task query or path context supplied."] };
  const corpusTokens = new Set(tokenize(corpus.join(" ")));
  const misses = tokens.filter((token) => !corpusTokens.has(token));
  const score = Math.round((misses.length / tokens.length) * 100) / 100;
  const reasons = score >= 0.65
    ? ["Most task terms are not covered by current behavior graph."]
    : score >= 0.35
      ? ["Some task terms are weakly covered by current behavior graph."]
      : ["Task terms overlap with current behavior graph."];
  return { score, reasons };
}

function estimateLocalCoverage(returned: number, considered: number, novelty: number): number {
  if (considered === 0) return 0;
  const retrievalCoverage = returned > 0 ? Math.min(1, 0.75 + Math.max(0, returned - 1) * 0.08) : 0;
  return Math.round((retrievalCoverage * (1 - novelty * 0.5)) * 100) / 100;
}

function matchWorkflows(graph: WorkflowGraph, query: string | undefined, paths: string[], commands: string[]): {
  matched: WorkflowNode[];
  activeMatchedCount: number;
  reviewMatchedCount: number;
} {
  const tokens = new Set(tokenize([query, ...paths, ...commands].join(" ")));
  const normalizedPaths = paths.map((value) => value.replaceAll("\\", "/"));
  const normalizedCommands = commands.map((value) => value.toLowerCase());
  const matched = graph.nodes.filter((node) => {
    const pathHit = node.trigger.paths.some((workflowPath) => normalizedPaths.some((inputPath) => inputPath.startsWith(workflowPath) || inputPath.includes(`/${workflowPath}`)));
    const commandHit = node.trigger.commands.some((workflowCommand) => normalizedCommands.some((command) => command.includes(workflowCommand.toLowerCase())));
    const textHit = tokenize([node.name, node.description, ...node.trigger.taskTypes, ...node.trigger.commands].join(" ")).some((token) => tokens.has(token));
    return pathHit || commandHit || textHit;
  });
  return {
    matched,
    activeMatchedCount: matched.filter((node) => node.status === "active" || node.status === "locked").length,
    reviewMatchedCount: matched.filter((node) => node.status === "candidate" || node.status === "staged" || node.status === "conflict").length
  };
}

function renderWorkflowRouteMarkdown(nodes: WorkflowNode[]): string {
  if (!nodes.length) return "";
  return [
    "## Relevant Workflows",
    "",
    ...nodes.slice(0, 8).map((node) => `- ${node.id} [${node.status}] ${node.name}: ${node.steps.map((step) => step.instruction).join(" -> ")}`)
  ].join("\n");
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [])].slice(0, 80);
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function timestampId(now: Date): string {
  return now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
