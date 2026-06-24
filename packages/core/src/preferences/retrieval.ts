import { readPreferenceGraph } from "./graph.js";
import type { PreferenceNode } from "./schema.js";

export interface PreferenceRetrievalOptions {
  projectRoot: string;
  query?: string;
  paths?: string[];
  categories?: PreferenceNode["category"][];
  limit?: number;
  now?: Date;
}

export interface RetrievedPreference {
  node: PreferenceNode;
  score: number;
  reasons: string[];
}

export interface PreferenceBundle {
  schemaVersion: "openskill-kit.preference-bundle.v1";
  query?: string;
  paths: string[];
  categories: string[];
  items: RetrievedPreference[];
  compactMarkdown: string;
}

export async function retrieveRelevantPreferences(options: PreferenceRetrievalOptions): Promise<PreferenceBundle> {
  const graph = await readPreferenceGraph(options.projectRoot);
  const queryWords = tokenSet(options.query ?? "");
  const paths = (options.paths ?? []).map(normalizePath);
  const categoryFilter = new Set(options.categories ?? []);
  const now = options.now ?? new Date();
  const items = graph.nodes
    .filter((node) => node.status === "active" || node.status === "locked")
    .filter((node) => categoryFilter.size === 0 || categoryFilter.has(node.category))
    .map((node) => scoreNode(node, queryWords, paths, now))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.node.confidence - a.node.confidence || a.node.title.localeCompare(b.node.title))
    .slice(0, options.limit ?? 12);
  return {
    schemaVersion: "openskill-kit.preference-bundle.v1",
    query: options.query,
    paths,
    categories: [...categoryFilter].sort(),
    items,
    compactMarkdown: renderCompactBundle(items)
  };
}

function scoreNode(node: PreferenceNode, queryWords: Set<string>, paths: string[], now: Date): RetrievedPreference {
  const reasons: string[] = [];
  let score = node.confidence;
  if (node.status === "locked") {
    score += 0.25;
    reasons.push("locked");
  }
  const queryMatches = overlapCount(queryWords, tokenSet(`${node.title} ${node.statement} ${node.category}`));
  if (queryMatches > 0) {
    score += Math.min(0.4, queryMatches * 0.08);
    reasons.push(`query:${queryMatches}`);
  }
  const pathMatches = matchingPaths(node.scope.paths, paths);
  if (pathMatches.length > 0) {
    score += 0.35 + Math.min(0.25, pathMatches.length * 0.05);
    reasons.push(`path:${pathMatches.slice(0, 3).join(",")}`);
  } else if (node.scope.level === "project") {
    score += 0.05;
    reasons.push("project-scope");
  }
  if (node.category !== "general" && queryWords.has(node.category)) {
    score += 0.15;
    reasons.push(`category:${node.category}`);
  }
  const recency = recencyScore(node.updatedAt, now);
  if (recency > 0) {
    score += recency;
    reasons.push("recent");
  }
  return { node, score: Math.round(score * 1000) / 1000, reasons };
}

function renderCompactBundle(items: RetrievedPreference[]): string {
  if (items.length === 0) return "No relevant active preferences.";
  return items.map((item) => `- ${item.node.statement} (score ${item.score}; ${item.reasons.join(", ")})`).join("\n");
}

function matchingPaths(scopePaths: string[], paths: string[]): string[] {
  if (scopePaths.length === 0 || paths.length === 0) return [];
  return scopePaths.filter((scopePath) => paths.some((inputPath) => inputPath.startsWith(scopePath) || scopePath.startsWith(inputPath)));
}

function tokenSet(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) if (b.has(item)) count += 1;
  return count;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function recencyScore(timestamp: string, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - new Date(timestamp).getTime()) / 86_400_000);
  if (ageDays > 180) return 0;
  return Math.round((0.12 * (1 - ageDays / 180)) * 1000) / 1000;
}
