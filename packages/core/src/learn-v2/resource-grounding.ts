import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../storage/atomic.js";
import {
  LearnV2OpenWorldGroundingArtifactSchema,
  LearnV2OpenWorldResourceAnchorSchema,
  type LearnV2ConceptCard,
  type LearnV2OpenWorldGroundingArtifact,
  type LearnV2OpenWorldResourceAnchor
} from "./schemas.js";
import { learnV2SafeLocalPath, learnV2ShortHash } from "./utils.js";

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

export function buildLearnV2OpenWorldGroundingAnchors(concepts: LearnV2ConceptCard[], now = new Date()): LearnV2OpenWorldResourceAnchor[] {
  const anchors: LearnV2OpenWorldResourceAnchor[] = [];
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
  const anchors = buildLearnV2OpenWorldGroundingAnchors(concepts, now);
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
