import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  initAdaptiveProject,
  initOpenWorldTask,
  mergeLearnV2ConceptCards,
  PUBLIC_MCP_PROFILE_TOOLS,
  readLearnV2ConceptStore,
  type LearnV2BehaviorAtom,
  writeLearnV2ConceptStore
} from "@openskill-kit/core";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("openskill-kit MCP server", () => {
  it("defaults to the public MCP profile at runtime", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-mcp-public-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "mcp-public-fixture" }), "utf8");

    const client = new Client({ name: "openskill-kit-public-test", version: "0.1.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repoRoot, "packages", "mcp-server", "src", "index.ts")],
      cwd: root,
      stderr: "pipe"
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([...PUBLIC_MCP_PROFILE_TOOLS].sort());
      expect(names).not.toContain("openskill_draft");
      expect(names).not.toContain("osk_record_event");
    } finally {
      await client.close();
    }
  });

  it("uses OPENSKILLKIT_PROJECT_ROOT when host omits projectRoot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-mcp-env-root-"));
    const launcherCwd = await mkdtemp(path.join(os.tmpdir(), "osk-mcp-launcher-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "mcp-env-root-fixture" }), "utf8");

    const client = new Client({ name: "openskill-kit-env-root-test", version: "0.1.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repoRoot, "packages", "mcp-server", "src", "index.ts")],
      cwd: launcherCwd,
      env: { ...inheritedEnv(), OPENSKILLKIT_PROJECT_ROOT: root },
      stderr: "pipe"
    });

    try {
      await client.connect(transport);
      const boot = await client.callTool({
        name: "osk_get_status",
        arguments: { init: true }
      });
      const bootText = boot.content.find((item) => item.type === "text")?.text;
      const parsed = JSON.parse(bootText ?? "{}");
      expect(parsed.initResult.configPath).toContain(".openskill-kit");
      await expect(readFile(path.join(root, ".openskill-kit", "config.json"), "utf8")).resolves.toContain("mcp-env-root-fixture");
      await expect(readFile(path.join(launcherCwd, ".openskill-kit", "config.json"), "utf8")).rejects.toThrow();
    } finally {
      await client.close();
    }
  });

  it("passes Learn v2 negative signals through public task context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-mcp-task-context-learn-v2-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "mcp-task-context-learn-v2-fixture" }), "utf8");
    await initAdaptiveProject({ projectRoot: root, now: new Date("2026-06-30T00:00:00Z") });
    const dir = path.join(root, ".openskill-kit", "learn-v2");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "activation-index.json"), JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.activation-index.v1",
      projectId: "project",
      updatedAt: "2026-06-30T00:00:00.000Z",
      entries: [{
        conceptId: "concept_mcp_task_context",
        status: "active",
        title: "Focused parser regression",
        phrases: ["parser behavior"],
        pathGlobs: ["packages/core/src/parser.ts"],
        commands: [],
        taskTypes: ["parser-change"],
        negativeTriggers: ["docs-only"],
        confidence: 0.82,
        risk: "low"
      }]
    }, null, 2), "utf8");

    const client = new Client({ name: "openskill-kit-task-context-test", version: "0.1.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repoRoot, "packages", "mcp-server", "src", "index.ts")],
      cwd: root,
      stderr: "pipe"
    });

    try {
      await client.connect(transport);
      const shown = await client.callTool({
        name: "osk_get_task_context",
        arguments: { projectRoot: root, query: "parser behavior", paths: ["packages/core/src/parser.ts"] }
      });
      const shownParsed = JSON.parse(shown.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(shownParsed.learnedConcepts.shown.some((match: { conceptId: string }) => match.conceptId === "concept_mcp_task_context")).toBe(true);

      const suppressed = await client.callTool({
        name: "osk_get_task_context",
        arguments: {
          projectRoot: root,
          query: "parser behavior",
          paths: ["packages/core/src/parser.ts"],
          negativeSignals: ["docs-only"]
        }
      });
      const suppressedParsed = JSON.parse(suppressed.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(suppressedParsed.learnedConcepts.shown.some((match: { conceptId: string }) => match.conceptId === "concept_mcp_task_context")).toBe(false);
      expect(suppressedParsed.learnedConcepts.suppressed.some((match: { conceptId: string }) => match.conceptId === "concept_mcp_task_context")).toBe(true);
      expect(suppressedParsed.learnV2Activation.suppressed.find((match: { conceptId: string; reasons: string[] }) => match.conceptId === "concept_mcp_task_context")?.reasons)
        .toContain("negative-trigger:docs-only");
    } finally {
      await client.close();
    }
  });

  it("exposes declassified Learn v2 observability through advanced MCP", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-mcp-learn-v2-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "mcp-learn-v2-fixture" }), "utf8");
    const transcript = path.join(root, "session.md");
    await mkdir(path.join(root, "logs"), { recursive: true });
    await writeFile(transcript, [
      `user: In ${path.join(root, "packages/core/src/parser.ts")}, prefer focused parser tests before parser rewrites. API_KEY=sk-live-secret`,
      "assistant: noted"
    ].join("\n"), "utf8");
    await writeFile(path.join(root, "logs", "terminal-build.log"), "$ npm test -- parser\nPASS parser suite\n", "utf8");

    const client = new Client({ name: "openskill-kit-learn-v2-test", version: "0.1.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repoRoot, "packages", "mcp-server", "src", "index.ts")],
      cwd: root,
      env: { ...inheritedEnv(), OPENSKILLKIT_MCP_PROFILE: "advanced" },
      stderr: "pipe"
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      expect(names).toContain("osk_plan_learning_sources_v2");
      expect(names).toContain("osk_ingest_raw_evidence");
      expect(names).toContain("osk_get_concept_review_queue");
      expect(names).toContain("osk_get_learn_v2_observability");
      expect(names).toContain("osk_prepare_learn_v2_scope_requests");
      expect(names).toContain("osk_apply_learn_v2_scope_outputs");
      expect(names).toContain("osk_prepare_learn_v2_contradiction_requests");
      expect(names).toContain("osk_apply_learn_v2_contradiction_outputs");
      expect(names).toContain("osk_prepare_learn_v2_eval_requests");
      expect(names).toContain("osk_apply_learn_v2_eval_outputs");

      await client.callTool({
        name: "osk_get_status",
        arguments: { projectRoot: root, init: true }
      });
      const planV2 = await client.callTool({
        name: "osk_plan_learning_sources_v2",
        arguments: { projectRoot: root }
      });
      const planV2Text = planV2.content.find((item) => item.type === "text")?.text ?? "{}";
      const planV2Parsed = JSON.parse(planV2Text);
      expect(planV2Parsed.schemaVersion).toBe("openskill-kit.learn-v2.source-plan.v1");
      expect(planV2Parsed.legacySourcePlan.schemaVersion).toBe("openskill-kit.learn-source-plan.v1");
      expect(planV2Parsed.rawLocalSurfacePolicy.ingestTool).toBe("osk_ingest_raw_evidence");
      expect(planV2Parsed.rawLocalSurfacePolicy.previewDefault).toBe(true);
      expect(planV2Parsed.rawLocalSurfaceCandidates.some((candidate: { adapter: { adapterId: string; normalizationProfile: string } }) =>
        candidate.adapter.adapterId === "terminal" && candidate.adapter.normalizationProfile === "terminal"
      )).toBe(true);
      expect(planV2Text).not.toContain(root);

      const raw = await client.callTool({
        name: "osk_ingest_raw_evidence",
        arguments: {
          projectRoot: root,
          sourceFiles: [transcript],
          previewOnly: true,
          modelMode: "deterministic-only"
        }
      });
      const rawText = raw.content.find((item) => item.type === "text")?.text ?? "{}";
      const rawParsed = JSON.parse(rawText);
      expect(rawParsed.digest.topLevelConceptsScope).toBe("current-run-legacy-projection");
      expect(rawParsed.digest.mergedConceptCards).toBeGreaterThanOrEqual(rawParsed.digest.currentRunConceptCards);
      expect(rawParsed.sources[0]?.learnV2?.rawRef).toBeUndefined();
      expect(rawText).not.toContain(root);
      expect(rawText).not.toContain("sk-live-secret");
      expect(rawText).not.toMatch(/"rawRefs?"\s*:/);

      const queue = await client.callTool({
        name: "osk_get_concept_review_queue",
        arguments: { projectRoot: root }
      });
      const queueText = queue.content.find((item) => item.type === "text")?.text ?? "{}";
      const queueParsed = JSON.parse(queueText);
      expect(queueParsed.schemaVersion).toBe("openskill-kit.learn-v2.review-queue.v1");
      expect(queueParsed.behaviorDeltaFirst).toBe(true);
      expect(queueParsed.reviewFocus.focusCardIds.length).toBeGreaterThan(0);
      expect(queueParsed.evidenceSnippetSummary.snippetCount).toBeGreaterThan(0);
      expect(queueText).not.toContain(root);
      expect(queueText).not.toContain("sk-live-secret");
      expect(queueText).not.toContain("raw_");

      const observability = await client.callTool({
        name: "osk_get_learn_v2_observability",
        arguments: { projectRoot: root }
      });
      const observabilityText = observability.content.find((item) => item.type === "text")?.text ?? "{}";
      const observabilityParsed = JSON.parse(observabilityText);
      expect(observabilityParsed.schemaVersion).toBe("openskill-kit.learn-v2.pipeline-observability.v1");
      expect(observabilityParsed.privacy.rawRefsExported).toBe(false);
      expect(observabilityParsed.privacy.rawSourcePathsExported).toBe(false);
      expect(observabilityParsed.health.status).toMatch(/pass|warn|fail/);
      expect(observabilityText).not.toContain(root);
      expect(observabilityText).not.toContain("sk-live-secret");
    } finally {
      await client.close();
    }
  }, 45_000);

  it("prepares and applies Learn v2 scope-inferencer outputs through advanced MCP", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-mcp-scope-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "mcp-scope-fixture" }), "utf8");
    await initAdaptiveProject({ projectRoot: root, now: new Date("2026-06-30T00:00:00Z") });
    const now = new Date("2026-06-30T00:01:00Z");
    const [card] = mergeLearnV2ConceptCards([
      learnV2McpBehaviorAtom("mcp_scope_parser", "Prefer focused parser regression tests for parser changes.", "positive")
    ], now);
    await writeLearnV2ConceptStore(root, [card!], now);

    const client = new Client({ name: "openskill-kit-scope-test", version: "0.1.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repoRoot, "packages", "mcp-server", "src", "index.ts")],
      cwd: root,
      env: { ...inheritedEnv(), OPENSKILLKIT_MCP_PROFILE: "advanced" },
      stderr: "pipe"
    });

    try {
      await client.connect(transport);
      const prepared = await client.callTool({
        name: "osk_prepare_learn_v2_scope_requests",
        arguments: { projectRoot: root, conceptIds: [card!.id] }
      });
      const preparedText = prepared.content.find((item) => item.type === "text")?.text ?? "{}";
      const preparedParsed = JSON.parse(preparedText);
      expect(preparedParsed.schemaVersion).toBe("openskill-kit.learn-v2.scope-inference-request-result.v1");
      expect(preparedParsed.requestCount).toBe(1);
      expect(preparedText).not.toContain(root);
      expect(preparedText).not.toContain("raw_mcp_scope");

      const requestRoot = path.join(root, ".openskill-kit", "learn-v2", "model-requests");
      const scopeDirs = (await readdir(requestRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("scope_"))
        .map((entry) => path.join(requestRoot, entry.name));
      expect(scopeDirs).toHaveLength(1);
      const manifestPath = path.join(scopeDirs[0]!, "request-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const outputPath = path.resolve(root, manifest.expectedOutputPath);
      await writeFile(outputPath, JSON.stringify({
        schemaVersion: "openskill-kit.learn-v2.llm-scope-inference-output.v1",
        conceptId: card!.id,
        appliesWhen: ["Parser behavior changes need focused regression coverage."],
        doesNotApplyWhen: ["Docs-only changes do not need parser regression scope."],
        scope: {
          level: "path",
          paths: ["packages/core/src/parser.ts"],
          taskTypes: ["parser-change"]
        },
        activation: {
          phrases: ["parser regression coverage"],
          pathGlobs: ["packages/core/src/parser.ts"],
          commands: ["npm test -- parser"],
          negativeTriggers: ["docs-only changes"]
        },
        counterevidence: [{
          evidenceId: card!.evidenceIds[0],
          reason: "Evidence is scoped to parser behavior."
        }],
        confidence: 0.72,
        rationale: "The concept cites parser-specific evidence.",
        rejected: []
      }), "utf8");

      const applied = await client.callTool({
        name: "osk_apply_learn_v2_scope_outputs",
        arguments: { projectRoot: root, outputPaths: [manifestPath] }
      });
      const appliedText = applied.content.find((item) => item.type === "text")?.text ?? "{}";
      const appliedParsed = JSON.parse(appliedText);
      expect(appliedParsed.schemaVersion).toBe("openskill-kit.learn-v2.scope-inference-apply-result.v1");
      expect(appliedParsed.updatedConceptIds).toEqual([card!.id]);
      expect(appliedParsed.rejected).toEqual([]);
      expect(appliedText).not.toContain(root);
      expect(appliedText).not.toContain("raw_mcp_scope");

      const store = await readLearnV2ConceptStore(root);
      const updated = store.cards.find((item) => item.id === card!.id)!;
      expect(updated.conditions?.appliesWhen).toContain("Parser behavior changes need focused regression coverage.");
      expect(updated.scope.negativeTriggers).toContain("docs-only changes");
      expect(updated.activation.commands).toContain("npm test -- parser");
    } finally {
      await client.close();
    }
  }, 45_000);

  it("prepares and applies Learn v2 contradiction-reviewer outputs through advanced MCP", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-mcp-contradiction-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "mcp-contradiction-fixture" }), "utf8");
    await initAdaptiveProject({ projectRoot: root, now: new Date("2026-06-30T00:00:00Z") });
    const now = new Date("2026-06-30T00:01:00Z");
    const cards = mergeLearnV2ConceptCards([
      learnV2McpBehaviorAtom("mcp_contradict_positive", "Prefer focused parser regression tests for parser changes.", "positive"),
      learnV2McpBehaviorAtom("mcp_contradict_negative", "Avoid focused parser regression tests for parser changes.", "negative")
    ], now);
    await writeLearnV2ConceptStore(root, cards, now);

    const client = new Client({ name: "openskill-kit-contradiction-test", version: "0.1.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repoRoot, "packages", "mcp-server", "src", "index.ts")],
      cwd: root,
      env: { ...inheritedEnv(), OPENSKILLKIT_MCP_PROFILE: "advanced" },
      stderr: "pipe"
    });

    try {
      await client.connect(transport);
      const prepared = await client.callTool({
        name: "osk_prepare_learn_v2_contradiction_requests",
        arguments: { projectRoot: root }
      });
      const preparedText = prepared.content.find((item) => item.type === "text")?.text ?? "{}";
      const preparedParsed = JSON.parse(preparedText);
      expect(preparedParsed.schemaVersion).toBe("openskill-kit.learn-v2.contradiction-review-request-result.v1");
      expect(preparedParsed.requestCount).toBe(1);
      expect(preparedText).not.toContain(root);
      expect(preparedText).not.toContain("raw_mcp_contradict");

      const requestRoot = path.join(root, ".openskill-kit", "learn-v2", "model-requests");
      const contradictionDirs = (await readdir(requestRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("contradiction_"))
        .map((entry) => path.join(requestRoot, entry.name));
      expect(contradictionDirs).toHaveLength(1);
      const manifestPath = path.join(contradictionDirs[0]!, "request-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const outputPath = path.resolve(root, manifest.expectedOutputPath);
      const targetConceptId = manifest.conceptIds[0];
      const targetEvidenceId = cards.find((card) => card.id === targetConceptId)!.evidenceIds[0]!;
      await writeFile(outputPath, JSON.stringify({
        schemaVersion: "openskill-kit.learn-v2.llm-contradiction-review-output.v1",
        reviewId: manifest.reviewId,
        findings: [{
          kind: "counterevidence",
          conceptIds: manifest.conceptIds,
          evidenceIds: [targetEvidenceId],
          rationale: "Opposing parser guidance bounds this concept.",
          counterevidence: [{
            conceptId: targetConceptId,
            evidenceId: targetEvidenceId,
            reason: "MCP contradiction review found bounded parser counterevidence."
          }],
          requiresHumanReview: false
        }],
        rejected: []
      }), "utf8");

      const applied = await client.callTool({
        name: "osk_apply_learn_v2_contradiction_outputs",
        arguments: { projectRoot: root, outputPaths: [manifestPath] }
      });
      const appliedText = applied.content.find((item) => item.type === "text")?.text ?? "{}";
      const appliedParsed = JSON.parse(appliedText);
      expect(appliedParsed.schemaVersion).toBe("openskill-kit.learn-v2.contradiction-review-apply-result.v1");
      expect(appliedParsed.appliedCounterevidence).toBe(1);
      expect(appliedParsed.rejected).toEqual([]);
      expect(appliedText).not.toContain(root);
      expect(appliedText).not.toContain("raw_mcp_contradict");

      const store = await readLearnV2ConceptStore(root);
      expect(store.cards.find((item) => item.id === targetConceptId)?.counterevidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ evidenceId: targetEvidenceId, reason: "MCP contradiction review found bounded parser counterevidence." })
      ]));
    } finally {
      await client.close();
    }
  }, 45_000);

  it("prepares and applies Learn v2 eval-planner outputs through advanced MCP", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-mcp-eval-planner-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "mcp-eval-planner-fixture" }), "utf8");
    await initAdaptiveProject({ projectRoot: root, now: new Date("2026-06-30T00:00:00Z") });
    const now = new Date("2026-06-30T00:01:00Z");
    const [card] = mergeLearnV2ConceptCards([
      learnV2McpBehaviorAtom("mcp_eval_parser", "Prefer focused parser regression tests for parser changes.", "positive")
    ], now);
    const activeCard = { ...card!, status: "active" as const };
    await writeLearnV2ConceptStore(root, [activeCard], now);

    const client = new Client({ name: "openskill-kit-eval-planner-test", version: "0.1.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repoRoot, "packages", "mcp-server", "src", "index.ts")],
      cwd: root,
      env: { ...inheritedEnv(), OPENSKILLKIT_MCP_PROFILE: "advanced" },
      stderr: "pipe"
    });

    try {
      await client.connect(transport);
      const prepared = await client.callTool({
        name: "osk_prepare_learn_v2_eval_requests",
        arguments: { projectRoot: root, conceptIds: [activeCard.id] }
      });
      const preparedText = prepared.content.find((item) => item.type === "text")?.text ?? "{}";
      const preparedParsed = JSON.parse(preparedText);
      expect(preparedParsed.schemaVersion).toBe("openskill-kit.learn-v2.eval-planner-request-result.v1");
      expect(preparedParsed.requestCount).toBe(1);
      expect(preparedText).not.toContain(root);
      expect(preparedText).not.toContain("raw_mcp_eval");

      const requestRoot = path.join(root, ".openskill-kit", "learn-v2", "model-requests");
      const evalDirs = (await readdir(requestRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("eval_"))
        .map((entry) => path.join(requestRoot, entry.name));
      expect(evalDirs).toHaveLength(1);
      const manifestPath = path.join(evalDirs[0]!, "request-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const outputPath = path.resolve(root, manifest.expectedOutputPath);
      await writeFile(outputPath, JSON.stringify({
        schemaVersion: "openskill-kit.learn-v2.llm-eval-plan-output.v1",
        extractionScenarios: [{
          schemaVersion: "openskill-kit.learn-v2.extraction-golden.v1",
          id: "golden_mcp_parser_eval",
          title: "MCP parser eval extraction",
          expectedConceptText: ["focused parser regression"],
          expectedKinds: ["verification"],
          expectedTaskHints: ["parser"],
          expectedPathText: ["packages/core/src/parser.ts"],
          forbiddenText: ["broad rewrite only"]
        }],
        behaviorDeltaScenarios: [{
          schemaVersion: "openskill-kit.learn-v2.behavior-delta-golden.v1",
          id: "delta_mcp_parser_eval",
          title: "MCP parser eval activation",
          task: {
            prompt: "Change parser behavior",
            paths: ["packages/core/src/parser.ts"],
            commands: ["npm test -- parser"],
            taskTypes: ["parser-change"],
            negativeSignals: []
          },
          expectedConceptText: ["focused parser regression"],
          expectedKinds: ["verification"],
          expectedPlanIncludes: ["focused parser regression"],
          expectedPlanExcludes: ["broad rewrite only"],
          minActivatedConcepts: 1
        }],
        rejected: []
      }), "utf8");

      const applied = await client.callTool({
        name: "osk_apply_learn_v2_eval_outputs",
        arguments: { projectRoot: root, outputPaths: [manifestPath] }
      });
      const appliedText = applied.content.find((item) => item.type === "text")?.text ?? "{}";
      const appliedParsed = JSON.parse(appliedText);
      expect(appliedParsed.schemaVersion).toBe("openskill-kit.learn-v2.eval-planner-apply-result.v1");
      expect(appliedParsed.extractionScenarioCount).toBe(1);
      expect(appliedParsed.behaviorDeltaScenarioCount).toBe(1);
      expect(appliedParsed.rejected).toEqual([]);
      expect(appliedText).not.toContain(root);
      expect(appliedText).not.toContain("raw_mcp_eval");
      const proposal = JSON.parse(await readFile(path.resolve(root, appliedParsed.proposalPath), "utf8"));
      expect(proposal.schemaVersion).toBe("openskill-kit.learn-v2.eval-golden-proposal.v1");
      expect(proposal.reviewRequired).toBe(true);
    } finally {
      await client.close();
    }
  }, 45_000);

  it("lists advanced tools and drafts a skill through stdio transport", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-mcp-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "mcp-fixture" }), "utf8");

    const client = new Client({ name: "openskill-kit-test", version: "0.1.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repoRoot, "packages", "mcp-server", "src", "index.ts")],
      cwd: root,
      env: { ...inheritedEnv(), OPENSKILLKIT_MCP_PROFILE: "advanced" },
      stderr: "pipe"
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);

      expect(names).toEqual(
        expect.arrayContaining([
          "openskill_doctor",
          "openskill_draft",
          "openskill_evolve",
          "openskill_audit",
          "openskill_test",
          "openskill_evaluate",
          "openskill_install",
          "openskill_list",
          "openskill_inspect",
          "osk_get_status",
          "osk_get_docs_help",
          "osk_record_event",
          "osk_learn_from_session",
          "osk_compile_behavior_layer",
          "osk_compile_deploy",
          "osk_review_behavior",
          "osk_run_openworld_workflow",
          "osk_verify_behavior",
          "osk_run_eval",
          "osk_pack_behavior",
          "osk_agent_doctor",
          "osk_install_agent_hooks",
          "osk_preview_plugin_attach",
          "osk_apply_plugin_attach",
          "osk_get_plugin_attach_status",
          "osk_get_task_context",
          "osk_finish_task",
          "osk_import_interaction_source",
          "osk_list_interaction_adapters",
          "osk_list_interaction_imports",
          "osk_explain_interaction_import",
          "osk_get_interaction_pool",
          "osk_plan_learning_sources_v2",
          "osk_ingest_raw_evidence",
          "osk_get_concept_review_queue",
          "osk_review_concepts",
          "osk_compile_concepts",
          "osk_prepare_learn_v2_scope_requests",
          "osk_apply_learn_v2_scope_outputs",
          "osk_prepare_learn_v2_contradiction_requests",
          "osk_apply_learn_v2_contradiction_outputs",
          "osk_prepare_learn_v2_eval_requests",
          "osk_apply_learn_v2_eval_outputs",
          "osk_reconstruct_episodes",
          "osk_extract_concepts",
          "osk_run_learn_v2_eval",
          "osk_get_learn_v2_observability",
          "osk_run_lifecycle_once",
          "osk_openworld_retrieval_adapters",
          "osk_openworld_execute_source_plan",
          "osk_openworld_repair_candidate",
          "osk_openworld_hidden_oracle_harness",
          "osk_openworld_candidate_skill",
          "osk_openworld_verifier_quality"
        ])
      );

      const boot = await client.callTool({
        name: "osk_get_status",
        arguments: { projectRoot: root, init: true }
      });
      const bootText = boot.content.find((item) => item.type === "text")?.text;
      expect(bootText).toBeTruthy();
      expect(bootText).not.toContain(root);
      const bootParsed = JSON.parse(bootText ?? "{}");
      expect(bootParsed.schemaVersion).toBe("openskill-kit.status-facade.v1");
      expect(bootParsed.plugin.ready).toBe(false);
      expect(bootParsed.plugin.nextActions[0]).toContain("compile --target plugin");

      await client.callTool({
        name: "osk_record_event",
        arguments: {
          projectRoot: root,
          sessionId: "mcp-adaptive",
          eventType: "user-prompt-submit",
          normalized: { text: "Always run npm test before finishing." }
        }
      });
      const learned = await client.callTool({
        name: "osk_learn_from_session",
        arguments: { projectRoot: root }
      });
      const learnedText = learned.content.find((item) => item.type === "text")?.text;
      expect(learnedText).toContain("run npm test");

      const badSourcePlan = await client.callTool({
        name: "osk_plan_learning_sources",
        arguments: { projectRoot: root, sourceMode: "selected", selectedSourceIds: ["not-a-source"] }
      });
      expect(badSourcePlan.isError).toBe(true);
      expect(badSourcePlan.content.find((item) => item.type === "text")?.text).toContain("Unknown learning source(s): not-a-source");

      await client.callTool({
        name: "osk_apply_review_actions",
        arguments: { projectRoot: root, activateAll: true }
      });
      const facadeCompile = await client.callTool({
        name: "osk_compile_deploy",
        arguments: { projectRoot: root, action: "compile", targets: ["plugin"] }
      });
      const facadeCompileParsed = JSON.parse(facadeCompile.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(facadeCompileParsed.schemaVersion).toBe("openskill-kit.compile-deploy.v1");
      expect(facadeCompileParsed.compile.compiledTargets).toContain("plugin");
      const bootReady = await client.callTool({
        name: "osk_get_status",
        arguments: { projectRoot: root, init: false }
      });
      const bootReadyText = bootReady.content.find((item) => item.type === "text")?.text;
      const bootReadyParsed = JSON.parse(bootReadyText ?? "{}");
      expect(bootReadyParsed.plugin.ready).toBe(true);
      expect(bootReadyParsed.plugin.skills).toEqual(expect.arrayContaining(["skills/project-behavior", "skills/project-testing"]));
      expect(bootReadyParsed.plugin.nextActions).toContain("Attach `.openskill-kit/compiled/plugin/` as the local plugin directory.");
      const mcpTelemetry = bootReadyParsed.status.operations.commandTelemetry;
      expect(mcpTelemetry.bySurface.mcp.total).toBeGreaterThanOrEqual(3);
      expect(mcpTelemetry.byFamily.status.success).toBeGreaterThanOrEqual(1);
      expect(mcpTelemetry.byFamily.learn.failure).toBe(1);
      expect(mcpTelemetry.byFamily.compile.success).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(mcpTelemetry)).not.toContain("not-a-source");

      const attachPlan = await client.callTool({
        name: "osk_compile_deploy",
        arguments: { projectRoot: root, action: "deploy" }
      });
      const attachPlanParsed = JSON.parse(attachPlan.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(attachPlanParsed.attachment.status).toBe("planned");
      expect(attachPlanParsed.attachment.host).toBe("opencode");
      expect(attachPlanParsed.attachment.files.some((file: { destination: string }) => file.destination.endsWith("opencode.json"))).toBe(true);
      expect(attachPlanParsed.hooks.status).toBe("planned");
      expect(attachPlanParsed.manifests.status).toBe("planned");
      expect(attachPlanParsed.manifests.files.some((file: { destination: string }) => file.destination.endsWith("AGENTS.md"))).toBe(true);
      const healthPlan = await client.callTool({
        name: "osk_get_plugin_attach_status",
        arguments: { projectRoot: root }
      });
      const healthPlanParsed = JSON.parse(healthPlan.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(healthPlanParsed.attached).toBe(false);

      const attachApply = await client.callTool({
        name: "osk_compile_deploy",
        arguments: { projectRoot: root, action: "deploy", apply: true, yes: true }
      });
      const attachApplyParsed = JSON.parse(attachApply.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(attachApplyParsed.attachment.status).toBe("attached");
      expect(attachApplyParsed.attachment.host).toBe("opencode");
      expect(attachApplyParsed.hooks.status).toBe("installed");
      expect(attachApplyParsed.manifests.status).toBe("installed");
      await expect(readFile(path.join(root, ".agents", "hooks", "openskill-kit.json"), "utf8")).resolves.toContain("openskill-kit");
      await expect(readFile(path.join(root, "AGENTS.md"), "utf8")).resolves.toContain("BEGIN MANAGED BY OPENSKILL-KIT");
      const bootAttached = await client.callTool({
        name: "osk_get_status",
        arguments: { projectRoot: root, init: false }
      });
      const bootAttachedParsed = JSON.parse(bootAttached.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(bootAttachedParsed.status.compiled.pluginAttachment.attached).toBe(true);
      const healthAttached = await client.callTool({
        name: "osk_get_plugin_attach_status",
        arguments: { projectRoot: root }
      });
      const healthAttachedParsed = JSON.parse(healthAttached.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(healthAttachedParsed.attached).toBe(true);
      expect(healthAttachedParsed.defaultHostReady).toBe(true);

      const taskContext = await client.callTool({
        name: "osk_get_task_context",
        arguments: { projectRoot: root, query: "finish with npm test", commands: ["npm test"] }
      });
      const taskContextParsed = JSON.parse(taskContext.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(taskContextParsed.schemaVersion).toBe("openskill-kit.agent-task-context.v1");
      expect(taskContextParsed.compactMarkdown).toContain("OpenSkillKit Task Context");
      expect(taskContextParsed.preferences.items.some((item: { node?: { statement?: string } }) => item.node?.statement?.includes("run npm test"))).toBe(true);
      expect(taskContextParsed.plugin.attached).toBe(true);

      const finished = await client.callTool({
        name: "osk_finish_task",
        arguments: {
          projectRoot: root,
          sessionId: "mcp-finish",
          summary: "Always run npm test before final response.",
          outcome: "accepted",
          commands: ["npm test"],
          commandStatus: "pass",
          outcomeReason: "User accepted verified test workflow.",
          proposedPatchHash: "sha256:mcpProposal",
          finalPatchHash: "sha256:mcpFinal",
          diffStats: { added: 4, removed: 1, files: 1 }
        }
      });
      const finishedParsed = JSON.parse(finished.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(finishedParsed.schemaVersion).toBe("openskill-kit.agent-task-finish.v1");
      expect(finishedParsed.eventIds.length).toBeGreaterThanOrEqual(4);
      expect(finishedParsed.lifecycle.signals.signalCount).toBeGreaterThan(0);

      const docsHelp = await client.callTool({
        name: "osk_get_docs_help",
        arguments: { projectRoot: root, topic: "all" }
      });
      const docsHelpParsed = JSON.parse(docsHelp.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(docsHelpParsed.schemaVersion).toBe("openskill-kit.docs-help.v1");
      expect(docsHelpParsed.commands).toContain("`/osk task`");
      expect(docsHelpParsed.learn).toContain("OpenCode ambient metadata");

      const reviewQueue = await client.callTool({
        name: "osk_review_behavior",
        arguments: { projectRoot: root, action: "queue" }
      });
      const reviewQueueParsed = JSON.parse(reviewQueue.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(reviewQueueParsed.schemaVersion).toBe("openskill-kit.review-queue.v1");

      const verified = await client.callTool({
        name: "osk_verify_behavior",
        arguments: { projectRoot: root }
      });
      const verifiedParsed = JSON.parse(verified.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(verifiedParsed.schemaVersion).toBe("openskill-kit.verify-behavior.v1");
      expect(verifiedParsed.hiddenOracleProof).toBe(false);
      expect(verifiedParsed.harness.schemaVersion).toBe("openskill-kit.harness-readiness-verification.v1");
      expect(verifiedParsed.harness.summary.publicMcpToolCount).toBeLessThanOrEqual(12);
      expect(verifiedParsed.harness.summary.opencodeCommandCount).toBe(12);
      expect(verifiedParsed.harness.summary.opencodeAgentCount).toBe(8);
      expect(verifiedParsed.harness.summary.opencodePluginReady).toBe(true);

      const evalRun = await client.callTool({
        name: "osk_run_eval",
        arguments: { projectRoot: root, mode: "replay" }
      });
      const evalParsed = JSON.parse(evalRun.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(evalParsed.schemaVersion).toBe("openskill-kit.eval-facade.v1");
      expect(evalParsed.mode).toBe("replay");
      expect(evalParsed.report.schemaVersion).toBe("openskill-kit.eval-report.v1");
      expect(evalParsed.report.scenarioCount).toBeGreaterThan(0);

      const packed = await client.callTool({
        name: "osk_pack_behavior",
        arguments: { projectRoot: root, action: "export" }
      });
      const packedParsed = JSON.parse(packed.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(packedParsed.schemaVersion).toBe("openskill-kit.project-pack.v1");
      expect(packedParsed.packPath).toContain(".openskill-kit");
      const packBlocked = await client.callTool({
        name: "osk_pack_behavior",
        arguments: { projectRoot: root, action: "import", packPath: packedParsed.packPath, dryRun: false }
      });
      expect(packBlocked.isError).toBe(true);
      expect(packBlocked.content.find((item) => item.type === "text")?.text).toContain("requires yes=true");
      const importBlocked = await client.callTool({
        name: "osk_import_behavior_pack",
        arguments: { projectRoot: root, packPath: packedParsed.packPath, dryRun: false }
      });
      expect(importBlocked.isError).toBe(true);
      expect(importBlocked.content.find((item) => item.type === "text")?.text).toContain("requires yes=true");
      const packPreview = await client.callTool({
        name: "osk_pack_behavior",
        arguments: { projectRoot: root, action: "import", packPath: packedParsed.packPath, review: true }
      });
      const packPreviewParsed = JSON.parse(packPreview.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(packPreviewParsed.status).toBe("planned");

      await writeFile(path.join(root, "openworld-source.md"), "MCP OpenWorld source-plan execution needs explicit approval before ingestion writes.\n", "utf8");
      const task = await initOpenWorldTask(root, {
        title: "MCP source gate",
        prompt: "Use OpenWorld source-plan execution approval for MCP ingestion",
        paths: ["openworld-source.md"]
      });
      const planResult = await client.callTool({
        name: "osk_openworld_source_plan",
        arguments: { projectRoot: root, taskId: task.task.id, paths: ["openworld-source.md"], includeAutonomousWebCandidates: false }
      });
      const planParsed = JSON.parse(planResult.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(planParsed.summary.recommendedCount).toBeGreaterThan(0);
      const mcpWriteBlocked = await client.callTool({
        name: "osk_openworld_execute_source_plan",
        arguments: { projectRoot: root, taskId: task.task.id, planId: planParsed.id, dryRun: false }
      });
      expect(mcpWriteBlocked.isError).toBe(true);
      expect(mcpWriteBlocked.content.find((item) => item.type === "text")?.text).toContain("requires yes=true");
      const mcpPreview = await client.callTool({
        name: "osk_openworld_execute_source_plan",
        arguments: { projectRoot: root, taskId: task.task.id, planId: planParsed.id }
      });
      const mcpPreviewParsed = JSON.parse(mcpPreview.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(mcpPreviewParsed.execution.status).toBe("planned");
      expect(mcpPreviewParsed.execution.dryRun).toBe(true);
      expect(mcpPreviewParsed.execution.summary.ingestedCount).toBe(0);
      const mcpApplied = await client.callTool({
        name: "osk_openworld_execute_source_plan",
        arguments: { projectRoot: root, taskId: task.task.id, planId: planParsed.id, dryRun: false, yes: true }
      });
      const mcpAppliedParsed = JSON.parse(mcpApplied.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(mcpAppliedParsed.execution.status).toBe("completed");
      expect(mcpAppliedParsed.execution.dryRun).toBe(false);
      expect(mcpAppliedParsed.execution.summary.ingestedCount).toBe(1);

      const lifecycle = await client.callTool({
        name: "osk_run_lifecycle_once",
        arguments: { projectRoot: root }
      });
      const lifecycleText = lifecycle.content.find((item) => item.type === "text")?.text;
      expect(lifecycleText).toContain("highValueEvents");

      const draft = await client.callTool({
        name: "openskill_draft",
        arguments: { topic: "mcp agent handoff", projectRoot: root, noLlm: true }
      });
      const text = draft.content.find((item) => item.type === "text")?.text;
      expect(text).toBeTruthy();
      expect(text).not.toContain(root);

      const parsed = JSON.parse(text ?? "{}");
      expect(parsed.skillName).toBe("mcp-agent-handoff");
      expect(parsed.skillDir).toContain(".openskill-kit");

      const skillMarkdown = await readFile(path.join(root, ".openskill-kit", "runs", parsed.runId, "candidate", parsed.skillName, "SKILL.md"), "utf8");
      expect(skillMarkdown).toContain("mcp agent handoff");

      const evaluation = await client.callTool({
        name: "openskill_evaluate",
        arguments: { skillPath: parsed.skillDir, projectRoot: root }
      });
      const evaluationText = evaluation.content.find((item) => item.type === "text")?.text;
      expect(evaluationText).toBeTruthy();
      const evaluationParsed = JSON.parse(evaluationText ?? "{}");
      expect(evaluationParsed.schemaVersion).toBe("openskill-kit.evaluation.v0");
      expect(evaluationParsed.status).not.toBe("fail");
    } finally {
      await client.close();
    }
  }, 45_000);
});

function learnV2McpBehaviorAtom(id: string, statement: string, polarity: LearnV2BehaviorAtom["polarity"]): LearnV2BehaviorAtom {
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

function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
