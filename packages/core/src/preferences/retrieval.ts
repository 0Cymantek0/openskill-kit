import { readPreferenceGraph } from "./graph.js";
import type { PreferenceNode } from "./schema.js";

export interface PreferenceRetrievalOptions {
  projectRoot: string;
  query?: string;
  paths?: string[];
  categories?: PreferenceNode["category"][];
  limit?: number;
  tokenBudgetLines?: number;
  now?: Date;
}

export interface RetrievedPreference {
  node: PreferenceNode;
  score: number;
  reasons: string[];
  level: RetrievalLevel;
  budgetLines: number;
}

export type RetrievalLevel = "critical" | "focused" | "supporting" | "background";

export interface PreferenceBundle {
  schemaVersion: "openskill-kit.preference-bundle.v1";
  query?: string;
  paths: string[];
  categories: string[];
  items: RetrievedPreference[];
  levels: Record<RetrievalLevel, RetrievedPreference[]>;
  budget: {
    requestedLines?: number;
    usedLines: number;
    omittedForBudget: string[];
  };
  trace: PreferenceRetrievalTrace;
  compactMarkdown: string;
}

export interface PreferenceRetrievalTrace {
  inferred: {
    languages: string[];
    taskTypes: string[];
    pathRoots: string[];
  };
  consideredCount: number;
  includedIds: string[];
  omitted: Array<{ id: string; reason: string }>;
  budget: {
    requestedLines?: number;
    usedLines: number;
  };
}

export async function retrieveRelevantPreferences(options: PreferenceRetrievalOptions): Promise<PreferenceBundle> {
  const graph = await readPreferenceGraph(options.projectRoot);
  const queryWords = tokenSet(options.query ?? "");
  const paths = (options.paths ?? []).map(normalizePath);
  const inferred = inferRetrievalContext(options.query ?? "", paths);
  const categoryFilter = new Set(options.categories ?? []);
  const now = options.now ?? new Date();
  const active = graph.nodes.filter((node) => node.status === "active" || node.status === "locked");
  const omitted: PreferenceRetrievalTrace["omitted"] = [];
  const scored = active
    .filter((node) => {
      const keep = categoryFilter.size === 0 || categoryFilter.has(node.category);
      if (!keep) omitted.push({ id: node.id, reason: `category-filter:${node.category}` });
      return keep;
    })
    .map((node) => scoreNode(node, queryWords, paths, inferred, now))
    .filter((item) => {
      const keep = item.score > 0;
      if (!keep) omitted.push({ id: item.node.id, reason: "low-score" });
      return keep;
    })
    .sort((a, b) => b.score - a.score || b.node.confidence - a.node.confidence || a.node.title.localeCompare(b.node.title));
  const limit = options.limit ?? 12;
  const limited = scored.slice(0, limit);
  for (const item of scored.slice(limit)) omitted.push({ id: item.node.id, reason: "over-limit" });
  const packed = packItems(limited, options.tokenBudgetLines);
  for (const id of packed.omittedForBudget) omitted.push({ id, reason: "over-budget" });
  const levels = groupByLevel(packed.items);
  return {
    schemaVersion: "openskill-kit.preference-bundle.v1",
    query: options.query,
    paths,
    categories: [...categoryFilter].sort(),
    items: packed.items,
    levels,
    budget: {
      requestedLines: options.tokenBudgetLines,
      usedLines: packed.usedLines,
      omittedForBudget: packed.omittedForBudget
    },
    trace: {
      inferred,
      consideredCount: active.length,
      includedIds: packed.items.map((item) => item.node.id),
      omitted,
      budget: {
        requestedLines: options.tokenBudgetLines,
        usedLines: packed.usedLines
      }
    },
    compactMarkdown: renderCompactBundle(packed.items)
  };
}

function scoreNode(node: PreferenceNode, queryWords: Set<string>, paths: string[], inferred: PreferenceRetrievalTrace["inferred"], now: Date): RetrievedPreference {
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
  if (inferred.taskTypes.includes("testing") && node.category === "testing") {
    score += 0.18;
    reasons.push("task:testing");
  }
  if (inferred.taskTypes.includes("documentation") && node.category === "documentation") {
    score += 0.18;
    reasons.push("task:documentation");
  }
  if (inferred.taskTypes.includes("security") && node.category === "security") {
    score += 0.28;
    reasons.push("task:security");
  }
  if (inferred.taskTypes.includes("architecture") && (node.category === "architecture" || node.category === "dependency-policy")) {
    score += 0.14;
    reasons.push("task:architecture");
  }
  const recency = recencyScore(node.updatedAt, now);
  if (recency > 0) {
    score += recency;
    reasons.push("recent");
  }
  if (isRiskSensitive(node)) {
    score += 0.12;
    reasons.push("risk-sensitive");
  }
  const rounded = Math.round(score * 1000) / 1000;
  return { node, score: rounded, reasons, level: retrievalLevel(node, rounded, reasons), budgetLines: preferenceLineCount(node, reasons) };
}

function renderCompactBundle(items: RetrievedPreference[]): string {
  if (items.length === 0) return "No relevant active preferences.";
  const groups = groupByLevel(items);
  const chunks: string[] = [];
  for (const level of ["critical", "focused", "supporting", "background"] as RetrievalLevel[]) {
    const group = groups[level];
    if (!group.length) continue;
    chunks.push(`## ${titleCase(level)}`);
    chunks.push(...group.map((item) => `- ${item.node.statement} (score ${item.score}; ${item.reasons.join(", ")})`));
    chunks.push("");
  }
  return chunks.join("\n").trim();
}

function packItems(items: RetrievedPreference[], tokenBudgetLines?: number): { items: RetrievedPreference[]; usedLines: number; omittedForBudget: string[] } {
  if (tokenBudgetLines === undefined) {
    return { items, usedLines: items.reduce((sum, item) => sum + item.budgetLines, 0), omittedForBudget: [] };
  }
  const budget = Math.max(1, Math.floor(tokenBudgetLines));
  const selected: RetrievedPreference[] = [];
  const omittedForBudget: string[] = [];
  let usedLines = 0;
  const sorted = [...items].sort((a, b) => levelRank(a.level) - levelRank(b.level) || b.score - a.score || a.node.title.localeCompare(b.node.title));
  for (const item of sorted) {
    if (usedLines + item.budgetLines <= budget) {
      selected.push(item);
      usedLines += item.budgetLines;
    } else {
      omittedForBudget.push(item.node.id);
    }
  }
  selected.sort((a, b) => levelRank(a.level) - levelRank(b.level) || b.score - a.score || a.node.title.localeCompare(b.node.title));
  return { items: selected, usedLines, omittedForBudget };
}

function groupByLevel(items: RetrievedPreference[]): Record<RetrievalLevel, RetrievedPreference[]> {
  return {
    critical: items.filter((item) => item.level === "critical"),
    focused: items.filter((item) => item.level === "focused"),
    supporting: items.filter((item) => item.level === "supporting"),
    background: items.filter((item) => item.level === "background")
  };
}

function retrievalLevel(node: PreferenceNode, score: number, reasons: string[]): RetrievalLevel {
  if (node.status === "locked" || (isRiskSensitive(node) && reasons.some((reason) => reason.startsWith("task:") || reason.startsWith("path:")))) return "critical";
  if (score >= 1.15 || reasons.some((reason) => reason.startsWith("path:"))) return "focused";
  if (score >= 0.85 || reasons.includes("project-scope")) return "supporting";
  return "background";
}

function preferenceLineCount(node: PreferenceNode, reasons: string[]): number {
  return 1 + (node.exceptions?.length ? 1 : 0) + (reasons.length > 3 ? 1 : 0);
}

function isRiskSensitive(node: PreferenceNode): boolean {
  return ["security", "command-policy", "testing", "review-policy"].includes(node.category) || node.polarity === "negative";
}

function levelRank(level: RetrievalLevel): number {
  return { critical: 0, focused: 1, supporting: 2, background: 3 }[level];
}

function titleCase(level: RetrievalLevel): string {
  return level.slice(0, 1).toUpperCase() + level.slice(1);
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

function inferRetrievalContext(query: string, paths: string[]): PreferenceRetrievalTrace["inferred"] {
  const text = `${query} ${paths.join(" ")}`.toLowerCase();
  const languages = [...new Set(paths.map(languageFromPath).filter((value): value is string => Boolean(value)))].sort();
  const taskTypes = new Set<string>();
  if (/\b(test|spec|vitest|jest|coverage|regression|fixture)\b/.test(text)) taskTypes.add("testing");
  if (/\b(doc|readme|markdown|changelog|comment)\b/.test(text)) taskTypes.add("documentation");
  if (/\b(secret|token|credential|auth|permission|security|vulnerability)\b/.test(text)) taskTypes.add("security");
  if (/\b(refactor|architecture|dependency|module|package|boundary|design)\b/.test(text)) taskTypes.add("architecture");
  if (/\b(route|endpoint|schema|api)\b/.test(text)) taskTypes.add("api");
  const pathRoots = [...new Set(paths.map((inputPath) => inputPath.split("/").slice(0, 2).join("/")).filter(Boolean))].sort();
  return { languages, taskTypes: [...taskTypes].sort(), pathRoots };
}

function languageFromPath(inputPath: string): string | undefined {
  if (/\.[cm]?tsx?$/.test(inputPath)) return "typescript";
  if (/\.jsx?$/.test(inputPath)) return "javascript";
  if (/\.py$/.test(inputPath)) return "python";
  if (/\.mdx?$/.test(inputPath)) return "markdown";
  if (/\.json$/.test(inputPath)) return "json";
  return undefined;
}

function recencyScore(timestamp: string, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - new Date(timestamp).getTime()) / 86_400_000);
  if (ageDays > 180) return 0;
  return Math.round((0.12 * (1 - ageDays / 180)) * 1000) / 1000;
}
