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
  const audit = auditOpenWorldLeakage([
    { source: relative, surface: "path", value: relative },
    { source: relative, surface: "content", value: content }
  ], task, now);
  if (audit.status === "blocked") throw new Error(`OpenWorld local source blocked by leakage audit: ${audit.findings.map((finding) => finding.id).join(", ")}`);
  const sourceId = `src_${shortHash(`${taskId}:${relative}:${sha256(content)}`)}`;
  const contentPath = path.join(".openskill-kit", "openworld", "tasks", taskId, "sources", `${sourceId}.content.txt`).replace(/\\/g, "/");
  const source = makeOpenWorldSource({
    id: sourceId,
    taskId,
    kind: relative.startsWith("docs/") || relative.endsWith(".md") ? "local-doc" : "project-file",
    uri: relative,
    title: path.basename(relative),
    content,
    retrievedAt: now,
    contentPath,
    trust: { authority: 0.7, freshness: 0.8, independence: 0.4, rationale: "Project-local source, leakage-audited before caching." },
    privacyClass: "project-private",
    usableFor: ["skill", "virtual-test", "report"],
    leakageAuditId: audit.id
  });
  const auditPath = await writeOpenWorldLeakageAudit(root, audit);
  const writtenContentPath = await writeOpenWorldSourceContent(root, taskId, sourceId, content);
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value: string): string {
  return sha256(value).slice(0, 16);
}
