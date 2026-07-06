import ts from "typescript";
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

interface TypeScriptStructuralSignal {
  symbols: string[];
  imports: string[];
}

interface BlockStructuralSignal {
  symbols: string[];
  imports: string[];
}

interface StructuralParser {
  language: StructuralLanguage;
  backend: FileSummary["parserBackend"];
  confidence: FileSummary["structuralConfidence"];
  confidenceCap: number;
  signal(file: DiffFile): { symbols: string[]; imports: string[] };
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
  const parser = structuralParserForLanguage(language);
  const parserSignal = parser.signal(file);
  const changedSymbols = [...new Set([
    ...parserSignal.symbols,
    ...allChanged.flatMap((line) => symbolsForLine(language, line)),
    ...symbolsFromHunks(language, file.hunks)
  ])].sort().slice(0, 20);
  const changedImports = [...new Set([
    ...parserSignal.imports,
    ...allChanged.flatMap((line) => importsForLine(language, line))
  ])].sort().slice(0, 20);
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
    parserBackend: parser.backend,
    structuralConfidence: parser.confidence,
    confidenceCap: parser.confidenceCap,
    semanticChange
  };
}

function structuralParserForLanguage(language: StructuralLanguage): StructuralParser {
  if (language === "typescript" || language === "javascript") {
    return {
      language,
      backend: "typescript-compiler",
      confidence: "parser",
      confidenceCap: 1,
      signal: (file) => typeScriptStructuralSignal(file, language)
    };
  }
  if (language === "python" || language === "go" || language === "rust") {
    return {
      language,
      backend: "language-structural-scanner",
      confidence: "fallback",
      confidenceCap: 0.78,
      signal: (file) => blockStructuralSignal(file, language)
    };
  }
  return {
    language,
    backend: "none",
    confidence: "none",
    confidenceCap: 0.35,
    signal: () => ({ symbols: [], imports: [] })
  };
}

function typeScriptStructuralSignal(file: DiffFile, language: StructuralLanguage): TypeScriptStructuralSignal {
  if (language !== "typescript" && language !== "javascript") return { symbols: [], imports: [] };
  const signals: TypeScriptStructuralSignal[] = [];
  for (const hunk of file.hunks) {
    signals.push(typeScriptSignalFromHunk(file.path, language, hunk, "after"));
    signals.push(typeScriptSignalFromHunk(file.path, language, hunk, "before"));
  }
  if (!file.hunks.length) {
    signals.push(typeScriptSignalFromSource(file.path, language, file.added.join("\n"), new Set(file.added.map((_, index) => index + 1))));
    signals.push(typeScriptSignalFromSource(file.path, language, file.removed.join("\n"), new Set(file.removed.map((_, index) => index + 1))));
  }
  return {
    symbols: [...new Set(signals.flatMap((signal) => signal.symbols))].sort(),
    imports: [...new Set(signals.flatMap((signal) => signal.imports))].sort()
  };
}

function blockStructuralSignal(file: DiffFile, language: StructuralLanguage): BlockStructuralSignal {
  if (language !== "python" && language !== "go" && language !== "rust") return { symbols: [], imports: [] };
  const signals: BlockStructuralSignal[] = [];
  for (const hunk of file.hunks) {
    signals.push(blockSignalFromHunk(language, hunk, "after"));
    signals.push(blockSignalFromHunk(language, hunk, "before"));
  }
  if (!file.hunks.length) {
    signals.push(blockSignalFromSource(language, file.added, new Set(file.added.map((_, index) => index + 1))));
    signals.push(blockSignalFromSource(language, file.removed, new Set(file.removed.map((_, index) => index + 1))));
  }
  return {
    symbols: [...new Set(signals.flatMap((signal) => signal.symbols))].sort(),
    imports: [...new Set(signals.flatMap((signal) => signal.imports))].sort()
  };
}

function blockSignalFromHunk(language: StructuralLanguage, hunk: DiffHunk, side: "after" | "before"): BlockStructuralSignal {
  const lines: string[] = [];
  const changedLines = new Set<number>();
  const headerContext = /^@@[^@]*@@\s*(.*)$/.exec(hunk.header)?.[1]?.trim();
  if (headerContext) lines.push(headerContext);
  for (const line of hunk.lines) {
    if (line.kind === "context" || (side === "after" && line.kind === "added") || (side === "before" && line.kind === "removed")) {
      lines.push(line.text);
      if ((side === "after" && line.kind === "added") || (side === "before" && line.kind === "removed")) changedLines.add(lines.length);
    }
  }
  return blockSignalFromSource(language, lines, changedLines);
}

function blockSignalFromSource(language: StructuralLanguage, lines: string[], changedLines: Set<number>): BlockStructuralSignal {
  if (language === "python") return mergeBlockSignals(pythonBlockSignal(lines, changedLines), pythonImportBlockSignal(lines, changedLines), adjacentDeclarationSignal(language, lines, changedLines));
  if (language === "go") return mergeBlockSignals(braceBlockSignal(language, lines, changedLines), goDeclarationBlockSignal(lines, changedLines), adjacentDeclarationSignal(language, lines, changedLines));
  if (language === "rust") return mergeBlockSignals(braceBlockSignal(language, lines, changedLines), rustDeclarationBlockSignal(lines, changedLines), adjacentDeclarationSignal(language, lines, changedLines));
  return { symbols: [], imports: [] };
}

function mergeBlockSignals(...signals: BlockStructuralSignal[]): BlockStructuralSignal {
  return {
    symbols: [...new Set(signals.flatMap((signal) => signal.symbols))].sort(),
    imports: [...new Set(signals.flatMap((signal) => signal.imports))].sort()
  };
}

function pythonBlockSignal(lines: string[], changedLines: Set<number>): BlockStructuralSignal {
  const symbols = new Set<string>();
  const imports = new Set<string>();
  const stack: Array<{ indent: number; name: string }> = [];
  lines.forEach((line, index) => {
    for (const item of importsForLine("python", line)) imports.add(item);
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const indent = leadingIndentWidth(line);
    while (stack.length && indent <= stack[stack.length - 1]!.indent) stack.pop();
    for (const name of symbolsForLine("python", line)) {
      if (/^(?:async\s+)?def\s+|^class\s+/.test(trimmed)) stack.push({ indent, name });
      symbols.add(name);
    }
    if (indent === 0) {
      const topLevelAssignment = /^([A-Za-z_]\w*)\s*(?::[^=]+)?=/.exec(trimmed);
      if (topLevelAssignment) symbols.add(topLevelAssignment[1]!);
    }
    if (changedLines.has(index + 1)) {
      for (const item of stack) symbols.add(item.name);
    }
  });
  return { symbols: [...symbols].sort(), imports: [...imports].sort() };
}

function pythonImportBlockSignal(lines: string[], changedLines: Set<number>): BlockStructuralSignal {
  const imports = new Set<string>();
  let fromModule: string | undefined;
  let inImportBlock = false;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    if (!inImportBlock) {
      for (const item of pythonImportsForLine(trimmed)) imports.add(item);
      const start = /^from\s+([A-Za-z0-9_.]+)\s+import\s*\($/.exec(trimmed);
      if (start) {
        fromModule = start[1]!;
        inImportBlock = true;
      }
      return;
    }
    if (trimmed === ")") {
      fromModule = undefined;
      inImportBlock = false;
      return;
    }
    if (fromModule && changedLines.has(index + 1)) imports.add(fromModule);
  });
  return { symbols: [], imports: [...imports].sort() };
}

function braceBlockSignal(language: "go" | "rust", lines: string[], changedLines: Set<number>): BlockStructuralSignal {
  const symbols = new Set<string>();
  const imports = new Set<string>();
  const stack: Array<{ depth: number; names: string[] }> = [];
  let depth = 0;
  lines.forEach((line, index) => {
    for (const item of importsForLine(language, line)) imports.add(item);
    const lineSymbols = braceLineSymbols(language, line);
    for (const symbol of lineSymbols) symbols.add(symbol);
    if (line.includes("{") && lineSymbols.length) stack.push({ depth, names: lineSymbols });
    if (changedLines.has(index + 1)) {
      for (const scope of stack) for (const symbol of scope.names) symbols.add(symbol);
    }
    depth = Math.max(0, depth + braceDelta(line));
    while (stack.length && depth <= stack[stack.length - 1]!.depth) stack.pop();
  });
  return { symbols: [...symbols].sort(), imports: [...imports].sort() };
}

function braceLineSymbols(language: "go" | "rust", line: string): string[] {
  const symbols = new Set(symbolsForLine(language, line));
  if (language === "go") {
    const receiver = /\bfunc\s+\(([^)]*)\)\s*([A-Za-z_]\w*)/.exec(line);
    const receiverType = receiver ? goReceiverTypeName(receiver[1]!) : undefined;
    if (receiverType) symbols.add(receiverType);
    if (receiver?.[2]) symbols.add(receiver[2]);
  } else {
    for (const symbol of rustImplSymbols(line)) symbols.add(symbol);
  }
  return [...symbols];
}

function goDeclarationBlockSignal(lines: string[], changedLines: Set<number>): BlockStructuralSignal {
  const symbols = new Set<string>();
  const imports = new Set<string>();
  let block: "const" | "var" | "type" | "import" | undefined;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const blockStart = /^(const|var|type|import)\s*\($/.exec(trimmed);
    if (blockStart) {
      block = blockStart[1] as typeof block;
      return;
    }
    if (block && trimmed === ")") {
      block = undefined;
      return;
    }
    if (!block) return;
    if (block === "import") {
      for (const item of goImportsForLine(trimmed)) imports.add(item);
      return;
    }
    if (!changedLines.has(index + 1)) return;
    const symbol = /^([A-Za-z_]\w*)\b/.exec(trimmed)?.[1];
    if (symbol) symbols.add(symbol);
  });
  return { symbols: [...symbols].sort(), imports: [...imports].sort() };
}

function rustDeclarationBlockSignal(lines: string[], changedLines: Set<number>): BlockStructuralSignal {
  const symbols = new Set<string>();
  const imports = new Set<string>();
  const stack: Array<{ depth: number; symbols: string[] }> = [];
  let depth = 0;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    for (const item of importsForLine("rust", trimmed)) imports.add(item);
    const lineSymbols = braceLineSymbols("rust", trimmed);
    for (const symbol of lineSymbols) symbols.add(symbol);
    if (/^(?:pub(?:\([^)]*\))?\s+)?(?:impl|trait|mod)\b/.test(trimmed) && lineSymbols.length) {
      stack.push({ depth, symbols: lineSymbols });
    }
    if (changedLines.has(index + 1)) {
      for (const scope of stack) for (const symbol of scope.symbols) symbols.add(symbol);
    }
    depth = Math.max(0, depth + braceDelta(trimmed));
    while (stack.length && depth <= stack[stack.length - 1]!.depth) stack.pop();
  });
  return { symbols: [...symbols].sort(), imports: [...imports].sort() };
}

function adjacentDeclarationSignal(language: "python" | "go" | "rust", lines: string[], changedLines: Set<number>): BlockStructuralSignal {
  const symbols = new Set<string>();
  const imports = new Set<string>();
  for (const changedLine of changedLines) {
    const line = lines[changedLine - 1] ?? "";
    if (!isStructuralMetadataLine(language, line)) continue;
    const declaration = findNextDeclarationLine(language, lines, changedLine - 1);
    if (!declaration) continue;
    for (const item of importsForLine(language, declaration)) imports.add(item);
    const declarationSymbols = language === "python" ? symbolsForLine(language, declaration) : braceLineSymbols(language, declaration);
    for (const symbol of declarationSymbols) symbols.add(symbol);
  }
  return { symbols: [...symbols].sort(), imports: [...imports].sort() };
}

function isStructuralMetadataLine(language: "python" | "go" | "rust", line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (language === "python") return /^@[\w.]/.test(trimmed);
  if (language === "go") return /^(?:\/\/go:|\/\/\s*[A-Z][\w.]*\s)/.test(trimmed);
  return /^(?:#\[[^\]]+\]|\/\/\/|\/\/!)/.test(trimmed);
}

function findNextDeclarationLine(language: "python" | "go" | "rust", lines: string[], startIndex: number): string | undefined {
  const baseIndent = leadingIndentWidth(lines[startIndex] ?? "");
  for (let index = startIndex + 1; index < Math.min(lines.length, startIndex + 8); index++) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (language === "python") {
      if (trimmed.startsWith("@")) continue;
      if (leadingIndentWidth(line) < baseIndent) return undefined;
      if (symbolsForLine(language, line).length) return line;
      return undefined;
    }
    if (language === "rust") {
      if (/^(?:#\[[^\]]+\]|\/\/\/|\/\/!)/.test(trimmed)) continue;
      if (braceLineSymbols(language, line).length) return line;
      if (!trimmed.startsWith("//")) return undefined;
      continue;
    }
    if (/^(?:\/\/go:|\/\/)/.test(trimmed)) continue;
    if (braceLineSymbols(language, line).length) return line;
    return undefined;
  }
  return undefined;
}

function typeScriptSignalFromHunk(file: string, language: StructuralLanguage, hunk: DiffHunk, side: "after" | "before"): TypeScriptStructuralSignal {
  const lines: string[] = [];
  const changedLines = new Set<number>();
  const headerContext = /^@@[^@]*@@\s*(.*)$/.exec(hunk.header)?.[1]?.trim();
  if (headerContext) lines.push(headerContext);
  for (const line of hunk.lines) {
    if (line.kind === "context" || (side === "after" && line.kind === "added") || (side === "before" && line.kind === "removed")) {
      lines.push(line.text);
      if ((side === "after" && line.kind === "added") || (side === "before" && line.kind === "removed")) changedLines.add(lines.length);
    }
  }
  return typeScriptSignalFromSource(file, language, lines.join("\n"), changedLines);
}

function typeScriptSignalFromSource(file: string, language: StructuralLanguage, sourceText: string, changedLines: Set<number>): TypeScriptStructuralSignal {
  if (!sourceText.trim()) return { symbols: [], imports: [] };
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKindForLanguage(language, file));
  const declarations: Array<{ name: string; start: number; end: number; topLevel: boolean }> = [];
  const imports: string[] = [];
  const visit = (node: ts.Node): void => {
    const name = declarationName(node);
    if (name) {
      declarations.push({
        name,
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        topLevel: node.parent === sourceFile || hasExportModifier(node)
      });
    }
    const importRef = importReference(node);
    if (importRef) imports.push(importRef);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  const changedPositions = [...changedLines]
    .filter((line) => line > 0 && line <= sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1)
    .map((line) => sourceFile.getPositionOfLineAndCharacter(line - 1, 0));
  const changedSymbols = declarations
    .filter((decl) => changedPositions.some((pos) => pos >= decl.start && pos <= decl.end) || decl.topLevel)
    .map((decl) => decl.name);
  return {
    symbols: [...new Set(changedSymbols)].sort(),
    imports: [...new Set(imports)].sort()
  };
}

function scriptKindForLanguage(language: StructuralLanguage, file: string): ts.ScriptKind {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(file)) return ts.ScriptKind.JSX;
  if (language === "typescript") return ts.ScriptKind.TS;
  if (language === "javascript") return ts.ScriptKind.JS;
  return ts.ScriptKind.Unknown;
}

function declarationName(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return readableNodeName(node.name);
  }
  if (ts.isVariableDeclaration(node) && (node.parent.parent.parent === node.getSourceFile() || hasExportModifier(node.parent.parent))) {
    return readableBindingName(node.name);
  }
  return undefined;
}

function readableNodeName(name: ts.Node | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function readableBindingName(name: ts.BindingName): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(name);
  return names.length ? names.join(",") : undefined;
}

function importReference(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) return node.moduleSpecifier.text;
  if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) return node.moduleSpecifier.text;
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1) {
    const [arg] = node.arguments;
    if (arg && ts.isStringLiteral(arg)) return arg.text;
  }
  return undefined;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
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
        /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
        /\b(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g,
        /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g,
        /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/g,
        /\b(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/g,
        /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
        /\b([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*=>/g
      ]
    : language === "python"
      ? [/\b(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/g, /\bclass\s+([A-Za-z_]\w*)\s*[:(]/g]
      : language === "go"
        ? [
            /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*(?:\[.*?\])?\s*\(/g,
            /\btype\s+([A-Za-z_]\w*)\s*(?:\[.*?\])?\s+(?:struct|interface|func|map|\w+)/g,
            /\b(?:const|var)\s+([A-Za-z_]\w*)\b/g
          ]
        : language === "rust"
          ? [
              /\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]+>)?\s*\(/g,
              /\b(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|mod|type)\s+([A-Za-z_]\w*)/g,
              /\b(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+([A-Za-z_]\w*)\s*:/g,
              /\bmacro_rules!\s+([A-Za-z_]\w*)/g,
              /\bimpl(?:<[^>]+>)?\s+(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)/g
            ]
          : [];
  const out: string[] = [];
  for (const pattern of patterns) {
    for (const match of trimmed.matchAll(pattern)) out.push(match[1]!);
  }
  return out;
}

function importsForLine(language: StructuralLanguage, line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (language === "python") return pythonImportsForLine(trimmed);
  if (language === "go") return goImportsForLine(trimmed);
  if (language === "rust") return rustImportsForLine(trimmed);
  const out: string[] = [];
  const patterns: RegExp[] = language === "typescript" || language === "javascript"
    ? [/^import(?:\s+type)?[\s\S]*?\s+from\s+["']([^"']+)["']/g, /^export[\s\S]*?\s+from\s+["']([^"']+)["']/g, /^import\s*\(\s*["']([^"']+)["']\s*\)/g]
    : [];
  for (const pattern of patterns) {
    for (const match of trimmed.matchAll(pattern)) out.push(match[1]!.replace(/\s+/g, " ").trim());
  }
  return out;
}

function pythonImportsForLine(trimmed: string): string[] {
  const direct = /^import\s+(.+)$/.exec(trimmed);
  if (direct) {
    return direct[1]!
      .split(",")
      .map((item) => item.trim().replace(/\s+as\s+\w+$/i, ""))
      .filter(Boolean);
  }
  const fromImport = /^from\s+([A-Za-z0-9_.]+)\s+import\s+/.exec(trimmed);
  return fromImport ? [fromImport[1]!] : [];
}

function goImportsForLine(trimmed: string): string[] {
  const single = /^import\s+(?:\w+\s+)?"([^"]+)"/.exec(trimmed);
  if (single) return [single[1]!];
  const block = /^(?:\w+\s+)?"([^"]+)"$/.exec(trimmed);
  return block ? [block[1]!] : [];
}

function rustImportsForLine(trimmed: string): string[] {
  const use = /^use\s+([^;]+);/.exec(trimmed);
  if (use) return expandRustUse(use[1]!);
  const crateRef = /^extern\s+crate\s+([A-Za-z_]\w*)/.exec(trimmed);
  return crateRef ? [crateRef[1]!] : [];
}

function expandRustUse(value: string): string[] {
  const compact = value.replace(/\s+/g, "");
  const grouped = /^(.+)::\{(.+)\}$/.exec(compact);
  if (!grouped) return [stripRustImportAlias(compact)];
  const prefix = grouped[1]!;
  return grouped[2]!
    .split(",")
    .map((item) => stripRustImportAlias(item.trim()))
    .filter(Boolean)
    .map((item) => item === "self" ? prefix : `${prefix}::${item}`);
}

function stripRustImportAlias(value: string): string {
  return value.replace(/\sas\s[A-Za-z_]\w*$/i, "").replace(/as[A-Za-z_]\w*$/i, "");
}

function leadingIndentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

function braceDelta(line: string): number {
  const scrubbed = stripQuotedSegments(line);
  return [...scrubbed].filter((char) => char === "{").length - [...scrubbed].filter((char) => char === "}").length;
}

function stripQuotedSegments(line: string): string {
  return line
    .replace(/"([^"\\]|\\.)*"/g, "\"\"")
    .replace(/'([^'\\]|\\.)*'/g, "''")
    .replace(/`([^`\\]|\\.)*`/g, "``");
}

function goReceiverTypeName(receiver: string): string | undefined {
  const tokens = receiver.trim().split(/\s+/);
  const rawType = tokens.at(-1)?.replace(/^\*/, "").replace(/\[.*\]$/, "");
  const match = rawType ? /([A-Za-z_]\w*)$/.exec(rawType) : undefined;
  return match?.[1];
}

function rustImplSymbols(line: string): string[] {
  const trimmed = line.trim();
  const impl = /\bimpl(?:<[^>]+>)?\s+(.+?)\s*\{?$/.exec(trimmed);
  if (!impl) return [];
  const signature = impl[1]!.replace(/\s+where\s+.*$/, "").trim();
  const traitImpl = /^(.+?)\s+for\s+(.+)$/.exec(signature);
  const candidates = traitImpl ? [traitImpl[1]!, traitImpl[2]!] : [signature];
  return candidates
    .flatMap((item) => item.split(/::|<|>|,|\s+/))
    .map((item) => item.replace(/[^\w]/g, ""))
    .filter((item) => /^[A-Za-z_]\w*$/.test(item) && !/^(pub|crate|self|super|dyn|where)$/.test(item))
    .slice(0, 6);
}

function classesForFile(file: string, language: StructuralLanguage, lines: string[], symbols: string[], imports: string[]): StructuralClass[] {
  const text = lines.join("\n");
  const classes = new Set<StructuralClass>();
  if (/(\b|\/)(?:parser|parse|grammar|lexer)(\b|\/)/i.test(file) || /\b(?:parser|parse|grammar|lexer)\b/i.test(text)) classes.add("parser");
  if (/(?:test|spec|fixture)/i.test(file) || /\b(?:test|fixture|regression|describe|it\(|pytest|unittest)\b/i.test(text)) classes.add("test");
  if (language === "markdown") classes.add("docs");
  if (language === "json" || /(?:package\.json|tsconfig|vite|vitest|eslint|config)/i.test(file)) classes.add("config");
  if (symbols.length && (/\bexport\b/.test(text) || language === "python" || language === "go" || language === "rust")) classes.add("api");
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
