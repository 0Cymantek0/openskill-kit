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
import type { AnchorCard, OpenWorldLeakageAudit, OpenWorldResearchExecution, OpenWorldResearchPlan, OpenWorldRetrievalAdapter, OpenWorldSource, OpenWorldSourceCandidate, OpenWorldTask, VirtualTestSuite } from "./schema.js";

const SOURCE_SKIP_DIRS = new Set([".git", ".openskill-kit", "node_modules", "dist", "coverage", "tmp", ".next", ".turbo"]);
const SOURCE_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".json", ".jsonc", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".toml", ".yaml", ".yml"]);
const LANGUAGE_DOC_URLS: Record<string, { title: string; url: string }> = {
  javascript: { title: "MDN JavaScript reference", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript" },
  typescript: { title: "TypeScript documentation", url: "https://www.typescriptlang.org/docs/" },
  node: { title: "Node.js API documentation", url: "https://nodejs.org/api/" },
  nodejs: { title: "Node.js API documentation", url: "https://nodejs.org/api/" },
  python: { title: "Python documentation", url: "https://docs.python.org/3/" },
  react: { title: "React reference", url: "https://react.dev/reference/react" },
  vitest: { title: "Vitest guide", url: "https://vitest.dev/guide/" }
};

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
  includeAutonomousWebCandidates?: boolean;
  write?: boolean;
  now?: Date;
}

export function buildOpenWorldRetrievalAdapters(task: Pick<OpenWorldTask, "allowWeb" | "privacyClass">, limits: { maxLocalSources?: number; maxBytes?: number; timeoutMs?: number } = {}): OpenWorldRetrievalAdapter[] {
  const maxLocalSources = Math.max(0, Math.min(limits.maxLocalSources ?? 5, 25));
  const maxBytes = Math.max(1_000, Math.min(limits.maxBytes ?? 1_000_000, 2_000_000));
  const timeoutMs = Math.max(1_000, Math.min(limits.timeoutMs ?? 12_000, 120_000));
  return [
    {
      id: "local-project-files",
      kind: "local-files",
      title: "Project-local source files",
      status: "enabled",
      networkAccess: "none",
      requiresAllowWeb: false,
      inputPrivacyClasses: ["project-private", "shareable"],
      outputPrivacyClass: "project-private",
      maxSources: maxLocalSources,
      maxBytes,
      reasons: ["Always available for files under the project root."],
      safeguards: ["Project-root path containment", "Leakage audit before cache write", "Atomic artifact writes"]
    },
    {
      id: "explicit-http-cache",
      kind: "http-cache",
      title: "Explicit URL with operator-provided text cache",
      status: task.allowWeb ? "enabled" : "disabled",
      networkAccess: "none",
      requiresAllowWeb: true,
      inputPrivacyClasses: ["openworld-public", "shareable"],
      outputPrivacyClass: "openworld-public",
      maxSources: 25,
      maxBytes,
      reasons: task.allowWeb ? ["Task allows explicit public web sources; content is provided by operator."] : ["Task allowWeb is false."],
      safeguards: ["No network access", "Operator supplies exact text", "Leakage audit before cache write"]
    },
    {
      id: "explicit-http-fetch",
      kind: "http-fetch",
      title: "Explicit HTTP(S) fetch",
      status: task.allowWeb ? "enabled" : "disabled",
      networkAccess: "explicit-http",
      requiresAllowWeb: true,
      inputPrivacyClasses: ["openworld-public"],
      outputPrivacyClass: "openworld-public",
      maxSources: 25,
      maxBytes,
      timeoutMs,
      reasons: task.allowWeb ? ["Task allows explicit public web sources; URL must be passed by operator."] : ["Task allowWeb is false."],
      safeguards: ["HTTP(S) only", "Operator-provided URL only", "Content-type allowlist", "Timeout and byte limit", "Leakage audit before cache write"]
    },
    {
      id: "autonomous-docs-repo-discovery",
      kind: "docs-repo-discovery",
      title: "Autonomous docs/repo URL discovery",
      status: task.allowWeb ? "enabled" : "disabled",
      networkAccess: "explicit-http",
      requiresAllowWeb: true,
      inputPrivacyClasses: ["shareable", "openworld-public"],
      outputPrivacyClass: "openworld-public",
      maxSources: 5,
      maxBytes,
      timeoutMs,
      reasons: task.allowWeb ? ["Task allows deterministic public docs/repo URL discovery from package metadata and language hints."] : ["Task allowWeb is false."],
      safeguards: ["No search-engine dependency", "Only deterministic package/language URL candidates", "HTTP(S) only", "Timeout and byte limit", "Leakage audit before cache write", "Execution requires include-autonomous-web"]
    }
  ];
}

export async function planOpenWorldResearch(projectRoot: string, taskId: string, options: PlanOpenWorldResearchOptions = {}): Promise<OpenWorldResearchPlan> {
  const root = path.resolve(projectRoot);
  const task = await readOpenWorldTask(root, taskId);
  const now = options.now ?? new Date();
  const maxCandidates = Math.max(1, Math.min(options.maxCandidates ?? 8, 25));
  const maxFilesScanned = Math.max(maxCandidates, Math.min(options.maxFilesScanned ?? 250, 1000));
  const maxFileBytes = Math.max(4_000, Math.min(options.maxFileBytes ?? 128_000, 1_000_000));
  const retrievalAdapters = buildOpenWorldRetrievalAdapters(task, { maxLocalSources: maxCandidates, maxBytes: maxFileBytes });
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
      adapterId: "local-project-files",
      usableFor: ["skill", "virtual-test", "report"],
      reasons: candidateReasons(relative, sample, score, seedPaths, blocked),
      leakageFindingIds: audit.findings.map((finding) => finding.id),
      ingestCommand: blocked ? undefined : `openskill-kit openworld research --task-id ${taskId} --file ${quoteArg(relative)}`
    });
  }

  const autonomousWebCandidates = task.allowWeb && options.includeAutonomousWebCandidates !== false
    ? await discoverAutonomousWebCandidates(root, task, searchTokens, now)
    : [];
  for (const candidate of autonomousWebCandidates) {
    candidateInputs.push({ source: candidate.uri, surface: "query", value: candidate.uri });
    candidates.push(candidate);
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
  const planId = `owrplan_${shortHash(`${taskId}:${now.toISOString()}:${topCandidates.map((candidate) => candidate.uri).join(",")}`)}`;
  const recommendedNextCommands = [
    ...topCandidates.filter((candidate) => candidate.status !== "blocked" && candidate.ingestCommand).slice(0, 5).map((candidate) => candidate.ingestCommand!),
    ...(task.allowWeb && queryPlan.some((query) => query.status !== "blocked")
      ? [`openskill-kit openworld fetch-source --task-id ${taskId} --url <trusted-doc-url> --content-file <cached-text-file>`]
      : []),
    ...(task.allowWeb && topCandidates.some((candidate) => candidate.adapterId === "autonomous-docs-repo-discovery" && candidate.status !== "blocked")
      ? [`openskill-kit openworld execute-source-plan --task-id ${taskId} --plan-id ${planId} --include-autonomous-web`]
      : []),
    ...(!task.allowWeb ? ["Re-run init-task with --allow-web only if external public sources are explicitly acceptable."] : [])
  ];
  const draft = OpenWorldResearchPlanSchema.parse({
    schemaVersion: "openskill-kit.openworld-research-plan.v1",
    id: planId,
    taskId,
    createdAt: now.toISOString(),
    retrievalAdapters,
    queryPlan,
    candidates: topCandidates,
    recommendedNextCommands,
    summary: {
      adapterCount: retrievalAdapters.length,
      enabledAdapterCount: retrievalAdapters.filter((adapter) => adapter.status === "enabled").length,
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
  includeAutonomousWeb?: boolean;
  maxAutonomousWebSources?: number;
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
  const autonomousLimit = Math.max(0, Math.min(options.maxAutonomousWebSources ?? 3, 10));
  const retrievalAdapters = plan.retrievalAdapters.length
    ? plan.retrievalAdapters
    : buildOpenWorldRetrievalAdapters(task, { maxLocalSources: localLimit, maxBytes: Math.max(...explicitWebSources.map((source) => source.maxBytes ?? 1_000_000), 1_000_000), timeoutMs: Math.max(...explicitWebSources.map((source) => source.timeoutMs ?? 12_000), 12_000) });
  const localCandidates = plan.candidates
    .filter((candidate) => candidate.status === "recommended" || (options.includeAvailable === true && candidate.status === "available"))
    .filter((candidate) => candidate.status !== "blocked")
    .filter((candidate) => isLocalCandidate(candidate))
    .slice(0, localLimit);
  const autonomousWebCandidates = options.includeAutonomousWeb === true
    ? plan.candidates
      .filter((candidate) => candidate.status === "recommended" || (options.includeAvailable === true && candidate.status === "available"))
      .filter((candidate) => candidate.status !== "blocked")
      .filter((candidate) => candidate.adapterId === "autonomous-docs-repo-discovery" && candidate.locator.url)
      .slice(0, autonomousLimit)
    : [];
  const skipped = plan.candidates
    .filter((candidate) => candidate.status === "blocked")
    .map((candidate) => ({ uri: candidate.uri, reason: "Blocked by source-plan leakage audit." }));
  const ingested: OpenWorldResearchExecution["ingested"] = [];
  const errors: OpenWorldResearchExecution["errors"] = [];
  const adapterResults: OpenWorldResearchExecution["adapterResults"] = [];
  let localIngested = 0;
  let localErrors = 0;
  let webCacheIngested = 0;
  let webCacheErrors = 0;
  let webFetchIngested = 0;
  let webFetchErrors = 0;
  let autonomousWebIngested = 0;
  let autonomousWebErrors = 0;

  for (const candidate of localCandidates) {
    if (dryRun) {
      skipped.push({ uri: candidate.uri, reason: "Dry run; source not ingested." });
      continue;
    }
    try {
      const result = await ingestLocalOpenWorldSource(root, taskId, candidate.locator.path ?? candidate.uri, now);
      ingested.push(sourceExecutionEntry(result.source, result.audit.id));
      localIngested += 1;
    } catch (error) {
      errors.push({ uri: candidate.uri, message: error instanceof Error ? error.message : String(error) });
      localErrors += 1;
    }
  }

  for (const webSource of explicitWebSources) {
    if (dryRun) {
      skipped.push({ uri: webSource.url, reason: "Dry run; explicit web source not ingested." });
      continue;
    }
    try {
      const usedCache = typeof webSource.content === "string";
      const result = await ingestWebOpenWorldSource(root, taskId, {
        url: webSource.url,
        title: webSource.title,
        content: webSource.content,
        timeoutMs: webSource.timeoutMs,
        maxBytes: webSource.maxBytes,
        now
      });
      ingested.push(sourceExecutionEntry(result.source, result.audit.id));
      if (usedCache) webCacheIngested += 1;
      else webFetchIngested += 1;
    } catch (error) {
      errors.push({ uri: webSource.url, message: error instanceof Error ? error.message : String(error) });
      if (typeof webSource.content === "string") webCacheErrors += 1;
      else webFetchErrors += 1;
    }
  }

  for (const candidate of autonomousWebCandidates) {
    if (dryRun) {
      skipped.push({ uri: candidate.uri, reason: "Dry run; autonomous web candidate not ingested." });
      continue;
    }
    try {
      const result = await ingestWebOpenWorldSource(root, taskId, {
        url: candidate.locator.url ?? candidate.uri,
        title: candidate.title,
        now
      });
      ingested.push(sourceExecutionEntry(result.source, result.audit.id));
      autonomousWebIngested += 1;
    } catch (error) {
      errors.push({ uri: candidate.uri, message: error instanceof Error ? error.message : String(error) });
      autonomousWebErrors += 1;
    }
  }

  for (const adapter of retrievalAdapters) {
    if (adapter.id === "local-project-files") {
      adapterResults.push({
        adapterId: adapter.id,
        status: dryRun ? "planned" : localErrors ? localIngested ? "partial" : "error" : "completed",
        plannedCount: localCandidates.length,
        ingestedCount: dryRun ? 0 : localIngested,
        skippedCount: dryRun ? localCandidates.length : 0,
        errorCount: localErrors,
        reasons: adapter.reasons
      });
      continue;
    }
    const webSourcesForAdapter = explicitWebSources.filter((source) => adapter.id === "explicit-http-cache" ? typeof source.content === "string" : typeof source.content !== "string");
    const plannedForAdapter = adapter.id === "autonomous-docs-repo-discovery" ? autonomousWebCandidates.length : webSourcesForAdapter.length;
    const adapterIngested = adapter.id === "autonomous-docs-repo-discovery" ? autonomousWebIngested : adapter.id === "explicit-http-cache" ? webCacheIngested : webFetchIngested;
    const adapterErrors = adapter.id === "autonomous-docs-repo-discovery" ? autonomousWebErrors : adapter.id === "explicit-http-cache" ? webCacheErrors : webFetchErrors;
    adapterResults.push({
      adapterId: adapter.id,
      status: adapter.status === "disabled"
        ? "blocked"
        : dryRun
          ? "planned"
          : plannedForAdapter === 0
            ? "skipped"
          : adapterErrors
              ? adapterIngested ? "partial" : "error"
              : "completed",
      plannedCount: plannedForAdapter,
      ingestedCount: dryRun ? 0 : adapterIngested,
      skippedCount: dryRun ? plannedForAdapter : 0,
      errorCount: adapterErrors,
      reasons: adapter.reasons
    });
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
      explicitWebCount: explicitWebSources.length + autonomousWebCandidates.length,
      adapterCount: adapterResults.length
    },
    adapterResults,
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
    `- Retrieval adapters: ${execution.summary.adapterCount}`,
    `- Ingested: ${execution.summary.ingestedCount}`,
    `- Skipped: ${execution.summary.skippedCount}`,
    `- Errors: ${execution.summary.errorCount}`,
    "",
    "## Retrieval Adapters",
    "",
    ...(execution.adapterResults.length
      ? execution.adapterResults.map((item) => `- ${item.adapterId}: ${item.status} planned=${item.plannedCount} ingested=${item.ingestedCount} skipped=${item.skippedCount} errors=${item.errorCount}`)
      : ["None"]),
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

async function discoverAutonomousWebCandidates(root: string, task: OpenWorldTask, searchTokens: string[], now: Date): Promise<OpenWorldSourceCandidate[]> {
  const raw: Array<{ url: string; title: string; source: string; kind?: OpenWorldSource["kind"]; score: number; reasons: string[] }> = [];
  for (const language of task.languages) {
    const doc = LANGUAGE_DOC_URLS[language.toLowerCase().replace(/[^a-z0-9]/g, "")];
    if (doc) raw.push({ ...doc, source: `language:${language}`, kind: "official-docs", score: 0.78, reasons: [`Language hint '${language}' maps to known official documentation.`] });
  }
  const packageDocs = await discoverPackageWebHints(root, searchTokens);
  raw.push(...packageDocs);
  const seen = new Set<string>();
  const candidates: OpenWorldSourceCandidate[] = [];
  for (const item of raw) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    const audit = auditOpenWorldLeakage([
      { source: item.source, surface: "query", value: item.url },
      { source: item.source, surface: "query", value: item.title }
    ], task, now);
    const blocked = audit.findings.some((finding) => finding.level === "block");
    candidates.push({
      id: `owcand_${shortHash(`${task.id}:autonomous:${item.url}`)}`,
      taskId: task.id,
      kind: item.kind ?? classifyWebSource(new URL(item.url)),
      uri: item.url,
      title: item.title,
      locator: { url: item.url },
      score: item.score,
      status: blocked ? "blocked" : item.score >= 0.55 ? "recommended" : "available",
      privacyClass: "openworld-public",
      adapterId: "autonomous-docs-repo-discovery",
      usableFor: ["skill", "virtual-test", "report"],
      reasons: [
        ...item.reasons,
        "Discovered deterministically from local task/package metadata; execution still requires --include-autonomous-web."
      ],
      leakageFindingIds: audit.findings.map((finding) => finding.id),
      ingestCommand: blocked ? undefined : `openskill-kit openworld execute-source-plan --task-id ${task.id} --include-autonomous-web`
    });
  }
  return candidates.sort((a, b) => b.score - a.score || a.uri.localeCompare(b.uri)).slice(0, 10);
}

async function discoverPackageWebHints(root: string, searchTokens: string[]): Promise<Array<{ url: string; title: string; source: string; kind?: OpenWorldSource["kind"]; score: number; reasons: string[] }>> {
  const packageFiles = await discoverCandidateFiles(root, ["package.json"], 20);
  const out: Array<{ url: string; title: string; source: string; kind?: OpenWorldSource["kind"]; score: number; reasons: string[] }> = [];
  for (const file of packageFiles.filter((item) => path.basename(item) === "package.json")) {
    const relative = path.relative(root, file).replace(/\\/g, "/");
    const parsed = await fs.readFile(file, "utf8").then((text) => JSON.parse(text) as Record<string, unknown>).catch(() => undefined);
    if (!parsed) continue;
    const packageName = typeof parsed.name === "string" ? parsed.name : undefined;
    const homepage = typeof parsed.homepage === "string" && isHttpUrl(parsed.homepage) ? parsed.homepage : undefined;
    const repository = extractRepositoryUrl(parsed.repository);
    if (homepage) {
      out.push({ url: homepage, title: `${packageName ?? "package"} homepage`, source: relative, score: 0.74, reasons: [`Package ${relative} declares homepage.`] });
    }
    if (repository) {
      out.push({ url: repository, title: `${packageName ?? "package"} repository`, source: relative, kind: "repository", score: 0.72, reasons: [`Package ${relative} declares repository.`] });
    }
    const deps = dependencyNames(parsed).filter((name) => packageMatchesTask(name, searchTokens)).slice(0, 6);
    for (const dep of deps) {
      out.push({
        url: `https://www.npmjs.com/package/${encodeURIComponent(dep)}`,
        title: `${dep} npm package docs`,
        source: relative,
        kind: "package-docs",
        score: 0.62,
        reasons: [`Dependency ${dep} overlaps task/package tokens.`]
      });
    }
  }
  return out;
}

function dependencyNames(packageJson: Record<string, unknown>): string[] {
  const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  const names = sections.flatMap((section) => {
    const value = packageJson[section];
    return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value as Record<string, unknown>) : [];
  });
  return [...new Set(names)].sort();
}

function packageMatchesTask(name: string, tokens: string[]): boolean {
  const normalized = tokenize(name.replace(/^@/, "").replace("/", " "));
  return normalized.some((token) => tokens.includes(token)) || tokens.some((token) => normalized.includes(token));
}

function extractRepositoryUrl(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value : value && typeof value === "object" ? (value as { url?: unknown }).url : undefined;
  if (typeof raw !== "string") return undefined;
  const normalized = raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
  return isHttpUrl(normalized) ? normalized : undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
