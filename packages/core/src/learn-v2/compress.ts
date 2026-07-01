import type { LearnV2NormalizedEvidence, LearnV2PatchComparison, LearnV2ToolCallSummary } from "./schemas.js";
import { analyzeLearnV2StructuralDiff, structuralClassesFromSummary } from "./structural-diff.js";
import { learnV2ShortHash, learnV2Snippet } from "./utils.js";

export function summarizeLearnV2Tools(evidence: LearnV2NormalizedEvidence[]): LearnV2ToolCallSummary[] {
  return evidence
    .filter((item) => item.kind === "tool-call" || item.kind === "command" || item.commands.length)
    .map((item) => ({
      id: `tool_${learnV2ShortHash(`${item.id}:${item.toolName}:${item.commands.join("\n")}`)}`,
      evidenceId: item.id,
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
    const structuralSummary = analyzeLearnV2StructuralDiff(item.text, item.paths);
    const paths = structuralSummary.fileSummaries.map((file) => file.path).slice(0, 30);
    const ignoredGenerated = structuralSummary.ignoredFiles.length > 0;
    const addedLines = item.text.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const removedLines = item.text.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    patches.push({
      id: `patch_${learnV2ShortHash(`${item.id}:${paths.join(",")}:${addedLines}:${removedLines}`)}`,
      evidenceId: item.id,
      kind: /\bmanual edit\b/i.test(item.text) ? "manual-edit" : /\bfinal patch\b/i.test(item.text) ? "final-patch" : "diff-summary",
      paths,
      structuralClasses: structuralClassesFromSummary(structuralSummary),
      structuralSummary,
      addedLines,
      removedLines,
      summary: renderPatchSummary(structuralSummary, item.text),
      ignoredGenerated
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

function renderPatchSummary(summary: LearnV2PatchComparison["structuralSummary"], text: string): string {
  const parts = [
    summary.languages.length ? `languages=${summary.languages.join(",")}` : undefined,
    summary.fileSummaries.length ? `files=${summary.fileSummaries.map((file) => file.path).slice(0, 6).join(",")}` : undefined,
    summary.changedSymbols.length ? `symbols=${summary.changedSymbols.slice(0, 8).join(",")}` : undefined,
    summary.changedImports.length ? `imports=${summary.changedImports.slice(0, 5).join(",")}` : undefined,
    summary.ignoredFiles.length ? `ignored=${summary.ignoredFiles.slice(0, 5).join(",")}` : undefined,
    summary.formattingOnly ? "formatting-only" : summary.semanticChange ? "semantic-change" : undefined
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : learnV2Snippet(text, 320) || "Patch summary";
}
