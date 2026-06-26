import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { auditOpenWorldLeakage } from "./leakage.js";
import {
  makeOpenWorldSource,
  readOpenWorldSource,
  readOpenWorldSourceContent,
  readOpenWorldTask,
  writeAnchorCard,
  writeOpenWorldLeakageAudit,
  writeOpenWorldSource,
  writeOpenWorldSourceContent,
  writeVirtualTestSuite
} from "./store.js";
import type { AnchorCard, OpenWorldLeakageAudit, OpenWorldSource, VirtualTestSuite } from "./schema.js";

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
}

export async function buildVirtualSuiteFromAnchors(projectRoot: string, taskId: string, anchors: AnchorCard[], now = new Date()): Promise<BuildVirtualSuiteResult> {
  const suite: VirtualTestSuite = {
    schemaVersion: "openskill-kit.virtual-test-suite.v1",
    id: `vts_${shortHash(`${taskId}:${anchors.map((anchor) => anchor.id).join(",")}`)}`,
    taskId,
    createdAt: now.toISOString(),
    generatedFromAnchorIds: anchors.map((anchor) => anchor.id),
    cases: anchors.map((anchor, index) => ({
      id: `case_${shortHash(anchor.id)}`,
      anchorIds: [anchor.id],
      runner: "manual",
      split: index % 4 === 3 ? "holdout" : "visible",
      name: `Review anchor ${anchor.id}`,
      description: anchor.claim,
      command: [],
      assertions: [
        "Anchor claim is traceable to its source.",
        "No hidden oracle or forbidden identifier appears in the claim."
      ],
      expectedArtifacts: [],
      status: "draft"
    }))
  };
  const suitePath = await writeVirtualTestSuite(projectRoot, suite);
  return { schemaVersion: "openskill-kit.openworld-virtual-suite-draft.v1", suite, suitePath };
}

function firstUsefulLine(content: string): string | undefined {
  return content.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 12 && !/^(```|---|#\s*$)/.test(line));
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value: string): string {
  return sha256(value).slice(0, 16);
}
