import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  appendEvent,
  applyPreferenceReview,
  compileBehaviorLayer,
  compileInstructionManifests,
  detectConflicts,
  extractSignals,
  getAdaptiveStatus,
  importProjectBehaviorPack,
  initAdaptiveProject,
  inspectProjectBehaviorPack,
  installInstructionManifests,
  migrateProjectConfig,
  redactValue,
  scoreConfidence,
  updatePreferenceGraph,
  verifyProjectBehaviorPack,
  type PreferenceGraph,
  type PreferenceNode
} from "../src/index.js";

describe("phase 1 hardening", () => {
  it("counts only active and locked preferences in status", async () => {
    const root = await tempProject();
    await writeJson(path.join(root, ".openskill-kit", "preferences", "graph.json"), graph([
      pref("active-one", "active"),
      pref("locked-one", "locked"),
      pref("candidate-one", "candidate"),
      pref("rejected-one", "rejected"),
      pref("conflict-one", "conflict")
    ]));
    const status = await getAdaptiveStatus(root);
    expect(status.activePreferenceCount).toBe(2);
  });

  it("blocks install when an existing managed instruction block is corrupted", async () => {
    const root = await tempProject();
    await writeJson(path.join(root, ".openskill-kit", "preferences", "graph.json"), graph([
      pref("active-managed", "active", "Prefer focused tests before final answer", "positive", "testing")
    ]));
    await compileInstructionManifests(root);
    const first = await installInstructionManifests(root, { yes: true, dryRun: false });
    expect(first.status).toBe("installed");
    const agentsPath = path.join(root, "AGENTS.md");
    const installed = await readFile(agentsPath, "utf8");
    await writeFile(agentsPath, installed.replace("Prefer focused tests", "Prefer skipped tests"), "utf8");

    const blocked = await installInstructionManifests(root, { yes: true, dryRun: false });
    expect(blocked.status).toBe("blocked");
    expect(blocked.messages.join("\n")).toContain("hash mismatch");
  });

  it("auto-stages safe preferences and keeps them out of active compiled behavior", async () => {
    const root = await tempProject();
    const configPath = path.join(root, ".openskill-kit", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    await writeJson(configPath, {
      ...config,
      learning: { ...config.learning, mode: "auto-stage", minConfidenceToApply: 0.35 }
    });
    await appendEvent(root, {
      sessionId: "auto-stage",
      eventType: "user-prompt-submit",
      source: { adapter: "test" },
      normalized: { text: "Always run focused regression tests before final answer." }
    });
    await extractSignals(root, new Date("2026-06-25T00:01:00.000Z"));
    const graph = await updatePreferenceGraph(root, new Date("2026-06-25T00:02:00.000Z"));
    const staged = graph.graph.nodes.find((node) => node.statement.includes("focused regression tests"));
    expect(staged?.status).toBe("staged");

    const compiled = await compileBehaviorLayer(root, { targets: ["context-pack"], includeStagedPreview: true });
    const context = await readFile(compiled.contextPackPath!, "utf8");
    expect(context).not.toContain("focused regression tests");
    expect(compiled.stagedPreviewPath).toBeTruthy();
    const preview = await readFile(compiled.stagedPreviewPath!, "utf8");
    expect(preview).toContain("focused regression tests");
  });

  it("applies review transitions without silently activating conflicts", async () => {
    const root = await tempProject();
    await writeJson(path.join(root, ".openskill-kit", "preferences", "graph.json"), graph([
      pref("candidate-one", "candidate"),
      pref("staged-one", "staged"),
      pref("conflict-one", "conflict"),
      pref("reject-one", "candidate"),
      pref("lock-one", "candidate")
    ]));

    const reviewed = await applyPreferenceReview(root, { activateAll: true, reject: ["pref_reject-one"], lock: ["pref_lock-one"] }, new Date("2026-06-25T00:00:00.000Z"));
    expect(reviewed.nodes.find((node) => node.id === "pref_candidate-one")?.status).toBe("active");
    expect(reviewed.nodes.find((node) => node.id === "pref_staged-one")?.status).toBe("active");
    expect(reviewed.nodes.find((node) => node.id === "pref_conflict-one")?.status).toBe("conflict");
    expect(reviewed.nodes.find((node) => node.id === "pref_reject-one")?.status).toBe("rejected");
    expect(reviewed.nodes.find((node) => node.id === "pref_lock-one")?.status).toBe("locked");
  });

  it("detects opposing overlapping preference conflicts", () => {
    const conflicts = detectConflicts([
      pref("prefer-tests", "candidate", "Prefer run focused tests before final answer", "positive", "testing"),
      pref("avoid-tests", "candidate", "Do not run focused tests before final answer", "negative", "testing")
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.nodeIds).toEqual(["pref_prefer-tests", "pref_avoid-tests"]);
  });

  it("scores confidence with positive, negative, and decayed evidence", () => {
    const score = scoreConfidence([
      {
        schemaVersion: "openskill-kit.signal.v1",
        id: "sig_positive",
        eventIds: ["evt_positive"],
        extractedAt: "2026-06-25T00:00:00.000Z",
        kind: "explicit-preference",
        category: "testing",
        scope: { level: "project", paths: [] },
        statement: "Prefer focused tests",
        polarity: "positive",
        weight: 0.8,
        evidence: [{ eventId: "evt_positive" }]
      },
      {
        schemaVersion: "openskill-kit.signal.v1",
        id: "sig_negative",
        eventIds: ["evt_negative"],
        extractedAt: "2026-03-27T00:00:00.000Z",
        kind: "rejection",
        category: "testing",
        scope: { level: "project", paths: [] },
        statement: "Prefer focused tests",
        polarity: "negative",
        weight: 0.8,
        evidence: [{ eventId: "evt_negative" }]
      }
    ], 90, new Date("2026-06-25T00:00:00.000Z"));
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(0.75);
  });

  it("fails pack verification for private paths, missing hashes, and tampering", async () => {
    const pack = await mkdtemp(path.join(os.tmpdir(), "osk-pack-bad-"));
    await mkdir(path.join(pack, ".openskill-kit", "events"), { recursive: true });
    await mkdir(path.join(pack, ".openskill-kit", "interactions", "import-runs"), { recursive: true });
    await writeFile(path.join(pack, ".openskill-kit", "events", "2026-06.jsonl"), "{}", "utf8");
    await writeFile(path.join(pack, ".openskill-kit", "interactions", "import-runs", "run.json"), "{}", "utf8");
    await writeJson(path.join(pack, "manifest.json"), {
      schemaVersion: "openskill-kit.project-pack.v1",
      privacy: { rawEventsIncluded: false, rawSignalsIncluded: false },
      files: [".openskill-kit/events/2026-06.jsonl", ".openskill-kit/interactions/import-runs/run.json", "missing-hash.txt"],
      hashes: { ".openskill-kit/events/2026-06.jsonl": "bad", ".openskill-kit/interactions/import-runs/run.json": await sha256(path.join(pack, ".openskill-kit", "interactions", "import-runs", "run.json")) }
    });
    const result = await verifyProjectBehaviorPack(pack);
    expect(result.status).toBe("fail");
    expect(result.issues).toContain("Private path included: .openskill-kit/events/");
    expect(result.issues).toContain("Private path included: .openskill-kit/interactions/");
    expect(result.issues).toContain("Hash mismatch for .openskill-kit/events/2026-06.jsonl");
    expect(result.issues).toContain("Missing hash for missing-hash.txt");
  });

  it("fails pack verification when allowed files contain publish-boundary leaks", async () => {
    const pack = await mkdtemp(path.join(os.tmpdir(), "osk-pack-leaky-"));
    const policy = path.join(pack, "policy.md");
    await writeFile(policy, [
      "# Policy",
      "Do not export raw_deadbeef references.",
      "Secret fixture API_KEY=sk-live-secret",
      "Path C:\\Users\\Alice\\project\\.openskill-kit\\learn-v2\\raw-vault\\records\\raw_deadbeef.json"
    ].join("\n"), "utf8");
    await writeJson(path.join(pack, "manifest.json"), {
      schemaVersion: "openskill-kit.project-pack.v1",
      privacy: { rawEventsIncluded: false, rawSignalsIncluded: false },
      files: ["policy.md"],
      hashes: {
        "policy.md": await sha256(policy)
      }
    });

    const result = await verifyProjectBehaviorPack(pack);
    expect(result.status).toBe("fail");
    expect(result.publishAudit.status).toBe("fail");
    expect(result.issues.some((issue) => issue.includes("Publish audit block: policy.md: raw-vault-ref"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("Publish audit block: policy.md: secret-assignment"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("Publish audit block: policy.md: absolute-user-path"))).toBe(true);
  });

  it("fails pack verification when compiled learn-v2 resources are unsafe to publish", async () => {
    const pack = await mkdtemp(path.join(os.tmpdir(), "osk-pack-learn-v2-unsafe-"));
    const resourceRel = ".openskill-kit/compiled/mcp/resources/learn-v2-concepts.json";
    const resourcePath = path.join(pack, resourceRel);
    await mkdir(path.dirname(resourcePath), { recursive: true });
    await writeJson(resourcePath, {
      schemaVersion: "openskill-kit.mcp.learn-v2-concept-resources.v1",
      generatedAt: "2026-06-30T00:00:00.000Z",
      resources: [{
        uri: "openskill-kit://learn-v2/concepts/concept_bad",
        name: "learn-v2 concept concept_bad",
        title: "Bad exported command",
        mimeType: "application/json",
        annotations: { audience: ["assistant"], priority: 1, lastModified: "2026-06-30T00:00:00.000Z" },
        concept: {
          id: "concept_bad",
          behavior: "",
          behaviorDelta: "Adds a broad risky command rule.",
          scope: { level: "project", paths: [], taskTypes: [], negativeTriggers: [] },
          activation: { phrases: [], pathGlobs: [], commands: ["npm run deploy"] },
          confidence: 0.99,
          risk: "high",
          status: "superseded",
          evidenceCount: 0,
          sourceReliability: 0.2
        },
        privacy: { class: "project-private", rawRefsExported: false, rationale: "test" }
      }]
    });
    await writeJson(path.join(pack, "manifest.json"), {
      schemaVersion: "openskill-kit.project-pack.v1",
      privacy: { rawEventsIncluded: false, rawSignalsIncluded: false },
      files: [resourceRel],
      hashes: { [resourceRel]: await sha256(resourcePath) }
    });

    const result = await verifyProjectBehaviorPack(pack);
    expect(result.status).toBe("fail");
    expect(result.issues.some((issue) => issue.includes("Publish audit block: .openskill-kit/compiled/mcp/resources/learn-v2-concepts.json: learn-v2-inactive-resource"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("learn-v2-concept-without-evidence"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("learn-v2-overbroad-weak-concept"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("learn-v2-unsafe-command-policy"))).toBe(true);
  });

  it("plans pack import without writing files or importing hooks by default", async () => {
    const pack = await mkdtemp(path.join(os.tmpdir(), "osk-pack-good-"));
    await writeFile(path.join(pack, "policy.md"), "# Policy\n", "utf8");
    await mkdir(path.join(pack, ".openskill-kit", "compiled", "hooks"), { recursive: true });
    await writeFile(path.join(pack, ".openskill-kit", "compiled", "hooks", "hooks.json"), "{}", "utf8");
    await writeJson(path.join(pack, "manifest.json"), {
      schemaVersion: "openskill-kit.project-pack.v1",
      privacy: { rawEventsIncluded: false, rawSignalsIncluded: false },
      files: ["policy.md", ".openskill-kit/compiled/hooks/hooks.json"],
      hashes: {
        "policy.md": await sha256(path.join(pack, "policy.md")),
        ".openskill-kit/compiled/hooks/hooks.json": await sha256(path.join(pack, ".openskill-kit", "compiled", "hooks", "hooks.json"))
      }
    });
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-import-plan-"));
    const result = await importProjectBehaviorPack(root, pack);
    expect(result.status).toBe("planned");
    expect(result.files.map((file) => file.destination)).not.toContain(path.join(root, ".openskill-kit", "compiled", "hooks", "hooks.json"));
    await expect(stat(path.join(root, "policy.md"))).rejects.toThrow();
  });

  it("summarizes shareable learn-v2 concepts in pack import review without auto-activating them", async () => {
    const pack = await mkdtemp(path.join(os.tmpdir(), "osk-pack-learn-v2-review-"));
    const resourceRel = ".openskill-kit/compiled/mcp/resources/learn-v2-concepts.json";
    const resourcePath = path.join(pack, resourceRel);
    await writeFile(path.join(pack, "policy.md"), "# Policy\n", "utf8");
    await writeJson(resourcePath, {
      schemaVersion: "openskill-kit.mcp.learn-v2-concept-resources.v1",
      generatedAt: "2026-06-30T00:00:00.000Z",
      resources: [{
        uri: "openskill-kit://learn-v2/concepts/concept_shared_parser",
        name: "learn-v2 concept concept_shared_parser",
        title: "Shared parser regression behavior",
        mimeType: "application/json",
        annotations: { audience: ["assistant"], priority: 0.9, lastModified: "2026-06-30T00:00:00.000Z" },
        concept: {
          id: "concept_shared_parser",
          behavior: "Prefer focused parser regression tests when parser code changes.",
          behaviorDelta: "Adds parser regression test focus.",
          scope: { level: "path", paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"], negativeTriggers: [] },
          activation: { phrases: ["parser regression"], pathGlobs: ["packages/core/src/parser.ts"], commands: ["npm test -- parser"], negativeTriggers: [] },
          confidence: 0.91,
          risk: "low",
          status: "active",
          evidenceCount: 2,
          sourceReliability: 0.9
        },
        privacy: { class: "project-private", rawRefsExported: false, rationale: "compiled reviewed behavior only" }
      }]
    });
    await writeJson(path.join(pack, "manifest.json"), {
      schemaVersion: "openskill-kit.project-pack.v1",
      privacy: { rawEventsIncluded: false, rawSignalsIncluded: false },
      files: ["policy.md", resourceRel],
      hashes: {
        "policy.md": await sha256(path.join(pack, "policy.md")),
        [resourceRel]: await sha256(resourcePath)
      }
    });

    const root = await mkdtemp(path.join(os.tmpdir(), "osk-import-learn-v2-review-"));
    const inspected = await inspectProjectBehaviorPack(pack);
    expect(inspected.learnV2ConceptSummary).toEqual({
      schemaVersion: "openskill-kit.learn-v2-pack-concept-summary.v1",
      resourceCount: 1,
      activeCount: 1,
      lockedCount: 0,
      highRiskCount: 0,
      commandCount: 1,
      pathScopedCount: 1,
      conceptIds: ["concept_shared_parser"]
    });
    const result = await importProjectBehaviorPack(root, pack, { review: true });

    expect(result.status).toBe("planned");
    expect(result.learnV2ConceptSummary).toEqual({
      schemaVersion: "openskill-kit.learn-v2-pack-concept-summary.v1",
      resourceCount: 1,
      activeCount: 1,
      lockedCount: 0,
      highRiskCount: 0,
      commandCount: 1,
      pathScopedCount: 1,
      conceptIds: ["concept_shared_parser"]
    });
    expect(result.reviewPath).toBeTruthy();
    const review = await readFile(result.reviewPath!, "utf8");
    expect(review).toContain("## Learn v2 Concepts");
    expect(review).toContain("- Concept ids: concept_shared_parser");
    expect(review).toContain("does not auto-activate Learn v2 concepts");
    await expect(stat(path.join(root, resourceRel))).rejects.toThrow();
  });

  it("redacts nested values plus intent and raw refs before event storage", async () => {
    const root = await tempProject();
    const secret = ["phase", "one", "secret"].join("-");
    const direct = redactValue({ nested: { token: `TOKEN=${secret}` } });
    expect(JSON.stringify(direct.value)).not.toContain(secret);
    const result = await appendEvent(root, {
      sessionId: "redaction",
      eventType: "user-prompt-submit",
      intent: `Always hide TOKEN=${secret}`,
      rawRef: `ref TOKEN=${secret}`,
      source: { adapter: "test" },
      normalized: { text: `Prompt TOKEN=${secret}` }
    });
    const eventLog = await readFile(result.eventPath, "utf8");
    expect(eventLog).not.toContain(secret);
    expect(result.redactionMatches).toContain("secret-assignment");
  });

  it("migrates legacy local config shape into current defaults", async () => {
    const migrated = migrateProjectConfig({ schemaVersion: "openskill-kit.config.v0" }, "C:/tmp/example-project");
    expect(migrated.schemaVersion).toBe("openskill-kit.config.v1");
    expect(migrated.privacy.localOnly).toBe(true);
  });

  it("migrates pre raw-evidence v1 configs without losing existing learning settings", async () => {
    const migrated = migrateProjectConfig({
      schemaVersion: "openskill-kit.config.v1",
      projectId: "osk_old",
      projectName: "old-project",
      createdAt: "2026-06-01T00:00:00.000Z",
      learning: {
        enabled: true,
        mode: "auto-stage",
        highValueOnly: false,
        minConfidenceToApply: 0.8,
        minConfidenceToShare: 0.91,
        decayHalfLifeDays: 30
      },
      privacy: {},
      scopes: {},
      adapters: {},
      compileTargets: undefined
    }, "C:/tmp/old-project");

    expect(migrated.learning.mode).toBe("auto-stage");
    expect(migrated.learning.highValueOnly).toBe(false);
    expect(migrated.learning.rawEvidence.enabled).toBe(false);
    expect(migrated.learning.rawEvidence.extractionExecution).toBe("deterministic-only");
  });

  it("opens existing pre raw-evidence configs during init without rewriting them", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-old-config-"));
    const oskRoot = path.join(root, ".openskill-kit");
    await mkdir(oskRoot, { recursive: true });
    await writeJson(path.join(oskRoot, "config.json"), {
      schemaVersion: "openskill-kit.config.v1",
      projectId: "osk_old_init",
      projectName: "old-init",
      createdAt: "2026-06-01T00:00:00.000Z",
      learning: { enabled: true, mode: "manual-review" },
      privacy: {},
      scopes: {},
      adapters: {},
      compileTargets: undefined
    });

    const result = await initAdaptiveProject({ projectRoot: root, projectName: "ignored", now: new Date("2026-07-03T00:00:00.000Z") });

    expect(result.status).toBe("exists");
    expect(result.config.projectId).toBe("osk_old_init");
    expect(result.config.learning.rawEvidence.maxRawBytesTotal).toBe(250_000_000);
    const stored = JSON.parse(await readFile(path.join(oskRoot, "config.json"), "utf8"));
    expect(stored.learning.rawEvidence).toBeUndefined();
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "osk-phase1-"));
  await initAdaptiveProject({ projectRoot: root, projectName: "phase1", now: new Date("2026-06-25T00:00:00.000Z") });
  return root;
}

function graph(nodes: PreferenceNode[]): PreferenceGraph {
  return {
    schemaVersion: "openskill-kit.preference-graph.v1",
    projectId: "phase1",
    nodes,
    conflicts: [],
    updatedAt: "2026-06-25T00:00:00.000Z"
  };
}

function pref(id: string, status: PreferenceNode["status"], statement = `Prefer ${id}`, polarity: PreferenceNode["polarity"] = "positive", category: PreferenceNode["category"] = "workflow"): PreferenceNode {
  return {
    schemaVersion: "openskill-kit.preference-node.v1",
    id: `pref_${id}`,
    title: id,
    statement,
    category,
    scope: { level: "project", paths: [] },
    confidence: 0.8,
    status,
    polarity,
    evidence: [{ signalId: `sig_${id}`, eventIds: [`evt_${id}`], weight: 0.8 }],
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z"
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
