import type { LearnV2NormalizedEvidence, LearnV2PatchComparison, LearnV2ToolCallSummary } from "./schemas.js";
import { analyzeLearnV2StructuralDiff, structuralClassesFromSummary } from "./structural-diff.js";
import { learnV2FilePathsFromText, learnV2IsLockfilePath, learnV2ShortHash, learnV2Snippet } from "./utils.js";

export function summarizeLearnV2Tools(evidence: LearnV2NormalizedEvidence[]): LearnV2ToolCallSummary[] {
  return evidence
    .filter((item) => item.kind === "tool-call" || item.kind === "command" || item.commands.length)
    .map((item) => {
      const command = item.commands[0];
      const compression = compressToolOutput(item.text, item.status);
      return {
        id: `tool_${learnV2ShortHash(`${item.id}:${item.toolName}:${item.commands.join("\n")}`)}`,
        evidenceId: item.id,
        toolName: item.toolName ?? (item.commands.length ? "shell" : item.kind),
        status: item.status,
        command,
        commandShape: command ? commandShape(command) : undefined,
        paths: [...new Set([...item.paths, ...learnV2FilePathsFromText(compression.summary)])].slice(0, 12),
        summary: compression.summary,
        omittedBytes: compression.omittedBytes,
        outputCompression: compression
      };
    });
}

type OutputCompression = LearnV2ToolCallSummary["outputCompression"];

function compressToolOutput(text: string, status: LearnV2ToolCallSummary["status"]): OutputCompression {
  const rawLines = text.split(/\r?\n/);
  const meaningful = rawLines.map((line) => line.trim()).filter(isMeaningfulLogLine);
  const deduped = dedupeConsecutive(meaningful);
  const diagnosticLines = deduped.filter(isDiagnosticLine);
  const stackLines = deduped.filter(isStackLine).slice(0, 12);
  const testLines = deduped.filter(isTestFailureLine).slice(0, 16);
  const signatures = [...new Set([
    ...diagnosticLines.map(signatureForLine),
    ...stackLines.map(signatureForLine),
    ...testLines.map(signatureForLine)
  ])].filter(Boolean).slice(0, 12);
  const rawBytes = Buffer.byteLength(text, "utf8");
  const repeatedNoise = meaningful.length - deduped.length;
  if (!text.trim()) return compression("status-only", `${status}: no output captured.`, rawBytes, []);
  if ((status === "fail" || status === "blocked") && testLines.length) {
    return compression("test-failure-summary", testLines.join("\n"), rawBytes, signatures);
  }
  if (stackLines.length >= 2) {
    return compression("stacktrace-signature", [...diagnosticLines.slice(0, 4), ...stackLines].join("\n"), rawBytes, signatures);
  }
  if (diagnosticLines.length) {
    return compression("diagnostic-extract", diagnosticLines.slice(0, 20).join("\n"), rawBytes, signatures);
  }
  if (repeatedNoise > 3) {
    return compression("deduplicated-log", deduped.slice(0, 24).join("\n"), rawBytes, signatures);
  }
  if (deduped.length > 18 || rawBytes > 1600) {
    const first = deduped.slice(0, 10);
    const last = deduped.slice(-12);
    return compression("first-last-lines", [...first, "...", ...last].join("\n"), rawBytes, signatures);
  }
  return compression("status-only", deduped.join("\n") || `${status}: no meaningful output.`, rawBytes, signatures);
}

function compression(strategy: OutputCompression["strategy"], summaryInput: string, rawBytes: number, signatures: string[]): OutputCompression {
  const summary = learnV2Snippet(summaryInput, 900) || "No output captured.";
  return {
    strategy,
    summary,
    omittedBytes: Math.max(0, rawBytes - Buffer.byteLength(summary, "utf8")),
    signatures
  };
}

function commandShape(command: string): NonNullable<LearnV2ToolCallSummary["commandShape"]> {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  const [base = command.trim(), ...args] = parts;
  return {
    rendered: command,
    base,
    argsShape: args.slice(0, 20).map(argShape),
    riskFlags: commandRiskFlags(command)
  };
}

function argShape(value: string): string {
  if (/^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*(?:=.*)?$/.test(value)) return value.includes("=") ? "flag-with-value" : "flag";
  if (/^[A-Za-z]:[\\/]|^\/|^\.\.?[\\/]|^~[\\/]/.test(value)) return "path";
  if (/^https?:\/\//i.test(value)) return "url";
  if (/^[A-Z_][A-Z0-9_]*=.*/.test(value)) return "env-assignment";
  if (/^\d+$/.test(value)) return "number";
  if (/\*/.test(value)) return "glob";
  return "word";
}

function commandRiskFlags(command: string): string[] {
  const flags: string[] = [];
  if (/[A-Za-z0-9_]+=\S+/.test(command)) flags.push("assignment-like");
  if (/\b(token|secret|password|passwd|apikey|api_key|access_key|private_key|credential)\b/i.test(command)) flags.push("secret-keyword");
  if (/(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{10,}|AKIA[0-9A-Z]{8,})/.test(command)) flags.push("credential-pattern");
  if (/https?:\/\/\S+[?&]\S+/.test(command)) flags.push("url-with-query");
  if (/\b(?:rm|del|Remove-Item)\b.*\b(?:-rf|-r|\/s)\b/i.test(command)) flags.push("destructive-shape");
  return [...new Set(flags)].sort();
}

function isMeaningfulLogLine(line: string): boolean {
  if (!line) return false;
  if (/^[\s.=\-_*#]{8,}$/.test(line)) return false;
  if (/^(?:\d+%|\[[=>\-\s]+\]|[-\\|/]\s*)$/.test(line)) return false;
  if (/^(?:added|removed|changed) \d+ packages?/i.test(line)) return false;
  if (/^\d+\s*(?:packages?|funding|audited)\b/i.test(line)) return false;
  return true;
}

function isDiagnosticLine(line: string): boolean {
  return /\b(?:error|failed|failure|exception|assertion|expected|received|timeout|timed out|denied|blocked|cannot|not found|TS\d{4}|ERR[_A-Z0-9]+)\b/i.test(line)
    || /\b[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|md):\d+(?::\d+)?\b/.test(line);
}

function isStackLine(line: string): boolean {
  return /^\s*at\s+\S+/.test(line)
    || /\b(?:Traceback \(most recent call last\)|File \"[^\"]+\", line \d+|panic:|goroutine \d+|Caused by:)\b/.test(line);
}

function isTestFailureLine(line: string): boolean {
  return /\b(?:FAIL|FAILED|Failure|AssertionError|expected|received|should|Spec|Test Files|Tests)\b/.test(line)
    || /(?:^|[\\/])[^\\/]+\.(?:test|spec)\.[jt]sx?:\d+/.test(line);
}

function signatureForLine(line: string): string {
  return learnV2Snippet(
    line
      .replace(/\b[A-Fa-f0-9]{16,}\b/g, "<hash>")
      .replace(/\b\d+(?:\.\d+)?\b/g, "<n>")
      .replace(/[A-Za-z]:[\\/][^\s"'`]+/g, "<path>")
      .replace(/\/(?:Users|home|workspace|tmp|var|opt)\/[^\s"'`]+/g, "<path>"),
    160
  );
}

function dedupeConsecutive(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (out.at(-1) === line) continue;
    out.push(line);
  }
  return out;
}

export function summarizeLearnV2Patches(evidence: LearnV2NormalizedEvidence[]): LearnV2PatchComparison[] {
  const patches: LearnV2PatchComparison[] = [];
  for (const item of evidence) {
    const hasUnifiedDiff = /^diff --git /m.test(item.text);
    const hasPatchKeywordWithPathContext = item.paths.length > 0 && /\b(?:patched|manual edit|final patch|proposed patch|diff)\b/i.test(item.text);
    if (item.kind !== "file-change" && !hasUnifiedDiff && !hasPatchKeywordWithPathContext) continue;
    const structuralSummary = analyzeLearnV2StructuralDiff(item.text, item.paths);
    const paths = structuralSummary.fileSummaries.map((file) => file.path).slice(0, 30);
    const ignoredGenerated = structuralSummary.ignoredFiles.length > 0;
    const addedLines = item.text.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const removedLines = item.text.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    const eligibility = patchLearningEligibility(structuralSummary, item.text, item.paths, addedLines, removedLines);
    patches.push({
      id: `patch_${learnV2ShortHash(`${item.id}:${paths.join(",")}:${addedLines}:${removedLines}`)}`,
      evidenceId: item.id,
      kind: inferPatchKind(item),
      pairedWithIds: [],
      paths,
      structuralClasses: structuralClassesFromSummary(structuralSummary),
      structuralSummary,
      addedLines,
      removedLines,
      summary: renderPatchSummary(structuralSummary, item.text, eligibility.filterReasons),
      ignoredGenerated,
      behaviorEligible: eligibility.behaviorEligible,
      filterReasons: eligibility.filterReasons
    });
  }
  return attachPatchPairComparisons(patches);
}

function inferPatchKind(item: LearnV2NormalizedEvidence): LearnV2PatchComparison["kind"] {
  const metadataKind = [item.metadata.patchKind, item.metadata.diffKind, item.metadata.role, item.metadata.sourceRole]
    .map((value) => typeof value === "string" ? value : "")
    .join(" ");
  const text = `${metadataKind}\n${item.text}`;
  if (/\b(?:manual edit|manual-edited|user edited|user patch|user final edit)\b/i.test(text)) return "manual-edit";
  if (/\b(?:final patch|accepted patch|user final|finalPatch|final-patch)\b/i.test(text)) return "final-patch";
  if (/\b(?:agent patch|assistant patch|proposed patch|agent-proposed|proposedPatch|proposed-patch)\b/i.test(text)) return "agent-patch";
  return "diff-summary";
}

function attachPatchPairComparisons(patches: LearnV2PatchComparison[]): LearnV2PatchComparison[] {
  const out = patches.map((patch) => ({ ...patch, pairedWithIds: [...patch.pairedWithIds] }));
  const usedFinal = new Set<number>();
  for (const [proposedIndex, proposed] of out.entries()) {
    if (proposed.kind !== "agent-patch" || proposed.behaviorEligible === false) continue;
    const finalIndex = bestPatchPairCandidate(out, proposedIndex, usedFinal);
    if (finalIndex === undefined) continue;
    const finalPatch = out[finalIndex]!;
    const comparison = comparePatchPair(proposed, finalPatch);
    out[proposedIndex] = {
      ...proposed,
      pairedWithIds: uniqueStrings([...proposed.pairedWithIds, finalPatch.id]),
      comparison: {
        ...comparison,
        role: "agent-proposed",
        counterpartPatchId: finalPatch.id
      }
    };
    out[finalIndex] = {
      ...finalPatch,
      pairedWithIds: uniqueStrings([...finalPatch.pairedWithIds, proposed.id]),
      comparison: {
        ...comparison,
        role: finalPatch.kind === "manual-edit" ? "manual-edit" : "user-final",
        relation: finalPatch.kind === "manual-edit" ? "manual-edit-over-agent" : "proposed-vs-final",
        counterpartPatchId: proposed.id
      }
    };
    usedFinal.add(finalIndex);
  }
  return out;
}

function bestPatchPairCandidate(patches: LearnV2PatchComparison[], proposedIndex: number, usedFinal: Set<number>): number | undefined {
  let best: { index: number; score: number } | undefined;
  const proposed = patches[proposedIndex]!;
  for (let index = proposedIndex + 1; index < patches.length; index += 1) {
    if (usedFinal.has(index)) continue;
    const candidate = patches[index]!;
    if (candidate.kind !== "manual-edit" && candidate.kind !== "final-patch") continue;
    if (candidate.behaviorEligible === false) continue;
    const score = patchPairScore(proposed, candidate, index - proposedIndex);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { index, score };
  }
  return best?.index;
}

function patchPairScore(proposed: LearnV2PatchComparison, finalPatch: LearnV2PatchComparison, distance: number): number {
  const sharedPathCount = intersectStrings(proposed.paths, finalPatch.paths).length;
  const sharedDirectory = proposed.paths.some((left) => finalPatch.paths.some((right) => pathFamily(left) === pathFamily(right)));
  const sharedClassCount = intersectStrings(proposed.structuralClasses, finalPatch.structuralClasses).length;
  const symbolOverlap = intersectStrings(proposed.structuralSummary.changedSymbols, finalPatch.structuralSummary.changedSymbols).length;
  const fallbackSinglePair = !proposed.paths.length && !finalPatch.paths.length && sharedClassCount > 0;
  return (sharedPathCount * 4)
    + (sharedDirectory ? 2 : 0)
    + sharedClassCount
    + Math.min(2, symbolOverlap)
    + (fallbackSinglePair ? 1 : 0)
    - Math.min(2, Math.max(0, distance - 1) * 0.25);
}

function comparePatchPair(proposed: LearnV2PatchComparison, finalPatch: LearnV2PatchComparison): NonNullable<LearnV2PatchComparison["comparison"]> {
  const sharedPaths = intersectStrings(proposed.paths, finalPatch.paths);
  const proposedOnlyPaths = differenceStrings(proposed.paths, finalPatch.paths);
  const finalOnlyPaths = differenceStrings(finalPatch.paths, proposed.paths);
  const sharedStructuralClasses = intersectStrings(proposed.structuralClasses, finalPatch.structuralClasses);
  const proposedOnlyStructuralClasses = differenceStrings(proposed.structuralClasses, finalPatch.structuralClasses);
  const finalOnlyStructuralClasses = differenceStrings(finalPatch.structuralClasses, proposed.structuralClasses);
  const proposedOnlySymbols = differenceStrings(proposed.structuralSummary.changedSymbols, finalPatch.structuralSummary.changedSymbols);
  const finalOnlySymbols = differenceStrings(finalPatch.structuralSummary.changedSymbols, proposed.structuralSummary.changedSymbols);
  const proposedOnlyImports = differenceStrings(proposed.structuralSummary.changedImports, finalPatch.structuralSummary.changedImports);
  const finalOnlyImports = differenceStrings(finalPatch.structuralSummary.changedImports, proposed.structuralSummary.changedImports);
  const addedLineDelta = finalPatch.addedLines - proposed.addedLines;
  const removedLineDelta = finalPatch.removedLines - proposed.removedLines;
  const { behaviorSignal, reasons } = patchBehaviorSignal({
    proposed,
    finalPatch,
    sharedPaths,
    proposedOnlyPaths,
    finalOnlyPaths,
    proposedOnlyStructuralClasses,
    finalOnlyStructuralClasses,
    proposedOnlySymbols,
    finalOnlySymbols,
    proposedOnlyImports,
    finalOnlyImports,
    addedLineDelta,
    removedLineDelta
  });
  const confidence = patchComparisonConfidence({
    sharedPaths,
    sharedStructuralClasses,
    proposedOnlyPaths,
    finalOnlyPaths,
    finalOnlyStructuralClasses,
    reasons,
    behaviorSignal
  });
  return {
    schemaVersion: "openskill-kit.learn-v2.patch-comparison.v1",
    role: "standalone",
    relation: finalPatch.kind === "manual-edit" ? "manual-edit-over-agent" : "proposed-vs-final",
    sharedPaths,
    proposedOnlyPaths,
    finalOnlyPaths,
    sharedStructuralClasses,
    proposedOnlyStructuralClasses,
    finalOnlyStructuralClasses,
    proposedOnlySymbols,
    finalOnlySymbols,
    proposedOnlyImports,
    finalOnlyImports,
    addedLineDelta,
    removedLineDelta,
    behaviorSignal,
    confidence,
    reasons
  };
}

function patchBehaviorSignal(input: {
  proposed: LearnV2PatchComparison;
  finalPatch: LearnV2PatchComparison;
  sharedPaths: string[];
  proposedOnlyPaths: string[];
  finalOnlyPaths: string[];
  proposedOnlyStructuralClasses: LearnV2PatchComparison["structuralClasses"];
  finalOnlyStructuralClasses: LearnV2PatchComparison["structuralClasses"];
  proposedOnlySymbols: string[];
  finalOnlySymbols: string[];
  proposedOnlyImports: string[];
  finalOnlyImports: string[];
  addedLineDelta: number;
  removedLineDelta: number;
}): { behaviorSignal: NonNullable<LearnV2PatchComparison["comparison"]>["behaviorSignal"]; reasons: string[] } {
  const reasons: string[] = [];
  const finalAddedTests = input.finalOnlyStructuralClasses.includes("test") || input.finalOnlyPaths.some((file) => /(?:test|spec|fixture)/i.test(file));
  if (finalAddedTests) {
    reasons.push("final-patch-added-test-scope");
    return { behaviorSignal: "user-added-tests", reasons };
  }
  const proposedGeneratedOrLock = input.proposed.structuralClasses.some((item) => item === "generated" || item === "lockfile");
  const finalGeneratedOrLock = input.finalPatch.structuralClasses.some((item) => item === "generated" || item === "lockfile");
  if (proposedGeneratedOrLock && !finalGeneratedOrLock) {
    reasons.push("final-patch-removed-generated-or-lockfile-scope");
    return { behaviorSignal: "user-removed-generated-or-lockfile", reasons };
  }
  const apiChanged = input.finalOnlyStructuralClasses.includes("api")
    || input.finalOnlySymbols.length > 0
    || input.finalOnlyImports.length > 0
    || input.proposedOnlySymbols.length > 0
    || input.proposedOnlyImports.length > 0;
  if (apiChanged && input.sharedPaths.length) {
    reasons.push("final-patch-changed-api-symbols-or-imports");
    return { behaviorSignal: "user-changed-api-surface", reasons };
  }
  if (input.finalOnlyPaths.length > input.proposedOnlyPaths.length || input.finalOnlyStructuralClasses.length > input.proposedOnlyStructuralClasses.length) {
    reasons.push("final-patch-expanded-scope");
    return { behaviorSignal: "user-expanded-scope", reasons };
  }
  if (input.proposedOnlyPaths.length > input.finalOnlyPaths.length || input.proposedOnlyStructuralClasses.length > input.finalOnlyStructuralClasses.length) {
    reasons.push("final-patch-narrowed-scope");
    return { behaviorSignal: "user-narrowed-scope", reasons };
  }
  if (input.addedLineDelta === 0 && input.removedLineDelta === 0 && !input.finalOnlySymbols.length && !input.proposedOnlySymbols.length) {
    reasons.push("final-patch-kept-proposal-shape");
    return { behaviorSignal: "user-kept-proposal", reasons };
  }
  reasons.push("final-patch-materially-reworked-proposal");
  return { behaviorSignal: "user-reworked-patch", reasons };
}

function patchComparisonConfidence(input: {
  sharedPaths: string[];
  sharedStructuralClasses: LearnV2PatchComparison["structuralClasses"];
  proposedOnlyPaths: string[];
  finalOnlyPaths: string[];
  finalOnlyStructuralClasses: LearnV2PatchComparison["structuralClasses"];
  reasons: string[];
  behaviorSignal: NonNullable<LearnV2PatchComparison["comparison"]>["behaviorSignal"];
}): number {
  const sharedPathBoost = Math.min(0.22, input.sharedPaths.length * 0.08);
  const sharedClassBoost = Math.min(0.14, input.sharedStructuralClasses.length * 0.04);
  const finalScopeBoost = Math.min(0.12, (input.finalOnlyPaths.length + input.finalOnlyStructuralClasses.length) * 0.03);
  const signalBoost = input.behaviorSignal === "user-kept-proposal" || input.behaviorSignal === "unknown" ? 0 : 0.08;
  const reasonBoost = Math.min(0.06, input.reasons.length * 0.03);
  return Number(Math.min(0.9, 0.42 + sharedPathBoost + sharedClassBoost + finalScopeBoost + signalBoost + reasonBoost).toFixed(2));
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

function patchLearningEligibility(
  summary: LearnV2PatchComparison["structuralSummary"],
  text: string,
  fallbackPaths: string[],
  addedLines: number,
  removedLines: number
): Pick<LearnV2PatchComparison, "behaviorEligible" | "filterReasons"> {
  const reasons = new Set<LearnV2PatchComparison["filterReasons"][number]>();
  const allPaths = [...new Set([
    ...summary.fileSummaries.map((file) => file.path),
    ...summary.ignoredFiles,
    ...fallbackPaths
  ].filter(Boolean))];
  const changedLineCount = addedLines + removedLines;
  if (allPaths.length > 0 && allPaths.every((file) => learnV2IsLockfilePath(file))) reasons.add("dependency-lockfile-only");
  if (summary.ignoredFiles.length > 0 && summary.fileSummaries.length === 0 && !reasons.has("dependency-lockfile-only")) reasons.add("generated-only");
  if (summary.formattingOnly) reasons.add("formatting-only");
  if (isRenameOnlyDiff(text)) reasons.add("rename-only");
  if (changedLineCount === 0 && !reasons.has("rename-only")) reasons.add("empty-diff");
  if (!summary.semanticChange && !reasons.size) reasons.add("non-semantic");
  return {
    behaviorEligible: reasons.size === 0,
    filterReasons: [...reasons].sort()
  };
}

function isRenameOnlyDiff(text: string): boolean {
  const blocks = text.split(/(?=^diff --git )/m).filter((block) => /^diff --git /m.test(block));
  if (!blocks.length) return false;
  return blocks.every((block) => {
    const hasRenameMetadata = /^rename from .+/m.test(block) && /^rename to .+/m.test(block);
    const hasContentHunk = /^@@/m.test(block) || /^[+-](?![+-]{2})/m.test(block);
    return hasRenameMetadata && !hasContentHunk;
  });
}

function renderPatchSummary(summary: LearnV2PatchComparison["structuralSummary"], text: string, filterReasons: LearnV2PatchComparison["filterReasons"] = []): string {
  const parts = [
    summary.languages.length ? `languages=${summary.languages.join(",")}` : undefined,
    summary.fileSummaries.length ? `files=${summary.fileSummaries.map((file) => file.path).slice(0, 6).join(",")}` : undefined,
    summary.changedSymbols.length ? `symbols=${summary.changedSymbols.slice(0, 8).join(",")}` : undefined,
    summary.changedImports.length ? `imports=${summary.changedImports.slice(0, 5).join(",")}` : undefined,
    summary.ignoredFiles.length ? `ignored=${summary.ignoredFiles.slice(0, 5).join(",")}` : undefined,
    summary.formattingOnly ? "formatting-only" : summary.semanticChange ? "semantic-change" : undefined,
    filterReasons.length ? `learning-filter=${filterReasons.join(",")}` : undefined
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : learnV2Snippet(text, 320) || "Patch summary";
}

function intersectStrings<T extends string>(left: T[], right: T[]): T[] {
  const rightSet = new Set(right);
  return uniqueStrings(left.filter((item) => rightSet.has(item))) as T[];
}

function differenceStrings<T extends string>(left: T[], right: T[]): T[] {
  const rightSet = new Set(right);
  return uniqueStrings(left.filter((item) => !rightSet.has(item))) as T[];
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function pathFamily(file: string): string {
  const parts = file.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : file;
}
