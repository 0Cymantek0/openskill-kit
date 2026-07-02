import type { LearnV2PatchComparison } from "./schemas.js";
import { learnV2IsGeneratedPath } from "./utils.js";

type StructuralClass = LearnV2PatchComparison["structuralClasses"][number];
type StructuralLanguage = LearnV2PatchComparison["structuralSummary"]["languages"][number];
type FileSummary = LearnV2PatchComparison["structuralSummary"]["fileSummaries"][number];

interface DiffFile {
  path: string;
  added: string[];
  removed: string[];
  hunks: DiffHunk[];
}

interface DiffHunk {
  header: string;
  lines: Array<{ kind: "context" | "added" | "removed"; text: string }>;
}

export function analyzeLearnV2StructuralDiff(text: string, fallbackPaths: string[] = []): LearnV2PatchComparison["structuralSummary"] {
  const diffFiles = parseUnifiedDiff(text);
  const files = diffFiles.length
    ? diffFiles
    : fallbackPaths.map((file) => ({ path: file, added: addedLinesFromText(text), removed: removedLinesFromText(text), hunks: [] }));
  const ignoredFiles = files.filter((file) => learnV2IsGeneratedPath(file.path)).map((file) => file.path);
  const considered = files.filter((file) => !learnV2IsGeneratedPath(file.path));
  const fileSummaries = considered.map(summarizeFile);
  const changedSymbols = [...new Set(fileSummaries.flatMap((file) => file.changedSymbols))].sort().slice(0, 40);
  const changedImports = [...new Set(fileSummaries.flatMap((file) => file.changedImports))].sort().slice(0, 40);
  const languages = [...new Set(fileSummaries.map((file) => file.language))].sort();
  const semanticChange = fileSummaries.some((file) => file.semanticChange);
  const formattingOnly = fileSummaries.length > 0 && fileSummaries.every((file) => file.classes.includes("formatting")) && !semanticChange;
  return {
    languages,
    semanticChange,
    formattingOnly,
    ignoredFiles,
    changedSymbols,
    changedImports,
    fileSummaries
  };
}

export function structuralClassesFromSummary(summary: LearnV2PatchComparison["structuralSummary"]): StructuralClass[] {
  const classes = new Set<StructuralClass>();
  for (const file of summary.fileSummaries) for (const item of file.classes) classes.add(item);
  if (summary.ignoredFiles.some((file) => /(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum)$/i.test(file))) classes.add("lockfile");
  if (summary.ignoredFiles.length) classes.add("generated");
  if (summary.formattingOnly) classes.add("formatting");
  if (!classes.size) classes.add("unknown");
  return [...classes].sort();
}

function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let currentHunk: DiffHunk | undefined;
  for (const line of text.split(/\r?\n/)) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[2]!, added: [], removed: [], hunks: [] };
      currentHunk = undefined;
      files.push(current);
      continue;
    }
    const plusFile = /^\+\+\+ b\/(.+)$/.exec(line);
    if (plusFile && current) {
      current.path = plusFile[1]!;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("@@")) {
      currentHunk = { header: line, lines: [] };
      current.hunks.push(currentHunk);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const textLine = line.slice(1);
      current.added.push(textLine);
      currentHunk?.lines.push({ kind: "added", text: textLine });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      const textLine = line.slice(1);
      current.removed.push(textLine);
      currentHunk?.lines.push({ kind: "removed", text: textLine });
    } else if (line.startsWith(" ")) {
      currentHunk?.lines.push({ kind: "context", text: line.slice(1) });
    }
  }
  return files;
}

function summarizeFile(file: DiffFile): FileSummary {
  const language = languageForPath(file.path);
  const allChanged = [...file.added, ...file.removed];
  const changedSymbols = [...new Set([
    ...allChanged.flatMap((line) => symbolsForLine(language, line)),
    ...symbolsFromHunks(language, file.hunks)
  ])].sort().slice(0, 20);
  const changedImports = [...new Set(allChanged.flatMap((line) => importsForLine(language, line)))].sort().slice(0, 20);
  const classes = classesForFile(file.path, language, allChanged, changedSymbols, changedImports);
  const formattingOnly = file.added.length > 0 && file.removed.length > 0 && normalizedCode(file.added.join("\n")) === normalizedCode(file.removed.join("\n"));
  if (formattingOnly && !classes.includes("formatting")) classes.push("formatting");
  const semanticChange = !formattingOnly && (changedSymbols.length > 0 || changedImports.length > 0 || classes.some((item) => item !== "unknown" && item !== "formatting"));
  return {
    path: file.path,
    language,
    classes: [...new Set(classes)].sort(),
    changedSymbols,
    changedImports,
    addedLines: file.added.length,
    removedLines: file.removed.length,
    semanticChange
  };
}

function symbolsFromHunks(language: StructuralLanguage, hunks: DiffHunk[]): string[] {
  const out: string[] = [];
  for (const hunk of hunks) {
    const headerContext = /^@@[^@]*@@\s*(.*)$/.exec(hunk.header)?.[1] ?? "";
    out.push(...symbolsForLine(language, headerContext));
    let nearestContextSymbols: string[] = [];
    for (const line of hunk.lines) {
      const symbols = symbolsForLine(language, line.text);
      if (symbols.length) nearestContextSymbols = symbols;
      if ((line.kind === "added" || line.kind === "removed") && !symbols.length && nearestContextSymbols.length) {
        out.push(...nearestContextSymbols);
      }
    }
  }
  return out;
}

function languageForPath(file: string): StructuralLanguage {
  if (/\.(ts|tsx|mts|cts)$/i.test(file)) return "typescript";
  if (/\.(js|jsx|mjs|cjs)$/i.test(file)) return "javascript";
  if (/\.py$/i.test(file)) return "python";
  if (/\.go$/i.test(file)) return "go";
  if (/\.rs$/i.test(file)) return "rust";
  if (/\.jsonc?$/i.test(file)) return "json";
  if (/\.(md|mdx|rst)$/i.test(file)) return "markdown";
  return "unknown";
}

function symbolsForLine(language: StructuralLanguage, line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) return [];
  const patterns: RegExp[] = language === "typescript" || language === "javascript"
    ? [
        /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
        /\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g,
        /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g,
        /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/g,
        /\b(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/g,
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g
      ]
    : language === "python"
      ? [/\bdef\s+([A-Za-z_]\w*)\s*\(/g, /\bclass\s+([A-Za-z_]\w*)\s*[:(]/g]
      : language === "go"
        ? [/\bfunc\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(/g, /\btype\s+([A-Za-z_]\w*)\s+(?:struct|interface|func|\w+)/g]
        : language === "rust"
          ? [/\b(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(/g, /\b(?:pub\s+)?(?:struct|enum|trait|mod)\s+([A-Za-z_]\w*)/g, /\bimpl(?:<[^>]+>)?\s+([A-Za-z_]\w*)/g]
          : [];
  const out: string[] = [];
  for (const pattern of patterns) {
    for (const match of trimmed.matchAll(pattern)) out.push(match[1]!);
  }
  return out;
}

function importsForLine(language: StructuralLanguage, line: string): string[] {
  const trimmed = line.trim();
  const out: string[] = [];
  const patterns: RegExp[] = language === "typescript" || language === "javascript"
    ? [/^import(?:\s+type)?[\s\S]*?\s+from\s+["']([^"']+)["']/g, /^export[\s\S]*?\s+from\s+["']([^"']+)["']/g, /^import\s*\(\s*["']([^"']+)["']\s*\)/g]
    : language === "python"
      ? [/^import\s+([A-Za-z0-9_., ]+)/g, /^from\s+([A-Za-z0-9_.]+)\s+import\s+/g]
      : language === "go"
        ? [/^\s*"([^"]+)"/g, /^import\s+"([^"]+)"/g]
        : language === "rust"
          ? [/^use\s+([^;]+);/g, /^extern\s+crate\s+([^;]+);/g]
          : [];
  for (const pattern of patterns) {
    for (const match of trimmed.matchAll(pattern)) out.push(match[1]!.replace(/\s+/g, " ").trim());
  }
  return out;
}

function classesForFile(file: string, language: StructuralLanguage, lines: string[], symbols: string[], imports: string[]): StructuralClass[] {
  const text = lines.join("\n");
  const classes = new Set<StructuralClass>();
  if (/(\b|\/)(?:parser|parse|grammar|lexer)(\b|\/)/i.test(file) || /\b(?:parser|parse|grammar|lexer)\b/i.test(text)) classes.add("parser");
  if (/(?:test|spec|fixture)/i.test(file) || /\b(?:test|fixture|regression|describe|it\(|pytest|unittest)\b/i.test(text)) classes.add("test");
  if (language === "markdown") classes.add("docs");
  if (language === "json" || /(?:package\.json|tsconfig|vite|vitest|eslint|config)/i.test(file)) classes.add("config");
  if (symbols.length && (/\bexport\b/.test(text) || language === "go" || language === "rust")) classes.add("api");
  if (imports.length) classes.add("api");
  if (!classes.size && language === "unknown") classes.add("unknown");
  return [...classes];
}

function normalizedCode(text: string): string {
  return text.replace(/\s+/g, "").replace(/[;,]/g, "");
}

function addedLinesFromText(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1));
}

function removedLinesFromText(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---")).map((line) => line.slice(1));
}
