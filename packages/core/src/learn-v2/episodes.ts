import type { LearnV2NormalizedEvidence, LearnV2TaskEpisode } from "./schemas.js";
import { summarizeLearnV2Patches, summarizeLearnV2Tools, learnV2TokenBudget } from "./compress.js";
import { learnV2CanonicalKey, learnV2ShortHash, learnV2Snippet } from "./utils.js";

export function reconstructLearnV2Episodes(evidence: LearnV2NormalizedEvidence[]): LearnV2TaskEpisode[] {
  const sorted = [...evidence].sort((a, b) => timestampMs(a) - timestampMs(b) || a.id.localeCompare(b.id));
  const groups = new Map<string, LearnV2NormalizedEvidence[]>();
  for (const item of sorted) {
    const key = episodeKey(item, groups);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].map(([key, items]) => buildEpisode(key, items)).sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
}

function episodeKey(item: LearnV2NormalizedEvidence, groups: Map<string, LearnV2NormalizedEvidence[]>): string {
  if (item.episodeId) return `episode:${item.episodeId}`;
  if (item.traceId) return `trace:${item.traceId}`;
  if (item.sessionId) return `session:${item.sessionId}`;
  const pathKey = item.paths.slice(0, 4).map((file) => file.split("/").slice(0, 3).join("/")).sort().join("|");
  const branch = item.branch ?? "unknown";
  const bucket = item.timestamp ? Math.floor(timestampMs(item) / (45 * 60 * 1000)) : 0;
  const heuristic = `heuristic:${branch}:${pathKey}:${bucket}`;
  if (!pathKey) return `single:${item.rawRef}`;
  for (const [existingKey, values] of groups) {
    if (!existingKey.startsWith(`heuristic:${branch}:`)) continue;
    if (values.some((value) => pathOverlap(value.paths, item.paths) && Math.abs(timestampMs(value) - timestampMs(item)) <= 90 * 60 * 1000)) return existingKey;
  }
  return heuristic;
}

function buildEpisode(key: string, evidence: LearnV2NormalizedEvidence[]): LearnV2TaskEpisode {
  const evidenceIds = evidence.map((item) => item.id);
  const rawRefs = [...new Set(evidence.map((item) => item.rawRef))];
  const traceIds = [...new Set(evidence.map((item) => item.traceId).filter((value): value is string => Boolean(value)))];
  const sessionIds = [...new Set(evidence.map((item) => item.sessionId).filter((value): value is string => Boolean(value)))];
  const pathCluster = [...new Set(evidence.flatMap((item) => item.paths))].slice(0, 30);
  const messages = evidence.filter((item) => item.kind === "message" || item.kind === "review" || item.kind === "test-result" || item.kind === "log-line").slice(0, 80);
  const toolSummaries = summarizeLearnV2Tools(evidence).slice(0, 40);
  const patchComparisons = summarizeLearnV2Patches(evidence).slice(0, 20);
  const compressed = [
    ...messages.map((item) => `${item.actor}: ${learnV2Snippet(item.text, 240)}`),
    ...toolSummaries.map((item) => `tool:${item.toolName}:${item.status}:${item.summary}`),
    ...patchComparisons.map((item) => `patch:${item.structuralClasses.join(",")}:${item.summary}`)
  ].join("\n");
  const method = key.startsWith("episode:") ? "explicit-id"
    : key.startsWith("trace:") ? "trace-id"
      : key.startsWith("session:") ? "session"
        : key.startsWith("heuristic:") ? "branch-path-time"
          : "single-record";
  return {
    schemaVersion: "openskill-kit.learn-v2.task-episode.v1",
    id: `episode_${learnV2ShortHash(`${key}:${evidenceIds.join(",")}`)}`,
    traceIds,
    sessionIds,
    evidenceIds,
    rawRefs,
    startedAt: firstTimestamp(evidence),
    endedAt: lastTimestamp(evidence),
    cwdHints: [...new Set(evidence.map((item) => item.cwdHint).filter((value): value is string => Boolean(value)))],
    branch: evidence.find((item) => item.branch)?.branch,
    pathCluster,
    taskHints: inferTaskHints(evidence, patchComparisons),
    outcome: inferOutcome(evidence),
    episodeConfidence: confidenceForMethod(method, evidence),
    stitching: {
      method,
      reasons: stitchReasons(method, evidence, pathCluster)
    },
    messages,
    toolSummaries,
    patchComparisons,
    tokenBudget: learnV2TokenBudget(evidence, compressed)
  };
}

function inferTaskHints(evidence: LearnV2NormalizedEvidence[], patches: ReturnType<typeof summarizeLearnV2Patches>): string[] {
  const text = evidence.map((item) => item.text).join("\n");
  const hints = new Set<string>();
  if (/\bparser|parse|grammar|lexer\b/i.test(text)) hints.add("parser-change");
  if (/\bsecurity|secret|token|credential|authorization\b/i.test(text)) hints.add("security");
  if (/\btest|fixture|regression|vitest|pytest\b/i.test(text)) hints.add("testing");
  if (/\brefactor|rewrite|broad\b/i.test(text)) hints.add("refactor-boundary");
  if (/\bdependency|package|library\b/i.test(text)) hints.add("dependency");
  if (patches.some((patch) => patch.structuralClasses.includes("parser"))) hints.add("parser-change");
  if (patches.some((patch) => patch.structuralClasses.includes("test"))) hints.add("testing");
  if (patches.some((patch) => patch.structuralClasses.includes("api"))) hints.add("api-change");
  if (patches.some((patch) => patch.structuralSummary.formattingOnly)) hints.add("formatting-only");
  for (const command of evidence.flatMap((item) => item.commands)) hints.add(`command:${learnV2CanonicalKey(command).slice(0, 40)}`);
  return [...hints].slice(0, 12);
}

function inferOutcome(evidence: LearnV2NormalizedEvidence[]): LearnV2TaskEpisode["outcome"] {
  const text = evidence.map((item) => item.text).join("\n");
  if (/\b(rejected|reject|bad approach|unacceptable)\b/i.test(text)) return "rejected";
  if (/\b(wrong|instead|manual edit|user edited|changed it)\b/i.test(text)) return "edited";
  if (/\b(accepted|approved|looks good)\b/i.test(text)) return "accepted";
  if (evidence.some((item) => item.status === "fail")) return "failed";
  if (evidence.some((item) => item.status === "pass")) return "passed";
  return "unknown";
}

function confidenceForMethod(method: LearnV2TaskEpisode["stitching"]["method"], evidence: LearnV2NormalizedEvidence[]): number {
  const base = method === "explicit-id" ? 0.96 : method === "trace-id" ? 0.9 : method === "session" ? 0.78 : method === "branch-path-time" ? 0.62 : 0.48;
  const bonus = Math.min(0.12, evidence.length * 0.01);
  return Number(Math.min(0.98, base + bonus).toFixed(2));
}

function stitchReasons(method: LearnV2TaskEpisode["stitching"]["method"], evidence: LearnV2NormalizedEvidence[], paths: string[]): string[] {
  const reasons: string[] = [method];
  if (evidence.some((item) => item.episodeId)) reasons.push("osk-episode-id-present");
  if (evidence.some((item) => item.traceId)) reasons.push("osk-trace-id-present");
  if (evidence.some((item) => item.sessionId)) reasons.push("session-id-present");
  if (paths.length) reasons.push("path-cluster-present");
  if (evidence.some((item) => item.branch)) reasons.push("branch-present");
  return reasons;
}

function pathOverlap(a: string[], b: string[]): boolean {
  const left = new Set(a.map((file) => file.split("/").slice(0, 3).join("/")));
  return b.some((file) => left.has(file.split("/").slice(0, 3).join("/")));
}

function timestampMs(item: LearnV2NormalizedEvidence): number {
  return item.timestamp ? new Date(item.timestamp).getTime() : 0;
}

function firstTimestamp(items: LearnV2NormalizedEvidence[]): string | undefined {
  return items.map((item) => item.timestamp).filter((value): value is string => Boolean(value)).sort()[0];
}

function lastTimestamp(items: LearnV2NormalizedEvidence[]): string | undefined {
  return items.map((item) => item.timestamp).filter((value): value is string => Boolean(value)).sort().at(-1);
}
