import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { z } from "zod";
import { readProjectConfig } from "../events/store.js";
import { redactValue } from "../events/redaction.js";
import { importInteractionSource, type InteractionImportRun } from "../interactions/importer.js";
import { runLifecycleOnce, type LifecycleRunnerResult } from "../lifecycle/runner.js";
import { buildReviewQueue } from "../preferences/proposals.js";
import { writeJsonAtomic } from "../storage/atomic.js";

export const RawLearningModelModes = ["local-raw", "remote-redacted", "remote-explicit", "heuristic-only"] as const;
export type RawLearningModelMode = typeof RawLearningModelModes[number];

const LearningWindowKindSchema = z.enum([
  "explicit-preference",
  "correction",
  "rejection",
  "acceptance",
  "security",
  "tool-failure",
  "final-summary"
]);

const BehaviorAtomSchema = z.object({
  id: z.string(),
  kind: z.enum(["preference", "workflow", "security", "verification", "dependency-policy", "review-policy"]),
  statement: z.string(),
  polarity: z.enum(["positive", "negative", "neutral"]),
  scope: z.object({
    level: z.enum(["project", "path", "directory", "task"]),
    paths: z.array(z.string()).default([])
  }),
  weight: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string())
});
export type BehaviorAtom = z.infer<typeof BehaviorAtomSchema>;

const ConceptCardSchema = z.object({
  id: z.string(),
  concept: z.string(),
  canonicalBehavior: z.string(),
  scope: z.object({
    level: z.enum(["project", "path", "directory", "task"]),
    paths: z.array(z.string()).default([])
  }),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string()),
  atoms: z.array(BehaviorAtomSchema),
  reviewStatus: z.literal("candidate")
});
export type ConceptCard = z.infer<typeof ConceptCardSchema>;

export interface RawLocalLearningOptions {
  sourceFiles: string[];
  adapter?: string;
  previewOnly?: boolean;
  maxRawBytes?: number;
  maxTurns?: number;
  allowDuplicateImports?: boolean;
  modelMode?: RawLearningModelMode;
  now?: Date;
}

export interface RawLearningSourceDigest {
  id: string;
  sourcePath: string;
  sourceHash: string;
  byteCount: number;
  lineCount: number;
  projectRelevance: ProjectRelevanceResult;
  rawVaultRecordPath?: string;
  analysisFramePath: string;
  turnCount: number;
  windowCount: number;
  atomCount: number;
  conceptCount: number;
  deidentification: {
    redacted: boolean;
    matches: string[];
  };
  importRun?: InteractionImportRun;
}

export interface RawLocalLearningResult {
  schemaVersion: "openskill-kit.raw-local-learning-run.v1";
  projectRoot: string;
  generatedAt: string;
  previewOnly: boolean;
  modelMode: RawLearningModelMode;
  sources: RawLearningSourceDigest[];
  concepts: ConceptCard[];
  artifacts: {
    digestPath: string;
    reviewMarkdownPath: string;
    rawVaultDir: string;
    analysisFramesDir: string;
  };
  lifecycle?: LifecycleRunnerResult;
  digest: {
    sourcesConsidered: number;
    sourcesIncluded: number;
    sourcesAsk: number;
    sourcesExcluded: number;
    rawVaultRecordsWritten: number;
    analysisFramesWritten: number;
    learningWindows: number;
    behaviorAtoms: number;
    conceptCards: number;
    eventsAppended: number;
    reviewCandidates: number;
  };
  quality: {
    relevanceScore: number;
    conceptYieldScore: number;
    reviewReadinessScore: number;
    propagationSafetyScore: number;
    overallScore: number;
    strengths: string[];
    risks: string[];
  };
  privacy: string[];
  nextActions: string[];
}

interface ProjectRelevanceResult {
  score: number;
  reasons: string[];
  matchedPaths: string[];
  matchedRemotes: string[];
  decision: "include" | "ask" | "exclude";
}

interface CanonicalTurn {
  role: "system" | "developer" | "user" | "assistant" | "tool" | "reviewer" | "unknown";
  timestamp?: string;
  text: string;
  toolName?: string;
  status?: "pass" | "fail" | "blocked" | "unknown";
  files: string[];
  commands: string[];
}

interface LearningWindow {
  id: string;
  kind: z.infer<typeof LearningWindowKindSchema>;
  summary: string;
  excerpt: string;
  files: string[];
  commands: string[];
  evidenceRef: string;
}

export async function runRawLocalLearning(
  projectRootInput: string,
  options: RawLocalLearningOptions
): Promise<RawLocalLearningResult> {
  if (!options.sourceFiles.length) throw new Error("Raw local learning requires at least one --surface-file path.");
  const root = path.resolve(projectRootInput);
  const config = await readProjectConfig(root);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const previewOnly = options.previewOnly !== false;
  const modelMode = options.modelMode ?? "heuristic-only";
  const rawVaultDir = path.join(root, ".openskill-kit", "raw-vault");
  const analysisFramesDir = path.join(root, ".openskill-kit", "learning", "analysis-frames");
  const stagedImportsDir = path.join(root, ".openskill-kit", "learning", "staged-imports");
  const digestsDir = path.join(root, ".openskill-kit", "learning", "digests");
  await fs.mkdir(analysisFramesDir, { recursive: true });
  await fs.mkdir(digestsDir, { recursive: true });
  if (!previewOnly) {
    await fs.mkdir(path.join(rawVaultDir, "records"), { recursive: true });
    await fs.mkdir(stagedImportsDir, { recursive: true });
  }

  const sourceDigests: RawLearningSourceDigest[] = [];
  const allConcepts: ConceptCard[] = [];
  let eventsAppended = 0;
  const importRuns: InteractionImportRun[] = [];

  for (const sourceFile of options.sourceFiles) {
    const sourcePath = path.resolve(sourceFile);
    const stat = await fs.stat(sourcePath).catch(() => undefined);
    if (!stat?.isFile()) throw new Error(`Raw learning source is not a file: ${sourcePath}`);
    const maxBytes = options.maxRawBytes ?? 5_000_000;
    if (stat.size > maxBytes) throw new Error(`Raw learning source exceeds maxRawBytes=${maxBytes}: ${sourcePath}`);
    const rawText = await fs.readFile(sourcePath, "utf8");
    const sourceHash = `sha256:${sha256(rawText)}`;
    const relevance = await resolveProjectRelevance(root, sourcePath, rawText);
    const deidentified = deidentifyRawText(rawText, root, config);
    const turns = parseCanonicalTurns(deidentified.text, sourceHash, options.maxTurns ?? 500);
    const windows = mineLearningWindows(turns, sourceHash);
    const atoms = windows.flatMap((window) => atomsFromWindow(window));
    const concepts = induceConceptCards(atoms);
    allConcepts.push(...concepts);

    const short = sourceHash.replace(/^sha256:/, "").slice(0, 16);
    const rawVaultRecordPath = previewOnly ? undefined : path.join(rawVaultDir, "records", `${short}.json`);
    if (rawVaultRecordPath) {
      await writeJsonAtomic(rawVaultRecordPath, {
        schemaVersion: "openskill-kit.raw-vault-record.v1",
        id: `raw_${short}`,
        projectId: config.projectId,
        sourcePath: deidentifiedPath(sourcePath, root),
        sourcePathHash: sha256(sourcePath),
        sourceHash,
        capturedAt: generatedAt,
        byteCount: stat.size,
        lineCount: rawText.split(/\r?\n/).length,
        projectRelevance: relevance,
        deidentification: {
          redacted: deidentified.matches.length > 0,
          matches: deidentified.matches
        },
        contentEncoding: "utf8",
        contentKind: "deidentified-raw-transcript",
        content: deidentified.text
      });
    }

    const analysisFramePath = path.join(analysisFramesDir, `${short}.json`);
    await writeJsonAtomic(analysisFramePath, {
      schemaVersion: "openskill-kit.analysis-frame.v1",
      id: `frame_${short}`,
      sourceHash,
      sourcePath,
      projectRelevance: relevance,
      modelMode,
      promptSafe: modelMode !== "local-raw",
      turns,
      learningWindows: windows,
      behaviorAtoms: atoms,
      conceptCards: concepts
    });

    let importRun: InteractionImportRun | undefined;
    if (!previewOnly && relevance.decision === "include") {
      const stagedImportPath = path.join(stagedImportsDir, `${short}.txt`);
      await fs.writeFile(stagedImportPath, deidentified.text, "utf8");
      importRun = await importInteractionSource(root, stagedImportPath, {
        adapter: options.adapter ?? "manual-import",
        dryRun: false,
        allowDuplicate: options.allowDuplicateImports === true,
        maxEvents: options.maxTurns ?? 500,
        now: options.now
      });
      eventsAppended += importRun.appendedEventCount;
      importRuns.push(importRun);
    }

    sourceDigests.push({
      id: `source_${short}`,
      sourcePath,
      sourceHash,
      byteCount: stat.size,
      lineCount: rawText.split(/\r?\n/).length,
      projectRelevance: relevance,
      rawVaultRecordPath,
      analysisFramePath,
      turnCount: turns.length,
      windowCount: windows.length,
      atomCount: atoms.length,
      conceptCount: concepts.length,
      deidentification: {
        redacted: deidentified.matches.length > 0,
        matches: deidentified.matches
      },
      importRun
    });
  }

  const dedupedConcepts = induceConceptCards(allConcepts.flatMap((concept) => concept.atoms));
  const lifecycle = !previewOnly && importRuns.some((run) => run.appendedEventCount > 0)
    ? await runLifecycleOnce({ projectRoot: root, maxEvents: options.maxTurns ?? 500, compileSafe: false, now: options.now })
    : undefined;
  const review = lifecycle ? await buildReviewQueue(root) : undefined;
  const digestPath = path.join(digestsDir, `raw-learning-${timestampSlug(generatedAt)}.json`);
  const reviewMarkdownPath = path.join(digestsDir, `raw-learning-${timestampSlug(generatedAt)}.md`);
  const result: RawLocalLearningResult = {
    schemaVersion: "openskill-kit.raw-local-learning-run.v1",
    projectRoot: root,
    generatedAt,
    previewOnly,
    modelMode,
    sources: sourceDigests,
    concepts: dedupedConcepts,
    artifacts: {
      digestPath,
      reviewMarkdownPath,
      rawVaultDir,
      analysisFramesDir
    },
    lifecycle,
    digest: {
      sourcesConsidered: sourceDigests.length,
      sourcesIncluded: sourceDigests.filter((source) => source.projectRelevance.decision === "include").length,
      sourcesAsk: sourceDigests.filter((source) => source.projectRelevance.decision === "ask").length,
      sourcesExcluded: sourceDigests.filter((source) => source.projectRelevance.decision === "exclude").length,
      rawVaultRecordsWritten: sourceDigests.filter((source) => source.rawVaultRecordPath).length,
      analysisFramesWritten: sourceDigests.length,
      learningWindows: sourceDigests.reduce((sum, source) => sum + source.windowCount, 0),
      behaviorAtoms: sourceDigests.reduce((sum, source) => sum + source.atomCount, 0),
      conceptCards: dedupedConcepts.length,
      eventsAppended,
      reviewCandidates: lifecycle?.graph.candidateCount ?? review?.candidates.length ?? 0
    },
    quality: buildQualityReport(sourceDigests, dedupedConcepts, previewOnly),
    privacy: [
      "Raw local learning reads full supplied evidence locally.",
      "Raw vault records store deidentified raw content; API keys, secret assignments, user home paths, and project root paths are replaced with typed placeholders.",
      "Analysis frames and review digests are prompt-safe unless modelMode=local-raw is explicitly selected.",
      "Compiled behavior and project behavior packs never include raw-vault records.",
      "Concepts remain candidate review artifacts; activation still goes through /osk review."
    ],
    nextActions: previewOnly
      ? [
          "Inspect the raw learning digest, then rerun with --apply to write deidentified raw vault records and review-gated events.",
          "Use --model-mode local-raw only with a local model; use remote-redacted or heuristic-only for remote providers."
        ]
      : [
          "Inspect the raw learning digest and /osk review queue before activation.",
          "Run /osk review to accept, edit, or reject candidates, then /osk compile."
        ]
  };
  await writeJsonAtomic(digestPath, result);
  await fs.writeFile(reviewMarkdownPath, renderRawLearningDigest(result), "utf8");
  return result;
}

async function resolveProjectRelevance(root: string, sourcePath: string, text: string): Promise<ProjectRelevanceResult> {
  const reasons: string[] = [];
  const matchedPaths: string[] = [];
  const matchedRemotes: string[] = [];
  let score = 0;
  const normalizedRoot = root.replace(/\\/g, "/");
  const sourceInsideProject = isInside(root, sourcePath);
  if (sourceInsideProject) {
    score += 0.55;
    reasons.push("source-file-inside-project");
    matchedPaths.push(path.relative(root, sourcePath).replace(/\\/g, "/"));
  }
  if (text.includes(root) || text.includes(normalizedRoot)) {
    score += 0.35;
    reasons.push("project-root-mentioned");
    matchedPaths.push("[PROJECT_ROOT]");
  }
  const packageName = await readPackageName(root);
  if (packageName && new RegExp(`\\b${escapeRegExp(packageName)}\\b`, "i").test(text)) {
    score += 0.18;
    reasons.push("package-name-mentioned");
  }
  const remotes = await readGitRemotes(root);
  for (const remote of remotes) {
    if (remote && text.includes(remote)) {
      score += 0.35;
      reasons.push("git-remote-mentioned");
      matchedRemotes.push(remote);
    }
  }
  const relativeMentions = [...text.matchAll(/\b(?:packages|src|docs|tests|python|examples)\/[A-Za-z0-9_./-]+\b/g)]
    .map((match) => match[0])
    .slice(0, 12);
  if (relativeMentions.length) {
    score += Math.min(0.25, relativeMentions.length * 0.05);
    reasons.push("repo-relative-path-mentioned");
    matchedPaths.push(...relativeMentions);
  }
  const bounded = Math.min(1, score);
  const decision = bounded >= 0.5 ? "include" : bounded >= 0.25 ? "ask" : "exclude";
  return {
    score: Number(bounded.toFixed(2)),
    reasons: [...new Set(reasons)].sort(),
    matchedPaths: [...new Set(matchedPaths)].sort(),
    matchedRemotes: [...new Set(matchedRemotes)].sort(),
    decision
  };
}

function deidentifyRawText(text: string, root: string, config: Awaited<ReturnType<typeof readProjectConfig>>): { text: string; matches: string[] } {
  const matches = new Set<string>();
  let current = text;
  const redacted = redactValue(current, config);
  current = String(redacted.value);
  for (const match of redacted.matches) matches.add(match);
  const replacements: Array<[string, string, string]> = [
    [root, "[PROJECT_ROOT]", "project-root"],
    [root.replace(/\\/g, "\\\\"), "[PROJECT_ROOT]", "project-root"],
    [root.replace(/\\/g, "/"), "[PROJECT_ROOT]", "project-root"],
    [os.homedir(), "[USER_HOME]", "user-home"],
    [os.homedir().replace(/\\/g, "\\\\"), "[USER_HOME]", "user-home"],
    [os.homedir().replace(/\\/g, "/"), "[USER_HOME]", "user-home"]
  ];
  for (const [needle, replacement, id] of replacements) {
    if (!needle || !current.includes(needle)) continue;
    current = current.split(needle).join(replacement);
    matches.add(id);
  }
  current = current.replace(/\b[A-Z]:\\Users\\[^\\\s"'`]+(?:\\[^\s"'`]+)*/g, (match) => {
    matches.add("absolute-user-path");
    return match.includes(".") ? "[ABSOLUTE_USER_PATH:file]" : "[ABSOLUTE_USER_PATH]";
  });
  current = current.replace(/\b[A-Z]:\\(?!Windows\\|Program Files\\|Program Files \(x86\)\\)[^\s"'`]+/g, () => {
    matches.add("absolute-path");
    return "[ABSOLUTE_PATH]";
  });
  current = current.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => {
    matches.add("email");
    return "[REDACTED:email]";
  });
  return { text: current, matches: [...matches].sort() };
}

function deidentifiedPath(value: string, root: string): string {
  const relative = path.relative(root, value);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return `[PROJECT_ROOT]/${relative.replace(/\\/g, "/")}`;
  const home = os.homedir();
  const homeRelative = path.relative(home, value);
  if (homeRelative && !homeRelative.startsWith("..") && !path.isAbsolute(homeRelative)) return `[USER_HOME]/${homeRelative.replace(/\\/g, "/")}`;
  return "[LOCAL_PATH]";
}

function parseCanonicalTurns(text: string, sourceHash: string, maxTurns: number): CanonicalTurn[] {
  const warnings: string[] = [];
  const objects = parseJsonObjects(text, warnings);
  const turns = objects.length
    ? flattenObjects(objects).flatMap((object, index) => turnFromObject(object, index))
    : turnsFromPlainText(text, sourceHash);
  return turns.slice(0, maxTurns);
}

function parseJsonObjects(text: string, warnings: string[]): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 1) {
    const parsedLines: unknown[] = [];
    for (const line of lines) {
      try {
        parsedLines.push(JSON.parse(line));
      } catch {
        parsedLines.length = 0;
        break;
      }
    }
    if (parsedLines.length) return parsedLines;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (isObject(parsed)) {
      for (const key of ["events", "messages", "turns", "conversation", "transcript", "items"]) {
        if (Array.isArray(parsed[key])) return parsed[key] as unknown[];
      }
    }
    return [parsed];
  } catch {
    warnings.push("source is not JSON/JSONL; using plain text transcript parser");
    return [];
  }
}

function flattenObjects(objects: unknown[]): unknown[] {
  const out: unknown[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (isObject(value)) {
      const nested = ["events", "messages", "turns", "conversation", "transcript", "items", "entries"].find((key) => Array.isArray(value[key]));
      if (nested) {
        visit(value[nested]);
        return;
      }
    }
    out.push(value);
  };
  visit(objects);
  return out;
}

function turnFromObject(object: unknown, index: number): CanonicalTurn[] {
  if (!isObject(object)) return [];
  const role = normalizeRole(stringValue(object.role) ?? stringValue(object.type) ?? stringValue(object.actor));
  const text = [
    stringValue(object.content),
    stringValue(object.text),
    stringValue(object.message),
    stringValue(object.body),
    stringValue(object.summary),
    stringValue(object.output)
  ].find((value) => value && value.trim());
  const commandText = stringValue(object.command) ?? stringValue(object.cmd) ?? stringValue(object.commandLine);
  const toolName = stringValue(object.toolName) ?? stringValue(object.tool) ?? stringValue(object.name);
  const files = filePathsFromText(`${text ?? ""}\n${JSON.stringify(object)}`).slice(0, 20);
  const commands = commandText ? [commandText] : commandLinesFromText(text ?? "").slice(0, 8);
  if (!text && !commands.length && !toolName) return [];
  return [{
    role,
    timestamp: stringValue(object.timestamp) ?? stringValue(object.createdAt) ?? stringValue(object.created_at),
    text: text ?? commandText ?? toolName ?? `turn ${index}`,
    toolName,
    status: statusFromValue(object.status),
    files,
    commands
  }];
}

function turnsFromPlainText(text: string, sourceHash: string): CanonicalTurn[] {
  const turns: CanonicalTurn[] = [];
  const blocks = text.split(/\n(?=(?:user|assistant|system|developer|tool|reviewer)\s*:)/i);
  if (blocks.length > 1) {
    for (const block of blocks) {
      const match = block.match(/^\s*(user|assistant|system|developer|tool|reviewer)\s*:\s*([\s\S]*)$/i);
      if (!match) continue;
      const body = match[2]!.trim();
      turns.push({
        role: normalizeRole(match[1]),
        text: body,
        files: filePathsFromText(body),
        commands: commandLinesFromText(body)
      });
    }
    return turns;
  }
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .map((line, index) => ({
      role: /^(always|prefer|never|avoid|do not|don't|stop|must|should)\b/i.test(line) ? "user" as const : "unknown" as const,
      timestamp: undefined,
      text: line,
      files: filePathsFromText(line),
      commands: commandLinesFromText(line),
      toolName: undefined,
      status: /\b(pass|passed|success|succeeded|ok)\b/i.test(line) ? "pass" as const : undefined
    }))
    .map((turn, index) => ({ ...turn, text: turn.text || `plain text turn ${sourceHash}:${index}` }));
}

function mineLearningWindows(turns: CanonicalTurn[], sourceHash: string): LearningWindow[] {
  const windows: LearningWindow[] = [];
  for (const [index, turn] of turns.entries()) {
    const kind = classifyWindow(turn);
    if (!kind) continue;
    const nearby = turns.slice(Math.max(0, index - 2), Math.min(turns.length, index + 3));
    const files = [...new Set(nearby.flatMap((item) => item.files))].slice(0, 12);
    const commands = [...new Set(nearby.flatMap((item) => item.commands))].slice(0, 8);
    const excerpt = nearby.map((item) => `${item.role}: ${snippet(item.text, 360)}`).join("\n");
    windows.push({
      id: `win_${sha256(`${sourceHash}:${index}:${kind}:${turn.text}`).slice(0, 12)}`,
      kind,
      summary: summarizeWindow(kind, turn.text),
      excerpt,
      files,
      commands,
      evidenceRef: `${sourceHash}#turn-${index}`
    });
  }
  return windows;
}

function classifyWindow(turn: CanonicalTurn): LearningWindow["kind"] | undefined {
  const text = turn.text;
  if (/\b(always|prefer|make sure to|default to)\b/i.test(text) || /\b(never|avoid|do not|don't|stop)\b/i.test(text)) return "explicit-preference";
  if (/\b(wrong|missed|instead|not this|you should|should have|do not|don't)\b/i.test(text)) return "correction";
  if (/\b(reject|rejected|unacceptable|bad approach|broad rewrite)\b/i.test(text)) return "rejection";
  if (/\b(accepted|looks good|approved|works|pass|passed)\b/i.test(text)) return "acceptance";
  if (/\b(secret|token|api key|password|credential|authorization|private key)\b/i.test(text)) return "security";
  if (turn.status === "fail" || /\b(error|failed|failure|stack trace|exception)\b/i.test(text)) return "tool-failure";
  if (/\b(final|handoff|summary|tests run|verification)\b/i.test(text)) return "final-summary";
  return undefined;
}

function summarizeWindow(kind: LearningWindow["kind"], text: string): string {
  return `${kind}: ${snippet(text.replace(/\s+/g, " "), 180)}`;
}

function atomsFromWindow(window: LearningWindow): BehaviorAtom[] {
  const atoms: BehaviorAtom[] = [];
  const statements = extractPreferenceStatements(window.excerpt);
  for (const statement of statements) {
    atoms.push(atom(window, statement, /\b(never|avoid|do not|don't|stop)\b/i.test(statement) ? "negative" : "positive"));
  }
  if (!statements.length && window.kind === "rejection" && /broad rewrite/i.test(window.excerpt)) {
    atoms.push(atom(window, "Avoid broad rewrites when a focused project-scoped fix can satisfy the task.", "negative"));
  }
  if (/fixture|regression/i.test(window.excerpt) && /test/i.test(window.excerpt)) {
    atoms.push(atom(window, "Prefer focused regression tests or fixtures around the changed behavior before broader verification.", "positive", "verification"));
  }
  if (/secret|token|api key|authorization|credential/i.test(window.excerpt)) {
    atoms.push(atom(window, "Never propagate secrets, credentials, authorization headers, or API keys into generated artifacts or logs.", "negative", "security"));
  }
  return atoms;
}

function atom(window: LearningWindow, statement: string, polarity: BehaviorAtom["polarity"], kind?: BehaviorAtom["kind"]): BehaviorAtom {
  const paths = window.files.filter((file) => !file.includes("["));
  const inferredKind = kind ?? (/dependency|package|library/i.test(statement) ? "dependency-policy" : /review|final|handoff/i.test(statement) ? "review-policy" : "workflow");
  return BehaviorAtomSchema.parse({
    id: `atom_${sha256(`${window.id}:${statement}`).slice(0, 12)}`,
    kind: inferredKind,
    statement: normalizeStatement(statement),
    polarity,
    scope: {
      level: paths.length ? "path" : "project",
      paths: paths.slice(0, 8)
    },
    weight: Math.min(0.92, 0.58 + (window.commands.length ? 0.08 : 0) + (window.files.length ? 0.08 : 0)),
    evidenceRefs: [window.evidenceRef]
  });
}

function extractPreferenceStatements(text: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\b((?:always|prefer|make sure to|default to)\s+[^.!?\n]{8,220})/gi,
    /\b((?:never|avoid|do not|don't|stop)\s+[^.!?\n]{8,220})/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) out.push(match[1]!.trim());
  }
  return [...new Set(out)].slice(0, 8);
}

function induceConceptCards(atoms: BehaviorAtom[]): ConceptCard[] {
  const groups = new Map<string, BehaviorAtom[]>();
  for (const atom of atoms) {
    const key = `${atom.kind}:${atom.polarity}:${atom.scope.paths[0] ?? "project"}:${canonicalKey(atom.statement)}`;
    groups.set(key, [...(groups.get(key) ?? []), atom]);
  }
  return [...groups.values()].map((items) => {
    const first = items[0]!;
    const evidenceRefs = [...new Set(items.flatMap((item) => item.evidenceRefs))];
    return ConceptCardSchema.parse({
      id: `concept_${sha256(`${first.kind}:${first.polarity}:${first.statement}:${evidenceRefs.join(",")}`).slice(0, 12)}`,
      concept: titleFromStatement(first.statement),
      canonicalBehavior: first.statement,
      scope: {
        level: first.scope.paths.length ? "path" : first.scope.level,
        paths: [...new Set(items.flatMap((item) => item.scope.paths))].slice(0, 12)
      },
      confidence: Math.min(0.94, Math.max(...items.map((item) => item.weight)) + Math.min(0.18, (items.length - 1) * 0.04)),
      evidenceRefs,
      atoms: items,
      reviewStatus: "candidate"
    });
  }).sort((a, b) => b.confidence - a.confidence || a.concept.localeCompare(b.concept));
}

function renderRawLearningDigest(result: RawLocalLearningResult): string {
  const lines = [
    "# Raw Local Learning Digest",
    "",
    `Generated: ${result.generatedAt}`,
    `Preview only: ${result.previewOnly}`,
    `Model mode: ${result.modelMode}`,
    "",
    "## Summary",
    "",
    `- Sources considered: ${result.digest.sourcesConsidered}`,
    `- Sources included: ${result.digest.sourcesIncluded}`,
    `- Learning windows: ${result.digest.learningWindows}`,
    `- Behavior atoms: ${result.digest.behaviorAtoms}`,
    `- Concept cards: ${result.digest.conceptCards}`,
    `- Events appended: ${result.digest.eventsAppended}`,
    `- Overall quality: ${result.quality.overallScore.toFixed(2)}`,
    "",
    "## Quality",
    "",
    `- Relevance: ${result.quality.relevanceScore.toFixed(2)}`,
    `- Concept yield: ${result.quality.conceptYieldScore.toFixed(2)}`,
    `- Review readiness: ${result.quality.reviewReadinessScore.toFixed(2)}`,
    `- Propagation safety: ${result.quality.propagationSafetyScore.toFixed(2)}`,
    "",
    "Strengths:",
    ...result.quality.strengths.map((item) => `- ${item}`),
    "",
    "Risks:",
    ...result.quality.risks.map((item) => `- ${item}`),
    "",
    "## Concepts",
    ""
  ];
  if (!result.concepts.length) lines.push("No concept cards mined.");
  for (const concept of result.concepts) {
    lines.push(`### ${concept.concept}`);
    lines.push("");
    lines.push(`Behavior: ${concept.canonicalBehavior}`);
    lines.push(`Confidence: ${concept.confidence.toFixed(2)}`);
    if (concept.scope.paths.length) lines.push(`Paths: ${concept.scope.paths.join(", ")}`);
    lines.push(`Evidence: ${concept.evidenceRefs.join(", ")}`);
    lines.push("");
  }
  lines.push("## Privacy Boundary");
  lines.push("");
  for (const item of result.privacy) lines.push(`- ${item}`);
  return `${lines.join("\n")}\n`;
}

function buildQualityReport(sources: RawLearningSourceDigest[], concepts: ConceptCard[], previewOnly: boolean): RawLocalLearningResult["quality"] {
  const included = sources.filter((source) => source.projectRelevance.decision === "include");
  const relevanceScore = sources.length
    ? included.reduce((sum, source) => sum + source.projectRelevance.score, 0) / sources.length
    : 0;
  const totalWindows = sources.reduce((sum, source) => sum + source.windowCount, 0);
  const totalAtoms = sources.reduce((sum, source) => sum + source.atomCount, 0);
  const conceptYieldScore = totalWindows ? Math.min(1, (concepts.length + totalAtoms * 0.5) / Math.max(1, totalWindows)) : 0;
  const evidenceBacked = concepts.filter((concept) => concept.evidenceRefs.length > 0 && concept.confidence >= 0.58).length;
  const reviewReadinessScore = concepts.length ? evidenceBacked / concepts.length : 0;
  const unsafeSource = sources.some((source) => source.deidentification.matches.length === 0 && /secret|token|key|path/i.test(source.sourcePath));
  const propagationSafetyScore = unsafeSource ? 0.65 : 1;
  const overallScore = (relevanceScore * 0.3) + (conceptYieldScore * 0.25) + (reviewReadinessScore * 0.25) + (propagationSafetyScore * 0.2);
  const strengths: string[] = [];
  const risks: string[] = [];
  if (included.length) strengths.push(`${included.length} source(s) matched this project strongly enough for project-scoped learning.`);
  if (concepts.length) strengths.push(`${concepts.length} reviewable concept card(s) mined from raw learning windows.`);
  if (sources.some((source) => source.deidentification.redacted)) strengths.push("Deidentification ran before analysis frames and staged imports.");
  if (!previewOnly && sources.some((source) => source.rawVaultRecordPath)) strengths.push("Deidentified raw vault records were written for local auditability.");
  if (sources.some((source) => source.projectRelevance.decision === "ask")) risks.push("Some sources are ambiguous and should be reviewed before apply.");
  if (sources.some((source) => source.projectRelevance.decision === "exclude")) risks.push("Some sources were excluded as unrelated to this project.");
  if (!concepts.length) risks.push("No concepts mined; evidence may be too sparse or not correction/preference rich.");
  if (totalWindows > 0 && totalAtoms === 0) risks.push("Learning windows were found but did not produce behavior atoms.");
  if (!risks.length) risks.push("No blocking risk detected; human review still required before activation.");
  return {
    relevanceScore: Number(relevanceScore.toFixed(2)),
    conceptYieldScore: Number(conceptYieldScore.toFixed(2)),
    reviewReadinessScore: Number(reviewReadinessScore.toFixed(2)),
    propagationSafetyScore: Number(propagationSafetyScore.toFixed(2)),
    overallScore: Number(overallScore.toFixed(2)),
    strengths,
    risks
  };
}

function normalizeRole(value: string | undefined): CanonicalTurn["role"] {
  const role = (value ?? "unknown").toLowerCase();
  if (["system", "developer", "user", "assistant", "tool", "reviewer"].includes(role)) return role as CanonicalTurn["role"];
  if (/human|prompt/.test(role)) return "user";
  if (/function|command|result/.test(role)) return "tool";
  return "unknown";
}

function statusFromValue(value: unknown): CanonicalTurn["status"] {
  const status = String(value ?? "").toLowerCase();
  if (/pass|success|ok|succeeded/.test(status)) return "pass";
  if (/fail|error|exception/.test(status)) return "fail";
  if (/block|deny|reject/.test(status)) return "blocked";
  return "unknown";
}

function commandLinesFromText(text: string): string[] {
  return text.split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:\$|PS>|>)\s*/, ""))
    .filter((line) => /^(?:npm|pnpm|yarn|node|tsx|tsc|vitest|pytest|python|git|cargo|go|dotnet)\b/.test(line))
    .slice(0, 12);
}

function filePathsFromText(text: string): string[] {
  return [...text.matchAll(/\b(?:packages|src|docs|tests|python|examples)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+\b/g)]
    .map((match) => match[0])
    .slice(0, 20);
}

function titleFromStatement(statement: string): string {
  return normalizeStatement(statement)
    .replace(/^(always|prefer|never|avoid|do not|don't|stop)\s+/i, "")
    .split(/\s+/)
    .slice(0, 7)
    .join(" ");
}

function normalizeStatement(statement: string): string {
  const trimmed = statement.trim().replace(/\s+/g, " ");
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function canonicalKey(statement: string): string {
  return statement.toLowerCase().replace(/[^a-z0-9 ]+/g, "").split(/\s+/).filter((word) => word.length > 3).slice(0, 10).join("-");
}

function snippet(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function timestampSlug(timestamp: string): string {
  return timestamp.replace(/[^0-9]/g, "").slice(0, 14);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function readPackageName(root: string): Promise<string | undefined> {
  const parsed = await fs.readFile(path.join(root, "package.json"), "utf8").then((text) => JSON.parse(text)).catch(() => undefined);
  return typeof parsed?.name === "string" ? parsed.name : undefined;
}

async function readGitRemotes(root: string): Promise<string[]> {
  const config = await fs.readFile(path.join(root, ".git", "config"), "utf8").catch(() => "");
  return [...config.matchAll(/url\s*=\s*(.+)/g)].map((match) => match[1]!.trim()).filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
