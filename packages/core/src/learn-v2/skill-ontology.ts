import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../storage/atomic.js";
import {
  LearnV2SkillNamespaceCandidateSchema,
  LearnV2SkillOntologyOperationSchema,
  LearnV2SkillOntologyArtifactSchema,
  type LearnV2ConceptCard,
  type LearnV2SkillNamespaceCandidate,
  type LearnV2SkillOntologyOperation,
  type LearnV2SkillOntologyArtifact
} from "./schemas.js";
import { learnV2SafeLocalPath, learnV2ShortHash } from "./utils.js";

export interface LearnV2SkillOntologyDebugView {
  schemaVersion: "openskill-kit.learn-v2.skill-ontology-debug-view.v1";
  generatedAt: string;
  sourcePath: string;
  counts: LearnV2SkillOntologyArtifact["counts"] & {
    selectedNamespaces: number;
    selectedOperations: number;
  };
  namespaces: LearnV2SkillNamespaceCandidate[];
  operations: LearnV2SkillOntologyOperation[];
}

const stopWords = new Set([
  "about", "after", "again", "before", "behavior", "broad", "change", "changes", "concept",
  "context", "default", "files", "first", "learned", "prefer", "project", "review",
  "should", "source", "task", "tasks", "tests", "using", "when", "with"
]);

const namespaceProfiles = [
  { key: "ui-ux-design", label: "UI/UX design", prefix: "ui:" },
  { key: "parser-behavior", label: "Parser behavior", prefix: "parser:" },
  { key: "security-behavior", label: "Security behavior", prefix: "security:" },
  { key: "dependency-policy", label: "Dependency policy", prefix: "dependency:" },
  { key: "documentation-behavior", label: "Documentation behavior", prefix: "docs:" },
  { key: "verification-workflow", label: "Verification workflow", prefix: "verification:" }
] as const;

type NamespaceAssignment = { key: string; label: string; signals: string[]; parentKey?: string; hierarchyPath?: string[] };
type NamespaceCluster = { label: string; concepts: LearnV2ConceptCard[]; signals: Set<string>; parentKey?: string; hierarchyPath: string[] };

export function buildLearnV2SkillNamespaces(concepts: LearnV2ConceptCard[]): LearnV2SkillNamespaceCandidate[] {
  const usable = concepts.filter((concept) => !["rejected", "one-off", "superseded"].includes(concept.status));
  const clusters = new Map<string, NamespaceCluster>();
  for (const concept of usable) {
    for (const assignment of namespaceAssignments(concept)) {
      const current = clusters.get(assignment.key) ?? {
        label: assignment.label,
        concepts: [],
        signals: new Set<string>(),
        parentKey: assignment.parentKey,
        hierarchyPath: assignment.hierarchyPath ?? [assignment.label]
      };
      current.concepts.push(concept);
      for (const signal of assignment.signals) current.signals.add(signal);
      clusters.set(assignment.key, current);
    }
  }
  const candidateEntries = [...clusters.entries()].map(([key, cluster]) => ({
    key,
    cluster,
    candidate: makeNamespaceCandidate(key, cluster)
  }));
  const idByKey = new Map(candidateEntries.map((entry) => [entry.key, entry.candidate.id]));
  return candidateEntries
    .map(({ cluster, candidate }) => {
      const parentNamespaceId = cluster.parentKey ? idByKey.get(cluster.parentKey) : undefined;
      return LearnV2SkillNamespaceCandidateSchema.parse({
        ...candidate,
        ...(parentNamespaceId ? { parentNamespaceId } : {})
      });
    })
    .sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label));
}

export function buildLearnV2SkillOntologyOperations(
  concepts: LearnV2ConceptCard[],
  namespaces: LearnV2SkillNamespaceCandidate[]
): LearnV2SkillOntologyOperation[] {
  const operations: LearnV2SkillOntologyOperation[] = [];
  for (const namespace of namespaces) {
    operations.push(makeOntologyOperation({
      operation: "create-namespace",
      status: namespace.status,
      namespaceIds: [namespace.id],
      conceptIds: namespace.conceptIds,
      confidence: namespace.confidence,
      rationale: `Create emergent skill namespace '${namespace.label}' from ${namespace.conceptIds.length} behavior concept(s).`,
      reviewHint: "Accept when label, scope, and representative signals match observed behavior cluster."
    }));
  }

  for (const namespace of namespaces.filter((item) => item.parentNamespaceId)) {
    operations.push(makeOntologyOperation({
      operation: "nest-namespace",
      status: "needs-review",
      namespaceIds: [namespace.parentNamespaceId!, namespace.id],
      conceptIds: namespace.conceptIds,
      confidence: Math.min(0.84, namespace.confidence),
      rationale: `Nest '${namespace.label}' under parent namespace to preserve emergent skill hierarchy: ${namespace.hierarchyPath.join(" > ")}.`,
      reviewHint: "Accept when child namespace should inherit parent review context but keep narrower activation/debug ownership."
    }));
  }

  for (const pair of similarNamespacePairs(namespaces)) {
    operations.push(makeOntologyOperation({
      operation: "merge-namespaces",
      status: "needs-review",
      namespaceIds: [pair.left.id, pair.right.id],
      conceptIds: unique([...pair.left.conceptIds, ...pair.right.conceptIds]),
      confidence: pair.confidence,
      rationale: `Review possible merge between '${pair.left.label}' and '${pair.right.label}' due to overlapping signals.`,
      reviewHint: "Merge only if reviewer confirms these namespaces express same durable skill boundary."
    }));
  }

  for (const namespace of namespaces.filter(shouldReviewSplit)) {
    operations.push(makeOntologyOperation({
      operation: "split-namespace",
      status: "needs-review",
      namespaceIds: [namespace.id],
      conceptIds: namespace.conceptIds,
      confidence: Math.min(0.78, Math.max(0.52, namespace.confidence - 0.08)),
      rationale: `Review split for '${namespace.label}' because it contains multiple signal families or a broad cluster.`,
      reviewHint: "Split when concepts need different activation, review, or ownership rules."
    }));
  }

  for (const concept of concepts) {
    const attached = namespaces.filter((namespace) => namespace.conceptIds.includes(concept.id));
    if (attached.length < 2) continue;
    operations.push(makeOntologyOperation({
      operation: "attach-concept",
      status: "needs-review",
      namespaceIds: attached.map((namespace) => namespace.id),
      conceptIds: [concept.id],
      confidence: Math.min(0.86, average(attached.map((namespace) => namespace.confidence))),
      rationale: `Attach concept '${concept.title}' to multiple namespaces because evidence crosses ${attached.map((namespace) => namespace.label).join(", ")}.`,
      reviewHint: "Keep multi-attach only when each namespace should influence activation/debug review."
    }));
  }

  return operations.sort((a, b) => operationRank(a.operation) - operationRank(b.operation) || b.confidence - a.confidence || a.id.localeCompare(b.id));
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
  const operations = buildLearnV2SkillOntologyOperations(concepts, namespaces);
  const representedConcepts = new Set(namespaces.flatMap((item) => item.conceptIds));
  const artifact = LearnV2SkillOntologyArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.skill-ontology-artifact.v1",
    generatedAt: now.toISOString(),
    namespaces,
    operations,
    counts: {
      namespaces: namespaces.length,
      candidateNamespaces: namespaces.filter((item) => item.status === "candidate").length,
      reviewNamespaces: namespaces.filter((item) => item.status === "needs-review").length,
      representedConcepts: representedConcepts.size,
      operations: operations.length,
      createOperations: operations.filter((item) => item.operation === "create-namespace").length,
      nestOperations: operations.filter((item) => item.operation === "nest-namespace").length,
      mergeOperations: operations.filter((item) => item.operation === "merge-namespaces").length,
      splitOperations: operations.filter((item) => item.operation === "split-namespace").length,
      attachOperations: operations.filter((item) => item.operation === "attach-concept").length
    },
    artifacts: { json, markdown }
  });
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(json, artifact);
  await fs.writeFile(markdown, renderSkillOntologyArtifact(root, artifact), "utf8");
  return artifact;
}

export async function readLearnV2SkillOntologyDebugView(
  rootInput: string,
  options: { ontologyPath?: string; namespaceId?: string; operationId?: string } = {}
): Promise<LearnV2SkillOntologyDebugView> {
  const root = path.resolve(rootInput);
  const file = options.ontologyPath ? path.resolve(root, options.ontologyPath) : await latestSkillOntologyArtifactPath(root);
  const artifact = LearnV2SkillOntologyArtifactSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
  const namespaceFocusIds = namespaceFocusSet(artifact, options.namespaceId, options.operationId);
  const namespaces = artifact.namespaces.filter((namespace) =>
    namespaceFocusIds ? namespaceFocusIds.has(namespace.id) : true
  );
  const selectedNamespaceIds = new Set(namespaces.map((namespace) => namespace.id));
  const operations = artifact.operations.filter((operation) => {
    if (options.operationId) return operation.id === options.operationId;
    if (selectedNamespaceIds.size) return operation.namespaceIds.some((namespaceId) => selectedNamespaceIds.has(namespaceId));
    return !options.namespaceId;
  });

  return {
    schemaVersion: "openskill-kit.learn-v2.skill-ontology-debug-view.v1",
    generatedAt: artifact.generatedAt,
    sourcePath: learnV2SafeLocalPath(file, root),
    counts: {
      ...artifact.counts,
      selectedNamespaces: namespaces.length,
      selectedOperations: operations.length
    },
    namespaces,
    operations
  };
}

async function latestSkillOntologyArtifactPath(root: string): Promise<string> {
  const dir = path.join(root, ".openskill-kit", "learn-v2", "skill-ontology");
  const files = await fs.readdir(dir).catch(() => []);
  const jsonFiles = files
    .filter((file) => /^skill-ontology-(?:\d{14}|\d{8,})\.json$/.test(file) || file === "skill-ontology.json")
    .sort();
  const latest = jsonFiles.at(-1);
  if (!latest) throw new Error("No Learn v2 skill-ontology artifact found. Run `openskill-kit osk learn --raw --surface-file <path> --apply` or `openskill-kit osk learn --extract-concepts` first.");
  return path.join(dir, latest);
}

function namespaceFocusSet(
  artifact: LearnV2SkillOntologyArtifact,
  namespaceId?: string,
  operationId?: string
): Set<string> | undefined {
  if (operationId) {
    const operation = artifact.operations.find((item) => item.id === operationId);
    return new Set(operation?.namespaceIds ?? []);
  }
  if (!namespaceId) return undefined;
  const normalized = namespaceId.toLowerCase();
  const matches = artifact.namespaces.filter((namespace) =>
    namespace.id === namespaceId || namespace.label.toLowerCase() === normalized
  );
  return new Set(matches.map((namespace) => namespace.id));
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
  const profile = namespaceProfiles.find((item) => signals.some((signal) => signal.startsWith(item.prefix)));
  if (profile) return { key: profile.key, label: profile.label, signals };
  const terms = topTerms(text);
  const key = terms.length ? terms.join("-") : "project-behavior";
  const label = terms.length ? `${titleCase(terms.join(" "))} behavior` : "Project behavior";
  return { key, label, signals: signals.length ? signals : terms.map((term) => `term:${term}`) };
}

function namespaceAssignments(concept: LearnV2ConceptCard): NamespaceAssignment[] {
  const signature = namespaceSignature(concept);
  const profiled = namespaceProfiles
    .filter((profile) => signature.signals.some((signal) => signal.startsWith(profile.prefix)))
    .map((profile) => ({ key: profile.key, label: profile.label, signals: signature.signals }));
  const children = childNamespaceAssignments(signature.signals);
  return profiled.length ? uniqueAssignments([...profiled, ...children]) : [signature];
}

function childNamespaceAssignments(signals: string[]): NamespaceAssignment[] {
  const children: NamespaceAssignment[] = [];
  if (signals.includes("ui:theme")) {
    children.push({ key: "ui-theme-preference", label: "UI theme preference", parentKey: "ui-ux-design", hierarchyPath: ["UI/UX design", "UI theme preference"], signals: signals.filter((signal) => signal.startsWith("ui:")) });
  }
  if (signals.includes("ui:component-container")) {
    children.push({ key: "ui-component-containment", label: "UI component containment", parentKey: "ui-ux-design", hierarchyPath: ["UI/UX design", "UI component containment"], signals: signals.filter((signal) => signal.startsWith("ui:")) });
  }
  if (signals.includes("parser:language-structure")) {
    children.push({ key: "parser-language-structure", label: "Parser language structure", parentKey: "parser-behavior", hierarchyPath: ["Parser behavior", "Parser language structure"], signals: signals.filter((signal) => signal.startsWith("parser:")) });
  }
  if (signals.includes("verification:test-workflow")) {
    children.push({ key: "verification-test-workflow", label: "Verification test workflow", parentKey: "verification-workflow", hierarchyPath: ["Verification workflow", "Verification test workflow"], signals: signals.filter((signal) => signal.startsWith("verification:")) });
  }
  if (signals.includes("security:sensitive-work")) {
    children.push({ key: "security-sensitive-work", label: "Security sensitive work", parentKey: "security-behavior", hierarchyPath: ["Security behavior", "Security sensitive work"], signals: signals.filter((signal) => signal.startsWith("security:")) });
  }
  return children;
}

function uniqueAssignments(assignments: NamespaceAssignment[]): NamespaceAssignment[] {
  const byKey = new Map<string, NamespaceAssignment>();
  for (const assignment of assignments) if (!byKey.has(assignment.key)) byKey.set(assignment.key, assignment);
  return [...byKey.values()];
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

function namespaceIdForCluster(key: string, cluster: NamespaceCluster): string {
  return `namespace_${learnV2ShortHash(`${key}:${cluster.concepts.map((concept) => concept.id).sort().join(",")}`)}`;
}

function makeNamespaceCandidate(key: string, cluster: NamespaceCluster): LearnV2SkillNamespaceCandidate {
  const concepts = cluster.concepts;
  const signals = [...cluster.signals];
  const confidence = Math.min(0.92, 0.42 + Math.min(0.3, concepts.length * 0.1) + Math.min(0.16, signals.length * 0.04) + average(concepts.map((concept) => concept.confidence)) * 0.18);
  return LearnV2SkillNamespaceCandidateSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.skill-namespace-candidate.v1",
    id: namespaceIdForCluster(key, cluster),
    label: cluster.label,
    status: concepts.length >= 2 || confidence >= 0.72 ? "candidate" : "needs-review",
    confidence: Number(confidence.toFixed(3)),
    conceptIds: concepts.map((concept) => concept.id).sort(),
    representativeSignals: signals.slice(0, 12),
    hierarchyPath: cluster.hierarchyPath,
    rationale: `Grouped ${concepts.length} concept(s) by observed signals: ${signals.slice(0, 6).join(", ") || key}.`
  });
}

function makeOntologyOperation(input: Omit<LearnV2SkillOntologyOperation, "schemaVersion" | "id">): LearnV2SkillOntologyOperation {
  return LearnV2SkillOntologyOperationSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.skill-ontology-operation.v1",
    id: `ontology_op_${learnV2ShortHash(`${input.operation}:${input.namespaceIds.sort().join(",")}:${input.conceptIds.sort().join(",")}:${input.rationale}`)}`,
    ...input,
    namespaceIds: [...input.namespaceIds].sort(),
    conceptIds: [...input.conceptIds].sort(),
    confidence: Number(input.confidence.toFixed(3))
  });
}

function similarNamespacePairs(namespaces: LearnV2SkillNamespaceCandidate[]): Array<{ left: LearnV2SkillNamespaceCandidate; right: LearnV2SkillNamespaceCandidate; confidence: number }> {
  const pairs: Array<{ left: LearnV2SkillNamespaceCandidate; right: LearnV2SkillNamespaceCandidate; confidence: number }> = [];
  for (let i = 0; i < namespaces.length; i++) {
    for (let j = i + 1; j < namespaces.length; j++) {
      const left = namespaces[i]!;
      const right = namespaces[j]!;
      const overlap = signalOverlap(left.representativeSignals, right.representativeSignals);
      const labelOverlap = tokenOverlap(left.label, right.label);
      if (overlap < 0.34 && labelOverlap < 0.5) continue;
      pairs.push({ left, right, confidence: Math.min(0.82, 0.5 + overlap * 0.24 + labelOverlap * 0.16) });
    }
  }
  return pairs;
}

function shouldReviewSplit(namespace: LearnV2SkillNamespaceCandidate): boolean {
  const families = new Set(namespace.representativeSignals.map((signal) => signal.split(":")[0] ?? signal));
  const uiSubSignals = namespace.representativeSignals.filter((signal) => signal.startsWith("ui:")).length;
  return families.size >= 2 || namespace.conceptIds.length >= 4 || uiSubSignals >= 3;
}

function signalOverlap(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((signal) => rightSet.has(signal)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(left.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const rightTokens = new Set(right.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
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
    `- Ontology operations: ${artifact.counts.operations}`,
    `- Create / nest / merge / split / attach: ${artifact.counts.createOperations} / ${artifact.counts.nestOperations} / ${artifact.counts.mergeOperations} / ${artifact.counts.splitOperations} / ${artifact.counts.attachOperations}`,
    "",
    "## Namespaces",
    ""
  ];
  if (!artifact.namespaces.length) lines.push("No namespace candidates.");
  for (const namespace of artifact.namespaces) {
    lines.push(`### ${namespace.label}`);
    lines.push("");
    lines.push(`ID: ${namespace.id}`);
    lines.push(`Parent: ${namespace.parentNamespaceId ?? "none"}`);
    lines.push(`Hierarchy: ${namespace.hierarchyPath.join(" > ") || namespace.label}`);
    lines.push(`Status: ${namespace.status}`);
    lines.push(`Confidence: ${namespace.confidence.toFixed(2)}`);
    lines.push(`Concepts: ${namespace.conceptIds.join(", ")}`);
    lines.push(`Signals: ${namespace.representativeSignals.join(", ") || "none"}`);
    lines.push(`Rationale: ${namespace.rationale}`);
    lines.push("");
  }
  lines.push("## Ontology Operations");
  lines.push("");
  if (!artifact.operations.length) lines.push("No ontology operations.");
  for (const operation of artifact.operations) {
    lines.push(`### ${operation.operation}`);
    lines.push("");
    lines.push(`ID: ${operation.id}`);
    lines.push(`Status: ${operation.status}`);
    lines.push(`Confidence: ${operation.confidence.toFixed(2)}`);
    lines.push(`Namespaces: ${operation.namespaceIds.join(", ") || "none"}`);
    lines.push(`Concepts: ${operation.conceptIds.join(", ") || "none"}`);
    lines.push(`Rationale: ${operation.rationale}`);
    lines.push(`Review hint: ${operation.reviewHint}`);
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

function operationRank(operation: LearnV2SkillOntologyOperation["operation"]): number {
  if (operation === "create-namespace") return 0;
  if (operation === "nest-namespace") return 1;
  if (operation === "attach-concept") return 2;
  if (operation === "merge-namespaces") return 3;
  return 4;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
