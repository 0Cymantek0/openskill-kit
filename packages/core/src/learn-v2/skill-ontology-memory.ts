import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "../storage/atomic.js";
import {
  LearnV2SkillNamespaceCandidateSchema,
  LearnV2SkillOntologyOperationSchema,
  type LearnV2SkillNamespaceCandidate,
  type LearnV2SkillOntologyArtifact,
  type LearnV2SkillOntologyOperation
} from "./schemas.js";
import { learnV2SafeLocalPath, learnV2ShortHash } from "./utils.js";

export const LearnV2SkillOntologyMemoryStoreSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.skill-ontology-memory-store.v1"),
  updatedAt: z.string().datetime(),
  namespaces: z.array(LearnV2SkillNamespaceCandidateSchema).default([]),
  operations: z.array(LearnV2SkillOntologyOperationSchema).default([]),
  counts: z.object({
    namespaces: z.number().int().min(0),
    candidateNamespaces: z.number().int().min(0),
    reviewNamespaces: z.number().int().min(0),
    dormantNamespaces: z.number().int().min(0).default(0),
    representedConcepts: z.number().int().min(0),
    operations: z.number().int().min(0),
    createOperations: z.number().int().min(0),
    nestOperations: z.number().int().min(0),
    mergeOperations: z.number().int().min(0),
    splitOperations: z.number().int().min(0),
    attachOperations: z.number().int().min(0),
    latestRunNamespaces: z.number().int().min(0),
    latestRunOperations: z.number().int().min(0),
    updatedNamespaces: z.number().int().min(0),
    updatedOperations: z.number().int().min(0)
  }),
  artifacts: z.object({
    json: z.string(),
    markdown: z.string()
  })
});

export type LearnV2SkillOntologyMemoryStore = z.infer<typeof LearnV2SkillOntologyMemoryStoreSchema>;

export function learnV2SkillOntologyMemoryStorePath(rootInput: string): string {
  return path.join(path.resolve(rootInput), ".openskill-kit", "learn-v2", "skill-ontology-memory", "store.json");
}

export async function readLearnV2SkillOntologyMemoryStore(rootInput: string, now = new Date()): Promise<LearnV2SkillOntologyMemoryStore> {
  const root = path.resolve(rootInput);
  const json = learnV2SkillOntologyMemoryStorePath(root);
  const markdown = json.replace(/\.json$/, ".md");
  const text = await fs.readFile(json, "utf8").catch(() => undefined);
  if (!text) return emptySkillOntologyMemoryStore(json, markdown, now);
  return LearnV2SkillOntologyMemoryStoreSchema.parse(JSON.parse(text));
}

export async function writeLearnV2SkillOntologyMemoryStore(
  rootInput: string,
  run: Pick<LearnV2SkillOntologyArtifact, "namespaces" | "operations">,
  now = new Date()
): Promise<LearnV2SkillOntologyMemoryStore> {
  const root = path.resolve(rootInput);
  const json = learnV2SkillOntologyMemoryStorePath(root);
  const markdown = json.replace(/\.json$/, ".md");
  const existing = await readLearnV2SkillOntologyMemoryStore(root, now);
  const remap = namespaceIdRemap(run.namespaces);
  const incomingNamespaces = run.namespaces.map((namespace) => normalizeNamespaceForMemory(namespace, remap));
  const incomingOperations = run.operations.map((operation) => normalizeOperationForMemory(operation, remap));
  const { values: mergedNamespaces, updated: updatedNamespaces } = mergeValuesById(
    existing.namespaces,
    incomingNamespaces,
    mergeNamespace
  );
  const incomingNamespaceIds = new Set(incomingNamespaces.map((namespace) => namespace.id));
  const namespaces = mergedNamespaces.map((namespace) =>
    incomingNamespaceIds.has(namespace.id) ? namespace : markNamespaceDormant(namespace)
  );
  const { values: operations, updated: updatedOperations } = mergeValuesById(
    existing.operations,
    incomingOperations,
    mergeOperation
  );
  const representedConcepts = new Set(namespaces.flatMap((namespace) => namespace.conceptIds));
  const store = LearnV2SkillOntologyMemoryStoreSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.skill-ontology-memory-store.v1",
    updatedAt: now.toISOString(),
    namespaces,
    operations,
    counts: {
      namespaces: namespaces.length,
      candidateNamespaces: namespaces.filter((item) => item.status === "candidate").length,
      reviewNamespaces: namespaces.filter((item) => item.status === "needs-review").length,
      dormantNamespaces: namespaces.filter((item) => item.status === "dormant").length,
      representedConcepts: representedConcepts.size,
      operations: operations.length,
      createOperations: operations.filter((item) => item.operation === "create-namespace").length,
      nestOperations: operations.filter((item) => item.operation === "nest-namespace").length,
      mergeOperations: operations.filter((item) => item.operation === "merge-namespaces").length,
      splitOperations: operations.filter((item) => item.operation === "split-namespace").length,
      attachOperations: operations.filter((item) => item.operation === "attach-concept").length,
      latestRunNamespaces: run.namespaces.length,
      latestRunOperations: run.operations.length,
      updatedNamespaces,
      updatedOperations
    },
    artifacts: { json, markdown }
  });
  await fs.mkdir(path.dirname(json), { recursive: true });
  await writeJsonAtomic(json, store);
  await fs.writeFile(markdown, renderSkillOntologyMemoryStore(root, store), "utf8");
  return store;
}

function emptySkillOntologyMemoryStore(json: string, markdown: string, now: Date): LearnV2SkillOntologyMemoryStore {
  return LearnV2SkillOntologyMemoryStoreSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.skill-ontology-memory-store.v1",
    updatedAt: now.toISOString(),
    namespaces: [],
    operations: [],
    counts: {
      namespaces: 0,
      candidateNamespaces: 0,
      reviewNamespaces: 0,
      dormantNamespaces: 0,
      representedConcepts: 0,
      operations: 0,
      createOperations: 0,
      nestOperations: 0,
      mergeOperations: 0,
      splitOperations: 0,
      attachOperations: 0,
      latestRunNamespaces: 0,
      latestRunOperations: 0,
      updatedNamespaces: 0,
      updatedOperations: 0
    },
    artifacts: { json, markdown }
  });
}

function namespaceIdRemap(namespaces: LearnV2SkillNamespaceCandidate[]): Map<string, string> {
  const remap = new Map<string, string>();
  for (const namespace of namespaces) remap.set(namespace.id, namespaceMemoryId(namespace));
  return remap;
}

function normalizeNamespaceForMemory(
  namespace: LearnV2SkillNamespaceCandidate,
  remap: Map<string, string>
): LearnV2SkillNamespaceCandidate {
  const parentNamespaceId = namespace.parentNamespaceId ? remap.get(namespace.parentNamespaceId) : undefined;
  const { parentNamespaceId: _discardRawParentNamespaceId, ...rest } = namespace;
  return LearnV2SkillNamespaceCandidateSchema.parse({
    ...rest,
    id: namespaceMemoryId(namespace),
    ...(parentNamespaceId ? { parentNamespaceId } : {})
  });
}

function normalizeOperationForMemory(
  operation: LearnV2SkillOntologyOperation,
  remap: Map<string, string>
): LearnV2SkillOntologyOperation {
  const namespaceIds = operation.namespaceIds.map((id) => remap.get(id) ?? id).sort();
  const conceptIds = [...operation.conceptIds].sort();
  return LearnV2SkillOntologyOperationSchema.parse({
    ...operation,
    id: operationMemoryId(operation.operation, namespaceIds, conceptIds, operation.reviewHint),
    namespaceIds,
    conceptIds
  });
}

function operationMemoryId(
  operation: LearnV2SkillOntologyOperation["operation"],
  namespaceIds: string[],
  conceptIds: string[],
  reviewHint: string
): string {
  const conceptKey = operation === "attach-concept" ? `:${conceptIds.join(",")}` : "";
  return `ontology_memory_op_${learnV2ShortHash(`${operation}:${namespaceIds.join(",")}${conceptKey}:${reviewHint}`)}`;
}

function namespaceMemoryId(namespace: LearnV2SkillNamespaceCandidate): string {
  const key = `${namespace.hierarchyPath.join(" > ") || namespace.label}:${namespace.label}`;
  return `namespace_memory_${learnV2ShortHash(key.toLowerCase())}`;
}

function mergeValuesById<T extends { id: string }>(
  existing: T[],
  incoming: T[],
  merge: (left: T, right: T) => T
): { values: T[]; updated: number } {
  const byId = new Map<string, T>();
  for (const item of existing) byId.set(item.id, item);
  let updated = 0;
  for (const item of incoming) {
    const current = byId.get(item.id);
    byId.set(item.id, current ? merge(current, item) : item);
    updated += 1;
  }
  return {
    values: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    updated
  };
}

function mergeNamespace(left: LearnV2SkillNamespaceCandidate, right: LearnV2SkillNamespaceCandidate): LearnV2SkillNamespaceCandidate {
  return LearnV2SkillNamespaceCandidateSchema.parse({
    ...left,
    label: right.label,
    status: mergeNamespaceStatus(left.status, right.status),
    confidence: Number(Math.max(left.confidence, right.confidence).toFixed(3)),
    conceptIds: unique([...left.conceptIds, ...right.conceptIds]),
    representativeSignals: unique([...left.representativeSignals, ...right.representativeSignals]).slice(0, 24),
    parentNamespaceId: right.parentNamespaceId ?? left.parentNamespaceId,
    hierarchyPath: right.hierarchyPath.length ? right.hierarchyPath : left.hierarchyPath,
    rationale: `Merged durable namespace memory from repeated '${right.label}' run candidates.`
  });
}

function mergeNamespaceStatus(
  left: LearnV2SkillNamespaceCandidate["status"],
  right: LearnV2SkillNamespaceCandidate["status"]
): LearnV2SkillNamespaceCandidate["status"] {
  if (right !== "dormant") return right === "needs-review" || left === "needs-review" ? "needs-review" : "candidate";
  return left === "candidate" || left === "needs-review" ? left : "dormant";
}

function markNamespaceDormant(namespace: LearnV2SkillNamespaceCandidate): LearnV2SkillNamespaceCandidate {
  if (namespace.status === "dormant") return namespace;
  return LearnV2SkillNamespaceCandidateSchema.parse({
    ...namespace,
    status: "dormant",
    rationale: `Dormant namespace retained because latest Learn v2 ontology run did not refresh '${namespace.label}' with live concept evidence.`
  });
}

function mergeOperation(left: LearnV2SkillOntologyOperation, right: LearnV2SkillOntologyOperation): LearnV2SkillOntologyOperation {
  return LearnV2SkillOntologyOperationSchema.parse({
    ...left,
    status: left.status === "needs-review" || right.status === "needs-review" ? "needs-review" : "candidate",
    namespaceIds: unique([...left.namespaceIds, ...right.namespaceIds]),
    conceptIds: unique([...left.conceptIds, ...right.conceptIds]),
    confidence: Number(Math.max(left.confidence, right.confidence).toFixed(3)),
    rationale: right.rationale,
    reviewHint: right.reviewHint
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function renderSkillOntologyMemoryStore(root: string, store: LearnV2SkillOntologyMemoryStore): string {
  return [
    "# Learn v2 Skill Ontology Memory Store",
    "",
    `Updated: ${store.updatedAt}`,
    "",
    "## Counts",
    "",
    `- Namespaces: ${store.counts.namespaces} (${store.counts.latestRunNamespaces} latest run, ${store.counts.updatedNamespaces} updated)`,
    `- Operations: ${store.counts.operations} (${store.counts.latestRunOperations} latest run, ${store.counts.updatedOperations} updated)`,
    `- Represented concepts: ${store.counts.representedConcepts}`,
    `- Namespace review: ${store.counts.candidateNamespaces} candidate, ${store.counts.reviewNamespaces} needs review, ${store.counts.dormantNamespaces} dormant`,
    `- Operation mix: create=${store.counts.createOperations}, nest=${store.counts.nestOperations}, merge=${store.counts.mergeOperations}, split=${store.counts.splitOperations}, attach=${store.counts.attachOperations}`,
    "",
    "## Namespace Summary",
    "",
    ...store.namespaces.slice(0, 40).map((namespace) =>
      `- ${namespace.label}: status=${namespace.status}; confidence=${namespace.confidence}; concepts=${namespace.conceptIds.length}; signals=${namespace.representativeSignals.join(", ") || "none"}`
    ),
    ...(store.namespaces.length > 40 ? [`- ${store.namespaces.length - 40} more namespace(s) omitted from markdown summary.`] : []),
    "",
    "## Operation Summary",
    "",
    ...store.operations.slice(0, 40).map((operation) =>
      `- ${operation.operation}: status=${operation.status}; confidence=${operation.confidence}; namespaces=${operation.namespaceIds.length}; concepts=${operation.conceptIds.length}`
    ),
    ...(store.operations.length > 40 ? [`- ${store.operations.length - 40} more operation(s) omitted from markdown summary.`] : []),
    "",
    "## Privacy",
    "",
    `- Store path: ${learnV2SafeLocalPath(store.artifacts.json, root)}`,
    "- JSON store is local-only because ontology operations retain concept and review context for future skill boundary updates.",
    "- Markdown summary avoids raw evidence text and source paths."
  ].join("\n") + "\n";
}
