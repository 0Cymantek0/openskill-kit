import type { LearnV2NormalizedEvidence, LearnV2PatchComparison, LearnV2ToolCallSummary } from "./schemas.js";
import { learnV2IsGeneratedPath, learnV2ShortHash, learnV2Snippet } from "./utils.js";

export function summarizeLearnV2Tools(evidence: LearnV2NormalizedEvidence[]): LearnV2ToolCallSummary[] {
  return evidence
    .filter((item) => item.kind === "tool-call" || item.kind === "command" || item.commands.length)
    .map((item) => ({
      id: `tool_${learnV2ShortHash(`${item.id}:${item.toolName}:${item.commands.join("\n")}`)}`,
      toolName: item.toolName ?? (item.commands.length ? "shell" : item.kind),
      status: item.status,
      command: item.commands[0],
      paths: item.paths.slice(0, 12),
      summary: learnV2Snippet((item.text || item.commands.join("\n") || item.toolName) ?? "tool call", 240),
      omittedBytes: Math.max(0, Buffer.byteLength(item.text, "utf8") - 240)
    }));
}

export function summarizeLearnV2Patches(evidence: LearnV2NormalizedEvidence[]): LearnV2PatchComparison[] {
  const patches: LearnV2PatchComparison[] = [];
  for (const item of evidence) {
    if (item.kind !== "file-change" && !/^diff --git /m.test(item.text) && !/\b(?:patched|manual edit|final patch|diff)\b/i.test(item.text)) continue;
    const paths = [...new Set([...item.paths, ...pathsFromDiff(item.text)])].filter((file) => !learnV2IsGeneratedPath(file)).slice(0, 30);
    const generatedIgnored = [...item.paths, ...pathsFromDiff(item.text)].some(learnV2IsGeneratedPath);
    const addedLines = item.text.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const removedLines = item.text.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    patches.push({
      id: `patch_${learnV2ShortHash(`${item.id}:${paths.join(",")}:${addedLines}:${removedLines}`)}`,
      kind: /\bmanual edit\b/i.test(item.text) ? "manual-edit" : /\bfinal patch\b/i.test(item.text) ? "final-patch" : "diff-summary",
      paths,
      structuralClasses: structuralClasses(paths, item.text),
      addedLines,
      removedLines,
      summary: learnV2Snippet(item.text, 320) || "Patch summary",
      ignoredGenerated: generatedIgnored
    });
  }
  return patches;
}

export function learnV2TokenBudget(evidence: LearnV2NormalizedEvidence[], compressed: string): { inputChars: number; compressedChars: number; compressionRatio: number } {
  const inputChars = evidence.reduce((sum, item) => sum + item.text.length, 0);
  const compressedChars = compressed.length;
  return {
    inputChars,
    compressedChars,
    compressionRatio: inputChars ? Number(Math.min(1, compressedChars / inputChars).toFixed(3)) : 1
  };
}

function pathsFromDiff(text: string): string[] {
  return [...text.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].flatMap((match) => [match[1]!, match[2]!]);
}

function structuralClasses(paths: string[], text: string): LearnV2PatchComparison["structuralClasses"] {
  const classes = new Set<LearnV2PatchComparison["structuralClasses"][number]>();
  if (paths.some((file) => /(?:parser|parse|grammar|lexer)/i.test(file)) || /\b(?:parser|parse|grammar|lexer)\b/i.test(text)) classes.add("parser");
  if (paths.some((file) => /(?:test|spec|fixture)/i.test(file)) || /\b(?:test|fixture|regression)\b/i.test(text)) classes.add("test");
  if (paths.some((file) => /\.(md|mdx|rst)$/i.test(file))) classes.add("docs");
  if (paths.some((file) => /(?:package\.json|tsconfig|vite|vitest|eslint|config)/i.test(file))) classes.add("config");
  if (paths.some(learnV2IsGeneratedPath)) classes.add("generated");
  if (paths.some((file) => /(?:lock|go\.sum)$/i.test(file))) classes.add("lockfile");
  if (/\b(?:export|interface|public api|schema)\b/i.test(text)) classes.add("api");
  if (!classes.size) classes.add("unknown");
  return [...classes].sort();
}
