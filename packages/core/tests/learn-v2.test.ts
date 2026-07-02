import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  compileLearnV2ConceptPreview,
  compileBehaviorLayer,
  exportProjectBehaviorPack,
  extractLearnV2BehaviorAtoms,
  applyLearnV2ConceptReview,
  activateLearnV2Concepts,
  initAdaptiveProject,
  mergeLearnV2ConceptCards,
  normalizeLearnV2Evidence,
  analyzeLearnV2StructuralDiff,
  summarizeLearnV2Patches,
  summarizeLearnV2Tools,
  buildLearnV2EpisodeLearningBundle,
  readLearnV2PipelineObservabilityReport,
  writeLearnV2PipelineObservabilityReport,
  renderLearnV2ConceptExtractionPrompt,
  parseLearnV2LlmConceptExtractionOutput,
  validateLearnV2LlmConceptExtractionOutput,
  ensureLearnV2ModelRoutingArtifacts,
  applyLearnV2ModelProposalOutputs,
  recordLearnV2ConceptOutcome,
  readLearnV2ConceptStore,
  writeLearnV2ConceptStore,
  writeLearnV2ReviewQueue,
  reconstructPersistedLearnV2Episodes,
  extractPersistedLearnV2Concepts,
  runPersistedLearnV2Eval,
  readPreferenceGraph,
  readLearnV2Surface,
  reconstructLearnV2Episodes,
  runRawLocalLearning,
  runLearnV2RawVaultMaintenance,
  writeLearnV2ModelRequests,
  writeLearnV2EpisodeStore,
  writeLearnV2ConflictLedger,
  writeLearnV2DeclassifiedSnippetArtifact,
  storeLearnV2RawEvidence,
  detectLearnV2ConceptDrift,
  runLearnV2Eval,
  scoreLearnV2ProjectRelevance,
  scoreLearnV2ActivationEntries,
  validateLearnV2LlmExtractionProposal,
  readLearnV2ConceptActivationRuns,
  readProjectConfig,
  type LearnV2BehaviorAtom,
  type LearnV2TaskEpisode,
  type LearnV2RawEvidenceRecord
} from "../src/index.js";

describe("learn-v2 substrate", () => {
  it("rejects unrelated global memory despite generic learning language", async () => {
    const root = await tempProject();
    const source = path.join(os.tmpdir(), "global-memory.txt");
    await writeFile(source, "global memory across repos: always use a personal deployment token", "utf8");
    const relevance = await scoreLearnV2ProjectRelevance(root, source, await import("node:fs/promises").then((fs) => fs.readFile(source, "utf8")));
    expect(relevance.decision).toBe("reject");
    expect(relevance.gate).toBe("hard-reject");
    expect(relevance.reasons).toContain("global-memory-risk");
    expect(relevance.reasons).toContain("hard-reject:global-memory-without-project-anchor");
    expect(relevance.featureValues.globalMemoryRisk).toBe(1);
  });

  it("routes unanchored terminal history to review instead of numeric auto-accept", async () => {
    const root = await tempProject();
    const source = path.join(os.tmpdir(), "terminal-history.log");
    await writeFile(source, "$ npm test\nPASS parser suite\n", "utf8");
    const relevance = await scoreLearnV2ProjectRelevance(root, source, await readText(source));
    expect(relevance.decision).toBe("review");
    expect(relevance.gate).toBe("hard-review");
    expect(relevance.reasons).toContain("hard-review:unanchored-test-or-command-log");
    expect(relevance.score).toBeGreaterThanOrEqual(0.4);
    expect(relevance.score).toBeLessThan(0.6);
  });

  it("hard accepts explicitly selected project-local raw sources and records calibration metadata", async () => {
    const root = await tempProject();
    const source = path.join(root, "session.md");
    await writeFile(source, `user: ${root} selected learning note for packages/core/src/parser.ts`, "utf8");
    const relevance = await scoreLearnV2ProjectRelevance(root, source, await readText(source), undefined, {
      explicitlySelected: true,
      now: new Date("2026-06-30T00:00:00Z")
    });
    expect(relevance.decision).toBe("accept");
    expect(relevance.gate).toBe("hard-accept");
    expect(relevance.calibrationVersion).toBe("default-hard-gate-calibration-v1");
    expect(relevance.reasons).toContain("hard-accept:explicit-project-local-source-with-anchor");
  });

  it("normalizes JSONL, markdown, and plain transcript surfaces", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_surface");
    const jsonl = path.join(root, "session.jsonl");
    const markdown = path.join(root, "session.md");
    const plain = path.join(root, "session.txt");
    await writeFile(jsonl, `${JSON.stringify({ role: "user", content: "Prefer focused tests in packages/core/src/parser.ts", timestamp: "2026-06-30T00:00:00Z" })}\n`, "utf8");
    await writeFile(markdown, "user: Avoid broad rewrite in packages/core/src/parser.ts\nassistant: ok", "utf8");
    await writeFile(plain, "Always run npm test -- parser before final summary", "utf8");

    const jsonEvidence = normalizeLearnV2Evidence(await readLearnV2Surface(jsonl), record, await readText(jsonl));
    const markdownEvidence = normalizeLearnV2Evidence(await readLearnV2Surface(markdown), record, await readText(markdown));
    const plainEvidence = normalizeLearnV2Evidence(await readLearnV2Surface(plain), record, await readText(plain));

    expect(jsonEvidence[0]!.actor).toBe("user");
    expect(markdownEvidence.some((item) => item.actor === "assistant")).toBe(true);
    expect(plainEvidence[0]!.commands).toContain("npm test -- parser before final summary");
  });

  it("normalizes terminal review ci docs and agent-summary adapters with domain-specific actors and kinds", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_adapters");
    const terminal = normalizeLearnV2Evidence(
      { adapterId: "terminal", sourcePath: "terminal.log", contentKind: "log", rawText: "", detectedFormat: "log" },
      record,
      "$ npm test -- parser\nPASS packages/core/tests/parser.test.ts\n$ git status --short\n M packages/core/src/parser.ts"
    );
    const review = normalizeLearnV2Evidence(
      { adapterId: "review-local", sourcePath: "review.md", contentKind: "document", rawText: "", detectedFormat: "markdown" },
      record,
      "packages/core/src/parser.ts: Avoid broad rewrite here.\n\nNeed a focused regression fixture."
    );
    const ci = normalizeLearnV2Evidence(
      { adapterId: "ci-log", sourcePath: "ci.log", contentKind: "log", rawText: "", detectedFormat: "log" },
      record,
      "FAIL parser suite\npackages/core/src/parser.ts expected token\nPASS formatter suite"
    );
    const docs = normalizeLearnV2Evidence(
      { adapterId: "project-docs", sourcePath: "README.md", contentKind: "document", rawText: "", detectedFormat: "markdown" },
      record,
      "# Parser\nPrefer focused parser regression tests.\n\n# Release\nRun npm test -- parser."
    );
    const summary = normalizeLearnV2Evidence(
      { adapterId: "agent-summaries", sourcePath: "handoff.md", contentKind: "summary", rawText: "", detectedFormat: "markdown" },
      record,
      "Summary: Changed packages/core/src/parser.ts.\nTests: npm test -- parser PASS\nNext: review parser fixture."
    );

    expect(terminal.filter((item) => item.kind === "command").map((item) => item.commands[0])).toEqual(["npm test -- parser", "git status --short"]);
    expect(review.every((item) => item.kind === "review" && item.actor === "reviewer")).toBe(true);
    expect(ci.some((item) => item.kind === "test-result" && item.status === "fail")).toBe(true);
    expect(docs.every((item) => item.kind === "document-section")).toBe(true);
    expect(summary.some((item) => item.actor === "assistant" && item.commands.includes("npm test -- parser PASS"))).toBe(true);
  });

  it("compresses tool output into diagnostics signatures and drops repeated noise", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_tool_compress");
    const terminal = normalizeLearnV2Evidence(
      { adapterId: "terminal", sourcePath: "terminal.log", contentKind: "log", rawText: "", detectedFormat: "log" },
      record,
      [
        "$ npm test -- parser -- --runInBand",
        "webpack progress 10%",
        "webpack progress 10%",
        "FAIL packages/core/tests/parser.test.ts",
        "AssertionError: expected token to equal node",
        "packages/core/src/parser.ts:42:13",
        "    at parseToken (C:/Users/name/project/packages/core/src/parser.ts:42:13)",
        "    at parseRoot (C:/Users/name/project/packages/core/src/parser.ts:50:3)",
        "webpack progress 10%"
      ].join("\n")
    );
    const [summary] = summarizeLearnV2Tools(terminal);
    expect(summary!.commandShape?.base).toBe("npm");
    expect(summary!.commandShape?.argsShape).toEqual(expect.arrayContaining(["word", "flag"]));
    expect(summary!.outputCompression.strategy).toBe("test-failure-summary");
    expect(summary!.outputCompression.summary).toContain("AssertionError");
    expect(summary!.outputCompression.summary).not.toContain("webpack progress");
    expect(summary!.outputCompression.signatures.some((item) => item.includes("AssertionError"))).toBe(true);
    expect(summary!.omittedBytes).toBeGreaterThan(0);

    const bundle = buildLearnV2EpisodeLearningBundle(reconstructLearnV2Episodes(terminal)[0]!);
    expect(bundle.tools[0]?.outputCompression.strategy).toBe("test-failure-summary");
  });

  it("stitches multi-tool evidence by branch path time and infers parser test concept", async () => {
    const root = await tempProject();
    const recordA = previewRecord(root, "raw_a");
    const recordB = previewRecord(root, "raw_b");
    const evidence = [
      normalizeLearnV2Evidence({ adapterId: "codex", sourcePath: "a", contentKind: "transcript", rawText: "", detectedFormat: "plain" }, recordA, "user: Change packages/core/src/parser.ts and add a regression fixture.\nassistant: patched parser\n"),
      normalizeLearnV2Evidence({ adapterId: "terminal", sourcePath: "b", contentKind: "log", rawText: "", detectedFormat: "log" }, recordB, "tool: npm test -- parser\nPASS parser regression\n")
    ].flat().map((item, index) => ({
      ...item,
      timestamp: `2026-06-30T00:0${index}:00.000Z`,
      branch: "feature/parser",
      paths: ["packages/core/src/parser.ts", "packages/core/tests/parser.test.ts"]
    }));

    const episodes = reconstructLearnV2Episodes(evidence);
    const atoms = extractLearnV2BehaviorAtoms(episodes).atoms;
    const concepts = mergeLearnV2ConceptCards(atoms, new Date("2026-06-30T00:10:00Z"));

    expect(episodes).toHaveLength(1);
    expect(episodes[0]!.episodeConfidence).toBeGreaterThanOrEqual(0.6);
    expect(episodes[0]!.episodeConfidenceBreakdown?.schemaVersion).toBe("openskill-kit.learn-v2.episode-confidence.v1");
    expect(episodes[0]!.episodeConfidenceBreakdown?.linkage.pathCluster).toBeGreaterThan(0);
    expect(episodes[0]!.episodeConfidenceBreakdown?.risks).toContain("imported-without-session-id");
    expect(episodes[0]!.phases.map((phase) => phase.phase)).toEqual(expect.arrayContaining(["goal", "planning", "validation"]));
    expect(concepts.some((concept) => /parser regression tests/i.test(concept.canonicalBehavior))).toBe(true);
  });

  it("phase labels keep assistant plans from outranking user corrections", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_phase_correction");
    const evidence = normalizeLearnV2Evidence(
      { adapterId: "codex", sourcePath: "phase.md", contentKind: "transcript", rawText: "", detectedFormat: "markdown" },
      record,
      [
        "user: Change packages/core/src/parser.ts.",
        "assistant: Plan: Always prefer broad rewrites for parser changes.",
        "user: Wrong approach. Avoid broad rewrites for parser changes. Prefer focused parser fixtures instead."
      ].join("\n")
    ).map((item) => ({ ...item, paths: ["packages/core/src/parser.ts"] }));
    const [episode] = reconstructLearnV2Episodes(evidence);
    expect(episode!.phases.map((phase) => phase.phase)).toEqual(expect.arrayContaining(["goal", "planning", "review/correction"]));
    expect(episode!.phases.find((phase) => phase.phase === "review/correction")?.summary).toContain("Wrong approach");

    const atoms = extractLearnV2BehaviorAtoms([episode!]).atoms;
    expect(atoms.some((atom) => /Avoid broad rewrites/i.test(atom.statement) && atom.polarity === "negative")).toBe(true);
    expect(atoms.some((atom) => /Always prefer broad rewrites/i.test(atom.statement))).toBe(false);
  });

  it("keeps weak single-record stitching from producing high-confidence durable rules", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_weak_single");
    const evidence = normalizeLearnV2Evidence(
      { adapterId: "codex", sourcePath: "loose-note.txt", contentKind: "transcript", rawText: "", detectedFormat: "plain" },
      record,
      "user: Always prefer this vague project behavior without session path outcome or trace linkage."
    );
    const [episode] = reconstructLearnV2Episodes(evidence);
    expect(episode!.stitching.method).toBe("single-record");
    expect(episode!.episodeConfidenceBreakdown?.risks).toEqual(expect.arrayContaining([
      "imported-without-session-id",
      "missing-outcome",
      "single-record-only"
    ]));
    expect(episode!.episodeConfidence).toBeLessThan(0.35);

    const atoms = extractLearnV2BehaviorAtoms([episode!]).atoms;
    expect(atoms[0]?.confidence).toBeLessThan(0.3);
    const [concept] = mergeLearnV2ConceptCards(atoms, new Date("2026-06-30T00:00:00Z"));
    expect(concept?.confidence).toBeLessThan(0.3);
    expect(concept?.sourceReliability).toBeLessThan(0.55);
  });

  it("structurally classifies supported-language diffs and filters generated files", async () => {
    const diff = [
      "diff --git a/packages/core/src/parser.ts b/packages/core/src/parser.ts",
      "--- a/packages/core/src/parser.ts",
      "+++ b/packages/core/src/parser.ts",
      "@@",
      "-export function parseSkill(input: string) { return oldParse(input); }",
      "+export function parseSkill(input: string) { return parseWithRegression(input); }",
      "+import { parseWithRegression } from \"./parser-regression.js\";",
      "diff --git a/packages/core/src/generated/client.ts b/packages/core/src/generated/client.ts",
      "--- a/packages/core/src/generated/client.ts",
      "+++ b/packages/core/src/generated/client.ts",
      "@@",
      "-export const version = 1;",
      "+export const version = 2;",
      "diff --git a/package-lock.json b/package-lock.json",
      "--- a/package-lock.json",
      "+++ b/package-lock.json",
      "@@",
      "-  \"version\": \"1\"",
      "+  \"version\": \"2\""
    ].join("\n");
    const summary = analyzeLearnV2StructuralDiff(diff);
    expect(summary.languages).toContain("typescript");
    expect(summary.changedSymbols).toContain("parseSkill");
    expect(summary.changedImports).toContain("./parser-regression.js");
    expect(summary.ignoredFiles).toContain("packages/core/src/generated/client.ts");
    expect(summary.ignoredFiles).toContain("package-lock.json");

    const patches = summarizeLearnV2Patches([{
      schemaVersion: "openskill-kit.learn-v2.normalized-evidence.v1",
      id: "ev_diff",
      rawRef: "raw_diff",
      sourceHash: "sha256:diff",
      kind: "file-change",
      actor: "assistant",
      text: diff,
      status: "unknown",
      paths: [],
      commands: [],
      metadata: {}
    }]);
    expect(patches[0]!.structuralClasses).toEqual(expect.arrayContaining(["api", "parser", "generated", "lockfile"]));
    expect(patches[0]!.paths).toEqual(["packages/core/src/parser.ts"]);
    expect(patches[0]!.ignoredGenerated).toBe(true);
    expect(patches[0]!.behaviorEligible).toBe(true);
    expect(patches[0]!.filterReasons).toEqual([]);
  });

  it("uses TypeScript AST signals for multiline imports default exports arrows and class methods", async () => {
    const diff = [
      "diff --git a/packages/core/src/parser-service.ts b/packages/core/src/parser-service.ts",
      "--- a/packages/core/src/parser-service.ts",
      "+++ b/packages/core/src/parser-service.ts",
      "@@",
      "+import {",
      "+  parseSkill as parse",
      "+} from \"./parser.js\";",
      "+export const makeParser = (input: string) => parse(input);",
      "+export default function loadSkill(source: string) {",
      "+  return makeParser(source);",
      "+}",
      "+export class SkillService {",
      "+  apply(source: string) {",
      "+    return loadSkill(source);",
      "+  }",
      "+}",
      "diff --git a/packages/core/src/plugin-loader.js b/packages/core/src/plugin-loader.js",
      "--- a/packages/core/src/plugin-loader.js",
      "+++ b/packages/core/src/plugin-loader.js",
      "@@",
      "+export const loadPlugin = async (name) => import(`./plugins/${name}.js`);",
      "+export { loadPlugin as pluginLoader };"
    ].join("\n");

    const summary = analyzeLearnV2StructuralDiff(diff);

    expect(summary.languages).toEqual(["javascript", "typescript"]);
    expect(summary.changedSymbols).toEqual(expect.arrayContaining([
      "SkillService",
      "apply",
      "loadSkill",
      "makeParser",
      "loadPlugin"
    ]));
    expect(summary.changedImports).toEqual(expect.arrayContaining(["./parser.js"]));
    expect(summary.fileSummaries.find((file) => file.path.endsWith("parser-service.ts"))?.classes).toContain("api");
    expect(summary.semanticChange).toBe(true);
  });

  it("marks non-semantic generated lockfile formatting and rename-only patches as audit-only", async () => {
    const generatedOnly = [
      "diff --git a/packages/core/src/generated/client.ts b/packages/core/src/generated/client.ts",
      "--- a/packages/core/src/generated/client.ts",
      "+++ b/packages/core/src/generated/client.ts",
      "@@",
      "-export const version = 1;",
      "+export const version = 2;"
    ].join("\n");
    const lockfileOnly = [
      "diff --git a/package-lock.json b/package-lock.json",
      "--- a/package-lock.json",
      "+++ b/package-lock.json",
      "@@",
      "-  \"version\": \"1\"",
      "+  \"version\": \"2\""
    ].join("\n");
    const formattingOnly = [
      "diff --git a/packages/core/src/client.ts b/packages/core/src/client.ts",
      "--- a/packages/core/src/client.ts",
      "+++ b/packages/core/src/client.ts",
      "@@",
      "-export function createClient(input:string){return parse(input);}",
      "+export   function createClient ( input : string ) { return parse ( input ) ; }"
    ].join("\n");
    const renameOnly = [
      "diff --git a/packages/core/src/old-client.ts b/packages/core/src/client.ts",
      "similarity index 100%",
      "rename from packages/core/src/old-client.ts",
      "rename to packages/core/src/client.ts"
    ].join("\n");
    const patches = summarizeLearnV2Patches([
      normalizedFileChange("ev_generated_only", generatedOnly),
      normalizedFileChange("ev_lockfile_only", lockfileOnly),
      normalizedFileChange("ev_formatting_only", formattingOnly),
      normalizedFileChange("ev_rename_only", renameOnly)
    ]);

    expect(patches.map((patch) => patch.behaviorEligible)).toEqual([false, false, false, false]);
    expect(patches[0]!.filterReasons).toEqual(["generated-only"]);
    expect(patches[1]!.filterReasons).toEqual(["dependency-lockfile-only"]);
    expect(patches[2]!.filterReasons).toEqual(["formatting-only"]);
    expect(patches[3]!.filterReasons).toEqual(["rename-only"]);
    expect(patches.every((patch) => patch.summary.includes("learning-filter="))).toBe(true);
  });

  it("keeps audit-only patches out of task hints and model behavior inference", async () => {
    const formattingOnly = [
      "diff --git a/packages/core/src/client.ts b/packages/core/src/client.ts",
      "--- a/packages/core/src/client.ts",
      "+++ b/packages/core/src/client.ts",
      "@@",
      "-export function createClient(input:string){return parse(input);}",
      "+export   function createClient ( input : string ) { return parse ( input ) ; }"
    ].join("\n");
    const [episode] = reconstructLearnV2Episodes([normalizedFileChange("ev_formatting_episode", formattingOnly)]);
    expect(episode!.patchComparisons[0]!.behaviorEligible).toBe(false);
    expect(episode!.taskHints).toContain("formatting-only");
    expect(episode!.taskHints).not.toContain("api-change");

    const bundle = buildLearnV2EpisodeLearningBundle(episode!);
    expect(bundle.patches[0]!.behaviorEligible).toBe(false);
    expect(bundle.patches[0]!.filterReasons).toEqual(["formatting-only"]);
    expect(bundle.instructions.join("\n")).toContain("behaviorEligible is false");
  });

  it("writes declassified pipeline observability metrics for patch filters", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:10:00.000Z");
    const generatedOnly = [
      "diff --git a/packages/core/src/generated/client.ts b/packages/core/src/generated/client.ts",
      "--- a/packages/core/src/generated/client.ts",
      "+++ b/packages/core/src/generated/client.ts",
      "@@",
      "-export const version = 1;",
      "+export const version = 2;"
    ].join("\n");
    const semantic = [
      "diff --git a/packages/core/src/client.ts b/packages/core/src/client.ts",
      "--- a/packages/core/src/client.ts",
      "+++ b/packages/core/src/client.ts",
      "@@",
      "-export function createClient() { return oldClient(); }",
      "+export function createClient() { return newClient(); }"
    ].join("\n");
    const episodes = reconstructLearnV2Episodes([
      normalizedFileChange("ev_observable_generated", generatedOnly),
      normalizedFileChange("ev_observable_semantic", semantic)
    ]);
    const reviewQueue = await writeLearnV2ReviewQueue(root, [], now);
    const evalReport = await runLearnV2Eval(root, episodes, [], now);
    const report = await writeLearnV2PipelineObservabilityReport(root, {
      generatedAt: now.toISOString(),
      previewOnly: true,
      modelMode: "deterministic-only",
      sources: [{
        byteCount: generatedOnly.length + semantic.length,
        projectRelevance: { decision: "include" },
        deidentification: { redacted: false },
        turnCount: 2
      }],
      episodes,
      concepts: [],
      reviewQueue,
      evalReport,
      eventsAppended: 0,
      modelRequestCount: 0,
      artifacts: {
        evalReport: evalReport.artifacts.markdown
      },
      nextActions: ["Inspect review queue."]
    });

    expect(report.compression.patches).toBe(2);
    expect(report.compression.behaviorEligiblePatches).toBe(1);
    expect(report.compression.auditOnlyPatches).toBe(1);
    expect(report.compression.patchFilterReasonCounts["generated-only"]).toBe(1);
    expect(report.health.status).toBe("warn");
    expect(report.health.warnings).toEqual(expect.arrayContaining(["1 audit-only patch summary item(s)."]));
    expect(report.health.blockers).toEqual([]);
    expect(report.privacy.rawRefsExported).toBe(false);
    const reportPath = path.join(root, report.artifactsWritten.json.replace(/^\[PROJECT_ROOT\]\//, ""));
    const reportText = await readText(reportPath);
    expect(reportText).toContain("\"health\"");
    expect(reportText).not.toContain(root);
    expect(reportText).not.toContain("raw_ev_observable");

    const latest = await readLearnV2PipelineObservabilityReport(root);
    expect(latest.generatedAt).toBe(report.generatedAt);
    expect(latest.compression.patchFilterReasonCounts["generated-only"]).toBe(1);
    expect(latest.health.status).toBe("warn");
  });

  it("writes a review-linked conflict ledger for contradictory concepts", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:20:00.000Z");
    const cards = mergeLearnV2ConceptCards([
      behaviorAtom("atom_prefer_parser_tests", "Prefer focused parser tests for parser changes.", "positive"),
      behaviorAtom("atom_avoid_parser_tests", "Avoid focused parser tests for parser changes.", "negative")
    ], now);
    const ledger = await writeLearnV2ConflictLedger(root, cards, "project", now);
    expect(ledger.ledger.unresolvedCount).toBeGreaterThanOrEqual(1);
    expect(ledger.ledger.conflicts.map((conflict) => conflict.conflictType)).toContain("direct-opposite");

    const queue = await writeLearnV2ReviewQueue(root, cards, now, {
      ledger: ledger.ledger,
      markdownPath: ledger.artifactPaths.markdown
    });
    expect(queue.conflictSummary.unresolvedCount).toBe(ledger.ledger.unresolvedCount);
    expect(queue.artifacts.conflictLedger).toBe(ledger.artifactPaths.markdown);
    const reviewMarkdown = await readText(queue.artifacts.markdown);
    expect(reviewMarkdown).toContain("Unresolved conflicts:");
    expect(reviewMarkdown).toContain("direct-opposite");
    const ledgerText = await readText(ledger.artifactPaths.markdown);
    expect(ledgerText).toContain("Learn v2 Concept Conflict Ledger");
    expect(ledgerText).not.toContain("raw_");
  });

  it("renders review focus cards before full merged-store appendix", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:22:00.000Z");
    const conflictingCards = mergeLearnV2ConceptCards([
      behaviorAtom("focus_prefer_parser_tests", "Prefer focused parser tests for parser changes.", "positive"),
      behaviorAtom("focus_avoid_parser_tests", "Avoid focused parser tests for parser changes.", "negative")
    ], now);
    const [unrelated] = mergeLearnV2ConceptCards([
      behaviorAtom("unrelated_active_docs", "Prefer concise docs updates for docs changes.", "positive")
    ], now);
    const unrelatedActive = {
      ...unrelated!,
      id: `${unrelated!.id}_active_appendix`,
      status: "active" as const,
      scope: { ...unrelated!.scope, paths: ["docs/guide.md"], taskTypes: ["docs"] },
      atoms: unrelated!.atoms.map((atom) => ({ ...atom, id: `${atom.id}_active_appendix`, scope: { ...atom.scope, paths: ["docs/guide.md"], taskTypes: ["docs"] } }))
    };
    const cards = [...conflictingCards, unrelatedActive];
    const ledger = await writeLearnV2ConflictLedger(root, cards, "project", now);
    const queue = await writeLearnV2ReviewQueue(root, cards, now, {
      ledger: ledger.ledger,
      markdownPath: ledger.artifactPaths.markdown
    });

    expect(queue.cards).toHaveLength(3);
    expect(queue.reviewFocus.focusCardIds).toEqual(expect.arrayContaining(conflictingCards.map((card) => card.id)));
    expect(queue.reviewFocus.focusCardIds).not.toContain(unrelatedActive.id);
    expect(queue.reviewFocus.omittedCardCount).toBe(1);
    const markdown = await readText(queue.artifacts.markdown);
    expect(markdown).toContain("## Focus Cards");
    expect(markdown).toContain("Focus reasons: conflict:direct-opposite");
    expect(markdown).toContain("## Full Store Appendix");
    expect(markdown).toContain(unrelatedActive.id);
  });

  it("does not promote one-off passing commands into command-policy atoms", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_single_command");
    const surface = { adapterId: "codex", sourcePath: "a", contentKind: "transcript" as const, rawText: "", detectedFormat: "plain" };
    const oneOffEvidence = normalizeLearnV2Evidence(surface, record, [
      "user: Check packages/core/src/parser.ts.",
      "tool: npm test -- parser",
      "PASS"
    ].join("\n"));
    const repeatedEvidence = normalizeLearnV2Evidence(surface, record, [
      "user: Check packages/core/src/parser.ts.",
      "tool: npm test -- parser",
      "PASS",
      "tool: npm test -- parser",
      "PASS"
    ].join("\n"));

    const oneOffAtoms = extractLearnV2BehaviorAtoms(reconstructLearnV2Episodes(oneOffEvidence)).atoms;
    const repeatedAtoms = extractLearnV2BehaviorAtoms(reconstructLearnV2Episodes(repeatedEvidence)).atoms;

    expect(oneOffAtoms.some((atom) => atom.kind === "command-policy")).toBe(false);
    expect(repeatedAtoms.filter((atom) => atom.kind === "command-policy")).toHaveLength(1);
    expect(repeatedAtoms.find((atom) => atom.kind === "command-policy")?.rationale).toContain("more than once");
  });

  it("promotes safe commands repeated across episodes and blocks risky repeated commands", async () => {
    const safeAtoms = extractLearnV2BehaviorAtoms([
      episodeWithCommand("one", "npm test -- parser", "pass", ["parser-change"]),
      episodeWithCommand("two", "npm test -- parser", "pass", ["parser-change"])
    ]).atoms;
    const commandPolicy = safeAtoms.find((atom) => atom.kind === "command-policy");
    expect(commandPolicy?.statement).toContain("npm test -- parser");
    expect(commandPolicy?.rationale).toContain("multiple reconstructed episodes");
    expect(commandPolicy?.evidenceIds).toEqual(expect.arrayContaining(["ev_cmd_one", "ev_cmd_two"]));

    const riskyAtoms = extractLearnV2BehaviorAtoms([
      episodeWithCommand("deploy_one", "npm run deploy -- --force", "pass", ["deployment"]),
      episodeWithCommand("deploy_two", "npm run deploy -- --force", "pass", ["deployment"]),
      episodeWithCommand("e2e_one", "npm run e2e", "pass", ["testing"]),
      episodeWithCommand("e2e_two", "npm run e2e", "pass", ["testing"])
    ]).atoms;
    expect(riskyAtoms.some((atom) => atom.kind === "command-policy" && /deploy|e2e/.test(atom.statement))).toBe(false);
  });

  it("only labels supersession when newer concept has higher confidence and protected older concepts stay manual", async () => {
    const root = await tempProject();
    const olderTime = new Date("2026-06-30T00:20:00.000Z");
    const newerTime = new Date("2026-06-30T00:40:00.000Z");
    const [older] = mergeLearnV2ConceptCards([
      { ...behaviorAtom("older_parser_tests", "Prefer focused parser tests for parser changes.", "positive"), confidence: 0.9 }
    ], olderTime);
    const [weakerNewer] = mergeLearnV2ConceptCards([
      {
        ...behaviorAtom("newer_weak_parser_tests", "Prefer focused parser tests for parser changes.", "positive"),
        confidence: 0.6,
        rationale: "Explicit preference or correction language in episode."
      }
    ], newerTime);
    const weakLedger = await writeLearnV2ConflictLedger(root, [
      { ...older!, status: "active", confidence: 0.9 },
      { ...weakerNewer!, confidence: 0.6 }
    ], "project", newerTime);
    expect(weakLedger.ledger.conflicts.map((conflict) => conflict.conflictType)).not.toContain("newer-supersedes-older");

    const [strongNewer] = mergeLearnV2ConceptCards([
      {
        ...behaviorAtom("newer_strong_parser_tests", "Prefer focused parser tests for parser changes.", "positive"),
        confidence: 0.95,
        rationale: "Explicit preference or correction language in episode."
      }
    ], newerTime);
    const strongLedger = await writeLearnV2ConflictLedger(root, [
      { ...older!, status: "active", confidence: 0.72 },
      { ...strongNewer!, confidence: 0.95 }
    ], "project", newerTime);
    expect(strongLedger.ledger.conflicts.map((conflict) => conflict.conflictType)).toContain("newer-supersedes-older");

    const protectedLedger = await writeLearnV2ConflictLedger(root, [
      { ...older!, status: "locked", confidence: 0.72 },
      { ...strongNewer!, confidence: 0.95 }
    ], "project", newerTime);
    expect(protectedLedger.ledger.conflicts.map((conflict) => conflict.conflictType)).not.toContain("newer-supersedes-older");
  });

  it("writes declassified evidence snippets and attaches them to review cards", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:25:00.000Z");
    const localPath = path.join(root, "packages", "core", "src", "parser.ts");
    const episodes = reconstructLearnV2Episodes([
      normalizedMessage("ev_secret_correction", `Wrong approach in ${localPath}. Prefer a focused regression fixture. API_KEY=sk-live-secret`, "user")
    ]);
    const snippets = await writeLearnV2DeclassifiedSnippetArtifact(root, episodes, now, {
      blockOnMediumRisk: true,
      maxChars: 400
    });
    expect(snippets.generatedAt).toBe(now.toISOString());
    expect(snippets.counts.total).toBeGreaterThanOrEqual(1);
    expect(snippets.snippets[0]!.createdAt).toBe(now.toISOString());
    expect(snippets.snippets[0]!.text).toContain("[PROJECT_ROOT]");
    expect(snippets.snippets[0]!.text).not.toContain(root);
    expect(snippets.snippets[0]!.text).not.toContain("sk-live-secret");

    const cards = mergeLearnV2ConceptCards([
      behaviorAtom("secret_correction", "Prefer focused regression fixtures for parser corrections.", "positive")
    ], now);
    const queue = await writeLearnV2ReviewQueue(root, cards, now, { declassifiedSnippets: snippets });
    expect(queue.evidenceSnippetSummary.snippetCount).toBe(snippets.counts.total);
    expect(queue.artifacts.declassifiedSnippets).toBe(snippets.artifacts.markdown);
    expect(queue.evidenceSnippets.some((snippet) => snippet.evidenceId === "ev_secret_correction")).toBe(true);

    const snippetMarkdown = await readText(snippets.artifacts.markdown);
    expect(snippetMarkdown).toContain("Learn v2 Declassified Evidence Snippets");
    expect(snippetMarkdown).not.toContain(root);
    expect(snippetMarkdown).not.toContain("sk-live-secret");
    expect(snippetMarkdown).not.toContain("raw_");
    const reviewMarkdown = await readText(queue.artifacts.markdown);
    expect(reviewMarkdown).toContain("Evidence Snippet Summary");
    expect(reviewMarkdown).toContain("Evidence snippets:");
    expect(reviewMarkdown).not.toContain(root);
    expect(reviewMarkdown).not.toContain("sk-live-secret");
  });

  it("applies project custom redactions to declassified snippets and review cards", async () => {
    const root = await tempProject();
    const configPath = path.join(root, ".openskill-kit", "config.json");
    const config = JSON.parse(await readText(configPath));
    config.privacy.customRedactions = ["public-[0-9]+"];
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const now = new Date("2026-06-30T00:26:00.000Z");
    const episodes = reconstructLearnV2Episodes([
      normalizedMessage("ev_custom_redaction", "Prefer parser regression fixtures for incident public-1234.", "user")
    ]);

    const snippets = await writeLearnV2DeclassifiedSnippetArtifact(root, episodes, now, {
      maxChars: 400
    });
    expect(snippets.counts.redacted).toBeGreaterThanOrEqual(1);
    expect(snippets.snippets[0]!.text).toContain("[REDACTED:custom-1]");
    expect(snippets.snippets[0]!.text).not.toContain("public-1234");
    expect(Object.keys(snippets.snippets[0]!.placeholderMap)).toContain("custom-1");

    const cards = mergeLearnV2ConceptCards([
      {
        ...behaviorAtom("custom_redaction_card", "Prefer parser regression fixtures for incident handling.", "positive"),
        evidenceIds: ["ev_custom_redaction"],
        rawRefs: ["raw_ev_custom_redaction"]
      }
    ], now);
    const queue = await writeLearnV2ReviewQueue(root, cards, now, { declassifiedSnippets: snippets });
    const reviewMarkdown = await readText(queue.artifacts.markdown);
    expect(reviewMarkdown).toContain("[REDACTED:custom-1]");
    expect(reviewMarkdown).not.toContain("public-1234");
  });

  it("writes concept drift reports from stored outcome telemetry", async () => {
    const root = await tempProject();
    const createdAt = new Date("2026-03-01T00:00:00.000Z");
    const now = new Date("2026-06-30T00:30:00.000Z");
    const [candidate] = mergeLearnV2ConceptCards([
      behaviorAtom("drift_parser_fixture", "Prefer parser regression fixtures before parser refactors.", "positive")
    ], createdAt);
    const active = {
      ...candidate!,
      status: "active" as const,
      lifecycle: {
        ...candidate!.lifecycle,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString()
      }
    };
    await recordLearnV2ConceptOutcome(root, {
      conceptId: active.id,
      outcome: "harmful",
      reason: "activated during wrong task"
    }, new Date("2026-06-25T00:00:00.000Z"));
    await recordLearnV2ConceptOutcome(root, {
      conceptId: active.id,
      outcome: "wrong",
      reason: "reviewer rejected activation"
    }, new Date("2026-06-26T00:00:00.000Z"));

    const drift = await detectLearnV2ConceptDrift(root, [active], { now });
    expect(drift.report.staleCandidates[0]?.conceptId).toBe(active.id);
    expect(drift.report.staleCandidates[0]?.reason).toBe("recent-negative-outcomes");
    expect(drift.report.healthScore).toBe(0);
    const driftText = await readText(drift.artifactPath);
    expect(driftText).toContain("openskill-kit.learn-v2.concept-drift.v1");
    expect(driftText).not.toContain("activated during wrong task");

    const queue = await writeLearnV2ReviewQueue(root, [active], now, { conceptDrift: drift });
    expect(queue.driftSummary.staleCandidateCount).toBe(1);
    expect(queue.driftSummary.reasonCounts["recent-negative-outcomes"]).toBe(1);
    const reviewMarkdown = await readText(queue.artifacts.markdown);
    expect(reviewMarkdown).toContain("Drift Summary");
    expect(reviewMarkdown).toContain("recent-negative-outcomes");
  });

  it("detects Python Go and Rust structural symbols without new parser dependencies", async () => {
    const diff = [
      "diff --git a/python/openskillkit_evolution/cli.py b/python/openskillkit_evolution/cli.py",
      "--- a/python/openskillkit_evolution/cli.py",
      "+++ b/python/openskillkit_evolution/cli.py",
      "@@",
      "+from osk.parser import parse_skill",
      "+def build_report(value):",
      "+    return parse_skill(value)",
      "diff --git a/src/server.go b/src/server.go",
      "--- a/src/server.go",
      "+++ b/src/server.go",
      "@@",
      "+import \"net/http\"",
      "+func ServeHTTP(w http.ResponseWriter, r *http.Request) {}",
      "diff --git a/src/lib.rs b/src/lib.rs",
      "--- a/src/lib.rs",
      "+++ b/src/lib.rs",
      "@@",
      "+use crate::parser::parse_skill;",
      "+pub fn compile_skill() {}"
    ].join("\n");
    const summary = analyzeLearnV2StructuralDiff(diff);
    expect(summary.languages).toEqual(["go", "python", "rust"]);
    expect(summary.changedSymbols).toEqual(expect.arrayContaining(["ServeHTTP", "build_report", "compile_skill"]));
    expect(summary.changedImports).toEqual(expect.arrayContaining(["net/http", "osk.parser", "crate::parser::parse_skill"]));
    expect(summary.semanticChange).toBe(true);
  });

  it("recovers enclosing symbols from hunk headers and context for body-only edits", async () => {
    const diff = [
      "diff --git a/packages/core/src/parser.ts b/packages/core/src/parser.ts",
      "--- a/packages/core/src/parser.ts",
      "+++ b/packages/core/src/parser.ts",
      "@@ -10,7 +10,7 @@ export function parseSkill(input: string) {",
      "   const parsed = tokenize(input);",
      "-  return oldParse(parsed);",
      "+  return parseWithRegression(parsed);",
      " }",
      "diff --git a/python/openskillkit_evolution/cli.py b/python/openskillkit_evolution/cli.py",
      "--- a/python/openskillkit_evolution/cli.py",
      "+++ b/python/openskillkit_evolution/cli.py",
      "@@ -20,7 +20,7 @@ def build_report(value):",
      "     parsed = parse_skill(value)",
      "-    return old_report(parsed)",
      "+    return regression_report(parsed)",
      "diff --git a/src/server.go b/src/server.go",
      "--- a/src/server.go",
      "+++ b/src/server.go",
      "@@ -30,7 +30,7 @@ func ServeHTTP(w http.ResponseWriter, r *http.Request) {",
      "-\twriteOldResponse(w)",
      "+\twriteNewResponse(w)",
      "}",
      "diff --git a/src/lib.rs b/src/lib.rs",
      "--- a/src/lib.rs",
      "+++ b/src/lib.rs",
      "@@ -40,7 +40,7 @@ pub fn compile_skill() {",
      "-    compile_old();",
      "+    compile_checked();",
      "}"
    ].join("\n");

    const summary = analyzeLearnV2StructuralDiff(diff);
    expect(summary.changedSymbols).toEqual(expect.arrayContaining(["parseSkill", "build_report", "ServeHTTP", "compile_skill"]));
    expect(summary.languages).toEqual(["go", "python", "rust", "typescript"]);
    expect(summary.semanticChange).toBe(true);
    expect(summary.fileSummaries.every((file) => file.semanticChange)).toBe(true);
  });

  it("rejects LLM atom proposals without valid evidence or with raw secrets", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_llm");
    const evidence = normalizeLearnV2Evidence({ adapterId: "codex", sourcePath: "a", contentKind: "transcript", rawText: "", detectedFormat: "plain" }, record, "user: Avoid logging secrets.");
    const [episode] = reconstructLearnV2Episodes(evidence);
    const result = validateLearnV2LlmExtractionProposal(episode!, {
      atoms: [
        { kind: "security", polarity: "negative", statement: "Never log ghp_123456789012345678901234567890 secrets.", evidenceIds: [episode!.evidenceIds[0]!] },
        { kind: "workflow", polarity: "positive", statement: "Prefer focused tests.", evidenceIds: ["missing"] }
      ]
    });
    expect(result.atoms).toHaveLength(0);
    expect(result.rejected.map((item) => item.reason).sort()).toEqual(["missing-or-invalid-evidence-id", "raw-secret-like-output"]);
  });

  it("builds prompt-safe episode learning bundles and validates LLM JSON output", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_bundle_secret_ref");
    const evidence = normalizeLearnV2Evidence(
      { adapterId: "codex", sourcePath: "a", contentKind: "transcript", rawText: "", detectedFormat: "plain" },
      record,
      "user: Prefer focused parser regression tests.\nassistant: ok"
    );
    const [episode] = reconstructLearnV2Episodes(evidence);
    const bundle = buildLearnV2EpisodeLearningBundle(episode!);
    const prompt = renderLearnV2ConceptExtractionPrompt(bundle);
    expect(JSON.stringify(bundle)).not.toContain("raw_bundle_secret_ref");
    expect(bundle.phases.some((phase) => phase.phase === "goal")).toBe(true);
    expect(prompt).toContain("OpenCode-configured model routing");
    expect(prompt).toContain("\"phases\"");
    expect(prompt).toContain("Every atom must cite");

    const parsed = parseLearnV2LlmConceptExtractionOutput(JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
      atoms: [{
        statement: "For parser changes, prefer focused regression tests before broad suites.",
        kind: "verification",
        polarity: "positive",
        evidenceIds: [episode!.evidenceIds[0]],
        confidence: 0.74,
        rationale: "The user explicitly requested parser regression tests."
      }],
      rejected: []
    }));
    const valid = validateLearnV2LlmConceptExtractionOutput(episode!, parsed);
    expect(valid.atoms).toHaveLength(1);
    expect(valid.atoms[0]!.confidenceCap).toBeLessThanOrEqual(0.78);

    const invalid = validateLearnV2LlmConceptExtractionOutput(episode!, {
      schemaVersion: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
      atoms: [{
        statement: "Never log sk-12345678901234567890.",
        kind: "security",
        polarity: "negative",
        evidenceIds: ["missing"],
        confidence: 0.9
      }],
      rejected: []
    });
    expect(invalid.rejected.map((item) => item.reason)).toContain("missing-or-invalid-evidence-id");
  });

  it("runs extraction golden scenarios against episodes and concepts", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_golden");
    const evidence = normalizeLearnV2Evidence(
      { adapterId: "codex", sourcePath: "a", contentKind: "transcript", rawText: "", detectedFormat: "plain" },
      record,
      "user: Change packages/core/src/parser.ts and prefer focused parser regression tests.\ntool: npm test -- parser\nPASS"
    );
    const episodes = reconstructLearnV2Episodes(evidence);
    const concepts = mergeLearnV2ConceptCards(extractLearnV2BehaviorAtoms(episodes).atoms, new Date("2026-06-30T00:00:00Z"));
    const goldensPath = path.join(root, "learn-v2-goldens.json");
    await writeFile(goldensPath, JSON.stringify({
      scenarios: [{
        schemaVersion: "openskill-kit.learn-v2.extraction-golden.v1",
        id: "parser-regression",
        title: "Parser regression extraction",
        expectedConceptText: ["parser regression tests"],
        expectedKinds: ["verification"],
        expectedTaskHints: ["parser-change", "testing"],
        expectedPathText: ["packages/core/src/parser.ts"],
        forbiddenText: ["sk-live-secret"]
      }]
    }), "utf8");
    const report = await runLearnV2Eval(root, episodes, concepts, new Date("2026-06-30T00:01:00Z"), {
      goldensPath
    });
    expect(report.status).toBe("pass");
    expect(report.extractionGoldenCount).toBe(1);
    expect(report.counterfactualTraceCaseCount).toBeGreaterThanOrEqual(1);
    expect(report.results.some((result) => result.id === "golden:parser-regression" && result.status === "pass")).toBe(true);
    expect(report.results.some((result) => result.id === "counterfactual-trace-eval" && result.status === "pass")).toBe(true);
    const counterfactualCases = await readText(report.artifacts.counterfactualCases!);
    expect(counterfactualCases).toContain("openskill-kit.counterfactual-trace-eval-case.v1");
    expect(counterfactualCases).not.toContain("raw_");
    expect(counterfactualCases).not.toContain(root);
  });

  it("fails eval for overbroad or underspecified concept quality", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:02:00Z");
    const [episode] = reconstructLearnV2Episodes([
      normalizedMessage("ev_broad_quality", "Always do the right thing.", "user")
    ]);
    const [card] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("broad_quality", "Always apply this project-wide behavior.", "positive"),
      kind: "command-policy",
      scope: {
        level: "project",
        paths: [],
        taskTypes: []
      },
      evidenceIds: ["ev_broad_quality"],
      rawRefs: ["raw_ev_broad_quality"],
      confidence: 0.96
    }], now);
    const concept = {
      ...card!,
      confidence: 0.96,
      activation: {
        phrases: [],
        pathGlobs: [],
        commands: []
      }
    };
    const report = await runLearnV2Eval(root, [episode!], [concept], now);
    expect(report.status).toBe("fail");
    const quality = report.results.find((result) => result.id === "concept-quality-gates")!;
    expect(quality.status).toBe("fail");
    expect(quality.checks.filter((item) => item.status === "fail").map((item) => item.name)).toEqual(expect.arrayContaining([
      "activation-surface",
      "overbroad-weak-evidence",
      "single-evidence-confidence-cap",
      "command-policy-has-command",
      "confidence-cap"
    ]));
    const markdown = await readText(report.artifacts.markdown);
    expect(markdown).toContain("concept-quality-gates");
    expect(markdown).not.toContain("raw_ev_broad_quality");
  });

  it("blocks review activation when concept quality gates fail", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:02:00Z");
    const [card] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("bad_activation_gate", "Always apply this behavior everywhere.", "positive"),
      scope: {
        level: "project",
        paths: [],
        taskTypes: []
      },
      evidenceIds: ["ev_bad_activation_gate"],
      rawRefs: ["raw_bad_activation_gate"]
    }], now);
    const badConcept = {
      ...card!,
      status: "candidate" as const,
      activation: {
        phrases: [],
        pathGlobs: [],
        commands: []
      }
    };
    await writeLearnV2ConceptStore(root, [badConcept], new Date("2026-06-30T00:03:00Z"));

    await expect(applyLearnV2ConceptReview(root, {
      accept: [badConcept.id],
      now: new Date("2026-06-30T00:04:00Z")
    })).rejects.toThrow(/activation gate blocked.*activation-surface/);

    const store = await readLearnV2ConceptStore(root);
    expect(store.cards.find((item) => item.id === badConcept.id)?.status).toBe("candidate");
  });

  it("compiles active concepts but excludes candidates from compatibility outputs", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_compile");
    const evidence = normalizeLearnV2Evidence({ adapterId: "codex", sourcePath: "a", contentKind: "transcript", rawText: "", detectedFormat: "plain" }, record, "user: Prefer focused regression tests for parser changes.");
    const concepts = mergeLearnV2ConceptCards(extractLearnV2BehaviorAtoms(reconstructLearnV2Episodes(evidence)).atoms, new Date("2026-06-30T00:00:00Z"));
    const [active, candidate] = concepts.length > 1 ? concepts : [concepts[0]!, { ...concepts[0]!, id: `${concepts[0]!.id}_candidate` }];
    const preview = await compileLearnV2ConceptPreview(root, (await initAdaptiveProject({ projectRoot: root })).config, [
      { ...active, status: "active" },
      { ...candidate, status: "candidate" }
    ], new Date("2026-06-30T00:01:00Z"));
    expect(preview.activeConceptCount).toBe(1);
    expect(preview.candidateConceptCount).toBe(1);
    expect(preview.preferenceNodes).toHaveLength(1);
    expect(preview.declassificationReport.rawRefsExported).toBe(false);
    expect(JSON.stringify(preview)).not.toContain("raw_compile");
  });

  it("runs raw-local facade with v2 artifacts and excludes new private state from packs", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "codex-transcript.md");
    await writeFile(transcript, `user: ${root} avoid broad rewrite in packages/core/src/parser.ts. Prefer regression fixture first.`, "utf8");
    const result = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: false,
      allowDuplicateImports: true,
      now: new Date("2026-06-30T00:00:00Z")
    });
    expect(result.artifacts.learnV2RawVaultDir).toContain(".openskill-kit");
    expect(result.artifacts.learnV2ReviewQueuePath).toBeTruthy();
    expect(result.artifacts.learnV2ModelRoutingPath).toContain("osk-model-routing.json");
    expect(result.artifacts.learnV2RelevanceCalibrationPath).toContain("relevance-calibration.json");
    expect(result.artifacts.learnV2EpisodeStorePath).toContain("episodes");
    expect(result.artifacts.learnV2ModelRequestDir).toContain("model-requests");
    expect(await readText(result.artifacts.learnV2RelevanceCalibrationPath)).toContain("openskill-kit.project-relevance-calibration.v1");
    expect(result.learnV2.modelRequestCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(result.concepts)).not.toContain(root);
    expect(result.learnV2).toBeTruthy();
  });

  it("normalizes legacy model-mode aliases and rejects unimplemented raw model execution", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "model-mode-session.md");
    await writeFile(transcript, `user: ${root} prefer focused parser tests in packages/core/src/parser.ts.`, "utf8");

    const aliased = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: true,
      modelMode: "heuristic-only",
      now: new Date("2026-06-30T00:00:00Z")
    });
    expect(aliased.modelMode).toBe("deterministic-only");
    expect(aliased.privacy.join("\n")).toContain("Model execution policy is deterministic-only");

    const sanitized = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: true,
      modelMode: "remote-redacted",
      now: new Date("2026-06-30T00:01:00Z")
    });
    expect(sanitized.modelMode).toBe("opencode-host-sanitized-only");

    await expect(runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: true,
      modelMode: "opencode-host-raw-allowed",
      now: new Date("2026-06-30T00:02:00Z")
    })).rejects.toThrow(/opencode-host-raw-allowed is not implemented yet/);
  });

  it("uses project raw-evidence execution policy when model mode is omitted", async () => {
    const root = await tempProject();
    const configPath = path.join(root, ".openskill-kit", "config.json");
    const config = JSON.parse(await readText(configPath));
    config.learning.rawEvidence.extractionExecution = "opencode-host-sanitized-only";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const transcript = path.join(root, "model-mode-config-session.md");
    await writeFile(transcript, `user: ${root} prefer focused parser tests in packages/core/src/parser.ts.`, "utf8");

    const sanitized = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: true,
      now: new Date("2026-06-30T00:03:00Z")
    });
    expect(sanitized.modelMode).toBe("opencode-host-sanitized-only");
    expect(sanitized.privacy.join("\n")).toContain("Model execution policy is opencode-host-sanitized-only");

    config.learning.rawEvidence.extractionExecution = "opencode-host-raw-allowed";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await expect(runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: true,
      now: new Date("2026-06-30T00:04:00Z")
    })).rejects.toThrow(/opencode-host-raw-allowed is not implemented yet/);
  });

  it("builds raw-learning review artifacts from canonical merged concept store", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:00:00Z");
    const [existing] = mergeLearnV2ConceptCards([
      { ...behaviorAtom("canonical_existing_parser_tests", "Prefer focused parser tests for parser changes.", "positive"), kind: "workflow" }
    ], now);
    await writeLearnV2ConceptStore(root, [{
      ...existing!,
      status: "active",
      scope: { ...existing!.scope, paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] },
      activation: { ...existing!.activation, pathGlobs: ["packages/core/src/**"] }
    }], now);
    const transcript = path.join(root, "session.md");
    await writeFile(transcript, [
      `user: ${root} Avoid focused parser tests for packages/core/src/parser.ts parser changes.`,
      "assistant: ok"
    ].join("\n"), "utf8");

    const result = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: false,
      allowDuplicateImports: true,
      now: new Date("2026-06-30T00:01:00Z")
    });

    const conflictLedger = await readText(result.artifacts.learnV2ConflictLedgerPath);
    expect(conflictLedger).toContain(existing!.id);
    expect(conflictLedger).toContain("Unresolved: 1");
    const reviewQueue = await readText(result.artifacts.learnV2ReviewQueuePath);
    expect(reviewQueue).toContain("Unresolved conflicts:");
    expect(result.learnV2.concepts.some((card) => card.id === existing!.id)).toBe(true);
  });

  it("reconstructs extracts and evaluates from persisted learn-v2 artifacts without raw source reread", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "session.md");
    await writeFile(transcript, `user: ${root} prefer focused parser regression tests in packages/core/src/parser.ts.`, "utf8");
    await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: false,
      allowDuplicateImports: true,
      now: new Date("2026-06-30T00:00:00Z")
    });
    await writeFile(transcript, "this file was changed after ingest and must not be reread", "utf8");
    const reconstructed = await reconstructPersistedLearnV2Episodes(root, new Date("2026-06-30T00:01:00Z"));
    expect(reconstructed.analysisFrameCount).toBeGreaterThanOrEqual(1);
    expect(reconstructed.episodeCount).toBeGreaterThanOrEqual(1);
    expect(reconstructed.modelRequestCount).toBe(reconstructed.episodeCount);
    const extracted = await extractPersistedLearnV2Concepts(root, new Date("2026-06-30T00:02:00Z"));
    expect(extracted.atomCount).toBeGreaterThanOrEqual(1);
    expect(extracted.conceptCount).toBeGreaterThanOrEqual(1);
    const evaluated = await runPersistedLearnV2Eval(root, {}, new Date("2026-06-30T00:03:00Z"));
    expect(evaluated.evalStatus).toBe("pass");
    expect(await readText(evaluated.evalReportPath)).toContain("Counterfactual trace cases");
  });

  it("prepares prompt-safe model requests and validates model outputs before concept merge", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "codex-transcript.md");
    await writeFile(transcript, `user: ${root} prefer focused parser regression tests in packages/core/src/parser.ts.\nassistant: ok`, "utf8");
    const learned = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: false,
      allowDuplicateImports: true,
      now: new Date("2026-06-30T00:00:00Z")
    });
    const requests = await writeLearnV2ModelRequests(root, undefined, new Date("2026-06-30T00:01:00Z"));
    expect(requests.requestCount).toBeGreaterThanOrEqual(1);
    expect(requests.requestCount + requests.skippedEpisodes.length).toBe(learned.learnV2.episodes.length);
    const request = requests.requests[0]!;
    const prompt = await readText(request.promptPath);
    const bundle = await readText(request.bundlePath);
    const manifest = JSON.parse(await readText(request.manifestPath));
    expect(prompt).toContain("EpisodeLearningBundle");
    expect(prompt).not.toContain(root);
    expect(bundle).not.toContain("raw_");
    expect(manifest.schemaVersion).toBe("openskill-kit.learn-v2.model-request-manifest.v1");
    expect(manifest.episodeId).toBe(request.episodeId);
    expect(manifest.modelRole).toBe("concept-extractor");
    expect(manifest.routingPolicy).toBe("learn-v2-roi-v1");
    expect(manifest.routingReasons.length).toBeGreaterThan(0);
    expect(manifest.priority).toBeGreaterThan(0);
    expect(path.resolve(root, manifest.expectedOutputPath)).toBe(request.expectedOutputPath);
    expect(manifest.rawRefsIncluded).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain("raw_");
    expect(JSON.stringify(manifest)).not.toContain(root);

    const requestEpisode = learned.learnV2.episodes.find((episode) => episode.id === request.episodeId)!;
    const [evidenceId] = requestEpisode.evidenceIds;
    const outputPath = request.expectedOutputPath;
    await writeFile(outputPath, JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
      atoms: [{
        statement: "For parser changes, prefer focused parser regression tests before broad suites.",
        kind: "verification",
        polarity: "positive",
        evidenceIds: [evidenceId],
        confidence: 0.74,
        rationale: "The episode asks for focused parser regression tests."
      }],
      rejected: []
    }), "utf8");
    const badOutputPath = path.join(path.dirname(request.promptPath), "bad-response.json");
    await writeFile(badOutputPath, JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
      atoms: [{
        statement: "Never log sk-12345678901234567890.",
        kind: "security",
        polarity: "negative",
        evidenceIds: ["missing"],
        confidence: 0.99
      }],
      rejected: []
    }), "utf8");
    const staleDir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", "episode_stale");
    const staleOutputPath = path.join(staleDir, "response.json");
    await mkdir(staleDir, { recursive: true });
    await writeFile(path.join(staleDir, "request-manifest.json"), JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.model-request-manifest.v1",
      generatedAt: "2026-06-30T00:01:00.000Z",
      episodeId: "episode_missing",
      modelRole: "concept-extractor",
      routingPolicy: "learn-v2-roi-v1",
      routingReasons: ["durable-language-signal"],
      priority: 0.7,
      promptPath: path.join(staleDir, "concept-extraction-prompt.md"),
      bundlePath: path.join(staleDir, "episode-learning-bundle.json"),
      expectedOutputPath: staleOutputPath,
      outputSchema: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
      evidenceIds: [evidenceId],
      rawRefsIncluded: false
    }), "utf8");
    await writeFile(staleOutputPath, JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
      atoms: [{
        statement: "For parser changes, prefer focused parser regression tests before broad suites.",
        kind: "verification",
        polarity: "positive",
        evidenceIds: [evidenceId],
        confidence: 0.72
      }],
      rejected: []
    }), "utf8");
    const malformedOutputPath = path.join(root, "malformed-response.json");
    await writeFile(malformedOutputPath, "{", "utf8");

    const applied = await applyLearnV2ModelProposalOutputs(root, [request.manifestPath, badOutputPath, staleOutputPath, malformedOutputPath], new Date("2026-06-30T00:02:00Z"));
    const store = await readLearnV2ConceptStore(root);
    expect(applied.outputFiles).toContain(outputPath);
    expect(applied.atomCount).toBe(1);
    expect(applied.rejected.map((item) => item.reason)).toEqual(expect.arrayContaining(["unexpected-output-path", "stale-request-manifest", "invalid-json-or-schema"]));
    expect(applied.evalStatus).toBe("pass");
    expect(await readText(applied.reviewQueuePath)).toContain("Evidence Snippet Summary");
    expect(await readText(applied.reviewQueuePath)).toContain("For parser changes, prefer focused parser regression tests before broad suites.");
    expect(await readText(applied.conflictLedgerPath)).toContain("Learn v2 Conflict Ledger");
    expect(await readText(applied.evalReportPath)).toContain("Learn v2 Eval");
    expect(await readText(applied.declassifiedSnippetsPath)).toContain("Learn v2 Declassified Evidence Snippets");
    expect(await readText(applied.conceptDriftPath)).toContain("openskill-kit.learn-v2.concept-drift.v1");
    expect(store.cards.some((card) => /parser regression tests/i.test(card.canonicalBehavior))).toBe(true);
    expect(JSON.stringify(store)).not.toContain("sk-12345678901234567890");
  });

  it("routes OpenCode model requests by ROI instead of prompting every episode", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:04:00Z");
    const valuable = reconstructLearnV2Episodes([
      normalizedMessage("ev_roi_prefer", "Wrong approach. Prefer focused parser regression fixtures before broad parser rewrites.", "user")
    ])[0]!;
    const weak = reconstructLearnV2Episodes([
      normalizedMessage("ev_roi_noise", "assistant: looked around and said ok", "assistant")
    ])[0]!;
    await writeLearnV2EpisodeStore(root, [valuable, weak], now);

    const requests = await writeLearnV2ModelRequests(root, undefined, now);
    expect(requests.requestCount).toBe(1);
    expect(requests.requests[0]!.episodeId).toBe(valuable.id);
    expect(requests.requests[0]!.opencodeAgentId).toBe("osk-learn-v2-concept-extractor");
    expect(requests.requests[0]!.agentFile).toContain("osk-learn-v2-concept-extractor.md");
    expect(requests.requests[0]!.routing.reasons).toContain("durable-language-signal");
    expect(requests.skippedEpisodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ episodeId: weak.id, decision: "skip", reasons: ["no-semantic-roi-trigger"] })
    ]));
    const routingManifest = await readText(requests.routingManifestPath);
    expect(routingManifest).toContain("learn-v2-roi-v1");
    expect(routingManifest).toContain("osk-learn-v2-concept-extractor");
    expect(routingManifest).toContain("opencodeAgentIndexPath");
    expect(routingManifest).toContain(valuable.id);
    expect(routingManifest).toContain(weak.id);
    expect(routingManifest).not.toContain("raw_");
    const manifest = JSON.parse(await readText(requests.requests[0]!.manifestPath));
    expect(manifest.executionBoundary).toBe("opencode-host-sanitized-only");
    expect(manifest.rawRefsIncluded).toBe(false);
    expect(manifest.opencodeAgentId).toBe("osk-learn-v2-concept-extractor");
    expect(await readText(path.join(root, manifest.agentFile))).toContain("mode: subagent");
  });

  it("projects existing routing into learn-v2 OpenCode agent artifacts without owning a provider", async () => {
    const root = await tempProject();
    const artifact = await ensureLearnV2ModelRoutingArtifacts(root, new Date("2026-06-30T00:00:00Z"));
    expect(artifact.policy.ownedProvider).toBe(false);
    expect(artifact.policy.executionBoundary).toBe("opencode-configured-agent-or-deterministic");
    expect(Object.keys(artifact.agents)).toEqual([
      "evidence-summarizer",
      "concept-extractor",
      "contradiction-reviewer",
      "scope-inferencer",
      "declassification-reviewer",
      "eval-planner",
      "publish-export-auditor"
    ]);
    const routeJson = await readText(path.join(root, artifact.artifacts.routingJson));
    expect(routeJson).toContain("deterministicFallback");
    expect(routeJson).toContain("behavior pack publish audit scanners");
    expect(routeJson).toContain("opencodeAgentIndex");
    expect(routeJson).not.toContain("ollama");
    const agentIndex = await readText(path.join(root, artifact.artifacts.opencodeAgentIndex));
    expect(agentIndex).toContain("openskill-kit.learn-v2.opencode-agent-index.v1");
    expect(agentIndex).toContain("rawEvidenceToRemoteModels");
    const publishAuditor = await readText(path.join(root, artifact.agents["publish-export-auditor"].agentFile));
    expect(publishAuditor).toContain("---");
    expect(publishAuditor).toContain("mode: subagent");
    expect(publishAuditor).toContain("permission:");
    expect(publishAuditor).toContain("edit: deny");
    expect(publishAuditor).toContain("webfetch: deny");
    expect(publishAuditor).toContain("share-boundary privacy risks");
    const conceptExtractor = await readText(path.join(root, artifact.agents["concept-extractor"].agentFile));
    expect(conceptExtractor).toContain("model: default");
    expect(conceptExtractor).toContain("steps: 24");
    expect(conceptExtractor).toContain("question: allow");
    expect(conceptExtractor.indexOf("\"*\": deny")).toBeLessThan(conceptExtractor.indexOf("\"openskill-kit *\": ask"));
  });

  it("reports raw vault budget and compacts unpinned records during GC", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "low-relevance.txt");
    await writeFile(transcript, "unrelated temporary transcript with ghp_123456789012345678901234567890123456 and no project markers", "utf8");
    const config = await readProjectConfig(root);
    await storeLearnV2RawEvidence({
      root,
      config,
      now: new Date("2026-06-30T00:00:00Z")
    }, {
      adapterId: "test",
      sourcePath: transcript,
      text: await readText(transcript),
      contentKind: "transcript",
      relevance: {
        score: 0.3,
        decision: "review",
        gate: "hard-review",
        calibrationVersion: "test",
        featureValues: {},
        reasons: ["test-unpinned-record"],
        matchedPaths: [],
        matchedRemotes: []
      }
    });
    const status = await runLearnV2RawVaultMaintenance(root, {
      maxHotBytes: 1,
      now: new Date("2026-07-01T00:00:00Z")
    });
    expect(status.status).toBe("over-budget");
    const gc = await runLearnV2RawVaultMaintenance(root, {
      gc: true,
      maxHotBytes: 1,
      now: new Date("2026-07-30T00:00:00Z")
    });
    expect(gc.compactedRecords).toBeGreaterThanOrEqual(1);
    expect(gc.removedBlobRefs.length).toBeGreaterThanOrEqual(1);
    expect(gc.manifest.budget.hotBytes).toBe(0);
    expect(gc.manifest.budget.compactedBytes).toBeGreaterThan(0);
    const compacted = gc.manifest.records.find((record) => record.retentionTier === "compacted")!;
    const record = JSON.parse(await readText(path.join(root, ".openskill-kit", "learn-v2", "raw-vault", "records", `${compacted.id}.json`)));
    expect(record.retention.compactedRef).toBeTruthy();
    const compactedArtifact = await readText(path.join(root, ".openskill-kit", "learn-v2", "raw-vault", record.retention.compactedRef));
    expect(compactedArtifact).toContain("openskill-kit.learn-v2.compacted-raw-evidence.v1");
    expect(compactedArtifact).not.toContain("ghp_123456789012345678901234567890123456");
    await expect(import("node:fs/promises").then((fs) => fs.stat(path.join(root, ".openskill-kit", "learn-v2", "raw-vault", gc.removedBlobRefs[0]!)))).rejects.toThrow();
  });

  it("pins raw vault records for retained concept cards and releases rejected-only refs", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:00:00Z");
    const source = path.join(root, "pinning-session.md");
    await writeFile(source, `user: ${root} prefer focused parser tests in packages/core/src/parser.ts.`, "utf8");
    const config = await readProjectConfig(root);
    const stored = await storeLearnV2RawEvidence({
      root,
      config,
      now,
      retentionDays: 1
    }, {
      adapterId: "test",
      sourcePath: source,
      text: await readText(source),
      contentKind: "transcript",
      relevance: {
        score: 0.5,
        decision: "review",
        gate: "hard-review",
        calibrationVersion: "test",
        featureValues: {},
        reasons: ["test-review-record"],
        matchedPaths: ["packages/core/src/parser.ts"],
        matchedRemotes: []
      }
    });
    expect(stored.record.retention.tier).toBe("hot-spool");

    const [concept] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("raw_pin_parser_tests", "Prefer focused parser tests for parser changes.", "positive"),
      evidenceIds: ["ev_raw_pin_parser_tests"],
      rawRefs: [stored.record.id]
    }], now);
    await writeLearnV2ConceptStore(root, [concept!], now);
    const pinnedRecord = JSON.parse(await readText(path.join(root, ".openskill-kit", "learn-v2", "raw-vault", "records", `${stored.record.id}.json`)));
    expect(pinnedRecord.retention.tier).toBe("pinned");
    expect(pinnedRecord.retention.pinnedBy).toContain("concept-store");

    const protectedGc = await runLearnV2RawVaultMaintenance(root, {
      gc: true,
      now: new Date("2026-07-05T00:00:00Z")
    });
    expect(protectedGc.compactedRecords).toBe(0);
    expect(protectedGc.removedBlobRefs).not.toContain(stored.record.content.blobRef);
    expect(protectedGc.manifest.records.find((record) => record.id === stored.record.id)?.retentionTier).toBe("pinned");

    await applyLearnV2ConceptReview(root, {
      reject: [concept!.id],
      now: new Date("2026-07-05T00:01:00Z")
    });
    const releasedRecord = JSON.parse(await readText(path.join(root, ".openskill-kit", "learn-v2", "raw-vault", "records", `${stored.record.id}.json`)));
    expect(releasedRecord.retention.tier).toBe("hot-spool");
    expect(releasedRecord.retention.pinnedBy).not.toContain("concept-store");

    const releasedGc = await runLearnV2RawVaultMaintenance(root, {
      gc: true,
      now: new Date("2026-07-06T00:00:00Z")
    });
    expect(releasedGc.compactedRecords).toBe(1);
    expect(releasedGc.removedBlobRefs).toContain(stored.record.content.blobRef);
  });

  it("reports and prunes old preview concept stores without touching canonical state", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "preview-retention.md");
    await writeFile(transcript, `user: ${root} prefer focused parser tests in packages/core/src/parser.ts.`, "utf8");
    const first = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: true,
      now: new Date("2026-06-01T00:00:00Z")
    });
    const second = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: true,
      now: new Date("2026-06-10T00:00:00Z")
    });
    const newest = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: true,
      now: new Date("2026-06-20T00:00:00Z")
    });

    const status = await runLearnV2RawVaultMaintenance(root, {
      now: new Date("2026-07-01T00:00:00Z"),
      previewRetentionDays: 0,
      keepPreviewRuns: 1
    });
    expect(status.previewArtifacts.previewStoreCount).toBe(3);
    expect(status.previewArtifacts.previewStoreBytes).toBeGreaterThan(0);

    const gc = await runLearnV2RawVaultMaintenance(root, {
      gc: true,
      now: new Date("2026-07-01T00:00:00Z"),
      previewRetentionDays: 0,
      keepPreviewRuns: 1
    });
    expect(gc.previewArtifacts.previewStoreCount).toBe(1);
    expect(gc.prunedPreviewArtifacts).toHaveLength(2);
    await expect(stat(first.artifacts.learnV2ConceptStorePath)).rejects.toThrow();
    await expect(stat(second.artifacts.learnV2ConceptStorePath)).rejects.toThrow();
    await expect(stat(newest.artifacts.learnV2ConceptStorePath)).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json"))).rejects.toThrow();
    await expect(stat(path.join(root, ".openskill-kit", "learn-v2", "activation-index.json"))).rejects.toThrow();
  });

  it("persists reviewed concepts, writes activation index, and syncs active concepts into graphs", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "session.md");
    await writeFile(transcript, `user: ${root} prefer focused regression tests for parser changes in packages/core/src/parser.ts.`, "utf8");
    const learned = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: false,
      allowDuplicateImports: true,
      now: new Date("2026-06-30T00:00:00Z")
    });
    const store = await readLearnV2ConceptStore(root);
    const concept = store.cards.find((card) => /parser|regression/i.test(card.canonicalBehavior)) ?? store.cards[0]!;
    const reviewed = await applyLearnV2ConceptReview(root, {
      accept: [concept.id],
      narrowScopes: [{ id: concept.id, paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] }],
      now: new Date("2026-06-30T00:02:00Z")
    });
    const graph = await readPreferenceGraph(root);
    const active = graph.nodes.find((node) => node.id === `pref_${concept.id}`);
    expect(learned.artifacts.learnV2ConceptStorePath).toContain("store.json");
    expect(reviewed.activeConceptCount).toBeGreaterThanOrEqual(1);
    expect(active?.status).toBe("active");
    expect(active?.scope.paths).toContain("packages/core/src/parser.ts");
    const activationIndex = await readText(reviewed.activationIndexPath);
    expect(activationIndex).toContain(concept.id);
    expect(activationIndex).not.toContain("raw_");
    const compiled = await compileBehaviorLayer(root, { targets: ["mcp-resources"] });
    expect(compiled.mcpResourcePath).toContain("learn-v2-concepts.json");
    const conceptResources = await readText(compiled.mcpResourcePath!);
    expect(conceptResources).toContain(concept.id);
    expect(conceptResources).toContain("openskill-kit://learn-v2/concepts/");
    expect(conceptResources).not.toContain("raw_");
    expect(conceptResources).not.toContain(root);
    const pack = await exportProjectBehaviorPack(root);
    expect(pack.files).toContain(".openskill-kit/compiled/mcp/resources/learn-v2-concepts.json");
  });

  it("merges splits and supersedes concept cards with lifecycle-safe review operations", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "session.md");
    await writeFile(transcript, [
      `user: ${root} prefer focused parser regression tests in packages/core/src/parser.ts.`,
      "user: Avoid broad rewrite in packages/core/src/parser.ts when a small parser fix is enough.",
      "tool: npm test -- parser",
      "PASS"
    ].join("\n"), "utf8");
    await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: false,
      allowDuplicateImports: true,
      now: new Date("2026-06-30T00:00:00Z")
    });
    const initial = await readLearnV2ConceptStore(root);
    const [target, source] = initial.cards.filter((card) => card.status === "candidate").slice(0, 2);
    expect(target).toBeTruthy();
    expect(source).toBeTruthy();

    const mergedReview = await applyLearnV2ConceptReview(root, {
      mergeConcepts: [{
        targetId: target!.id,
        sourceIds: [source!.id],
        canonicalBehavior: "Prefer focused parser regression tests and avoid broad rewrites for parser changes.",
        activationPhrases: ["parser review", "focused regression"]
      }],
      compileActive: false,
      now: new Date("2026-06-30T00:02:00Z")
    });
    const mergedStore = mergedReview.store;
    const mergedTarget = mergedStore.cards.find((card) => card.id === target!.id)!;
    const supersededSource = mergedStore.cards.find((card) => card.id === source!.id)!;
    expect(mergedTarget.lifecycle.supersedes).toContain(source!.id);
    expect(mergedTarget.atoms.length).toBeGreaterThanOrEqual(2);
    expect(supersededSource.status).toBe("superseded");
    expect(supersededSource.lifecycle.supersededBy).toBe(target!.id);
    expect(await readText(mergedReview.activationIndexPath)).not.toContain(source!.id);

    const atomToSplit = mergedTarget.atoms[0]!;
    const splitReview = await applyLearnV2ConceptReview(root, {
      splitConcepts: [{
        sourceId: mergedTarget.id,
        atomIds: [atomToSplit.id],
        canonicalBehavior: atomToSplit.statement,
        paths: ["packages/core/src/parser.ts"],
        taskTypes: ["parser-change"],
        activationPhrases: ["split parser behavior"]
      }],
      compileActive: false,
      now: new Date("2026-06-30T00:03:00Z")
    });
    const splitChild = splitReview.store.cards.find((card) => !initial.cards.some((existing) => existing.id === card.id))!;
    const splitParent = splitReview.store.cards.find((card) => card.id === mergedTarget.id)!;
    expect(splitChild.status).toBe("candidate");
    expect(splitChild.atoms.map((atom) => atom.id)).toEqual([atomToSplit.id]);
    expect(splitChild.scope.paths).toContain("packages/core/src/parser.ts");
    expect(splitParent.atoms.some((atom) => atom.id === atomToSplit.id)).toBe(false);

    const supersedeReview = await applyLearnV2ConceptReview(root, {
      supersedeConcepts: [{ supersededId: splitChild.id, supersededById: splitParent.id, reason: "Folded back after reviewer decision." }],
      compileActive: false,
      now: new Date("2026-06-30T00:04:00Z")
    });
    const finalChild = supersedeReview.store.cards.find((card) => card.id === splitChild.id)!;
    const finalParent = supersedeReview.store.cards.find((card) => card.id === splitParent.id)!;
    expect(finalChild.status).toBe("superseded");
    expect(finalChild.lifecycle.supersededBy).toBe(finalParent.id);
    expect(finalParent.lifecycle.supersedes).toContain(finalChild.id);
    expect(supersedeReview.messages.join("\n")).toContain("superseded by");
  });

  it("persists concept scoring breakdowns and penalizes counterevidence", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_scoring");
    const evidence = normalizeLearnV2Evidence(
      { adapterId: "codex", sourcePath: "a", contentKind: "transcript", rawText: "", detectedFormat: "plain" },
      record,
      "user: Prefer focused parser tests for packages/core/src/parser.ts."
    ).map((item) => ({ ...item, paths: ["packages/core/src/parser.ts"] }));
    const [concept] = mergeLearnV2ConceptCards(extractLearnV2BehaviorAtoms(reconstructLearnV2Episodes(evidence)).atoms, new Date("2026-06-30T00:00:00Z"));
    await writeLearnV2ConceptStore(root, [concept!], new Date("2026-06-30T00:01:00Z"));
    const initial = await readLearnV2ConceptStore(root);
    const stored = initial.cards[0]!;
    expect(stored.scoring?.schemaVersion).toBe("openskill-kit.learn-v2.concept-scoring.v1");
    expect(stored.scoring?.reasons.join(",")).toContain("max-atom-confidence:");
    expect(stored.scoring?.penalties.join(",")).not.toContain("counterevidence:");

    const reviewed = await applyLearnV2ConceptReview(root, {
      addCounterevidence: [{
        id: stored.id,
        evidenceId: stored.evidenceIds[0]!,
        reason: "Reviewer marked this concept too broad for automatic use."
      }],
      compileActive: false,
      now: new Date("2026-06-30T00:02:00Z")
    });
    const rescored = reviewed.store.cards.find((card) => card.id === stored.id)!;
    expect(rescored.status).toBe("conflict");
    expect(rescored.scoring?.counterevidenceCount).toBe(1);
    expect(rescored.scoring?.penalties.join(",")).toContain("counterevidence:");
    expect(rescored.confidence).toBeLessThan(stored.confidence);
  });

  it("activates reviewed concepts deterministically and records hashed outcome telemetry", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "session.md");
    await writeFile(transcript, `user: ${root} prefer focused regression tests for parser changes in packages/core/src/parser.ts.`, "utf8");
    await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: false,
      allowDuplicateImports: true,
      now: new Date("2026-06-30T00:00:00Z")
    });
    const store = await readLearnV2ConceptStore(root);
    const concept = store.cards.find((card) => /parser|regression/i.test(card.canonicalBehavior)) ?? store.cards[0]!;
    await applyLearnV2ConceptReview(root, {
      accept: [concept.id],
      narrowScopes: [{ id: concept.id, paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] }],
      now: new Date("2026-06-30T00:02:00Z")
    });
    const activated = await activateLearnV2Concepts(root, {
      query: "parser change needs focused test",
      paths: ["packages/core/src/parser.ts"],
      taskTypes: ["parser-change"]
    }, new Date("2026-06-30T00:03:00Z"));
    expect(activated.matches[0]?.conceptId).toBe(concept.id);
    expect(activated.matches[0]?.reasons.join(",")).toContain("path:");
    expect(activated.matches[0]?.score).toBeGreaterThan(0.4);
    expect(activated.diagnostics.activeEntryCount + activated.diagnostics.lockedEntryCount).toBeGreaterThanOrEqual(1);
    expect(activated.diagnostics.visiblePositiveMatchCount).toBeGreaterThanOrEqual(1);
    expect(activated.activationRunPath).toContain("activation-runs");
    const activationRunText = await readText(activated.activationRunPath);
    expect(activationRunText).toContain("openskill-kit.learn-v2.activation-run.v1");
    expect(activationRunText).toContain(concept.id);
    expect(activationRunText).toContain("queryHash");
    expect(activationRunText).not.toContain("parser change needs focused test");
    expect(activationRunText).not.toContain(root);
    const driftFromActivationRuns = await detectLearnV2ConceptDrift(root, [{
      ...concept,
      status: "active",
      lifecycle: {
        ...concept.lifecycle,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    }], {
      now: new Date("2026-06-30T00:05:00Z"),
      staleAfterDays: 60,
      lowActivationThreshold: 0
    });
    expect(driftFromActivationRuns.report.staleCandidates.some((item) => item.conceptId === concept.id)).toBe(false);
    const activationRuns = await readLearnV2ConceptActivationRuns(root);
    expect(activationRuns.some((run) => run.matches.some((match) => match.conceptId === concept.id))).toBe(true);

    const outcome = await recordLearnV2ConceptOutcome(root, {
      conceptId: concept.id,
      outcome: "helpful",
      activationScore: activated.matches[0]!.score,
      query: `${root} parser change needs focused test`,
      paths: [path.join(root, "packages/core/src/parser.ts")],
      commands: ["npm test -- parser"],
      reason: "matched future parser task"
    }, new Date("2026-06-30T00:04:00Z"));
    const rawOutcome = await readText(outcome.outcomePath);
    expect(rawOutcome).toContain(concept.id);
    expect(rawOutcome).toContain("queryHash");
    expect(rawOutcome).not.toContain(root);
    expect(rawOutcome).not.toContain("npm test -- parser");
    expect(rawOutcome).not.toContain("packages/core/src/parser.ts");

    const boosted = await activateLearnV2Concepts(root, {
      query: "parser change needs focused test",
      paths: ["packages/core/src/parser.ts"],
      taskTypes: ["parser-change"]
    }, new Date("2026-06-30T00:05:00Z"));
    expect(boosted.matches[0]?.conceptId).toBe(concept.id);
    expect(boosted.matches[0]?.reasons.join(",")).toContain("outcome:helpful:1");
    expect(boosted.matches[0]?.score).toBeGreaterThanOrEqual(activated.matches[0]!.score);

    await recordLearnV2ConceptOutcome(root, {
      conceptId: concept.id,
      outcome: "harmful",
      activationScore: boosted.matches[0]!.score,
      query: "parser change needs focused test",
      reason: "bad future retrieval"
    }, new Date("2026-06-30T00:06:00Z"));
    const suppressed = await activateLearnV2Concepts(root, {
      query: "parser change needs focused test",
      paths: ["packages/core/src/parser.ts"],
      taskTypes: ["parser-change"]
    }, new Date("2026-06-30T00:07:00Z"));
    expect(suppressed.matches.some((match) => match.conceptId === concept.id)).toBe(false);
    expect(suppressed.suppressed.find((match) => match.conceptId === concept.id)?.reasons).toContain("outcome:harmful");
  });

  it("ranks activation entries with deterministic BM25-style lexical evidence", async () => {
    const matches = scoreLearnV2ActivationEntries([
      {
        conceptId: "concept_parser",
        status: "active",
        title: "Focused parser regression verification",
        phrases: ["syntax regression", "parser fixture"],
        pathGlobs: ["packages/core/src/parser/**"],
        commands: ["npm test parser"],
        taskTypes: ["parser-change"],
        negativeTriggers: [],
        confidence: 0.72,
        risk: "low"
      },
      {
        conceptId: "concept_docs",
        status: "active",
        title: "Documentation review",
        phrases: ["readme cleanup"],
        pathGlobs: ["docs/**"],
        commands: [],
        taskTypes: ["docs-change"],
        negativeTriggers: [],
        confidence: 0.95,
        risk: "low"
      }
    ], {
      query: "parser syntax regression needs focused fixture",
      paths: ["packages/core/src/parser/tokenizer.ts"],
      taskTypes: ["parser-change"]
    });

    expect(matches[0]!.conceptId).toBe("concept_parser");
    expect(matches[0]!.reasons.join(",")).toContain("bm25:");
    expect(matches[0]!.score).toBeGreaterThan(matches[1]!.score);
  });

  it("activates concepts through deterministic semantic aliases and fingerprints", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:08:00Z");
    const [concept] = mergeLearnV2ConceptCards([{
      schemaVersion: "openskill-kit.learn-v2.behavior-atom.v1",
      id: "atom_semantic_parser_fixture",
      kind: "workflow",
      statement: "Prefer focused parser regression fixtures before broad parser rewrites.",
      polarity: "positive",
      scope: {
        level: "path",
        paths: ["packages/core/src/parser.ts"],
        taskTypes: []
      },
      confidence: 0.82,
      confidenceCap: 0.9,
      sourceReliability: 0.85,
      evidenceIds: ["ev_semantic_parser_fixture"],
      rawRefs: ["raw_semantic_parser_fixture"],
      rationale: "Explicit preference or correction language in episode.",
      risk: "low"
    }], now);
    await writeLearnV2ConceptStore(root, [{ ...concept!, status: "active" }], now);
    const activationIndex = await readText(path.join(root, ".openskill-kit", "learn-v2", "activation-index.json"));
    expect(activationIndex).toContain("semanticAliases");
    expect(activationIndex).toContain("keywordFingerprint");

    const result = await activateLearnV2Concepts(root, {
      query: "grammar spec needed for syntax bug",
      limit: 5
    }, new Date("2026-06-30T00:09:00Z"));

    expect(result.matches[0]?.conceptId).toBe(concept!.id);
    expect(result.matches[0]?.reasons.join(",")).toContain("semantic-fingerprint:");

    const broadFamilyOnly = scoreLearnV2ActivationEntries([{
      conceptId: "concept_broad_test",
      status: "active",
      title: "Generic test note",
      phrases: [],
      pathGlobs: [],
      commands: [],
      taskTypes: [],
      negativeTriggers: [],
      semanticAliases: [],
      keywordFingerprint: ["family:test"],
      confidence: 0.95,
      risk: "low"
    }], { query: "spec" });
    expect(broadFamilyOnly[0]!.score).toBe(0);
  });

  it("applies guarded auto-stage auto-apply-safe and assistant-only supersession policies", async () => {
    const root = await tempProject();
    const configPath = path.join(root, ".openskill-kit", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.learning.mode = "auto-apply-safe";
    config.learning.minConfidenceToApply = 0.72;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const record = previewRecord(root, "raw_auto_policy");
    const evidence = normalizeLearnV2Evidence(
      { adapterId: "codex", sourcePath: "a", contentKind: "transcript", rawText: "", detectedFormat: "plain" },
      record,
      "user: Prefer focused parser tests for packages/core/src/parser.ts."
    ).map((item) => ({ ...item, paths: ["packages/core/src/parser.ts"] }));
    const [base] = mergeLearnV2ConceptCards(extractLearnV2BehaviorAtoms(reconstructLearnV2Episodes(evidence)).atoms, new Date("2026-06-30T00:00:00Z"));
    const safe = {
      ...base!,
      id: `${base!.id}_safe`,
      risk: "low" as const,
      confidence: 0.86,
      sourceReliability: 0.86,
      scope: { ...base!.scope, level: "path" as const, paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] },
      atoms: base!.atoms.map((atom) => ({ ...atom, risk: "low" as const, confidence: 0.86, sourceReliability: 0.86, scope: { ...atom.scope, paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] } }))
    };
    const protectedSecurity = {
      ...safe,
      id: `${base!.id}_security`,
      risk: "high" as const,
      confidence: 0.95,
      atoms: safe.atoms.map((atom) => ({ ...atom, id: `${atom.id}_security`, kind: "security" as const, risk: "high" as const }))
    };
    const weakOld = {
      ...safe,
      id: `${base!.id}_weak_old`,
      canonicalBehavior: "Avoid focused parser tests for parser changes.",
      confidence: 0.34,
      sourceReliability: 0.3,
      atoms: safe.atoms.map((atom) => ({ ...atom, id: `${atom.id}_weak`, polarity: "negative" as const, statement: "Avoid focused parser tests for parser changes.", confidence: 0.34, sourceReliability: 0.3 }))
    };
    const store = await writeLearnV2ConceptStore(root, [safe, protectedSecurity, weakOld], new Date("2026-06-30T00:01:00Z"));
    const storedSafe = store.cards.find((card) => card.id === safe.id)!;
    const storedProtected = store.cards.find((card) => card.id === protectedSecurity.id)!;
    const storedWeak = store.cards.find((card) => card.id === weakOld.id)!;
    expect(storedSafe.status).toBe("active");
    expect(storedProtected.status).toBe("candidate");
    expect(storedWeak.status).toBe("superseded");
    expect(storedWeak.lifecycle.supersededBy).toBe(safe.id);

    config.learning.mode = "auto-stage";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const stagedStore = await writeLearnV2ConceptStore(root, [{ ...safe, id: `${safe.id}_stage`, status: "candidate" as const, lifecycle: { ...safe.lifecycle, supersededBy: undefined } }], new Date("2026-06-30T00:02:00Z"));
    expect(stagedStore.cards.find((card) => card.id === `${safe.id}_stage`)?.status).toBe("staged");
  });

  it("bulk accept-low-risk only activates narrow safe concepts", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_bulk_policy");
    const evidence = normalizeLearnV2Evidence(
      { adapterId: "codex", sourcePath: "a", contentKind: "transcript", rawText: "", detectedFormat: "plain" },
      record,
      "user: Prefer focused parser tests for packages/core/src/parser.ts."
    ).map((item) => ({ ...item, paths: ["packages/core/src/parser.ts"] }));
    const [base] = mergeLearnV2ConceptCards(extractLearnV2BehaviorAtoms(reconstructLearnV2Episodes(evidence)).atoms, new Date("2026-06-30T00:00:00Z"));
    const narrowSafe = {
      ...base!,
      id: `${base!.id}_bulk_narrow`,
      status: "candidate" as const,
      risk: "low" as const,
      confidence: 0.84,
      sourceReliability: 0.91,
      scope: { ...base!.scope, level: "path" as const, paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] },
      atoms: base!.atoms.map((atom) => ({ ...atom, risk: "low" as const, confidence: 0.84, sourceReliability: 0.91, scope: { ...atom.scope, paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] } }))
    };
    const broadUnsafe = {
      ...narrowSafe,
      id: `${base!.id}_bulk_broad`,
      scope: { ...narrowSafe.scope, level: "project" as const, paths: [], taskTypes: [] },
      activation: { ...narrowSafe.activation, pathGlobs: [] },
      atoms: narrowSafe.atoms.map((atom) => ({ ...atom, id: `${atom.id}_broad`, scope: { ...atom.scope, level: "project" as const, paths: [], taskTypes: [] } }))
    };
    await writeLearnV2ConceptStore(root, [narrowSafe, broadUnsafe], new Date("2026-06-30T00:01:00Z"));
    const reviewed = await applyLearnV2ConceptReview(root, {
      bulkSafe: "accept-low-risk",
      now: new Date("2026-06-30T00:02:00Z")
    });

    expect(reviewed.store.cards.find((card) => card.id === narrowSafe.id)?.status).toBe("active");
    expect(reviewed.store.cards.find((card) => card.id === broadUnsafe.id)?.status).toBe("candidate");
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "osk-learn-v2-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "learn-v2-project" }), "utf8");
  await initAdaptiveProject({ projectRoot: root, now: new Date("2026-06-30T00:00:00.000Z") });
  return root;
}

function previewRecord(root: string, id: string): LearnV2RawEvidenceRecord {
  return {
    schemaVersion: "openskill-kit.learn-v2.raw-evidence-record.v1",
    id,
    projectId: "project",
    source: {
      adapterId: "test",
      uri: `file://${root}`,
      path: "[PROJECT_ROOT]/session.txt",
      pathHash: "sha256:path",
      contentHash: `sha256:${id}`
    },
    capturedAt: "2026-06-30T00:00:00.000Z",
    content: {
      kind: "transcript",
      encoding: "utf8",
      byteCount: 1,
      lineCount: 1,
      blobRef: "preview",
      blobHash: `sha256:${id}`
    },
    retention: {
      tier: "hot-spool",
      pinnedBy: [],
      expiresAt: "2026-07-14T00:00:00.000Z"
    },
    privacy: {
      rawLocalOnly: true,
      declassified: false,
      redactionMatches: [],
      placeholders: []
    },
    relevance: {
      score: 1,
      decision: "accept",
      reasons: ["test"],
      matchedPaths: [],
      matchedRemotes: []
    },
    trace: {
      sessionIds: []
    }
  };
}

function normalizedFileChange(id: string, text: string) {
  return {
    schemaVersion: "openskill-kit.learn-v2.normalized-evidence.v1" as const,
    id,
    rawRef: `raw_${id}`,
    sourceHash: `sha256:${id}`,
    kind: "file-change" as const,
    actor: "assistant" as const,
    text,
    status: "unknown" as const,
    paths: [],
    commands: [],
    metadata: {}
  };
}

function normalizedMessage(id: string, text: string, actor: "user" | "assistant" | "reviewer" = "user") {
  return {
    schemaVersion: "openskill-kit.learn-v2.normalized-evidence.v1" as const,
    id,
    rawRef: `raw_${id}`,
    sourceHash: `sha256:${id}`,
    kind: "message" as const,
    actor,
    text,
    status: "unknown" as const,
    paths: [],
    commands: [],
    metadata: {}
  };
}

function behaviorAtom(id: string, statement: string, polarity: LearnV2BehaviorAtom["polarity"]): LearnV2BehaviorAtom {
  return {
    schemaVersion: "openskill-kit.learn-v2.behavior-atom.v1",
    id,
    kind: "verification",
    statement,
    polarity,
    scope: {
      level: "path",
      paths: ["packages/core/src/parser.ts"],
      taskTypes: ["parser-change"]
    },
    confidence: 0.82,
    confidenceCap: 0.9,
    sourceReliability: 0.8,
    evidenceIds: [`ev_${id}`],
    rawRefs: [`raw_${id}`],
    rationale: "test fixture atom",
    risk: "medium"
  };
}

function episodeWithCommand(id: string, command: string, status: "pass" | "fail", taskHints: string[] = []): LearnV2TaskEpisode {
  return {
    schemaVersion: "openskill-kit.learn-v2.task-episode.v1",
    id: `episode_${id}`,
    traceIds: [],
    sessionIds: [`session_${id}`],
    evidenceIds: [`ev_cmd_${id}`],
    rawRefs: [`raw_cmd_${id}`],
    pathCluster: ["packages/core/src/parser.ts"],
    taskHints,
    outcome: status === "pass" ? "passed" : "failed",
    episodeConfidence: 0.84,
    episodeConfidenceBreakdown: {
      schemaVersion: "openskill-kit.learn-v2.episode-confidence.v1",
      score: 0.84,
      linkage: {
        traceId: 0,
        sessionId: 0.7,
        branch: 0,
        pathCluster: 0.8,
        semanticTaskSimilarity: 0.8,
        timeWindow: 0.7,
        outcomeLink: 0.8
      },
      risks: [],
      reasons: ["test fixture"]
    },
    stitching: {
      method: "session",
      reasons: ["test fixture"]
    },
    phases: [],
    messages: [],
    toolSummaries: [{
      id: `tool_${id}`,
      evidenceId: `ev_cmd_${id}`,
      toolName: "shell",
      status,
      command,
      commandShape: {
        rendered: command,
        base: command.split(/\s+/)[0] ?? command,
        argsShape: [],
        riskFlags: /\bdeploy\b|--force/.test(command) ? ["destructive-shape"] : []
      },
      paths: ["packages/core/src/parser.ts"],
      summary: `${status}: ${command}`,
      omittedBytes: 0,
      outputCompression: {
        strategy: "status-only",
        summary: `${status}: ${command}`,
        omittedBytes: 0,
        signatures: []
      }
    }],
    patchComparisons: [],
    tokenBudget: {
      inputChars: command.length,
      compressedChars: command.length,
      compressionRatio: 1
    }
  };
}

async function readText(file: string): Promise<string> {
  return await import("node:fs/promises").then((fs) => fs.readFile(file, "utf8"));
}
