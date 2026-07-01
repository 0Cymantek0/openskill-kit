import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  initAdaptiveProject,
  exportProjectBehaviorPack,
  verifyProjectBehaviorPack,
  compileLearnV2ConceptPreview,
  LEARN_V2_GENERATED_DIRS,
  LEARN_V2_GENERATED_FILES,
  getCleanedLearnV2Paths
} from "../src/index.js";

describe("Learn v2 hygiene + export boundary hardening", () => {
  it("proves all central Learn v2 paths are present in gitignore", async () => {
    const root = await tempProject();

    const gitignorePath = path.join(root, ".openskill-kit", ".gitignore");
    const gitignoreContent = await readFile(gitignorePath, "utf8");
    const lines = gitignoreContent.split("\n").map((line) => line.trim()).filter(Boolean);

    const { dirs, files } = getCleanedLearnV2Paths();

    for (const dir of dirs) {
      const rel = dir.replace(/^\.openskill-kit\//, "");
      const expected = rel.endsWith("/") ? rel : `${rel}/`;
      expect(lines).toContain(expected);
    }

    for (const file of files) {
      const rel = file.replace(/^\.openskill-kit\//, "");
      expect(lines).toContain(rel);
    }
  });

  it("proves pack/export excludes private Learn v2 directories", async () => {
    const root = await tempProject();

    // Simulate private Learn v2 artifacts being created
    const privatePaths = [
      "learn-v2/raw-vault/records/raw_12345678.json",
      "learn-v2/declassified-snippets/snippet.json",
      "learn-v2/evidence-quality/quality.json",
      "learn-v2/conflicts/ledger.json",
      "learn-v2/drift/drift.json",
      "learn-v2/observability/obs.json",
      "learn-v2/activation-index.json"
    ];

    for (const rel of privatePaths) {
      const fullPath = path.join(root, ".openskill-kit", rel);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, JSON.stringify({ data: "private" }), "utf8");
    }

    const pack = await exportProjectBehaviorPack(root);
    expect(pack.files.length).toBeGreaterThan(0);

    for (const rel of privatePaths) {
      const blockedPattern = `.openskill-kit/${rel}`;
      expect(pack.files.some((file) => file.includes(blockedPattern))).toBe(false);
    }

    const verified = await verifyProjectBehaviorPack(pack.packPath);
    expect(verified.status).toBe("pass");
  });

  it("proves adding a new generated Learn v2 path without updating paths.ts fails the test", async () => {
    // Scan learn-v2 source files for hardcoded paths matching learn-v2 subdirectories
    const learnV2SrcDir = path.resolve("packages/core/src/learn-v2");
    const files = await fs.readdir(learnV2SrcDir);
    const discoveredPaths = new Set<string>();

    const pathRegex = /(?:\.openskill-kit\/learn-v2\/|["']\.openskill-kit["'],\s*["']learn-v2["'],\s*["'])([A-Za-z0-9._-]+)/g;

    for (const file of files) {
      if (!file.endsWith(".ts")) continue;
      const content = await readFile(path.join(learnV2SrcDir, file), "utf8");
      let match;
      while ((match = pathRegex.exec(content)) !== null) {
        discoveredPaths.add(match[1]);
      }
    }

    // Map central paths to their sub-paths
    const { dirs, files: centralFiles } = getCleanedLearnV2Paths();
    const centralSubPaths = new Set<string>();
    
    for (const dir of dirs) {
      const rel = dir.replace(/^\.openskill-kit\/learn-v2\//, "");
      if (rel && !rel.startsWith(".openskill-kit")) {
        centralSubPaths.add(rel.split("/")[0]);
      }
    }
    for (const file of centralFiles) {
      const rel = file.replace(/^\.openskill-kit\/learn-v2\//, "");
      if (rel && !rel.startsWith(".openskill-kit")) {
        centralSubPaths.add(rel);
      }
    }

    // Every discovered subdirectory/file must be accounted for in central paths
    for (const pathName of discoveredPaths) {
      // Skip generic files/locks that aren't specific to learn-v2 subdirectories
      if (pathName === ".concepts.lock" || pathName === "store.json") continue;
      expect(centralSubPaths.has(pathName)).toBe(true);
    }
  });

  it("proves compile preview fails declassification if leak checks trigger", async () => {
    const root = await tempProject();
    const config = (await initAdaptiveProject({ projectRoot: root })).config;

    const createBadCard = (id: string, statement: string) => ({
      schemaVersion: "openskill-kit.learn-v2.concept-card.v1" as const,
      id,
      title: "Bad Concept",
      canonicalBehavior: statement,
      behaviorDelta: "Change code.",
      status: "active" as const,
      scope: { level: "project" as const, paths: [], taskTypes: [], negativeTriggers: [] },
      activation: { phrases: [], pathGlobs: [], commands: [] },
      confidence: 1,
      durability: 1,
      sourceReliability: 1,
      evidenceIds: ["ev_123"],
      rawRefs: ["raw_123"],
      atoms: [{
        schemaVersion: "openskill-kit.behavior-atom.v1" as const,
        id: "atom_123",
        projectId: "proj_123",
        kind: "preference" as const,
        statement,
        polarity: "positive" as const,
        modality: "must" as const,
        conditions: [],
        scope: { level: "project" as const, paths: [], subsystems: [], taskTypes: [] },
        evidenceRefs: [{ evidenceId: "ev_123", role: "inferred-pattern" as const, weight: 1 }],
        counterEvidenceRefs: [],
        extraction: { method: "deterministic" as const, extractorId: "test" },
        scores: { confidence: 1, agreement: 1, counterevidencePenalty: 0, correctionWeight: 0, outcomeStrength: 1, agreementWeight: 1, contradictionWeight: 0, recencyWeight: 1 }
      }],
      counterevidence: [],
      privacy: { outputClass: "shareable" as const, declassificationRequired: true as const, rawRefsExportable: false as const, placeholders: [] },
      lifecycle: { createdAt: "2026-06-30T00:00:00.000Z", updatedAt: "2026-06-30T00:00:00.000Z", supersedes: [] }
    });

    const leakCases = [
      { stmt: "Use raw_abcdef12 ref", issue: "raw-ref-like-token-in-output" },
      { stmt: "Read from C:\\Users\\john\\dev", issue: "absolute-user-path-in-output" },
      { stmt: "Save to /home/bob/file", issue: "absolute-user-path-in-output" },
      { stmt: "Token npm_12345678901234567890", issue: "secret-like-token-in-output" },
      { stmt: "Use .openskill-kit/learn-v2/raw-vault/ as state store", issue: "private-path-reference-in-output" }
    ];

    for (const testCase of leakCases) {
      const card = createBadCard(`card_${testCase.issue}`, testCase.stmt);
      const preview = await compileLearnV2ConceptPreview(root, config, [card], new Date());
      expect(preview.declassificationReport.status).toBe("fail");
      expect(preview.declassificationReport.issues).toContain(testCase.issue);
    }
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "osk-hygiene-test-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "hygiene-project" }), "utf8");
  await initAdaptiveProject({ projectRoot: root, now: new Date("2026-06-30T00:00:00.000Z") });
  return root;
}
