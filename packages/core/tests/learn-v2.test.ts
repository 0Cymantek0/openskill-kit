import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
  buildLearnV2EpisodeLearningBundle,
  renderLearnV2ConceptExtractionPrompt,
  parseLearnV2LlmConceptExtractionOutput,
  validateLearnV2LlmConceptExtractionOutput,
  ensureLearnV2ModelRoutingArtifacts,
  applyLearnV2ModelProposalOutputs,
  recordLearnV2ConceptOutcome,
  readLearnV2ConceptStore,
  writeLearnV2ConceptStore,
  reconstructPersistedLearnV2Episodes,
  extractPersistedLearnV2Concepts,
  runPersistedLearnV2Eval,
  readPreferenceGraph,
  readLearnV2Surface,
  reconstructLearnV2Episodes,
  runRawLocalLearning,
  runLearnV2RawVaultMaintenance,
  writeLearnV2ModelRequests,
  runLearnV2Eval,
  scoreLearnV2ProjectRelevance,
  scoreLearnV2ActivationEntries,
  validateLearnV2LlmExtractionProposal,
  type LearnV2RawEvidenceRecord
} from "../src/index.js";

describe("learn-v2 substrate", () => {
  it("rejects unrelated global memory despite generic learning language", async () => {
    const root = await tempProject();
    const source = path.join(os.tmpdir(), "global-memory.txt");
    await writeFile(source, "global memory across repos: always use a personal deployment token", "utf8");
    const relevance = await scoreLearnV2ProjectRelevance(root, source, await import("node:fs/promises").then((fs) => fs.readFile(source, "utf8")));
    expect(relevance.decision).toBe("reject");
    expect(relevance.reasons).toContain("global-memory-risk");
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
    expect(concepts.some((concept) => /parser regression tests/i.test(concept.canonicalBehavior))).toBe(true);
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
    expect(prompt).toContain("OpenCode-configured model routing");
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
    expect(result.artifacts.learnV2EpisodeStorePath).toContain("episodes");
    expect(result.artifacts.learnV2ModelRequestDir).toContain("model-requests");
    expect(result.learnV2.modelRequestCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(result.concepts)).not.toContain(root);
    expect(result.learnV2).toBeTruthy();
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
    expect(requests.requestCount).toBe(learned.learnV2.episodes.length);
    const request = requests.requests[0]!;
    const prompt = await readText(request.promptPath);
    const bundle = await readText(request.bundlePath);
    const manifest = JSON.parse(await readText(request.manifestPath));
    expect(prompt).toContain("EpisodeLearningBundle");
    expect(prompt).not.toContain(root);
    expect(bundle).not.toContain("raw_");
    expect(manifest.schemaVersion).toBe("openskill-kit.learn-v2.model-request-manifest.v1");
    expect(manifest.episodeId).toBe(request.episodeId);
    expect(path.resolve(root, manifest.expectedOutputPath)).toBe(request.expectedOutputPath);
    expect(manifest.rawRefsIncluded).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain("raw_");
    expect(JSON.stringify(manifest)).not.toContain(root);

    const [evidenceId] = learned.learnV2.episodes[0]!.evidenceIds;
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
    expect(store.cards.some((card) => /parser regression tests/i.test(card.canonicalBehavior))).toBe(true);
    expect(JSON.stringify(store)).not.toContain("sk-12345678901234567890");
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
      "eval-planner"
    ]);
    const routeJson = await readText(artifact.artifacts.routingJson);
    expect(routeJson).toContain("deterministicFallback");
    expect(routeJson).not.toContain("ollama");
  });

  it("reports raw vault budget and compacts unpinned records during GC", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "low-relevance.txt");
    await writeFile(transcript, "unrelated temporary transcript with ghp_123456789012345678901234567890123456 and no project markers", "utf8");
    await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: false,
      allowDuplicateImports: true,
      now: new Date("2026-06-30T00:00:00Z")
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
    expect(stored.scoring?.penalties).toHaveLength(0);

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
      confidence: 0.91,
      sourceReliability: 0.91,
      scope: { ...base!.scope, level: "path" as const, paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] },
      atoms: base!.atoms.map((atom) => ({ ...atom, risk: "low" as const, confidence: 0.91, sourceReliability: 0.91, scope: { ...atom.scope, paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] } }))
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

async function readText(file: string): Promise<string> {
  return await import("node:fs/promises").then((fs) => fs.readFile(file, "utf8"));
}
