import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../storage/atomic.js";
import {
  LearnV2SkillNamespaceCandidateSchema,
  LearnV2SkillOntologyArtifactSchema,
  type LearnV2ConceptCard,
  type LearnV2SkillNamespaceCandidate,
  type LearnV2SkillOntologyArtifact
} from "./schemas.js";
import { learnV2SafeLocalPath, learnV2ShortHash } from "./utils.js";

const stopWords = new Set([
  "about", "after", "again", "before", "behavior", "broad", "change", "changes", "concept",
  "context", "default", "files", "first", "learned", "prefer", "project", "review",
  "should", "source", "task", "tasks", "tests", "using", "when", "with"
]);

export function buildLearnV2SkillNamespaces(concepts: LearnV2ConceptCard[]): LearnV2SkillNamespaceCandidate[] {
  const usable = concepts.filter((concept) => !["rejected", "one-off", "superseded"].includes(concept.status));
  const clusters = new Map<string, { label: string; concepts: LearnV2ConceptCard[]; signals: Set<string> }>();
  for (const concept of usable) {
    const signature = namespaceSignature(concept);
    const current = clusters.get(signature.key) ?? { label: signature.label, concepts: [], signals: new Set<string>() };
    current.concepts.push(concept);
    for (const signal of signature.signals) current.signals.add(signal);
    clusters.set(signature.key, current);
  }
  return [...clusters.entries()]
    .map(([key, cluster]) => makeNamespaceCandidate(key, cluster.label, cluster.concepts, [...cluster.signals]))
    .sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label));
}

export async function writeLearnV2SkillOntologyArtifact(
  rootInput: string,
  concepts: LearnV2ConceptCard[],
  now = new Date()
): Promise<LearnV2SkillOntologyArtifact> {
  const root = path.resolve(rootInput);
  const stamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const dir = path.join(root, ".openskill-kit", "learn-v2", "skill-ontology");
  const json = path.join(dir, `skill-ontology-${stamp}.json`);
  const markdown = path.join(dir, `skill-ontology-${stamp}.md`);
  const namespaces = buildLearnV2SkillNamespaces(concepts);
  const representedConcepts = new Set(namespaces.flatMap((item) => item.conceptIds));
  const artifact = LearnV2SkillOntologyArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.skill-ontology-artifact.v1",
    generatedAt: now.toISOString(),
    namespaces,
    counts: {
      namespaces: namespaces.length,
      candidateNamespaces: namespaces.filter((item) => item.status === "candidate").length,
      reviewNamespaces: namespaces.filter((item) => item.status === "needs-review").length,
      representedConcepts: representedConcepts.size
    },
    artifacts: { json, markdown }
  });
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(json, artifact);
  await fs.writeFile(markdown, renderSkillOntologyArtifact(root, artifact), "utf8");
  return artifact;
}

function namespaceSignature(concept: LearnV2ConceptCard): { key: string; label: string; signals: string[] } {
  const text = [
    concept.title,
    concept.canonicalBehavior,
    concept.behaviorDelta,
    ...concept.scope.taskTypes,
    ...concept.activation.phrases,
    ...(concept.conditions?.appliesWhen ?? []),
    ...(concept.conditions?.doesNotApplyWhen ?? [])
  ].join(" ").toLowerCase();
  const signals = namespaceSignals(text);
  if (signals.some((signal) => signal.startsWith("ui:"))) return { key: "ui-ux-design", label: "UI/UX design", signals };
  if (signals.some((signal) => signal.startsWith("parser:"))) return { key: "parser-behavior", label: "Parser behavior", signals };
  if (signals.some((signal) => signal.startsWith("security:"))) return { key: "security-behavior", label: "Security behavior", signals };
  if (signals.some((signal) => signal.startsWith("dependency:"))) return { key: "dependency-policy", label: "Dependency policy", signals };
  if (signals.some((signal) => signal.startsWith("docs:"))) return { key: "documentation-behavior", label: "Documentation behavior", signals };
  if (signals.some((signal) => signal.startsWith("verification:"))) return { key: "verification-workflow", label: "Verification workflow", signals };
  const terms = topTerms(text);
  const key = terms.length ? terms.join("-") : "project-behavior";
  const label = terms.length ? `${titleCase(terms.join(" "))} behavior` : "Project behavior";
  return { key, label, signals: signals.length ? signals : terms.map((term) => `term:${term}`) };
}

function namespaceSignals(text: string): string[] {
  const signals = new Set<string>();
  if (/\b(ui|ux|visual|design|theme|component|button|cta|card|color|landing page|dashboard)\b/.test(text)) signals.add("ui:surface-design");
  if (/\b(theme|dark|light|white|black)\b/.test(text)) signals.add("ui:theme");
  if (/\b(card|panel|tile|container)\b/.test(text)) signals.add("ui:component-container");
  if (/\b(parser|parse|syntax|grammar|lexer|token|ast)\b/.test(text)) signals.add("parser:language-structure");
  if (/\b(test|fixture|regression|verify|verification|vitest|jest|pytest)\b/.test(text)) signals.add("verification:test-workflow");
  if (/\b(secret|credential|token|auth|security|permission)\b/.test(text)) signals.add("security:sensitive-work");
  if (/\b(dependency|package|lockfile|npm|pnpm|yarn)\b/.test(text)) signals.add("dependency:package-policy");
  if (/\b(docs|documentation|readme|markdown|guide)\b/.test(text)) signals.add("docs:documentation-work");
  return [...signals].sort();
}

function makeNamespaceCandidate(
  key: string,
  label: string,
  concepts: LearnV2ConceptCard[],
  signals: string[]
): LearnV2SkillNamespaceCandidate {
  const confidence = Math.min(0.92, 0.42 + Math.min(0.3, concepts.length * 0.1) + Math.min(0.16, signals.length * 0.04) + average(concepts.map((concept) => concept.confidence)) * 0.18);
  return LearnV2SkillNamespaceCandidateSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.skill-namespace-candidate.v1",
    id: `namespace_${learnV2ShortHash(`${key}:${concepts.map((concept) => concept.id).sort().join(",")}`)}`,
    label,
    status: concepts.length >= 2 || confidence >= 0.72 ? "candidate" : "needs-review",
    confidence: Number(confidence.toFixed(3)),
    conceptIds: concepts.map((concept) => concept.id).sort(),
    representativeSignals: signals.slice(0, 12),
    rationale: `Grouped ${concepts.length} concept(s) by observed signals: ${signals.slice(0, 6).join(", ") || key}.`
  });
}

function topTerms(text: string): string[] {
  const counts = new Map<string, number>();
  for (const token of text.replace(/[^a-z0-9]+/g, " ").split(/\s+/)) {
    if (token.length < 4 || stopWords.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([token]) => token);
}

function renderSkillOntologyArtifact(root: string, artifact: LearnV2SkillOntologyArtifact): string {
  const lines = [
    "# Learn v2 Skill Ontology",
    "",
    `Generated: ${artifact.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Namespaces: ${artifact.counts.namespaces}`,
    `- Candidate namespaces: ${artifact.counts.candidateNamespaces}`,
    `- Needs review: ${artifact.counts.reviewNamespaces}`,
    `- Represented concepts: ${artifact.counts.representedConcepts}`,
    "",
    "## Namespaces",
    ""
  ];
  if (!artifact.namespaces.length) lines.push("No namespace candidates.");
  for (const namespace of artifact.namespaces) {
    lines.push(`### ${namespace.label}`);
    lines.push("");
    lines.push(`ID: ${namespace.id}`);
    lines.push(`Status: ${namespace.status}`);
    lines.push(`Confidence: ${namespace.confidence.toFixed(2)}`);
    lines.push(`Concepts: ${namespace.conceptIds.join(", ")}`);
    lines.push(`Signals: ${namespace.representativeSignals.join(", ") || "none"}`);
    lines.push(`Rationale: ${namespace.rationale}`);
    lines.push("");
  }
  lines.push("## Artifacts");
  lines.push("");
  lines.push(`- JSON: ${learnV2SafeLocalPath(artifact.artifacts.json, root)}`);
  lines.push(`- Markdown: ${learnV2SafeLocalPath(artifact.artifacts.markdown, root)}`);
  return `${lines.join("\n")}\n`;
}

function average(values: number[]): number {
  if (!values.length) return 0.5;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
