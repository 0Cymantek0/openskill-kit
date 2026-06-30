import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  compileLearnV2ConceptPreview,
  extractLearnV2BehaviorAtoms,
  applyLearnV2ConceptReview,
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
  readLearnV2ConceptStore,
  readPreferenceGraph,
  readLearnV2Surface,
  reconstructLearnV2Episodes,
  runRawLocalLearning,
  runLearnV2RawVaultMaintenance,
  runLearnV2Eval,
  scoreLearnV2ProjectRelevance,
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
    expect(report.results.some((result) => result.id === "golden:parser-regression" && result.status === "pass")).toBe(true);
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
    expect(JSON.stringify(result.concepts)).not.toContain(root);
    expect(result.learnV2).toBeTruthy();
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

  it("reports raw vault budget and expires unpinned records during GC", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "low-relevance.txt");
    await writeFile(transcript, "unrelated temporary transcript with no project markers but useful syntax", "utf8");
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
    expect(gc.expiredRecords).toBeGreaterThanOrEqual(1);
    expect(gc.removedBlobRefs.length).toBeGreaterThanOrEqual(1);
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
