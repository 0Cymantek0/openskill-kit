import { promises as fs } from "node:fs";
import path from "node:path";
import { readProjectConfig } from "../events/store.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import {
  LearnV2OpenWorldGroundingArtifactSchema,
  LearnV2OpenWorldResourceAnchorSchema,
  type LearnV2ConceptCard,
  type LearnV2OpenWorldGroundingArtifact,
  type LearnV2OpenWorldResourceAnchor
} from "./schemas.js";
import { learnV2DeclassifyText, learnV2SafeLocalPath, learnV2ShortHash, learnV2Snippet } from "./utils.js";

type AnchorTemplate = Omit<LearnV2OpenWorldResourceAnchor, "schemaVersion" | "id" | "conceptId" | "evidenceConceptIds" | "retrievedAt">;

const anchorTemplates: Array<{ key: string; test: RegExp; anchors: AnchorTemplate[] }> = [
  {
    key: "ui-accessibility",
    test: /\b(ui|ux|visual|design|theme|component|button|cta|card|color|contrast|dark|light)\b/i,
    anchors: [{
      title: "W3C WCAG 2.2 Quick Reference",
      uri: "https://www.w3.org/WAI/WCAG22/quickref/",
      resourceKind: "standard",
      trustTier: "official",
      alignment: "supports-review",
      precedence: "user-correction-over-resource",
      licenseRisk: "low",
      alignedClaims: [
        "Use contrast and non-color affordances as verification anchors for visual UI preferences.",
        "Treat accessibility conformance as review evidence, not as a replacement for explicit product taste."
      ],
      conflictingClaims: [],
      declassifiedSnippetIds: [],
      usedFor: ["conditions", "verification", "eval"],
      rationale: "Use as an accessibility review anchor for visual and color-related learned behavior; direct scoped user corrections remain the source of truth."
    }]
  },
  {
    key: "security",
    test: /\b(secret|credential|token|auth|security|permission|privacy)\b/i,
    anchors: [{
      title: "OWASP Application Security Verification Standard",
      uri: "https://owasp.org/www-project-application-security-verification-standard/",
      resourceKind: "standard",
      trustTier: "official",
      alignment: "supports-review",
      precedence: "resource-informs-review-only",
      licenseRisk: "low",
      alignedClaims: ["Use established security verification language for sensitive learned behavior."],
      conflictingClaims: [],
      declassifiedSnippetIds: [],
      usedFor: ["verification", "eval"],
      rationale: "Use as a security review anchor for sensitive behavior; local policy and explicit user/project constraints still gate activation."
    }]
  },
  {
    key: "typescript",
    test: /\b(typescript|ts|tsx|type|compiler|parser|syntax)\b/i,
    anchors: [{
      title: "TypeScript Documentation",
      uri: "https://www.typescriptlang.org/docs/",
      resourceKind: "official-docs",
      trustTier: "official",
      alignment: "informational",
      precedence: "resource-informs-review-only",
      licenseRisk: "low",
      alignedClaims: ["Use official language semantics as reference material for TypeScript behavior."],
      conflictingClaims: [],
      declassifiedSnippetIds: [],
      usedFor: ["verification"],
      rationale: "Use as language reference context for TypeScript-related learned behavior."
    }]
  },
  {
    key: "testing",
    test: /\b(test|fixture|regression|vitest|jest|pytest|verification)\b/i,
    anchors: [{
      title: "Vitest Guide",
      uri: "https://vitest.dev/guide/",
      resourceKind: "official-docs",
      trustTier: "official",
      alignment: "informational",
      precedence: "project-doc-over-external",
      licenseRisk: "low",
      alignedClaims: ["Use test-runner documentation as supporting reference after project scripts and fixtures."],
      conflictingClaims: [],
      declassifiedSnippetIds: [],
      usedFor: ["verification", "eval"],
      rationale: "Use as test-runner reference when the project uses Vitest; project scripts remain authoritative."
    }]
  }
];

export function buildLearnV2OpenWorldGroundingAnchors(
  concepts: LearnV2ConceptCard[],
  now = new Date(),
  projectAnchors: Array<{ conceptId: string; key: string; template: AnchorTemplate }> = []
): LearnV2OpenWorldResourceAnchor[] {
  const anchors: LearnV2OpenWorldResourceAnchor[] = [];
  for (const anchor of projectAnchors) anchors.push(makeAnchor(anchor.conceptId, anchor.key, anchor.template, now));
  for (const concept of concepts.filter((item) => !["rejected", "one-off", "superseded"].includes(item.status))) {
    const text = conceptSearchText(concept);
    for (const templateGroup of anchorTemplates) {
      if (!templateGroup.test.test(text)) continue;
      for (const template of templateGroup.anchors) anchors.push(makeAnchor(concept.id, templateGroup.key, template, now));
    }
  }
  return dedupeAnchors(anchors).sort((a, b) => a.conceptId.localeCompare(b.conceptId) || a.title.localeCompare(b.title));
}

export async function writeLearnV2OpenWorldGroundingArtifact(
  rootInput: string,
  concepts: LearnV2ConceptCard[],
  now = new Date()
): Promise<LearnV2OpenWorldGroundingArtifact> {
  const root = path.resolve(rootInput);
  const stamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const dir = path.join(root, ".openskill-kit", "learn-v2", "open-world-grounding");
  const json = path.join(dir, `open-world-grounding-${stamp}.json`);
  const markdown = path.join(dir, `open-world-grounding-${stamp}.md`);
  const anchors = buildLearnV2OpenWorldGroundingAnchors(concepts, now, await buildProjectGroundingAnchors(root, concepts));
  const conceptIds = new Set(anchors.map((anchor) => anchor.conceptId));
  const artifact = LearnV2OpenWorldGroundingArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.openworld-grounding-artifact.v1",
    generatedAt: now.toISOString(),
    anchors,
    counts: {
      anchors: anchors.length,
      conceptCount: conceptIds.size,
      officialAnchors: anchors.filter((anchor) => anchor.trustTier === "official").length,
      projectAnchors: anchors.filter((anchor) => anchor.trustTier === "project").length,
      reviewOnlyAnchors: anchors.filter((anchor) => anchor.precedence !== "user-correction-over-resource").length
    },
    artifacts: { json, markdown }
  });
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(json, artifact);
  await fs.writeFile(markdown, renderGroundingArtifact(root, artifact), "utf8");
  return artifact;
}

function makeAnchor(conceptId: string, key: string, template: AnchorTemplate, now: Date): LearnV2OpenWorldResourceAnchor {
  return LearnV2OpenWorldResourceAnchorSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.openworld-resource-anchor.v1",
    id: `ground_${learnV2ShortHash(`${conceptId}:${key}:${template.uri}`)}`,
    conceptId,
    retrievedAt: now.toISOString(),
    evidenceConceptIds: [conceptId],
    ...template
  });
}

async function buildProjectGroundingAnchors(root: string, concepts: LearnV2ConceptCard[]): Promise<Array<{ conceptId: string; key: string; template: AnchorTemplate }>> {
  const anchors: Array<{ conceptId: string; key: string; template: AnchorTemplate }> = [];
  const config = await readProjectConfig(root);
  const packageJson = await readSmallProjectFile(root, "package.json");
  const projectBehavior = await firstReadableSmallFile(root, [
    ".openskill-kit/compiled/context-pack.md",
    "AGENTS.md",
    "README.md"
  ]);
  const projectDocs = await readProjectGroundingDocs(root);
  for (const concept of concepts.filter((item) => !["rejected", "one-off", "superseded"].includes(item.status))) {
    const text = conceptSearchText(concept);
    if (packageJson && /\b(test|fixture|regression|vitest|jest|pytest|verification|command)\b/i.test(text)) {
      const scriptClaim = declassifiedProjectClaim(root, config, "package.json#scripts", packageJson, text);
      anchors.push({
        conceptId: concept.id,
        key: "project-package-scripts",
        template: {
          title: "Project package scripts",
          uri: "project://package.json#scripts",
          resourceKind: "project-doc",
          trustTier: "project",
          alignment: "supports-review",
          precedence: "project-doc-over-external",
          licenseRisk: "low",
          alignedClaims: [
            "Project package scripts are highest-authority local evidence for verification command choices.",
            ...(scriptClaim ? [scriptClaim.claim] : [])
          ],
          conflictingClaims: [],
          declassifiedSnippetIds: scriptClaim ? [scriptClaim.id] : [],
          usedFor: ["verification", "eval"],
          rationale: "Search local project resources before external docs; package scripts constrain which verification commands should be proposed."
        }
      });
    }
    if (projectBehavior && /\b(security|privacy|secret|credential|token|permission|review|policy)\b/i.test(text)) {
      anchors.push({
        conceptId: concept.id,
        key: "project-behavior-doc",
        template: {
          title: "Project behavior instructions",
          uri: `project://${projectBehavior.relativePath}`,
          resourceKind: "project-doc",
          trustTier: "project",
          alignment: "supports-review",
          precedence: "project-doc-over-external",
          licenseRisk: "low",
          alignedClaims: ["Project behavior docs and repository instructions outrank external guidance for local policy boundaries."],
          conflictingClaims: [],
          declassifiedSnippetIds: [],
          usedFor: ["conditions", "verification"],
          rationale: "Search local project behavior resources before external standards; local instructions shape review gates and activation scope."
        }
      });
    }
    for (const doc of projectDocs) {
      const claim = declassifiedProjectClaim(root, config, doc.relativePath, doc.text, text);
      if (!claim) continue;
      anchors.push({
        conceptId: concept.id,
        key: `project-doc:${doc.relativePath}`,
        template: {
          title: `Project doc: ${doc.relativePath}`,
          uri: `project://${doc.relativePath}#${claim.id}`,
          resourceKind: "project-doc",
          trustTier: "project",
          alignment: "supports-review",
          precedence: "project-doc-over-external",
          licenseRisk: "low",
          alignedClaims: [claim.claim],
          conflictingClaims: [],
          declassifiedSnippetIds: [claim.id],
          usedFor: usedForFromConceptText(text),
          rationale: "Project-local documentation matched this concept before external resources; use it as grounding evidence for review without overriding direct user corrections."
        }
      });
    }
  }
  return anchors;
}

async function readProjectGroundingDocs(root: string): Promise<Array<{ relativePath: string; text: string }>> {
  const direct = [".openskill-kit/compiled/context-pack.md", "AGENTS.md", "README.md", "docs/README.md"];
  const docsDir = path.join(root, "docs");
  const docs = (await fs.readdir(docsDir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && /\.mdx?$/i.test(entry.name))
    .map((entry) => `docs/${entry.name}`);
  const unique = [...new Set([...direct, ...docs])];
  const out: Array<{ relativePath: string; text: string }> = [];
  for (const relativePath of unique) {
    const text = await readSmallProjectFile(root, relativePath);
    if (text) out.push({ relativePath: relativePath.replace(/\\/g, "/"), text });
  }
  return out;
}

function declassifiedProjectClaim(
  root: string,
  config: Awaited<ReturnType<typeof readProjectConfig>>,
  relativePath: string,
  text: string,
  conceptText: string
): { id: string; claim: string } | undefined {
  const snippet = bestProjectDocSnippet(text, conceptText);
  if (!snippet) return undefined;
  const declassified = learnV2DeclassifyText(snippet, root, config);
  const safeSnippet = learnV2Snippet(declassified.text, 220);
  const id = `snippet_${learnV2ShortHash(`${relativePath}:${safeSnippet}`)}`;
  return {
    id,
    claim: `Project doc snippet ${id}: ${safeSnippet}`
  };
}

function bestProjectDocSnippet(text: string, conceptText: string): string | undefined {
  const conceptTokens = significantTokens(conceptText);
  if (!conceptTokens.size) return undefined;
  const candidates = text
    .split(/\r?\n{1,2}/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 20 && line.length <= 800);
  let best: { line: string; score: number } | undefined;
  for (const line of candidates) {
    const tokens = significantTokens(line);
    const score = [...conceptTokens].filter((token) => tokens.has(token)).length;
    if (score < 2) continue;
    if (!best || score > best.score || (score === best.score && line.length < best.line.length)) best = { line, score };
  }
  return best?.line;
}

function significantTokens(text: string): Set<string> {
  const stop = new Set(["prefer", "before", "after", "with", "without", "project", "behavior", "change", "changes", "should", "would", "could"]);
  return new Set((text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((token) => !stop.has(token)));
}

function usedForFromConceptText(text: string): LearnV2OpenWorldResourceAnchor["usedFor"] {
  const normalized = text.toLowerCase();
  const used = new Set<LearnV2OpenWorldResourceAnchor["usedFor"][number]>(["skill-text"]);
  if (/\b(condition|when|unless|scope|theme|card|button|path)\b/.test(normalized)) used.add("conditions");
  if (/\b(test|verify|verification|fixture|regression|command)\b/.test(normalized)) used.add("verification");
  used.add("eval");
  return [...used].sort();
}

async function firstReadableSmallFile(root: string, relativePaths: string[]): Promise<{ relativePath: string; text: string } | undefined> {
  for (const relativePath of relativePaths) {
    const text = await readSmallProjectFile(root, relativePath);
    if (text) return { relativePath: relativePath.replace(/\\/g, "/"), text };
  }
  return undefined;
}

async function readSmallProjectFile(root: string, relativePath: string): Promise<string | undefined> {
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(root + path.sep) && absolute !== root) return undefined;
  const stat = await fs.stat(absolute).catch(() => undefined);
  if (!stat?.isFile() || stat.size > 256 * 1024) return undefined;
  return fs.readFile(absolute, "utf8").catch(() => undefined);
}

function dedupeAnchors(anchors: LearnV2OpenWorldResourceAnchor[]): LearnV2OpenWorldResourceAnchor[] {
  const byKey = new Map<string, LearnV2OpenWorldResourceAnchor>();
  for (const anchor of anchors) {
    const key = `${anchor.conceptId}:${anchor.uri}`;
    if (!byKey.has(key)) byKey.set(key, anchor);
  }
  return [...byKey.values()];
}

function conceptSearchText(concept: LearnV2ConceptCard): string {
  return [
    concept.title,
    concept.canonicalBehavior,
    concept.behaviorDelta,
    ...concept.scope.paths,
    ...concept.scope.taskTypes,
    ...concept.activation.phrases,
    ...concept.activation.pathGlobs,
    ...(concept.conditions?.appliesWhen ?? []),
    ...(concept.conditions?.doesNotApplyWhen ?? [])
  ].join(" ");
}

function renderGroundingArtifact(root: string, artifact: LearnV2OpenWorldGroundingArtifact): string {
  const lines = [
    "# Learn v2 Open-World Grounding",
    "",
    `Generated: ${artifact.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Anchors: ${artifact.counts.anchors}`,
    `- Concepts grounded: ${artifact.counts.conceptCount}`,
    `- Official anchors: ${artifact.counts.officialAnchors}`,
    `- Project anchors: ${artifact.counts.projectAnchors}`,
    `- Review-only anchors: ${artifact.counts.reviewOnlyAnchors}`,
    "",
    "## Precedence",
    "",
    "- Direct user corrections and reviewed project behavior remain authoritative.",
    "- External resources inform review, scope, and eval planning only.",
    "- Resource anchors do not activate or rewrite concepts by themselves.",
    "- User preference evidence, project evidence, external grounding, and model interpretation stay separate.",
    "",
    "## Anchors",
    ""
  ];
  if (!artifact.anchors.length) lines.push("No open-world grounding anchors proposed.");
  for (const anchor of artifact.anchors) {
    lines.push(`### ${anchor.title}`);
    lines.push("");
    lines.push(`ID: ${anchor.id}`);
    lines.push(`Concept: ${anchor.conceptId}`);
    lines.push(`URI: ${anchor.uri}`);
    lines.push(`Kind: ${anchor.resourceKind}`);
    lines.push(`Trust: ${anchor.trustTier}`);
    lines.push(`Alignment: ${anchor.alignment}`);
    lines.push(`Precedence: ${anchor.precedence}`);
    lines.push(`Retrieved: ${anchor.retrievedAt}`);
    lines.push(`License risk: ${anchor.licenseRisk}`);
    lines.push(`Used for: ${anchor.usedFor.join(", ") || "review"}`);
    lines.push(`Aligned claims: ${anchor.alignedClaims.join("; ") || "none"}`);
    lines.push(`Conflicting claims: ${anchor.conflictingClaims.join("; ") || "none"}`);
    lines.push(`Rationale: ${anchor.rationale}`);
    lines.push("");
  }
  lines.push("## Artifacts");
  lines.push("");
  lines.push(`- JSON: ${learnV2SafeLocalPath(artifact.artifacts.json, root)}`);
  lines.push(`- Markdown: ${learnV2SafeLocalPath(artifact.artifacts.markdown, root)}`);
  return `${lines.join("\n")}\n`;
}
