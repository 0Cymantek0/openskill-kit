import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { auditOpenWorldLeakage, sanitizeOpenWorldQuery } from "./leakage.js";
import {
  makeOpenWorldSource,
  readOpenWorldResearchPlan,
  readOpenWorldSource,
  readOpenWorldSourceContent,
  readOpenWorldTask,
  writeAnchorCard,
  writeOpenWorldLeakageAudit,
  writeOpenWorldResearchPlan,
  writeOpenWorldResearchExecution,
  writeOpenWorldSource,
  writeOpenWorldSourceContent,
  writeOpenWorldTaskTextArtifact,
  writeVirtualTestSuite
} from "./store.js";
import { OpenWorldResearchExecutionSchema, OpenWorldResearchPlanSchema } from "./schema.js";
import type { AnchorCard, OpenWorldLeakageAudit, OpenWorldResearchExecution, OpenWorldResearchPlan, OpenWorldSource, OpenWorldSourceCandidate, VirtualTestSuite } from "./schema.js";

const SOURCE_SKIP_DIRS = new Set([".git", ".openskill-kit", "node_modules", "dist", "coverage", "tmp", ".next", ".turbo"]);
const SOURCE_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".json", ".jsonc", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".toml", ".yaml", ".yml"]);

export interface IngestLocalSourceResult {
  schemaVersion: "openskill-kit.openworld-local-source.v1";
  source: OpenWorldSource;
  sourcePath: string;
  contentPath: string;
  audit: OpenWorldLeakageAudit;
  auditPath: string;
}

export async function ingestLocalOpenWorldSource(projectRoot: string, taskId: string, filePath: string, now = new Date()): Promise<IngestLocalSourceResult> {
  const root = path.resolve(projectRoot);
  const task = await readOpenWorldTask(root, taskId);
  const absolute = path.resolve(root, filePath);
  if (!(absolute === root || absolute.startsWith(`${root}${path.sep}`))) throw new Error(`Local source must stay under project root: ${filePath}`);
  const content = await fs.readFile(absolute, "utf8");
  const relative = path.relative(root, absolute).replace(/\\/g, "/");
  const sourceId = `src_${shortHash(`${taskId}:${relative}:${sha256(content)}`)}`;
  return registerOpenWorldSource(root, {
    taskId,
    id: sourceId,
    kind: relative.startsWith("docs/") || relative.endsWith(".md") ? "local-doc" : "project-file",
    uri: relative,
    title: path.basename(relative),
    content,
    now,
    trust: { authority: 0.7, freshness: 0.8, independence: 0.4, rationale: "Project-local source, leakage-audited before caching." },
    privacyClass: "project-private",
    usableFor: ["skill", "virtual-test", "report"]
  });
}

export interface IngestWebSourceOptions {
  url: string;
  title?: string;
  content?: string;
  timeoutMs?: number;
  maxBytes?: number;
  now?: Date;
}

export async function ingestWebOpenWorldSource(projectRoot: string, taskId: string, options: IngestWebSourceOptions): Promise<IngestLocalSourceResult> {
  const root = path.resolve(projectRoot);
  const task = await readOpenWorldTask(root, taskId);
  if (!task.allowWeb) throw new Error("OpenWorld web source ingestion blocked: task allowWeb is false");
  const url = new URL(options.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`Unsupported OpenWorld source URL protocol: ${url.protocol}`);
  const content = options.content ?? await fetchText(url, options.timeoutMs ?? 12000, options.maxBytes ?? 1_000_000);
  const sourceId = `src_${shortHash(`${taskId}:${url.toString()}:${sha256(content)}`)}`;
  return registerOpenWorldSource(root, {
    taskId,
    id: sourceId,
    kind: classifyWebSource(url),
    uri: url.toString(),
    title: options.title ?? url.hostname,
    content,
    now: options.now ?? new Date(),
    locator: { url: url.toString() },
    trust: trustForWebSource(url),
    privacyClass: "openworld-public",
    usableFor: ["skill", "virtual-test", "report"]
  });
}

export interface PlanOpenWorldResearchOptions {
  query?: string;
  paths?: string[];
  maxCandidates?: number;
  maxFilesScanned?: number;
  maxFileBytes?: number;
  includeWebQueries?: boolean;
  write?: boolean;
  now?: Date;
}

export async function planOpenWorldResearch(projectRoot: string, taskId: string, options: PlanOpenWorldResearchOptions = {}): Promise<OpenWorldResearchPlan> {
  const root = path.resolve(projectRoot);
  const task = await readOpenWorldTask(root, taskId);
  const now = options.now ?? new Date();
  const maxCandidates = Math.max(1, Math.min(options.maxCandidates ?? 8, 25));
  const maxFilesScanned = Math.max(maxCandidates, Math.min(options.maxFilesScanned ?? 250, 1000));
  const maxFileBytes = Math.max(4_000, Math.min(options.maxFileBytes ?? 128_000, 1_000_000));
  const queryPlan = buildResearchQueries(task, options.query, options.includeWebQueries ?? true, now);
  const seedPaths = [...new Set([...(task.paths ?? []), ...(options.paths ?? [])].map((item) => item.trim()).filter(Boolean))];
  const files = await discoverCandidateFiles(root, seedPaths, maxFilesScanned);
  const candidateInputs: Array<{ source: string; surface: "query" | "path" | "content" | "artifact"; value: string }> = queryPlan.map((query) => ({
    source: query.id,
    surface: "query" as const,
    value: query.query
  }));
  const candidates: OpenWorldSourceCandidate[] = [];
  const searchTokens = tokenize([task.title, task.prompt, task.taskType, ...(task.languages ?? []), ...seedPaths, options.query ?? ""].join(" "));

  for (const file of files) {
    const relative = path.relative(root, file).replace(/\\/g, "/");
    const content = await fs.readFile(file, "utf8").catch(() => "");
    const sample = content.slice(0, maxFileBytes);
    const audit = auditOpenWorldLeakage([
      { source: relative, surface: "path", value: relative },
      { source: relative, surface: "content", value: sample }
    ], task, now);
    candidateInputs.push({ source: relative, surface: "path", value: relative });
    candidateInputs.push({ source: relative, surface: "content", value: sample });
    const score = scoreSourceCandidate(relative, sample, searchTokens, seedPaths);
    const blocked = audit.findings.some((finding) => finding.level === "block");
    const kind = relative.startsWith("docs/") || relative.endsWith(".md") || relative.endsWith(".mdx") ? "local-doc" : "project-file";
    candidates.push({
      id: `owcand_${shortHash(`${taskId}:${relative}`)}`,
      taskId,
      kind,
      uri: relative,
      title: path.basename(relative),
      locator: { path: relative },
      score,
      status: blocked ? "blocked" : score >= 0.35 ? "recommended" : "available",
      privacyClass: "project-private",
      usableFor: ["skill", "virtual-test", "report"],
      reasons: candidateReasons(relative, sample, score, seedPaths, blocked),
      leakageFindingIds: audit.findings.map((finding) => finding.id),
      ingestCommand: blocked ? undefined : `openskill-kit openworld research --task-id ${taskId} --file ${quoteArg(relative)}`
    });
  }

  const sorted = candidates
    .sort((a, b) => statusWeight(b.status) - statusWeight(a.status) || b.score - a.score || a.uri.localeCompare(b.uri))
    .slice(0, maxCandidates + Math.min(4, candidates.filter((candidate) => candidate.status === "blocked").length));
  const recommended = sorted.filter((candidate) => candidate.status === "recommended").slice(0, maxCandidates);
  const topCandidates = [
    ...recommended,
    ...sorted.filter((candidate) => candidate.status !== "recommended").slice(0, Math.max(0, maxCandidates - recommended.length))
  ];
  const audit = auditOpenWorldLeakage(candidateInputs, task, now);
  const recommendedNextCommands = [
    ...topCandidates.filter((candidate) => candidate.status !== "blocked" && candidate.ingestCommand).slice(0, 5).map((candidate) => candidate.ingestCommand!),
    ...(task.allowWeb && queryPlan.some((query) => query.status !== "blocked")
      ? [`openskill-kit openworld fetch-source --task-id ${taskId} --url <trusted-doc-url> --content-file <cached-text-file>`]
      : []),
    ...(!task.allowWeb ? ["Re-run init-task with --allow-web only if external public sources are explicitly acceptable."] : [])
  ];
  const planId = `owrplan_${shortHash(`${taskId}:${now.toISOString()}:${topCandidates.map((candidate) => candidate.uri).join(",")}`)}`;
  const draft = OpenWorldResearchPlanSchema.parse({
    schemaVersion: "openskill-kit.openworld-research-plan.v1",
    id: planId,
    taskId,
    createdAt: now.toISOString(),
    queryPlan,
    candidates: topCandidates,
    recommendedNextCommands,
    summary: {
      queryCount: queryPlan.length,
      candidateCount: topCandidates.length,
      recommendedCount: topCandidates.filter((candidate) => candidate.status === "recommended").length,
      blockedCount: topCandidates.filter((candidate) => candidate.status === "blocked").length,
      webAllowed: task.allowWeb
    },
    leakageAuditId: audit.id
  });
  const auditPath = await writeOpenWorldLeakageAudit(root, audit);
  const planPath = options.write === false ? undefined : await writeOpenWorldResearchPlan(root, draft);
  return OpenWorldResearchPlanSchema.parse({
    ...draft,
    leakageAuditPath: path.relative(root, auditPath).replace(/\\/g, "/"),
    planPath: planPath ? path.relative(root, planPath).replace(/\\/g, "/") : undefined,
    recommendedNextCommands: draft.recommendedNextCommands
  });
}

export interface ExecuteOpenWorldResearchPlanWebSource {
  url: string;
  title?: string;
  content?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface ExecuteOpenWorldResearchPlanOptions {
  planId?: string;
  plan?: OpenWorldResearchPlan;
  includeAvailable?: boolean;
  maxLocalSources?: number;
  explicitWebSources?: ExecuteOpenWorldResearchPlanWebSource[];
  dryRun?: boolean;
  write?: boolean;
  now?: Date;
}

export interface ExecuteOpenWorldResearchPlanResult {
  schemaVersion: "openskill-kit.openworld-research-execution-result.v1";
  execution: OpenWorldResearchExecution;
  executionPath?: string;
  markdownPath?: string;
}

export async function executeOpenWorldResearchPlan(
  projectRoot: string,
  taskId: string,
  options: ExecuteOpenWorldResearchPlanOptions = {}
): Promise<ExecuteOpenWorldResearchPlanResult> {
  const root = path.resolve(projectRoot);
  const task = await readOpenWorldTask(root, taskId);
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const explicitWebSources = options.explicitWebSources ?? [];
  const plan = options.plan ?? await readOpenWorldResearchPlan(root, taskId, options.planId);
  if (plan.taskId !== taskId) throw new Error(`OpenWorld research plan ${plan.id} belongs to task ${plan.taskId}, not ${taskId}.`);

  const localLimit = Math.max(0, Math.min(options.maxLocalSources ?? 5, 25));
  const localCandidates = plan.candidates
    .filter((candidate) => candidate.status === "recommended" || (options.includeAvailable === true && candidate.status === "available"))
    .filter((candidate) => candidate.status !== "blocked")
    .filter((candidate) => isLocalCandidate(candidate))
    .slice(0, localLimit);
  const skipped = plan.candidates
    .filter((candidate) => candidate.status === "blocked")
    .map((candidate) => ({ uri: candidate.uri, reason: "Blocked by source-plan leakage audit." }));
  const ingested: OpenWorldResearchExecution["ingested"] = [];
  const errors: OpenWorldResearchExecution["errors"] = [];

  for (const candidate of localCandidates) {
    if (dryRun) {
      skipped.push({ uri: candidate.uri, reason: "Dry run; source not ingested." });
      continue;
    }
    try {
      const result = await ingestLocalOpenWorldSource(root, taskId, candidate.locator.path ?? candidate.uri, now);
      ingested.push(sourceExecutionEntry(result.source, result.audit.id));
    } catch (error) {
      errors.push({ uri: candidate.uri, message: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const webSource of explicitWebSources) {
    if (dryRun) {
      skipped.push({ uri: webSource.url, reason: "Dry run; explicit web source not ingested." });
      continue;
    }
    try {
      const result = await ingestWebOpenWorldSource(root, taskId, {
        url: webSource.url,
        title: webSource.title,
        content: webSource.content,
        timeoutMs: webSource.timeoutMs,
        maxBytes: webSource.maxBytes,
        now
      });
      ingested.push(sourceExecutionEntry(result.source, result.audit.id));
    } catch (error) {
      errors.push({ uri: webSource.url, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const status = dryRun
    ? "planned"
    : errors.length && ingested.length === 0
      ? "blocked"
      : errors.length
        ? "partial"
        : "completed";
  const draft = OpenWorldResearchExecutionSchema.parse({
    schemaVersion: "openskill-kit.openworld-research-execution.v1",
    id: `owrexec_${shortHash(`${taskId}:${plan.id}:${now.toISOString()}:${ingested.map((item) => item.sourceId).join(",")}:${errors.length}`)}`,
    taskId,
    planId: plan.id,
    executedAt: now.toISOString(),
    status,
    dryRun,
    summary: {
      plannedLocalCount: localCandidates.length,
      ingestedCount: ingested.length,
      skippedCount: skipped.length,
      errorCount: errors.length,
      explicitWebCount: explicitWebSources.length
    },
    ingested,
    skipped,
    errors,
    sourceIds: ingested.map((item) => item.sourceId),
    leakageAuditIds: [...new Set(ingested.map((item) => item.auditId).filter((value): value is string => Boolean(value)))]
  });
  if (options.write === false || dryRun) {
    return { schemaVersion: "openskill-kit.openworld-research-execution-result.v1", execution: draft };
  }
  const executionPath = await writeOpenWorldResearchExecution(root, draft);
  const markdownPath = await writeOpenWorldTaskTextArtifact(root, task.id, ["research", "executions", `${draft.id}.md`], renderOpenWorldResearchExecution(draft));
  const execution = OpenWorldResearchExecutionSchema.parse({
    ...draft,
    executionPath: path.relative(root, executionPath).replace(/\\/g, "/"),
    markdownPath: path.relative(root, markdownPath).replace(/\\/g, "/")
  });
  await writeOpenWorldResearchExecution(root, execution);
  return { schemaVersion: "openskill-kit.openworld-research-execution-result.v1", execution, executionPath, markdownPath };
}

export function renderOpenWorldResearchExecution(execution: OpenWorldResearchExecution): string {
  return [
    `# OpenWorld Research Execution ${execution.id}`,
    "",
    `Task: ${execution.taskId}`,
    `Plan: ${execution.planId}`,
    `Status: ${execution.status}`,
    `Dry run: ${execution.dryRun ? "yes" : "no"}`,
    `Executed: ${execution.executedAt}`,
    "",
    "## Summary",
    "",
    `- Planned local sources: ${execution.summary.plannedLocalCount}`,
    `- Explicit web sources: ${execution.summary.explicitWebCount}`,
    `- Ingested: ${execution.summary.ingestedCount}`,
    `- Skipped: ${execution.summary.skippedCount}`,
    `- Errors: ${execution.summary.errorCount}`,
    "",
    "## Ingested Sources",
    "",
    ...(execution.ingested.length
      ? execution.ingested.map((source) => `- ${source.sourceId} ${source.kind} trust=${source.trustScore} ${source.uri}`)
      : ["None"]),
    "",
    "## Skipped",
    "",
    ...(execution.skipped.length
      ? execution.skipped.map((item) => `- ${item.uri}: ${item.reason}`)
      : ["None"]),
    "",
    "## Errors",
    "",
    ...(execution.errors.length
      ? execution.errors.map((item) => `- ${item.uri ?? "source"}: ${item.message}`)
      : ["None"])
  ].join("\n") + "\n";
}

async function registerOpenWorldSource(
  root: string,
  input: {
    taskId: string;
    id: string;
    kind: OpenWorldSource["kind"];
    uri: string;
    title?: string;
    content: string;
    now: Date;
    locator?: OpenWorldSource["locator"];
    trust: OpenWorldSource["trust"];
    privacyClass: OpenWorldSource["privacyClass"];
    usableFor: OpenWorldSource["usableFor"];
  }
): Promise<IngestLocalSourceResult> {
  const task = await readOpenWorldTask(root, input.taskId);
  const audit = auditOpenWorldLeakage([
    { source: input.uri, surface: input.uri.startsWith("http") ? "query" : "path", value: input.uri },
    { source: input.uri, surface: "content", value: input.content }
  ], task, input.now);
  if (audit.status === "blocked") throw new Error(`OpenWorld source blocked by leakage audit: ${audit.findings.map((finding) => finding.id).join(", ")}`);
  const cachePath = path.join(".openskill-kit", "openworld", "tasks", input.taskId, "sources", "cache", `${input.id}.txt`).replace(/\\/g, "/");
  const source = makeOpenWorldSource({
    id: input.id,
    taskId: input.taskId,
    kind: input.kind,
    uri: input.uri,
    locator: input.locator ?? {},
    title: input.title,
    content: input.content,
    retrievedAt: input.now,
    contentPath: cachePath,
    cachePath,
    trust: input.trust,
    privacyClass: input.privacyClass,
    usableFor: input.usableFor,
    leakageAuditId: audit.id
  });
  const auditPath = await writeOpenWorldLeakageAudit(root, audit);
  const writtenContentPath = await writeOpenWorldSourceContent(root, input.taskId, input.id, input.content);
  const sourcePath = await writeOpenWorldSource(root, source);
  return { schemaVersion: "openskill-kit.openworld-local-source.v1", source, sourcePath, contentPath: writtenContentPath, audit, auditPath };
}

export interface DraftAnchorResult {
  schemaVersion: "openskill-kit.openworld-anchor-draft.v1";
  anchor: AnchorCard;
  anchorPath: string;
  audit: OpenWorldLeakageAudit;
  auditPath: string;
}

export async function draftAnchorFromOpenWorldSource(projectRoot: string, taskId: string, sourceId: string, claim?: string, now = new Date()): Promise<DraftAnchorResult> {
  const root = path.resolve(projectRoot);
  const task = await readOpenWorldTask(root, taskId);
  const source = await readOpenWorldSource(root, taskId, sourceId);
  const content = await readOpenWorldSourceContent(root, taskId, sourceId);
  const statement = cleanClaim(claim ?? firstUsefulLine(content) ?? `Review source ${source.uri} before using it as OpenWorld evidence.`);
  const audit = auditOpenWorldLeakage([{ source: source.uri, surface: "content", value: statement }], task, now);
  if (audit.status === "blocked") throw new Error(`OpenWorld anchor blocked by leakage audit: ${audit.findings.map((finding) => finding.id).join(", ")}`);
  const anchor = {
    schemaVersion: "openskill-kit.anchor-card.v1" as const,
    id: `anc_${shortHash(`${taskId}:${sourceId}:${statement}`)}`,
    taskId,
    sourceId,
    claim: statement,
    anchorType: source.kind === "local-doc" ? "workflow" as const : "invariant" as const,
    verifiableAs: ["manual-review" as const],
    sourceQuote: firstUsefulLine(content)?.slice(0, 400),
    paths: source.kind === "project-file" ? [source.uri] : [],
    confidence: source.kind === "local-doc" ? 0.62 : 0.58,
    leakageRisk: "low" as const,
    privacyClass: source.privacyClass,
    usableFor: ["skill" as const, "virtual-test" as const, "report" as const],
    createdAt: now.toISOString()
  };
  const auditPath = await writeOpenWorldLeakageAudit(root, audit);
  const anchorPath = await writeAnchorCard(root, anchor);
  return { schemaVersion: "openskill-kit.openworld-anchor-draft.v1", anchor, anchorPath, audit, auditPath };
}

export interface BuildVirtualSuiteResult {
  schemaVersion: "openskill-kit.openworld-virtual-suite-draft.v1";
  suite: VirtualTestSuite;
  suitePath: string;
  manifestPath: string;
  traceabilityMapPath: string;
  caseFilePaths: string[];
  audit: OpenWorldLeakageAudit;
  auditPath: string;
}

export async function buildVirtualSuiteFromAnchors(projectRoot: string, taskId: string, anchors: AnchorCard[], now = new Date()): Promise<BuildVirtualSuiteResult> {
  const root = path.resolve(projectRoot);
  const task = await readOpenWorldTask(root, taskId);
  if (!anchors.length) throw new Error("OpenWorld virtual suite requires at least one Anchor Card.");
  const suiteId = `vts_${shortHash(`${taskId}:${anchors.map((anchor) => anchor.id).join(",")}`)}`;
  const caseArtifacts: Array<{ split: "visible" | "holdout"; caseId: string; relativePath: string; content: string }> = [];
  const cases = [];
  const traceability: Array<Record<string, unknown>> = [];
  const artifactInputs: Array<{ source: string; surface: "artifact"; value: string }> = [];
  for (const [index, anchor] of anchors.entries()) {
    if (anchor.taskId !== taskId) throw new Error(`Anchor ${anchor.id} belongs to task ${anchor.taskId}, not ${taskId}.`);
    const split = index % 4 === 3 ? "holdout" as const : "visible" as const;
    const caseId = `case_${shortHash(anchor.id)}`;
    const source = await readOpenWorldSource(root, taskId, anchor.sourceId);
    const scriptRelative = path.join(".openskill-kit", "openworld", "tasks", taskId, "verifiers", suiteId, split, `${caseId}.cjs`).replace(/\\/g, "/");
    const script = renderNodeVerifierScript({ caseId, anchor, source });
    artifactInputs.push({ source: scriptRelative, surface: "artifact", value: script });
    caseArtifacts.push({ split, caseId, relativePath: scriptRelative, content: script });
    cases.push({
      id: caseId,
      anchorIds: [anchor.id],
      runner: "node" as const,
      split,
      name: `Verify anchor ${anchor.id}`,
      description: anchor.claim,
      file: scriptRelative,
      command: ["node", scriptRelative],
      assertions: [
        "Anchor JSON exists and references the expected source.",
        "Source JSON and cached text exist.",
        "Cached source text matches the recorded content hash.",
        "Anchor quote is traceable to cached source text when present.",
        "Anchor artifact avoids generic hidden-oracle markers."
      ],
      expectedArtifacts: [scriptRelative],
      status: "ready" as const
    });
    traceability.push({
      caseId,
      split,
      anchorId: anchor.id,
      sourceId: anchor.sourceId,
      sourceUri: source.uri,
      sourceHash: source.contentHash,
      assertionCount: 5
    });
  }
  const audit = auditOpenWorldLeakage([
    ...anchors.map((anchor) => ({ source: anchor.id, surface: "artifact" as const, value: `${anchor.claim}\n${anchor.sourceQuote ?? ""}` })),
    ...artifactInputs
  ], task, now);
  if (audit.status === "blocked") throw new Error(`OpenWorld virtual suite blocked by leakage audit: ${audit.findings.map((finding) => finding.id).join(", ")}`);
  const auditPath = await writeOpenWorldLeakageAudit(root, audit);
  const caseFilePaths: string[] = [];
  for (const artifact of caseArtifacts) {
    const scriptPath = await writeOpenWorldTaskTextArtifact(root, taskId, ["verifiers", suiteId, artifact.split, `${artifact.caseId}.cjs`], artifact.content);
    caseFilePaths.push(scriptPath);
  }
  const traceabilityMapPath = await writeOpenWorldTaskTextArtifact(root, taskId, ["verifiers", suiteId, "traceability-map.json"], `${JSON.stringify({ schemaVersion: "openskill-kit.virtual-test-traceability.v1", suiteId, taskId, generatedAt: now.toISOString(), entries: traceability }, null, 2)}\n`);
  const manifestPath = await writeOpenWorldTaskTextArtifact(root, taskId, ["verifiers", suiteId, "manifest.json"], `${JSON.stringify({ schemaVersion: "openskill-kit.virtual-test-manifest.v1", suiteId, taskId, generatedAt: now.toISOString(), visible: cases.filter((item) => item.split === "visible").map((item) => item.file), holdout: cases.filter((item) => item.split === "holdout").map((item) => item.file), traceabilityMap: path.relative(root, traceabilityMapPath).replace(/\\/g, "/"), leakageAuditId: audit.id }, null, 2)}\n`);
  const suite: VirtualTestSuite = {
    schemaVersion: "openskill-kit.virtual-test-suite.v1",
    id: suiteId,
    taskId,
    createdAt: now.toISOString(),
    generatedFromAnchorIds: anchors.map((anchor) => anchor.id),
    cases,
    artifacts: {
      manifestPath: path.relative(root, manifestPath).replace(/\\/g, "/"),
      traceabilityMapPath: path.relative(root, traceabilityMapPath).replace(/\\/g, "/"),
      visibleDir: path.join(".openskill-kit", "openworld", "tasks", taskId, "verifiers", suiteId, "visible").replace(/\\/g, "/"),
      holdoutDir: path.join(".openskill-kit", "openworld", "tasks", taskId, "verifiers", suiteId, "holdout").replace(/\\/g, "/")
    },
    leakageAuditId: audit.id
  };
  const suitePath = await writeVirtualTestSuite(root, suite);
  return { schemaVersion: "openskill-kit.openworld-virtual-suite-draft.v1", suite, suitePath, manifestPath, traceabilityMapPath, caseFilePaths, audit, auditPath };
}

function renderNodeVerifierScript(input: { caseId: string; anchor: AnchorCard; source: OpenWorldSource }): string {
  const anchorPath = path.join(".openskill-kit", "openworld", "tasks", input.anchor.taskId, "anchors", `${input.anchor.id}.json`).replace(/\\/g, "/");
  const sourcePath = path.join(".openskill-kit", "openworld", "tasks", input.anchor.taskId, "sources", `${input.source.id}.json`).replace(/\\/g, "/");
  const cachePath = (input.source.cachePath ?? input.source.contentPath ?? path.join(".openskill-kit", "openworld", "tasks", input.anchor.taskId, "sources", "cache", `${input.source.id}.txt`)).replace(/\\/g, "/");
  return "#!/usr/bin/env node\n" + `const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = process.cwd();
const caseId = ${JSON.stringify(input.caseId)};
const expectedAnchorId = ${JSON.stringify(input.anchor.id)};
const expectedSourceId = ${JSON.stringify(input.source.id)};
const anchorPath = path.join(root, ${JSON.stringify(anchorPath)});
const sourcePath = path.join(root, ${JSON.stringify(sourcePath)});
const cachePath = path.join(root, ${JSON.stringify(cachePath)});
const failures = [];
const checks = [];

function check(name, pass, message) {
  checks.push({ name, status: pass ? "pass" : "fail", message });
  if (!pass) failures.push(message);
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    failures.push(label + " missing or invalid: " + error.message);
    return undefined;
  }
}

const anchor = readJson(anchorPath, "anchor");
const source = readJson(sourcePath, "source");
const sourceText = fs.existsSync(cachePath) ? fs.readFileSync(cachePath, "utf8") : "";
check("anchor-id", anchor && anchor.id === expectedAnchorId, "anchor id matches expected");
check("source-id", source && source.id === expectedSourceId && anchor && anchor.sourceId === source.id, "anchor references expected source");
check("source-cache", sourceText.length > 0, "source cache exists and is non-empty");
if (source && source.contentHash && sourceText) {
  const actual = crypto.createHash("sha256").update(sourceText).digest("hex");
  check("source-hash", actual === source.contentHash, "source cache matches recorded content hash");
}
if (anchor && anchor.sourceQuote) {
  check("quote-trace", sourceText.includes(anchor.sourceQuote), "anchor quote appears in source cache");
}
const markerText = [anchor?.claim || "", anchor?.sourceQuote || ""].join("\\n");
check("oracle-marker", !/\\b(hidden[-_\\s]?tests?|oracle[-_\\s]?private|ground[-_\\s]?truth|target[-_\\s]?answer|reference[-_\\s]?solution)\\b/i.test(markerText), "anchor text avoids generic oracle markers");
const result = { schemaVersion: "openskill-kit.virtual-test-case-result.v1", caseId, status: failures.length ? "fail" : "pass", checks, failures };
console.log(JSON.stringify(result, null, 2));
process.exit(failures.length ? 1 : 0);
`;
}

function firstUsefulLine(content: string): string | undefined {
  return content.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 12 && !/^(?:\x60\x60\x60|---|#\s*$)/.test(line));
}

function cleanClaim(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

async function fetchText(url: URL, timeoutMs: number, maxBytes: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`Fetch failed ${response.status} ${response.statusText}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/(text|json|xml|markdown|html|javascript|typescript)/i.test(contentType)) {
      throw new Error(`Unsupported content type for OpenWorld text source: ${contentType}`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error(`OpenWorld source too large: ${Buffer.byteLength(text, "utf8")} bytes > ${maxBytes}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function classifyWebSource(url: URL): OpenWorldSource["kind"] {
  const host = url.hostname.toLowerCase();
  if (host === "arxiv.org" || host.endsWith(".arxiv.org")) return "paper";
  if (host === "github.com" || host.endsWith(".github.com")) return "repository";
  if (/\b(docs|developer|dev|api)\b/.test(host) || /\/docs?\//i.test(url.pathname)) return "official-docs";
  return "web";
}

function trustForWebSource(url: URL): OpenWorldSource["trust"] {
  const kind = classifyWebSource(url);
  if (kind === "official-docs") return { authority: 0.86, freshness: 0.68, independence: 0.78, rationale: "Explicit web source appears to be official documentation." };
  if (kind === "repository") return { authority: 0.78, freshness: 0.7, independence: 0.72, rationale: "Explicit web source is repository-hosted." };
  if (kind === "paper") return { authority: 0.82, freshness: 0.58, independence: 0.8, rationale: "Explicit web source is a paper or preprint." };
  return { authority: 0.48, freshness: 0.5, independence: 0.55, rationale: "General web source; lower authority until reviewed." };
}

function buildResearchQueries(
  task: { id: string; title: string; prompt: string; taskType: string; languages: string[]; paths: string[]; allowWeb: boolean; forbiddenIdentifiers: string[]; forbiddenPaths: string[] },
  query: string | undefined,
  includeWebQueries: boolean,
  now: Date
): OpenWorldResearchPlan["queryPlan"] {
  const raw = [
    { purpose: "task" as const, query: query ?? `${task.title} ${task.prompt}` },
    ...task.languages.slice(0, 4).map((language) => ({ purpose: "language-docs" as const, query: `${language} ${task.taskType} official docs ${task.title}` })),
    ...task.paths.slice(0, 6).map((taskPath) => ({ purpose: "path-docs" as const, query: `${path.basename(taskPath)} ${task.taskType} docs ${task.title}` })),
    ...(includeWebQueries && task.allowWeb ? [{ purpose: "targeted-followup" as const, query: `${task.title} best practices official documentation` }] : [])
  ];
  const seen = new Set<string>();
  return raw
    .map((item, index) => {
      const sanitized = sanitizeOpenWorldQuery(item.query, task);
      const status = sanitized !== item.query ? "sanitized" as const : "ready" as const;
      return {
        id: `owquery_${shortHash(`${task.id}:${now.toISOString()}:${index}:${sanitized}`)}`,
        purpose: item.purpose,
        query: item.query,
        sanitizedQuery: sanitized || "redacted query",
        status,
        reasons: status === "sanitized" ? ["Forbidden or oracle-like terms were redacted before external use."] : []
      };
    })
    .filter((item) => {
      const key = item.sanitizedQuery.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function discoverCandidateFiles(root: string, seedPaths: string[], maxFiles: number): Promise<string[]> {
  const starts = seedPaths.length
    ? seedPaths.map((item) => path.resolve(root, item))
    : ["README.md", "docs", "packages", "examples", "python", "package.json", "pyproject.toml"].map((item) => path.join(root, item));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const start of starts) {
    if (out.length >= maxFiles) break;
    const stat = await fs.stat(start).catch(() => undefined);
    if (!stat) continue;
    if (stat.isFile()) {
      addCandidate(root, start, out, seen);
      continue;
    }
    if (stat.isDirectory()) await walkCandidateDir(root, start, out, seen, maxFiles);
  }
  if (out.length === 0) await walkCandidateDir(root, root, out, seen, maxFiles);
  return out.slice(0, maxFiles);
}

async function walkCandidateDir(root: string, dir: string, out: string[], seen: Set<string>, maxFiles: number): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (out.length >= maxFiles) return;
    if (entry.isDirectory() && SOURCE_SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkCandidateDir(root, full, out, seen, maxFiles);
    else addCandidate(root, full, out, seen);
  }
}

function addCandidate(root: string, file: string, out: string[], seen: Set<string>): void {
  const resolved = path.resolve(file);
  if (!(resolved === root || resolved.startsWith(`${root}${path.sep}`))) return;
  if (!SOURCE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) return;
  const relative = path.relative(root, resolved).replace(/\\/g, "/");
  if (seen.has(relative)) return;
  seen.add(relative);
  out.push(resolved);
}

function scoreSourceCandidate(relative: string, sample: string, tokens: string[], seedPaths: string[]): number {
  const haystack = tokenize(`${relative} ${sample.slice(0, 20_000)}`);
  const tokenSet = new Set(haystack);
  const overlap = tokens.length ? tokens.filter((token) => tokenSet.has(token)).length / tokens.length : 0;
  const pathBoost = seedPaths.some((seed) => relative.startsWith(seed.replace(/\\/g, "/")) || relative.includes(seed.replace(/\\/g, "/"))) ? 0.22 : 0;
  const docsBoost = /^docs\//.test(relative) || /(?:^|\/)README\.md$/i.test(relative) ? 0.16 : 0;
  const configBoost = /(?:package|pyproject|tsconfig|vitest|jest|eslint|ruff|mypy)\./i.test(relative) ? 0.08 : 0;
  const sizePenalty = sample.length < 24 ? 0.2 : 0;
  return clamp(Math.round((overlap * 0.68 + pathBoost + docsBoost + configBoost - sizePenalty) * 100) / 100);
}

function candidateReasons(relative: string, sample: string, score: number, seedPaths: string[], blocked: boolean): string[] {
  if (blocked) return ["Blocked by OpenWorld leakage audit."];
  const reasons = [`score=${score}`];
  if (seedPaths.some((seed) => relative.startsWith(seed.replace(/\\/g, "/")) || relative.includes(seed.replace(/\\/g, "/")))) reasons.push("Matches task path scope.");
  if (/^docs\//.test(relative) || /(?:^|\/)README\.md$/i.test(relative)) reasons.push("Documentation-like source.");
  if (/(?:package|pyproject|tsconfig|vitest|jest|eslint|ruff|mypy)\./i.test(relative)) reasons.push("Project configuration source.");
  if (sample.length > 0) reasons.push("Readable text source.");
  return reasons;
}

function statusWeight(status: OpenWorldSourceCandidate["status"]): number {
  if (status === "recommended") return 3;
  if (status === "available") return 2;
  if (status === "blocked") return 1;
  return 0;
}

function isLocalCandidate(candidate: OpenWorldSourceCandidate): boolean {
  if (candidate.locator.url || /^https?:\/\//i.test(candidate.uri)) return false;
  return candidate.kind === "project-file" || candidate.kind === "local-doc" || candidate.kind === "package-docs";
}

function sourceExecutionEntry(source: OpenWorldSource, auditId?: string): OpenWorldResearchExecution["ingested"][number] {
  return {
    sourceId: source.id,
    kind: source.kind,
    uri: source.uri,
    privacyClass: source.privacyClass,
    trustScore: source.trust.score ?? 0.5,
    auditId
  };
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [])].slice(0, 120);
}

function quoteArg(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value: string): string {
  return sha256(value).slice(0, 16);
}
