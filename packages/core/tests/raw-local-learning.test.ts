import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  exportProjectBehaviorPack,
  initAdaptiveProject,
  mergeLearnV2ConceptCards,
  readEvents,
  runRawLocalLearning,
  writeLearnV2ConceptStore,
  verifyProjectBehaviorPack
} from "../src/index.js";

describe("raw local learning", () => {
  it("mines deidentified raw conversations into local concept cards", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "codex-transcript.jsonl");
    const projectPath = path.join(root, "packages/core/src/parser.ts");
    await writeFile(transcript, [
      JSON.stringify({
        role: "user",
        content: `In ${projectPath}, do not rewrite the whole parser. Prefer a focused regression fixture first. API_KEY=sk-live-secret`,
        timestamp: "2026-06-30T01:00:00.000Z"
      }),
      JSON.stringify({
        role: "assistant",
        content: "I rewrote broad parser structure and skipped the fixture.",
        timestamp: "2026-06-30T01:01:00.000Z"
      }),
      JSON.stringify({
        role: "user",
        content: "Wrong approach. Avoid broad rewrite. Use npm test -- parser before final summary.",
        timestamp: "2026-06-30T01:02:00.000Z"
      })
    ].join("\n"), "utf8");

    const preview = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: true,
      now: new Date("2026-06-30T01:10:00.000Z")
    });
    expect(preview.digest.sourcesIncluded).toBe(1);
    expect(preview.digest.rawVaultRecordsWritten).toBe(0);
    expect(preview.digest.previewWritesLocalArtifacts).toBe(true);
    expect(preview.digest.canonicalConceptStateWritten).toBe(false);
    expect(preview.digest.learningInputBoundary).toBe("raw-local-in-memory-declassified-artifacts");
    expect(preview.digest.currentRunConceptCards).toBe(preview.digest.conceptCards);
    expect(preview.digest.mergedConceptCards).toBe(preview.learnV2.concepts.length);
    expect(preview.digest.topLevelConceptsScope).toBe("current-run-legacy-projection");
    expect(preview.learnV2.learningInputBoundary).toBe("raw-local-in-memory-declassified-artifacts");
    expect(preview.learnV2.currentRunConcepts).toHaveLength(preview.digest.currentRunConceptCards);
    expect(preview.learnV2.conceptCounts).toEqual({
      currentRun: preview.digest.currentRunConceptCards,
      mergedForArtifacts: preview.digest.mergedConceptCards
    });
    expect(preview.sources[0]!.learnV2.adapterId).toMatch(/^(opencode|codex)$/);
    expect(preview.sources[0]!.learnV2.adapterLabel).toMatch(/OpenCode|Codex/);
    expect(preview.sources[0]!.learnV2.surfacePolicy).toMatchObject({
      selection: "explicit-only",
      read: "raw-local-file",
      learnerInput: "raw-local-in-memory",
      persistence: "preview-artifacts-or-apply-vault",
      modelBoundary: "declassified-only",
      rawRefsExportable: false,
      sensitivity: "high"
    });
    expect(preview.artifacts.learnV2ConceptStorePath).toContain("compiled-preview");
    await expect(stat(path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json"))).rejects.toThrow();
    await expect(stat(path.join(root, ".openskill-kit", "learn-v2", "activation-index.json"))).rejects.toThrow();
    expect(preview.digest.learningWindows).toBeGreaterThanOrEqual(1);
    expect(preview.quality.overallScore).toBeGreaterThan(0.6);
    expect(preview.quality.strengths.join(" ")).toContain("reviewable concept");
    expect(preview.concepts.some((concept) => /regression fixture|broad rewrite/i.test(concept.canonicalBehavior))).toBe(true);
    expect(await readFile(preview.artifacts.reviewMarkdownPath, "utf8")).not.toContain("sk-live-secret");
    expect(await readFile(preview.artifacts.reviewMarkdownPath, "utf8")).toContain("Learning input boundary: raw-local-in-memory-declassified-artifacts");
    const evidenceQuality = await readFile(preview.artifacts.learnV2EvidenceQualityPath!, "utf8");
    expect(evidenceQuality).toContain("openskill-kit.learn-v2.evidence-quality-artifact.v1");
    expect(evidenceQuality).toContain("\"dropsEvidence\": false");
    expect(evidenceQuality).not.toContain(root);
    expect(evidenceQuality).not.toContain("sk-live-secret");
    const conflictLedger = await readFile(preview.artifacts.learnV2ConflictLedgerPath!, "utf8");
    expect(conflictLedger).toContain("Learn v2 Conflict Ledger");
    expect(conflictLedger).not.toContain("sk-live-secret");
    const snippetArtifact = await readFile(preview.artifacts.learnV2DeclassifiedSnippetsPath!, "utf8");
    expect(snippetArtifact).toContain("Learn v2 Declassified Evidence Snippets");
    expect(snippetArtifact).toContain("[PROJECT_ROOT]");
    expect(snippetArtifact).not.toContain(root);
    expect(snippetArtifact).not.toContain("sk-live-secret");
    const reviewQueue = await readFile(preview.artifacts.learnV2ReviewQueuePath, "utf8");
    expect(reviewQueue).toContain("Evidence Snippet Summary");
    expect(reviewQueue).toContain("Evidence snippets:");
    expect(reviewQueue).toContain("Drift Summary");
    expect(reviewQueue).not.toContain("sk-live-secret");
    const conceptDrift = await readFile(preview.artifacts.learnV2ConceptDriftPath!, "utf8");
    expect(conceptDrift).toContain("openskill-kit.learn-v2.concept-drift.v1");
    expect(conceptDrift).not.toContain(root);
    expect(conceptDrift).not.toContain("sk-live-secret");
    const previewObservability = await readFile(preview.artifacts.learnV2ObservabilityReportPath, "utf8");
    expect(previewObservability).toContain("openskill-kit.learn-v2.pipeline-observability.v1");
    expect(previewObservability).toContain("\"episodes\"");
    expect(previewObservability).toContain("\"declassifiedSnippets\"");
    expect(previewObservability).toContain("\"driftHealthScore\"");
    expect(previewObservability).toContain("\"qualityTierCounts\"");
    expect(previewObservability).toContain("\"rawRefsExported\": false");
    expect(previewObservability).not.toContain(root);
    expect(previewObservability).not.toContain("sk-live-secret");
    expect(await readFile(preview.artifacts.reviewMarkdownPath, "utf8")).toContain("Preview writes local generated artifacts: true");

    const applied = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: false,
      adapter: "codex",
      allowDuplicateImports: true,
      now: new Date("2026-06-30T01:11:00.000Z")
    });
    expect(applied.digest.rawVaultRecordsWritten).toBe(1);
    expect(applied.digest.eventsAppended).toBeGreaterThan(0);
    expect(applied.quality.propagationSafetyScore).toBe(1);
    const rawVault = await readFile(applied.sources[0]!.rawVaultRecordPath!, "utf8");
    expect(rawVault).toContain("[PROJECT_ROOT]");
    expect(rawVault).toContain("API_KEY=[REDACTED:secret-assignment]");
    expect(rawVault).not.toContain(root);
    expect(rawVault).not.toContain("sk-live-secret");
    const v2RawRecord = JSON.parse(await readFile(path.join(applied.artifacts.learnV2RawVaultDir, "records", `${applied.sources[0]!.learnV2.rawRef}.json`), "utf8"));
    const v2RawBlob = await readFile(path.join(applied.artifacts.learnV2RawVaultDir, v2RawRecord.content.blobRef), "utf8");
    expect(v2RawBlob).toContain(root.replace(/\\/g, "\\\\"));
    expect(v2RawBlob).toContain("sk-live-secret");
    const analysisFrame = await readFile(applied.sources[0]!.analysisFramePath, "utf8");
    expect(analysisFrame).not.toContain(root);
    expect(analysisFrame).not.toContain("sk-live-secret");
    expect(analysisFrame).toContain("\"surfaceAdapter\"");
    expect(analysisFrame).toContain("\"modelBoundary\": \"declassified-only\"");
    const episodeStore = await readFile(applied.artifacts.learnV2EpisodeStorePath, "utf8");
    expect(episodeStore).not.toContain(root);
    expect(episodeStore).not.toContain("sk-live-secret");
    expect(JSON.stringify(applied.learnV2.episodes)).not.toContain(root);
    expect(JSON.stringify(applied.learnV2.episodes)).not.toContain("sk-live-secret");
    expect(JSON.stringify(applied.learnV2.concepts)).not.toContain(root);
    expect(JSON.stringify(applied.learnV2.concepts)).not.toContain("sk-live-secret");
    const requestDirs = await readdir(applied.artifacts.learnV2ModelRequestDir, { withFileTypes: true }).catch(() => []);
    for (const entry of requestDirs.filter((item) => item.isDirectory())) {
      const requestDir = path.join(applied.artifacts.learnV2ModelRequestDir, entry.name);
      for (const file of ["episode-learning-bundle.json", "concept-extraction-prompt.md"]) {
        const requestText = await readFile(path.join(requestDir, file), "utf8");
        expect(requestText).not.toContain(root);
        expect(requestText).not.toContain("sk-live-secret");
      }
    }
    const events = await readEvents(root);
    expect(JSON.stringify(events)).not.toContain(root);
    expect(JSON.stringify(events)).not.toContain("sk-live-secret");
  });

  it("keeps raw preview isolated even when auto-apply-safe is configured", async () => {
    const root = await tempProject();
    const configPath = path.join(root, ".openskill-kit", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.learning.mode = "auto-apply-safe";
    config.learning.minConfidenceToApply = 0.7;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const transcript = path.join(root, "session.md");
    await writeFile(transcript, `user: ${root} prefer focused parser tests in packages/core/src/parser.ts.`, "utf8");

    const preview = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: true,
      now: new Date("2026-06-30T01:20:00.000Z")
    });

    expect(preview.previewOnly).toBe(true);
    expect(preview.digest.rawVaultRecordsWritten).toBe(0);
    expect(preview.digest.previewWritesLocalArtifacts).toBe(true);
    expect(preview.digest.canonicalConceptStateWritten).toBe(false);
    expect(preview.artifacts.learnV2ConceptStorePath).toContain("compiled-preview");
    await expect(stat(path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json"))).rejects.toThrow();
    await expect(stat(path.join(root, ".openskill-kit", "learn-v2", "activation-index.json"))).rejects.toThrow();
  });

  it("uses virtual merged preview state without mutating existing canonical store or activation index", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T01:30:00.000Z");
    const [existing] = mergeLearnV2ConceptCards([{
      schemaVersion: "openskill-kit.learn-v2.behavior-atom.v1",
      id: "atom_existing_parser_tests",
      kind: "workflow",
      statement: "Prefer focused parser tests for parser changes.",
      polarity: "positive",
      scope: {
        level: "path",
        paths: ["packages/core/src/parser.ts"],
        taskTypes: ["parser-change"]
      },
      confidence: 0.86,
      confidenceCap: 0.9,
      sourceReliability: 0.82,
      evidenceIds: ["ev_existing_parser_tests"],
      rawRefs: ["raw_existing_parser_tests"],
      rationale: "Explicit preference or correction language in episode.",
      risk: "medium"
    }], now);
    await writeLearnV2ConceptStore(root, [{ ...existing!, status: "active" }], now);
    const storePath = path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json");
    const activationPath = path.join(root, ".openskill-kit", "learn-v2", "activation-index.json");
    const storeBefore = await readFile(storePath, "utf8");
    const activationBefore = await readFile(activationPath, "utf8");
    const transcript = path.join(root, "preview-session.md");
    await writeFile(transcript, [
      `user: ${root} Avoid focused parser tests for packages/core/src/parser.ts parser changes.`,
      "assistant: ok"
    ].join("\n"), "utf8");

    const preview = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: true,
      now: new Date("2026-06-30T01:31:00.000Z")
    });

    expect(await readFile(storePath, "utf8")).toBe(storeBefore);
    expect(await readFile(activationPath, "utf8")).toBe(activationBefore);
    expect(preview.artifacts.learnV2ConceptStorePath).toContain("compiled-preview");
    expect(preview.learnV2.concepts.some((card) => card.id === existing!.id)).toBe(true);
    expect(preview.digest.mergedConceptCards).toBeGreaterThan(preview.digest.currentRunConceptCards);
    expect(preview.learnV2.conceptCounts).toEqual({
      currentRun: preview.digest.currentRunConceptCards,
      mergedForArtifacts: preview.digest.mergedConceptCards
    });
    expect(preview.concepts).toHaveLength(preview.digest.currentRunConceptCards);
    const conflictLedger = await readFile(preview.artifacts.learnV2ConflictLedgerPath, "utf8");
    expect(conflictLedger).toContain(existing!.id);
    expect(conflictLedger).toContain("Unresolved: 1");
  });

  it("keeps raw learning vault and prompt frames out of behavior packs", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "session.md");
    await writeFile(transcript, [
      `user: ${root} always list exact verification commands in final summaries.`,
      "assistant: done"
    ].join("\n"), "utf8");
    await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: false,
      allowDuplicateImports: true,
      now: new Date("2026-06-30T02:00:00.000Z")
    });

    const pack = await exportProjectBehaviorPack(root);
    expect(pack.files.every((file) => !file.startsWith(".openskill-kit/raw-vault/"))).toBe(true);
    expect(pack.files.every((file) => !file.startsWith(".openskill-kit/learning/analysis-frames/"))).toBe(true);
    const manifest = await readFile(pack.manifestPath, "utf8");
    expect(manifest).toContain("raw learning vault records");
    const verified = await verifyProjectBehaviorPack(pack.packPath);
    expect(verified.status).toBe("pass");
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "osk-raw-learning-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "raw-learning-project" }), "utf8");
  await initAdaptiveProject({ projectRoot: root, now: new Date("2026-06-30T00:00:00.000Z") });
  return root;
}
