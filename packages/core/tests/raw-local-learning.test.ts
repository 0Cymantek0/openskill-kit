import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  exportProjectBehaviorPack,
  initAdaptiveProject,
  readEvents,
  runRawLocalLearning,
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
    expect(preview.artifacts.learnV2ConceptStorePath).toContain("compiled-preview");
    await expect(stat(path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json"))).rejects.toThrow();
    await expect(stat(path.join(root, ".openskill-kit", "learn-v2", "activation-index.json"))).rejects.toThrow();
    expect(preview.digest.learningWindows).toBeGreaterThanOrEqual(1);
    expect(preview.quality.overallScore).toBeGreaterThan(0.6);
    expect(preview.quality.strengths.join(" ")).toContain("reviewable concept");
    expect(preview.concepts.some((concept) => /regression fixture|broad rewrite/i.test(concept.canonicalBehavior))).toBe(true);
    expect(await readFile(preview.artifacts.reviewMarkdownPath, "utf8")).not.toContain("sk-live-secret");
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
    const analysisFrame = await readFile(applied.sources[0]!.analysisFramePath, "utf8");
    expect(analysisFrame).not.toContain(root);
    expect(analysisFrame).not.toContain("sk-live-secret");
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
    expect(preview.artifacts.learnV2ConceptStorePath).toContain("compiled-preview");
    await expect(stat(path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json"))).rejects.toThrow();
    await expect(stat(path.join(root, ".openskill-kit", "learn-v2", "activation-index.json"))).rejects.toThrow();
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
