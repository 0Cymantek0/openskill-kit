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
  ensureLearnV2ModelRoutingArtifacts,
  compileBehaviorLayer,
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
      "learn-v2/activation-runs/2026-06.jsonl",
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

  it("proves pack verification fails if manifest includes a private Learn v2 path", async () => {
    const root = await tempProject();
    const pack = await exportProjectBehaviorPack(root);
    
    // Mutate manifest.json to include a private Learn v2 path
    const manifestPath = path.join(pack.packPath, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const badPath = ".openskill-kit/learn-v2/declassified-snippets/snippet.json";
    manifest.files.push(badPath);
    manifest.hashes[badPath] = "dummyhash";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    // Also write a dummy file into the extracted pack directory to pass hash check or exist check
    const extractedFilePath = path.join(pack.packPath, badPath);
    await fs.mkdir(path.dirname(extractedFilePath), { recursive: true });
    await writeFile(extractedFilePath, "dummy", "utf8");

    const verified = await verifyProjectBehaviorPack(pack.packPath);
    expect(verified.status).toBe("fail");
    expect(verified.issues.some((issue) => issue.includes("Private path included"))).toBe(true);
  });

  it("proves adding a new generated Learn v2 path without updating paths.ts fails the test", async () => {
    const scanDirs = [
      "packages/core/src/learn-v2",
      "packages/core/src/config",
      "packages/core/src/compiler",
      "packages/core/src/sync",
      "packages/core/src/lifecycle",
      "packages/mcp-server/src",
      "packages/cli/src"
    ];

    async function getTsFiles(dir: string): Promise<string[]> {
      const results: string[] = [];
      const list = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of list) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...(await getTsFiles(full)));
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
          results.push(full);
        }
      }
      return results;
    }

    const discoveredPaths = new Set<string>();
    const pathRegex = /(?:\.openskill-kit\/learn-v2\/|["']\.openskill-kit["'],\s*["']learn-v2["'],\s*["']|(?:\.openskill-kit\/model-routing\/))([A-Za-z0-9._-]+)/g;

    for (const scanDir of scanDirs) {
      const dirPath = path.resolve(scanDir);
      const tsFiles = await getTsFiles(dirPath);
      for (const file of tsFiles) {
        const content = await readFile(file, "utf8");
        let match;
        while ((match = pathRegex.exec(content)) !== null) {
          discoveredPaths.add(match[1]);
        }
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
      const topRel = dir.replace(/^\.openskill-kit\//, "");
      if (topRel) {
        centralSubPaths.add(topRel.split("/")[0]);
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
      // Skip generic files/locks/agents that aren't specific to learn-v2 subdirectories
      if (pathName === ".concepts.lock" || pathName === "store.json" || pathName === "opencode-agents") continue;
      expect(centralSubPaths.has(pathName)).toBe(true);
    }

    expect(centralSubPaths.has("model-routing")).toBe(true);
  });

  it("proves compile preview fails declassification if leak checks trigger", async () => {
    const root = await tempProject();
    const config = (await initAdaptiveProject({ projectRoot: root })).config;

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

  it("scans compiled preference and workflow node fields for declassification leaks", async () => {
    const root = await tempProject();
    const config = (await initAdaptiveProject({ projectRoot: root })).config;
    const card = createBadCard("scope_path_leak", "Prefer focused parser regressions before parser rewrites.");
    card.atoms[0]!.kind = "workflow";
    card.scope.paths = ["C:\\Users\\john\\private\\parser.ts"];
    card.atoms[0]!.scope.paths = ["C:\\Users\\john\\private\\parser.ts"];

    const preview = await compileLearnV2ConceptPreview(root, config, [card], new Date());

    expect(preview.preferenceNodes[0]?.scope.paths).toContain("C:\\Users\\john\\private\\parser.ts");
    expect(preview.workflowNodes[0]?.trigger.paths).toContain("C:\\Users\\john\\private\\parser.ts");
    expect(preview.declassificationReport.status).toBe("fail");
    expect(preview.declassificationReport.issues).toContain("absolute-user-path-in-output");
  });

  it("proves dot-lock file patterns are present in gitignore", async () => {
    const root = await tempProject();
    const gitignorePath = path.join(root, ".openskill-kit", ".gitignore");
    const gitignoreContent = await readFile(gitignorePath, "utf8");
    const lines = gitignoreContent.split("\n").map((line) => line.trim()).filter(Boolean);

    expect(lines).toContain(".*.lock");
    expect(lines).toContain("**/.lock");
    expect(lines).toContain("**/*.lock");
  });

  it("proves pack verification and export reject lock files", async () => {
    const root = await tempProject();

    const lockPath = path.join(root, ".openskill-kit", "learn-v2", ".concepts.lock");
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "lock", "utf8");

    const pack = await exportProjectBehaviorPack(root);
    expect(pack.files.some((f) => f.endsWith(".lock"))).toBe(false);

    const manifestPath = path.join(pack.packPath, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files.push(".openskill-kit/learn-v2/.concepts.lock");
    manifest.hashes[".openskill-kit/learn-v2/.concepts.lock"] = "dummyhash";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const extractedLockPath = path.join(pack.packPath, ".openskill-kit", "learn-v2", ".concepts.lock");
    await fs.mkdir(path.dirname(extractedLockPath), { recursive: true });
    await writeFile(extractedLockPath, "lock", "utf8");

    const verified = await verifyProjectBehaviorPack(pack.packPath);
    expect(verified.status).toBe("fail");
    expect(verified.issues.some((issue) => issue.includes("Lock file included"))).toBe(true);
  });

  it("proves model-routing generated artifacts do not leak absolute local paths and are ignored", async () => {
    const root = await tempProject();
    
    const artifact = await ensureLearnV2ModelRoutingArtifacts(root);

    const oskRoutingFile = path.join(root, ".openskill-kit", "model-routing", "osk-model-routing.json");
    const oskRoutingContent = await readFile(oskRoutingFile, "utf8");
    
    expect(oskRoutingContent).not.toContain(root.replace(/\\/g, "/"));
    expect(oskRoutingContent).not.toContain(root);

    const gitignorePath = path.join(root, ".openskill-kit", ".gitignore");
    const gitignoreContent = await readFile(gitignorePath, "utf8");
    const lines = gitignoreContent.split("\n").map((line) => line.trim()).filter(Boolean);
    expect(lines).toContain("model-routing/");
  });

  it("proves compileBehaviorLayer fails compilation if active concepts contain declassification leaks", async () => {
    const root = await tempProject();
    
    // Create a card with a leak (e.g. absolute user path)
    const badCard = createBadCard("leak_card", "Read from C:\\Users\\john\\dev");

    // Write to store.json
    const storePath = path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json");
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.concept-store.v1",
      cards: [badCard]
    }, null, 2), "utf8");

    // Expect compileBehaviorLayer to fail
    await expect(compileBehaviorLayer(root, { targets: ["mcp-resources"] }))
      .rejects.toThrow(/Compile-time declassification checks failed/);
  });

  it("blocks Learn v2 leaks before writing project-rules policy artifacts", async () => {
    const root = await tempProject();
    const badCard = createBadCard("policy_scope_leak", "Prefer focused parser regression tests.");
    badCard.atoms[0]!.kind = "command-policy";
    badCard.activation.commands = ["npm test -- parser"];
    badCard.scope.paths = ["C:\\Users\\john\\private\\parser.ts"];
    badCard.atoms[0]!.scope.paths = ["C:\\Users\\john\\private\\parser.ts"];

    const storePath = path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json");
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.concept-store.v1",
      projectId: "hygiene-project",
      updatedAt: "2026-06-30T00:00:00.000Z",
      cards: [badCard]
    }, null, 2), "utf8");

    await expect(compileBehaviorLayer(root, { targets: ["project-rules"] }))
      .rejects.toThrow(/Learn v2 policy artifacts/);
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "osk-hygiene-test-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "hygiene-project" }), "utf8");
  await initAdaptiveProject({ projectRoot: root, now: new Date("2026-06-30T00:00:00.000Z") });
  return root;
}

function createBadCard(id: string, statement: string) {
  return {
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
    risk: "medium" as const,
    evidenceIds: ["ev_123"],
    rawRefs: ["raw_123"],
    atoms: [{
      schemaVersion: "openskill-kit.learn-v2.behavior-atom.v1" as const,
      id: "atom_123",
      kind: "preference" as const,
      statement,
      polarity: "positive" as const,
      scope: { level: "project" as const, paths: [], taskTypes: [] },
      confidence: 1,
      confidenceCap: 1,
      sourceReliability: 1,
      evidenceIds: ["ev_123"],
      rawRefs: ["raw_123"],
      rationale: "some rationale",
      risk: "medium" as const
    }],
    counterevidence: [],
    privacy: { outputClass: "shareable" as const, declassificationRequired: true as const, rawRefsExportable: false as const, placeholders: [] },
    lifecycle: { createdAt: "2026-06-30T00:00:00.000Z", updatedAt: "2026-06-30T00:00:00.000Z", supersedes: [] }
  };
}
