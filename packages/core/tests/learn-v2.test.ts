import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
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
  getAgentTaskContext,
  initAdaptiveProject,
  mergeLearnV2ConceptCards,
  normalizeLearnV2Evidence,
  analyzeLearnV2StructuralDiff,
  learnV2StructuralParserBackends,
  summarizeLearnV2Patches,
  summarizeLearnV2Tools,
  buildReviewQueue,
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
  learnV2ConceptStorePath,
  syncLearnV2ActiveConcepts,
  readWorkflowGraph,
  writeLearnV2ReviewQueue,
  reconstructPersistedLearnV2Episodes,
  extractPersistedLearnV2Concepts,
  runPersistedLearnV2Eval,
  readPreferenceGraph,
  readLearnV2Surface,
  discoverLearnV2SurfaceCandidates,
  learnV2SurfaceAdapterContracts,
  learnV2SurfaceAdapterDiscoveryRoots,
  validateLearnV2SurfaceAdapterContracts,
  reconstructLearnV2Episodes,
  runRawLocalLearning,
  runLearnV2RawVaultMaintenance,
  executeLearnV2ModelRequests,
  writeLearnV2ModelRequests,
  writeLearnV2ScopeInferenceRequests,
  applyLearnV2ScopeInferenceOutputs,
  writeLearnV2ContradictionReviewRequests,
  applyLearnV2ContradictionReviewOutputs,
  writeLearnV2EvalPlannerRequests,
  applyLearnV2EvalPlannerOutputs,
  writeLearnV2BehaviorEvalRequests,
  applyLearnV2BehaviorEvalOutputs,
  writeLearnV2EpisodeStore,
  writeLearnV2ConflictLedger,
  writeLearnV2CounterevidenceLedger,
  writeLearnV2DeclassifiedSnippetArtifact,
  writeLearnV2OutcomePolicyArtifact,
  writeLearnV2ConceptDebugTraceArtifact,
  readLearnV2EpisodeDebugView,
  readLearnV2SourceGateDebugView,
  storeLearnV2RawEvidence,
  detectLearnV2ConceptDrift,
  runLearnV2Eval,
  scoreLearnV2ProjectRelevance,
  scoreLearnV2ActivationEntries,
  validateLearnV2LlmExtractionProposal,
  validateLearnV2ModelOutputBoundary,
  readLearnV2ConceptActivationRuns,
  buildLearnV2LearningObservationsFromEvidence,
  extractLearnV2ContextFactors,
  inferLearnV2ConditionalHypotheses,
  decideLearnV2MemoryAdmission,
  learnV2ConditionalHypothesesToBehaviorAtoms,
  readLearnV2ConditionalLearningDebugView,
  buildLearnV2SkillNamespaces,
  buildLearnV2SkillOntologyOperations,
  readLearnV2SkillOntologyDebugView,
  writeLearnV2OpenWorldGroundingArtifact,
  readLearnV2OpenWorldGroundingDebugView,
  readProjectConfig,
  type LearnV2BehaviorAtom,
  type LearnV2NormalizedEvidence,
  type LearnV2OpenCodeInvocation,
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

  it("uses current git head commits as project relevance anchors with a project path", async () => {
    const root = await tempProject();
    const headCommit = "0123456789abcdef0123456789abcdef01234567";
    await mkdir(path.join(root, ".git", "refs", "heads"), { recursive: true });
    await writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    await writeFile(path.join(root, ".git", "refs", "heads", "main"), `${headCommit}\n`, "utf8");
    const source = path.join(root, "ci.log");
    await writeFile(source, `CI for ${headCommit.slice(0, 12)} passed after npm test -- parser in packages/core/src/parser.ts`, "utf8");

    const relevance = await scoreLearnV2ProjectRelevance(root, source, await readText(source));
    expect(relevance.decision).toBe("accept");
    expect(relevance.gate).toBe("hard-accept");
    expect(relevance.reasons).toContain("current-head-commit-mentioned");
    expect(relevance.reasons).toContain("hard-accept:current-head-commit-plus-project-anchor");
    expect(relevance.featureValues.currentHeadCommitMentioned).toBe(1);
    expect(relevance.matchedCommits).toEqual([headCommit.slice(0, 12)]);

    const externalSource = path.join(os.tmpdir(), "ci-with-only-commit.log");
    await writeFile(externalSource, `CI ${headCommit.slice(0, 12)} PASS npm test`, "utf8");
    const external = await scoreLearnV2ProjectRelevance(root, externalSource, await readText(externalSource));
    expect(external.decision).toBe("review");
    expect(external.gate).toBe("hard-review");
    expect(external.reasons).toContain("hard-review:unanchored-test-or-command-log");
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

  it("normalizes IDE diagnostics and issue tracker exports as explicit raw surfaces", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_diagnostics_issues");
    const diagnostics = path.join(root, "ide-diagnostics.json");
    const issues = path.join(root, "github-issues.md");
    await writeFile(diagnostics, JSON.stringify({
      diagnostics: [{
        severity: "error",
        source: "pyright",
        message: "Parser fixture missing",
        path: "packages/core/src/parser.ts"
      }]
    }), "utf8");
    await writeFile(issues, [
      "Issue: Parser regression",
      "Status: open",
      "Body: Add focused parser tests for packages/core/src/parser.ts before broad suite"
    ].join("\n"), "utf8");

    const diagnosticEvidence = normalizeLearnV2Evidence(await readLearnV2Surface(diagnostics), record, await readText(diagnostics));
    const issueEvidence = normalizeLearnV2Evidence(await readLearnV2Surface(issues), record, await readText(issues));

    expect(diagnosticEvidence[0]).toMatchObject({
      kind: "test-result",
      actor: "tool",
      status: "fail"
    });
    expect(diagnosticEvidence[0]!.metadata.adapter).toBe("ide-diagnostics");
    expect(diagnosticEvidence[0]!.paths).toContain("packages/core/src/parser.ts");
    expect(issueEvidence[0]).toMatchObject({
      kind: "review",
      actor: "reviewer"
    });
    expect(issueEvidence[0]!.metadata.adapter).toBe("issue-local");
    expect(issueEvidence.some((item) => item.paths.includes("packages/core/src/parser.ts"))).toBe(true);
  });

  it("normalizes local JUnit XML reports as CI test evidence", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_junit_xml");
    const junit = path.join(root, "junit-results.xml");
    await writeFile(junit, [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<testsuites>",
      "  <testsuite name=\"parser\" tests=\"2\" failures=\"1\">",
      "    <testcase classname=\"ParserSpec\" name=\"keeps focused fixtures\" file=\"packages/core/tests/parser.test.ts\" />",
      "    <testcase classname=\"ParserSpec\" name=\"rejects broad rewrite\" file=\"packages/core/src/parser.ts\">",
      "      <failure type=\"AssertionError\" message=\"Expected focused parser regression\">packages/core/src/parser.ts:42</failure>",
      "    </testcase>",
      "  </testsuite>",
      "  <testsuite name=\"platform\" tests=\"1\" skipped=\"1\">",
      "    <testcase classname=\"WindowsSpec\" name=\"skips unsupported signal\" file=\"packages/core/src/platform.ts\">",
      "      <skipped message=\"not on this platform\" />",
      "    </testcase>",
      "  </testsuite>",
      "</testsuites>"
    ].join("\n"), "utf8");

    const surface = await readLearnV2Surface(junit);
    const evidence = normalizeLearnV2Evidence(surface, record, await readText(junit));

    expect(surface).toMatchObject({
      adapterId: "ci-log",
      detectedFormat: "xml",
      normalizationProfile: "ci-log"
    });
    expect(evidence).toHaveLength(3);
    expect(evidence[0]).toMatchObject({
      kind: "test-result",
      actor: "ci",
      status: "pass"
    });
    expect(evidence[1]).toMatchObject({
      kind: "test-result",
      actor: "ci",
      status: "fail"
    });
    expect(evidence[1]!.text).toContain("Expected focused parser regression");
    expect(evidence[1]!.paths).toEqual(expect.arrayContaining(["packages/core/src/parser.ts"]));
    expect(evidence[1]!.metadata).toMatchObject({
      adapter: "ci-log",
      detectedFormat: "xml",
      junit: true,
      suite: "parser",
      className: "ParserSpec",
      testName: "rejects broad rewrite"
    });
    expect(evidence[2]).toMatchObject({
      kind: "test-result",
      actor: "ci",
      status: "blocked"
    });
    expect(evidence[2]!.text).toContain("not on this platform");
    expect(evidence[2]!.metadata).toMatchObject({
      suite: "platform",
      className: "WindowsSpec",
      testName: "skips unsupported signal"
    });
  });

  it("lifts OpenCode trace context from raw JSONL surfaces into episode stitching ids", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_opencode_trace");
    const jsonl = path.join(root, "opencode-events.jsonl");
    const traceContext = {
      schemaVersion: "openskill-kit.learn-v2.trace-context.v1",
      oskSessionId: "osk_session_trace_test",
      oskEpisodeId: "osk_episode_trace_test",
      oskTraceId: "osk_trace_trace_test",
      opencodeSessionId: "opencode_session_trace_test",
      projectRootHash: "sha256:root",
      createdAt: "2026-06-30T00:00:00.000Z"
    };
    await writeFile(jsonl, [
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        eventType: "post-tool-use",
        capturedAt: "2026-06-30T00:01:00.000Z",
        traceContext,
        metadata: { "input.tool": "bash", "input.commandKind": "package-manager" },
        text: "Prefer focused parser tests in packages/core/src/parser.ts"
      }),
      JSON.stringify({
        schemaVersion: "openskill-kit.opencode-ambient-event.v1",
        eventType: "post-tool-use",
        capturedAt: "2026-06-30T00:02:00.000Z",
        traceContext,
        text: "Run npm test -- parser before final summary"
      })
    ].join("\n") + "\n", "utf8");

    const evidence = normalizeLearnV2Evidence(await readLearnV2Surface(jsonl), record, await readText(jsonl));
    const episodes = reconstructLearnV2Episodes(evidence);

    expect(evidence).toHaveLength(2);
    expect(evidence.every((item) => item.sessionId === "osk_session_trace_test")).toBe(true);
    expect(evidence.every((item) => item.traceId === "osk_trace_trace_test")).toBe(true);
    expect(evidence.every((item) => item.episodeId === "osk_episode_trace_test")).toBe(true);
    expect(evidence[0]!.metadata.traceContext).toMatchObject({
      oskSessionId: "osk_session_trace_test",
      oskEpisodeId: "osk_episode_trace_test",
      oskTraceId: "osk_trace_trace_test",
      opencodeSessionId: "opencode_session_trace_test"
    });
    expect(episodes).toHaveLength(1);
    expect(episodes[0]!.stitching.method).toBe("explicit-id");
    expect(episodes[0]!.traceIds).toEqual(["osk_trace_trace_test"]);
    expect(episodes[0]!.sessionIds).toEqual(["osk_session_trace_test"]);
  });

  it("normalizes structured Codex Claude Cursor and OpenCode session export shapes", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_session_exports");
    const claude = path.join(root, "claude-session.json");
    const cursor = path.join(root, "cursor-chat.json");
    const codex = path.join(root, "codex-transcript.jsonl");
    const opencode = path.join(root, "opencode-session.json");
    await writeFile(claude, JSON.stringify({
      messages: [{
        role: "assistant",
        sessionID: "claude_session_1",
        content: [
          { type: "text", text: "Prefer focused parser regression tests in packages/core/src/parser.ts." },
          { type: "tool_use", name: "Bash", input: { command: "npm test -- parser" } }
        ]
      }]
    }), "utf8");
    await writeFile(cursor, JSON.stringify({
      conversationId: "cursor_conversation_1",
      messages: [{
        role: "user",
        content: [{ type: "text", text: "Avoid broad parser rewrites." }],
        contextFiles: ["packages/core/src/parser.ts"],
        attachments: [{ path: "packages/core/tests/parser.test.ts" }]
      }]
    }), "utf8");
    await writeFile(codex, `${JSON.stringify({
      type: "function_call",
      role: "assistant",
      name: "shell",
      arguments: JSON.stringify({ cmd: "npm run test -- parser" }),
      output: "PASS packages/core/tests/parser.test.ts"
    })}\n`, "utf8");
    await writeFile(opencode, JSON.stringify({
      metadata: { oskSessionId: "osk_session_from_parent_metadata" },
      events: [{
        eventType: "tool.execute",
        tool: "bash",
        input: { command: "npm test -- parser" },
        metadata: { commandKind: "package-manager" },
        text: "PASS parser suite"
      }]
    }), "utf8");

    const claudeEvidence = normalizeLearnV2Evidence(await readLearnV2Surface(claude), record, await readText(claude));
    const cursorEvidence = normalizeLearnV2Evidence(await readLearnV2Surface(cursor), record, await readText(cursor));
    const codexEvidence = normalizeLearnV2Evidence(await readLearnV2Surface(codex), record, await readText(codex));
    const opencodeEvidence = normalizeLearnV2Evidence(await readLearnV2Surface(opencode), record, await readText(opencode));

    expect(claudeEvidence[0]!).toMatchObject({
      actor: "assistant",
      toolName: "Bash",
      commands: ["npm test -- parser"],
      sessionId: "claude_session_1"
    });
    expect(claudeEvidence[0]!.text).toContain("Prefer focused parser regression tests");
    expect(cursorEvidence[0]!.actor).toBe("user");
    expect(cursorEvidence[0]!.paths).toEqual(expect.arrayContaining([
      "packages/core/src/parser.ts",
      "packages/core/tests/parser.test.ts"
    ]));
    expect(cursorEvidence[0]!.sessionId).toBe("cursor_conversation_1");
    expect(codexEvidence[0]!).toMatchObject({
      kind: "tool-call",
      toolName: "shell",
      commands: ["npm run test -- parser"]
    });
    expect(opencodeEvidence[0]!).toMatchObject({
      kind: "tool-call",
      toolName: "bash",
      commands: ["npm test -- parser"],
      sessionId: "osk_session_from_parent_metadata"
    });
  });

  it("detects raw surface adapters from file identity without parent-path false positives", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-parent-should-not-win-"));
    const codex = path.join(root, "codex-transcript.md");
    const claude = path.join(root, "claude-transcript.md");
    const cursor = path.join(root, "cursor-chat.md");
    const gemini = path.join(root, "gemini-session.jsonl");
    const roo = path.join(root, "roo-code-chat.md");
    const kilo = path.join(root, "kilo-code-session.md");
    const cline = path.join(root, "cline-transcript.txt");
    const goose = path.join(root, "goose-session.json");
    const zed = path.join(root, "zed-agent-chat.md");
    const diagnostics = path.join(root, "ide-diagnostics.json");
    const issues = path.join(root, "github-issues.md");
    const junit = path.join(root, "junit-results.xml");
    const diff = path.join(root, "session.diff");
    const generic = path.join(root, "session.md");
    const summaryCollision = path.join(root, "ordinary-session.md");
    const docs = path.join(root, "README.md");
    const handoff = path.join(root, "handoff.md");
    await writeFile(codex, "user: Prefer focused parser tests.\nassistant: done", "utf8");
    await writeFile(claude, "user: Prefer focused parser tests.\nassistant: done", "utf8");
    await writeFile(cursor, "user: Prefer focused parser tests.\nassistant: done", "utf8");
    await writeFile(gemini, "{\"role\":\"user\",\"content\":\"Prefer focused parser tests.\"}\n", "utf8");
    await writeFile(roo, "user: Prefer focused parser tests.\nassistant: done", "utf8");
    await writeFile(kilo, "user: Prefer focused parser tests.\nassistant: done", "utf8");
    await writeFile(cline, "user: Prefer focused parser tests.\nassistant: done", "utf8");
    await writeFile(goose, JSON.stringify([{ role: "user", content: "Prefer focused parser tests." }]), "utf8");
    await writeFile(zed, "user: Prefer focused parser tests.\nassistant: done", "utf8");
    await writeFile(diagnostics, JSON.stringify({ diagnostics: [{ severity: "error", source: "eslint", message: "Parser fixture missing", path: "packages/core/src/parser.ts" }] }), "utf8");
    await writeFile(issues, "Issue: Parser regression\nStatus: open\nBody: Add focused parser tests for packages/core/src/parser.ts", "utf8");
    await writeFile(junit, "<testsuite name=\"parser\"><testcase classname=\"ParserSpec\" name=\"regression\" file=\"packages/core/tests/parser.test.ts\" /></testsuite>", "utf8");
    await writeFile(diff, "diff --git a/src/parser.ts b/src/parser.ts\n+test", "utf8");
    await writeFile(generic, "user: Prefer focused parser tests.\nassistant: done", "utf8");
    await writeFile(summaryCollision, "Summary: we discussed the plan.\nuser: Prefer focused parser tests.\nassistant: done", "utf8");
    await writeFile(docs, "# Project Plan\nPrefer focused parser tests.", "utf8");
    await writeFile(handoff, "Summary: changed parser tests.\nTests: npm test -- parser\nNext: review.", "utf8");

    const codexSurface = await readLearnV2Surface(codex);
    const claudeSurface = await readLearnV2Surface(claude);
    const cursorSurface = await readLearnV2Surface(cursor);
    const geminiSurface = await readLearnV2Surface(gemini);
    const rooSurface = await readLearnV2Surface(roo);
    const kiloSurface = await readLearnV2Surface(kilo);
    const clineSurface = await readLearnV2Surface(cline);
    const gooseSurface = await readLearnV2Surface(goose);
    const zedSurface = await readLearnV2Surface(zed);
    const diagnosticsSurface = await readLearnV2Surface(diagnostics);
    const issuesSurface = await readLearnV2Surface(issues);
    const junitSurface = await readLearnV2Surface(junit);
    const diffSurface = await readLearnV2Surface(diff);
    const genericSurface = await readLearnV2Surface(generic);
    const summaryCollisionSurface = await readLearnV2Surface(summaryCollision);
    const docsSurface = await readLearnV2Surface(docs);
    const handoffSurface = await readLearnV2Surface(handoff);

    expect(codexSurface.adapterId).toBe("codex");
    expect(codexSurface.adapterDetection).toMatchObject({ matchedBy: "filename", confidence: "high" });
    expect(claudeSurface.adapterId).toBe("claude-code");
    expect(cursorSurface.adapterId).toBe("cursor");
    expect(geminiSurface.adapterId).toBe("gemini");
    expect(rooSurface.adapterId).toBe("roo");
    expect(kiloSurface.adapterId).toBe("kilo");
    expect(clineSurface.adapterId).toBe("cline");
    expect(gooseSurface.adapterId).toBe("goose");
    expect(zedSurface.adapterId).toBe("zed");
    expect(diagnosticsSurface.adapterId).toBe("ide-diagnostics");
    expect(issuesSurface.adapterId).toBe("issue-local");
    expect(junitSurface).toMatchObject({ adapterId: "ci-log", detectedFormat: "xml" });
    expect(diffSurface.adapterId).toBe("git");
    expect(diffSurface.contentKind).toBe("diff");
    expect(genericSurface.adapterId).toBe("generic-transcript");
    expect(genericSurface.adapterDetection).toMatchObject({ matchedBy: "fallback", confidence: "low" });
    expect(summaryCollisionSurface.adapterId).toBe("generic-transcript");
    expect(summaryCollisionSurface.adapterDetection).toMatchObject({ matchedBy: "fallback", confidence: "low" });
    expect(docsSurface.adapterId).toBe("project-docs");
    expect(docsSurface.adapterDetection).toMatchObject({ matchedBy: "filename", confidence: "high" });
    expect(handoffSurface.adapterId).toBe("agent-summaries");
    expect(handoffSurface.adapterDetection).toMatchObject({ matchedBy: "filename", confidence: "high" });
    const discovered = await discoverLearnV2SurfaceCandidates(root, { limit: 20 });
    expect(discovered.map((candidate) => candidate.adapterId)).toEqual(expect.arrayContaining([
      "gemini",
      "roo",
      "kilo",
      "cline",
      "goose",
      "zed",
      "ide-diagnostics",
      "issue-local",
      "ci-log"
    ]));
    expect(discovered.find((candidate) => candidate.relativePath === "junit-results.xml")).toMatchObject({
      adapterId: "ci-log",
      detectedFormat: "xml",
      normalizationProfile: "ci-log"
    });
    expect(discovered.find((candidate) => candidate.adapterId === "gemini")?.score).toBeGreaterThanOrEqual(0.72);
    expect(diffSurface.normalizationProfile).toBe("diff");
    expect(handoffSurface.normalizationProfile).toBe("agent-summaries");
    expect(genericSurface.normalizationProfile).toBe("generic-transcript");
  });

  it("discovers project-local hidden export directories without scanning memory stores", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-hidden-export-discovery-"));
    await mkdir(path.join(root, ".codex", "sessions"), { recursive: true });
    await mkdir(path.join(root, ".codex", "memories"), { recursive: true });
    await mkdir(path.join(root, ".claude", "projects", "openskill"), { recursive: true });
    await mkdir(path.join(root, ".cursor", "chats"), { recursive: true });
    await mkdir(path.join(root, ".vscode", "diagnostics"), { recursive: true });
    await mkdir(path.join(root, ".opencode", "sessions"), { recursive: true });
    await mkdir(path.join(root, ".opencode", "commands"), { recursive: true });
    await mkdir(path.join(root, ".opencode", "memories"), { recursive: true });
    await mkdir(path.join(root, ".gemini", "transcripts"), { recursive: true });
    await mkdir(path.join(root, ".roo-code", "sessions"), { recursive: true });
    await mkdir(path.join(root, ".kilo-code", "sessions"), { recursive: true });
    await mkdir(path.join(root, ".cline", "chats"), { recursive: true });
    await mkdir(path.join(root, ".goose", "sessions"), { recursive: true });
    await mkdir(path.join(root, ".zed", "transcripts"), { recursive: true });
    await mkdir(path.join(root, ".gemini", "memories"), { recursive: true });
    await writeFile(path.join(root, ".codex", "sessions", "2026-07-05.jsonl"), "{\"role\":\"user\",\"content\":\"Prefer parser tests.\"}\n", "utf8");
    await writeFile(path.join(root, ".codex", "memories", "private.md"), "Do not discover this private memory.", "utf8");
    await writeFile(path.join(root, ".claude", "projects", "openskill", "session.json"), "{\"messages\":[{\"role\":\"user\",\"content\":\"Prefer parser tests.\"}]}\n", "utf8");
    await writeFile(path.join(root, ".cursor", "chats", "chat.json"), "{\"messages\":[{\"role\":\"user\",\"content\":\"Prefer parser tests.\"}]}\n", "utf8");
    await writeFile(path.join(root, ".vscode", "diagnostics", "problems.json"), "{\"diagnostics\":[{\"severity\":\"error\",\"message\":\"Parser fixture missing\",\"path\":\"packages/core/src/parser.ts\"}]}\n", "utf8");
    await writeFile(path.join(root, ".opencode", "sessions", "session.jsonl"), "{\"role\":\"user\",\"content\":\"Prefer parser tests.\"}\n", "utf8");
    await writeFile(path.join(root, ".opencode", "commands", "learn.md"), "Command docs are not raw session exports.", "utf8");
    await writeFile(path.join(root, ".opencode", "memories", "private.md"), "Do not discover this private memory.", "utf8");
    await writeFile(path.join(root, ".gemini", "transcripts", "session.jsonl"), "{\"role\":\"user\",\"content\":\"Prefer parser tests.\"}\n", "utf8");
    await writeFile(path.join(root, ".roo-code", "sessions", "session.jsonl"), "{\"role\":\"user\",\"content\":\"Prefer parser tests.\"}\n", "utf8");
    await writeFile(path.join(root, ".kilo-code", "sessions", "session.jsonl"), "{\"role\":\"user\",\"content\":\"Prefer parser tests.\"}\n", "utf8");
    await writeFile(path.join(root, ".cline", "chats", "chat.json"), "{\"role\":\"user\",\"content\":\"Prefer parser tests.\"}\n", "utf8");
    await writeFile(path.join(root, ".goose", "sessions", "session.jsonl"), "{\"role\":\"user\",\"content\":\"Prefer parser tests.\"}\n", "utf8");
    await writeFile(path.join(root, ".zed", "transcripts", "session.jsonl"), "{\"role\":\"user\",\"content\":\"Prefer parser tests.\"}\n", "utf8");
    await writeFile(path.join(root, ".gemini", "memories", "private.md"), "Do not discover this private memory.", "utf8");

    const discovered = await discoverLearnV2SurfaceCandidates(root, { limit: 20 });
    const byPath = new Map(discovered.map((candidate) => [candidate.relativePath, candidate]));

    expect(byPath.get(".codex/sessions/2026-07-05.jsonl")).toMatchObject({
      adapterId: "codex",
      normalizationProfile: "structured-events",
      detection: {
        matchedBy: "filename",
        confidence: "high",
        reasons: expect.arrayContaining(["project-export-dir:codex:.codex/sessions"])
      }
    });
    expect(byPath.get(".claude/projects/openskill/session.json")?.adapterId).toBe("claude-code");
    expect(byPath.get(".cursor/chats/chat.json")?.adapterId).toBe("cursor");
    expect(byPath.get(".vscode/diagnostics/problems.json")?.adapterId).toBe("ide-diagnostics");
    expect(byPath.get(".opencode/sessions/session.jsonl")?.adapterId).toBe("opencode");
    expect(byPath.get(".gemini/transcripts/session.jsonl")?.adapterId).toBe("gemini");
    expect(byPath.get(".roo-code/sessions/session.jsonl")?.adapterId).toBe("roo");
    expect(byPath.get(".kilo-code/sessions/session.jsonl")?.adapterId).toBe("kilo");
    expect(byPath.get(".cline/chats/chat.json")?.adapterId).toBe("cline");
    expect(byPath.get(".goose/sessions/session.jsonl")?.adapterId).toBe("goose");
    expect(byPath.get(".zed/transcripts/session.jsonl")?.adapterId).toBe("zed");
    expect([...byPath.keys()].some((item) => item.includes(".codex/memories"))).toBe(false);
    expect([...byPath.keys()].some((item) => item.includes(".gemini/memories"))).toBe(false);
    expect([...byPath.keys()].some((item) => item.includes(".opencode/memories"))).toBe(false);
    expect([...byPath.keys()].some((item) => item.includes(".opencode/commands"))).toBe(false);
  });

  it("exposes a validated raw surface adapter contract with normalization profiles", async () => {
    const contracts = validateLearnV2SurfaceAdapterContracts();
    const descriptorContracts = learnV2SurfaceAdapterContracts();
    const discoveryRoots = learnV2SurfaceAdapterDiscoveryRoots();
    const byId = new Map(contracts.map((contract) => [contract.id, contract]));

    expect(contracts.map((contract) => contract.id)).toEqual([
      "opencode",
      "codex",
      "claude-code",
      "cursor",
      "gemini",
      "roo",
      "kilo",
      "cline",
      "goose",
      "zed",
      "git",
      "terminal",
      "ide-diagnostics",
      "issue-local",
      "review-local",
      "ci-log",
      "project-docs",
      "agent-summaries",
      "generic-transcript"
    ]);
    expect(descriptorContracts).toEqual(contracts);
    expect(byId.get("terminal")?.normalizationProfile).toBe("terminal");
    expect(byId.get("ide-diagnostics")?.normalizationProfile).toBe("ide-diagnostics");
    expect(byId.get("issue-local")?.normalizationProfile).toBe("issue-local");
    expect(byId.get("git")?.normalizationProfile).toBe("diff");
    expect(byId.get("project-docs")?.normalizationProfile).toBe("project-docs");
    expect(byId.get("codex")?.discovery).toMatchObject({
      projectLocalRoots: [".codex-log", ".codex/sessions", ".codex/transcripts"],
      blockedProjectLocalRoots: [".codex/memories", ".codex/memory"]
    });
    expect(byId.get("opencode")?.discovery.projectLocalRoots).toEqual([".opencode/sessions", ".opencode/traces"]);
    expect(byId.get("opencode")?.discovery.blockedProjectLocalRoots).toEqual([".opencode/memories", ".opencode/memory"]);
    expect(byId.get("ide-diagnostics")?.discovery.projectLocalRoots).toEqual([".vscode/diagnostics", ".vscode/problems", ".idea/diagnostics"]);
    expect(discoveryRoots.projectLocalRoots).toEqual(expect.arrayContaining([
      ".codex/sessions",
      ".claude/projects",
      ".cursor/chats",
      ".opencode/sessions",
      ".vscode/diagnostics",
      ".zed/transcripts"
    ]));
    expect(discoveryRoots.blockedProjectLocalRoots).toEqual(expect.arrayContaining([
      ".codex/memories",
      ".claude/memory",
      ".opencode/memories",
      ".zed/memory"
    ]));
    expect(byId.get("generic-transcript")?.capabilities).toEqual({
      discover: true,
      fetch: true,
      relevance: true,
      normalize: true
    });
    expect(contracts.every((contract) => contract.policy.selection === "explicit-only")).toBe(true);
    expect(contracts.every((contract) => contract.policy.modelBoundary === "declassified-only")).toBe(true);
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

  it("exposes structural parser backend registry for future parser upgrades", () => {
    const backends = learnV2StructuralParserBackends();
    const byLanguage = new Map(backends.map((backend) => [backend.language, backend]));

    expect([...byLanguage.keys()].sort()).toEqual(["go", "javascript", "python", "rust", "typescript"]);
    expect(byLanguage.get("typescript")).toMatchObject({
      backend: "typescript-compiler",
      confidence: "parser",
      confidenceCap: 1,
      capabilities: expect.arrayContaining(["ast-declarations", "hunk-scope", "import-tracking"]),
      limitations: ["hunk-context-dependent"]
    });
    expect(byLanguage.get("python")).toMatchObject({
      backend: "python-ast",
      confidence: "parser",
      confidenceCap: 0.94,
      capabilities: expect.arrayContaining(["ast-declarations", "hunk-scope", "import-tracking"]),
      limitations: ["hunk-context-dependent"]
    });
    for (const language of ["go", "rust"] as const) {
      expect(byLanguage.get(language)).toMatchObject({
        backend: "language-structural-scanner",
        confidence: "fallback",
        confidenceCap: 0.78,
        capabilities: expect.arrayContaining(["block-scope", "hunk-scope", "import-tracking", "metadata-adjacent-declarations"]),
        limitations: expect.arrayContaining(["fallback-confidence-cap", "hunk-context-dependent", "not-ast-equivalent"])
      });
    }

    const mutable = learnV2StructuralParserBackends();
    mutable[0]!.capabilities.push("unsupported-language");
    expect(learnV2StructuralParserBackends()[0]!.capabilities).not.toContain("unsupported-language");
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
    expect(summary.fileSummaries.find((file) => file.path.endsWith("parser-service.ts"))).toMatchObject({
      parserBackend: "typescript-compiler",
      structuralConfidence: "parser",
      confidenceCap: 1,
      parserCapabilities: expect.arrayContaining(["ast-declarations", "hunk-scope", "import-tracking"]),
      parserLimitations: ["hunk-context-dependent"]
    });
    expect(summary.fileSummaries.find((file) => file.path.endsWith("plugin-loader.js"))).toMatchObject({
      parserBackend: "typescript-compiler",
      structuralConfidence: "parser",
      confidenceCap: 1
    });
    expect(summary.semanticChange).toBe(true);
  });

  it("uses language structural scanners for Python Go and Rust scope signals", async () => {
    const diff = [
      "diff --git a/src/parser_engine.py b/src/parser_engine.py",
      "--- a/src/parser_engine.py",
      "+++ b/src/parser_engine.py",
      "@@",
      "+from osk.parser import (",
      "+    ParserConfig,",
      "+    parse_skill,",
      "+)",
      "+class ParserService:",
      "+    @classmethod",
      "+    def build(cls, source):",
      "+        return parse_skill(source)",
      "diff --git a/internal/parser/service.go b/internal/parser/service.go",
      "--- a/internal/parser/service.go",
      "+++ b/internal/parser/service.go",
      "@@",
      "+import (",
      "+  \"context\"",
      "+  parser \"example.com/acme/parser\"",
      "+)",
      "+type ParserConfig struct {",
      "+  Strict bool",
      "+}",
      "+func (s *Service) LoadParser(ctx context.Context) (*ParserConfig, error) {",
      "+  return parser.New(ctx)",
      "+}",
      "diff --git a/crates/parser/src/lib.rs b/crates/parser/src/lib.rs",
      "--- a/crates/parser/src/lib.rs",
      "+++ b/crates/parser/src/lib.rs",
      "@@",
      "+use crate::parser::{Parser, parse_skill};",
      "+pub struct SkillParser {",
      "+    strict: bool,",
      "+}",
      "+impl SkillParser {",
      "+    pub fn parse(&self, input: &str) -> Parser {",
      "+        parse_skill(input)",
      "+    }",
      "+}",
      "+macro_rules! parser_rule {",
      "+    () => {};",
      "+}"
    ].join("\n");

    const summary = analyzeLearnV2StructuralDiff(diff);

    expect(summary.languages).toEqual(["go", "python", "rust"]);
    expect(summary.changedSymbols).toEqual(expect.arrayContaining([
      "ParserService",
      "build",
      "ParserConfig",
      "LoadParser",
      "Service",
      "SkillParser",
      "parse",
      "parser_rule"
    ]));
    expect(summary.changedImports).toEqual(expect.arrayContaining([
      "osk.parser",
      "context",
      "example.com/acme/parser",
      "crate::parser::Parser",
      "crate::parser::parse_skill"
    ]));
    const pythonSummary = summary.fileSummaries.find((file) => file.language === "python")!;
    expect(pythonSummary.parserBackend).toBe("python-ast");
    expect(pythonSummary.structuralConfidence).toBe("parser");
    expect(pythonSummary.confidenceCap).toBe(0.94);
    expect(pythonSummary.parserCapabilities).toEqual(expect.arrayContaining(["ast-declarations", "hunk-scope", "import-tracking"]));
    expect(pythonSummary.parserLimitations).not.toContain("not-ast-equivalent");
    const fallbackSummaries = summary.fileSummaries.filter((file) => file.language === "go" || file.language === "rust");
    expect(fallbackSummaries.every((file) => file.parserBackend === "language-structural-scanner")).toBe(true);
    expect(fallbackSummaries.every((file) => file.structuralConfidence === "fallback")).toBe(true);
    expect(fallbackSummaries.every((file) => file.confidenceCap === 0.78)).toBe(true);
    expect(fallbackSummaries.every((file) => file.parserCapabilities.includes("block-scope"))).toBe(true);
    expect(fallbackSummaries.every((file) => file.parserCapabilities.includes("metadata-adjacent-declarations"))).toBe(true);
    expect(fallbackSummaries.every((file) => file.parserLimitations.includes("not-ast-equivalent"))).toBe(true);
    expect(fallbackSummaries.every((file) => file.parserLimitations.includes("fallback-confidence-cap"))).toBe(true);
    expect(summary.fileSummaries.every((file) => file.semanticChange === true)).toBe(true);
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

  it("compares proposed patches against final user edits and extracts correction atoms", async () => {
    const proposedPatch = [
      "proposed patch",
      "diff --git a/packages/core/src/parser.ts b/packages/core/src/parser.ts",
      "--- a/packages/core/src/parser.ts",
      "+++ b/packages/core/src/parser.ts",
      "@@",
      "-export function parseSkill(input: string) { return oldParse(input); }",
      "+export function parseSkill(input: string) { return parseWithRegression(input); }"
    ].join("\n");
    const finalPatch = [
      "final patch",
      "diff --git a/packages/core/src/parser.ts b/packages/core/src/parser.ts",
      "--- a/packages/core/src/parser.ts",
      "+++ b/packages/core/src/parser.ts",
      "@@",
      "-export function parseSkill(input: string) { return oldParse(input); }",
      "+export function parseSkill(input: string) { return parseWithRegression(input); }",
      "diff --git a/packages/core/tests/parser.test.ts b/packages/core/tests/parser.test.ts",
      "--- a/packages/core/tests/parser.test.ts",
      "+++ b/packages/core/tests/parser.test.ts",
      "@@",
      "+import { describe, expect, it } from \"vitest\";",
      "+import { parseSkill } from \"../src/parser.js\";",
      "+describe(\"parseSkill\", () => {",
      "+  it(\"keeps regression behavior\", () => {",
      "+    expect(parseSkill(\"value\")).toContain(\"value\");",
      "+  });",
      "+});"
    ].join("\n");
    const evidence = [
      normalizedFileChange("ev_agent_patch", proposedPatch, {
        sessionId: "sess_patch_compare",
        timestamp: "2026-06-30T00:00:00.000Z",
        paths: ["packages/core/src/parser.ts"]
      }),
      normalizedFileChange("ev_final_patch", finalPatch, {
        actor: "user",
        sessionId: "sess_patch_compare",
        timestamp: "2026-06-30T00:02:00.000Z",
        paths: ["packages/core/src/parser.ts", "packages/core/tests/parser.test.ts"]
      }),
      normalizedMessage("ev_user_edit", "I edited the final patch to add the missing focused regression test.", "user")
    ].map((item) => ({
      ...item,
      sessionId: item.sessionId ?? "sess_patch_compare",
      timestamp: item.timestamp ?? "2026-06-30T00:03:00.000Z"
    }));

    const patches = summarizeLearnV2Patches(evidence);
    expect(patches.map((patch) => patch.kind)).toEqual(["agent-patch", "final-patch"]);
    expect(patches[0]!.comparison?.role).toBe("agent-proposed");
    expect(patches[1]!.comparison?.role).toBe("user-final");
    expect(patches[1]!.comparison?.behaviorSignal).toBe("user-added-tests");
    expect(patches[1]!.comparison?.sharedPaths).toEqual(["packages/core/src/parser.ts"]);
    expect(patches[1]!.comparison?.finalOnlyPaths).toEqual(["packages/core/tests/parser.test.ts"]);
    expect(patches[1]!.comparison?.finalOnlyStructuralClasses).toContain("test");
    expect(patches[1]!.comparison?.evidenceStrength).toBe("strong");
    expect(patches[1]!.comparison?.reasons).toContain("pair-evidence-strong");
    expect(patches[1]!.comparison?.confidence).toBeGreaterThanOrEqual(0.5);

    const [episode] = reconstructLearnV2Episodes(evidence);
    expect(episode!.patchComparisons[1]!.comparison?.behaviorSignal).toBe("user-added-tests");
    const bundle = buildLearnV2EpisodeLearningBundle(episode!);
    expect(bundle.patches[1]!.comparison?.behaviorSignal).toBe("user-added-tests");

    const atoms = extractLearnV2BehaviorAtoms([episode!]).atoms;
    const correctionAtom = atoms.find((atom) => atom.statement.includes("include focused regression coverage"));
    expect(correctionAtom).toBeDefined();
    expect(correctionAtom!.kind).toBe("verification");
    expect(correctionAtom!.evidenceIds).toEqual(expect.arrayContaining(["ev_agent_patch", "ev_final_patch"]));
    expect(correctionAtom!.scope.paths).toEqual(expect.arrayContaining([
      "packages/core/src/parser.ts",
      "packages/core/tests/parser.test.ts"
    ]));
    expect(correctionAtom!.activationHints?.negativeTriggers).toEqual(expect.arrayContaining(["generated-only", "lockfile-only"]));
    expect(correctionAtom!.counterevidence?.[0]?.evidenceId).toBe("ev_agent_patch");
  });

  it("does not infer user patch taste from unrelated same-class parser edits", () => {
    const proposedPatch = [
      "diff --git a/packages/core/src/parser.ts b/packages/core/src/parser.ts",
      "--- a/packages/core/src/parser.ts",
      "+++ b/packages/core/src/parser.ts",
      "@@",
      "-export function parseSkill(input: string) { return oldParse(input); }",
      "+export function parseSkill(input: string) { return parseWithRegression(input); }"
    ].join("\n");
    const unrelatedFinalPatch = [
      "diff --git a/examples/demo/parser.ts b/examples/demo/parser.ts",
      "--- a/examples/demo/parser.ts",
      "+++ b/examples/demo/parser.ts",
      "@@",
      "-export function parseExample(input: string) { return oldExample(input); }",
      "+export function parseExample(input: string) { return newExample(input); }"
    ].join("\n");
    const patches = summarizeLearnV2Patches([
      normalizedFileChange("ev_agent_unrelated_parser_patch", proposedPatch, {
        sessionId: "sess_unrelated_pair",
        timestamp: "2026-06-30T00:00:00.000Z",
        metadata: { patchKind: "proposed patch" },
        paths: ["packages/core/src/parser.ts"]
      }),
      normalizedFileChange("ev_final_unrelated_parser_patch", unrelatedFinalPatch, {
        actor: "user",
        sessionId: "sess_unrelated_pair",
        timestamp: "2026-06-30T00:01:00.000Z",
        metadata: { patchKind: "final patch" },
        paths: ["examples/demo/parser.ts"]
      })
    ]);

    expect(patches).toHaveLength(2);
    expect(patches[0]!.comparison).toBeUndefined();
    expect(patches[1]!.comparison).toBeUndefined();
    expect(patches[0]!.pairedWithIds).toEqual([]);
    expect(patches[1]!.pairedWithIds).toEqual([]);
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
    expect(evalReport.proofBoundary.proves).not.toContain("configured behavior-delta golden checks");
    expect(evalReport.proofBoundary.doesNotProve).toContain("configured behavior-delta golden checks");
    await recordLearnV2ConceptOutcome(root, {
      conceptId: "concept_observable_outcome",
      outcome: "helpful",
      reason: "safe reason must not appear in observability"
    }, new Date("2026-06-30T00:11:00.000Z"));
    await recordLearnV2ConceptOutcome(root, {
      conceptId: "concept_observable_outcome",
      outcome: "harmful",
      reason: "raw harmful reason must not appear in observability"
    }, new Date("2026-06-30T00:12:00.000Z"));
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
      modelExecution: {
        requestedPolicy: "deterministic-only",
        deterministicExtraction: {
          supported: true,
          status: "always-on"
        },
        requestArtifacts: {
          status: "skipped-preview",
          requestCount: 0,
          requestDir: path.join(root, ".openskill-kit", "learn-v2", "model-requests"),
          routingManifestPath: path.join(root, ".openskill-kit", "learn-v2", "model-requests", "routing-manifest.json")
        },
        sanitizedOpenCodeExecution: {
          supported: true,
          requiresExplicitApproval: true,
          command: "openskill-kit osk learn --execute-model-requests --model-request .openskill-kit/learn-v2/model-requests/<request>/request-manifest.json",
          applyCommand: "openskill-kit osk learn --apply-model-responses --model-output .openskill-kit/learn-v2/model-requests/<request>/request-manifest.json"
        },
        rawToModelExecution: {
          supported: false,
          status: "rejected",
          reason: "Raw evidence is never sent directly to model execution.",
          saferPolicy: "opencode-host-sanitized-only"
        }
      },
      artifacts: {
        evalReport: evalReport.artifacts.markdown
      },
      nextActions: ["Inspect review queue."]
    });

    expect(report.compression.patches).toBe(2);
    expect(report.compression.behaviorEligiblePatches).toBe(1);
    expect(report.compression.auditOnlyPatches).toBe(1);
    expect(report.compression.patchFilterReasonCounts["generated-only"]).toBe(1);
    expect(report.compression.parserBackendCounts["typescript-compiler"]).toBe(1);
    expect(report.compression.structuralConfidenceCounts.parser).toBe(1);
    expect(report.compression.parserCapabilityCounts["ast-declarations"]).toBe(1);
    expect(report.compression.parserLimitationCounts["hunk-context-dependent"]).toBe(1);
    expect(report.compression.structuralConfidenceCapMin).toBe(1);
    expect(report.qualityGates.behaviorDeltaStatus).toBe("not-configured");
    expect(report.qualityGates.activationReplayRate).toBe(1);
    expect(report.qualityGates.counterfactualTraceRate).toBe(1);
    expect(report.concepts.outcomeTelemetry).toMatchObject({
      totalRecords: 2,
      conceptCount: 1,
      negativeOutcomeRecords: 1,
      harmfulOutcomeRecords: 1
    });
    expect(report.concepts.outcomeTelemetry.outcomeCounts.helpful).toBe(1);
    expect(report.concepts.outcomeTelemetry.outcomeCounts.harmful).toBe(1);
    expect(report.health.status).toBe("warn");
    expect(report.health.warnings).toEqual(expect.arrayContaining(["1 audit-only patch summary item(s)."]));
    expect(report.health.warnings).toEqual(expect.arrayContaining(["No behavior-delta eval goldens configured."]));
    expect(report.health.warnings).toEqual(expect.arrayContaining(["1 negative concept outcome record(s)."]));
    expect(report.health.blockers).toEqual([]);
    expect(report.privacy.rawRefsExported).toBe(false);
    expect(report.modelExecution.requestArtifacts.requestDir).toContain("[PROJECT_ROOT]");
    expect(report.modelExecution.rawToModelExecution.status).toBe("rejected");
    const reportPath = path.join(root, report.artifactsWritten.json.replace(/^\[PROJECT_ROOT\]\//, ""));
    const reportText = await readText(reportPath);
    expect(reportText).toContain("\"health\"");
    expect(reportText).toContain("\"behaviorDeltaStatus\"");
    expect(reportText).toContain("\"parserBackendCounts\"");
    expect(reportText).toContain("\"parserCapabilityCounts\"");
    expect(reportText).toContain("\"parserLimitationCounts\"");
    expect(reportText).toContain("\"outcomeTelemetry\"");
    expect(reportText).not.toContain("raw harmful reason");
    expect(reportText).not.toContain(root);
    expect(reportText).not.toContain("raw_ev_observable");
    const reportMarkdown = await readText(path.join(root, report.artifactsWritten.markdown.replace(/^\[PROJECT_ROOT\]\//, "")));
    expect(reportMarkdown).toContain("Behavior delta: not-configured");
    expect(reportMarkdown).toContain("Activation replay rate:");
    expect(reportMarkdown).toContain("Structural parser backends:");
    expect(reportMarkdown).toContain("Structural parser capabilities:");
    expect(reportMarkdown).toContain("Structural parser limitations:");
    expect(reportMarkdown).toContain("Outcome telemetry: 2 records across 1 concept(s)");

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
    const directConflict = ledger.ledger.conflicts.find((conflict) => conflict.conflictType === "direct-opposite")!;
    expect(directConflict.diagnostics).toMatchObject({
      scopeOverlap: true,
      sameKind: true,
      oppositePolarity: true
    });
    expect(directConflict.diagnostics?.tokenOverlap).toBeGreaterThanOrEqual(3);

    const queue = await writeLearnV2ReviewQueue(root, cards, now, {
      ledger: ledger.ledger,
      markdownPath: ledger.artifactPaths.markdown
    });
    expect(queue.conflictSummary.unresolvedCount).toBe(ledger.ledger.unresolvedCount);
    expect(queue.artifacts.conflictLedger).toBe(ledger.artifactPaths.markdown);
    expect(queue.conflictDetails.some((conflict) => conflict.conflictType === "direct-opposite")).toBe(true);
    expect(queue.conflictDetails.find((conflict) => conflict.conflictType === "direct-opposite")?.diagnostics).toMatchObject({
      scopeOverlap: true,
      sameKind: true,
      oppositePolarity: true
    });
    const reviewMarkdown = await readText(queue.artifacts.markdown);
    expect(reviewMarkdown).toContain("Unresolved conflicts:");
    expect(reviewMarkdown).toContain("direct-opposite");
    expect(reviewMarkdown).toContain("Conflict diagnostics:");
    expect(reviewMarkdown).toContain("scopeOverlap=true");
    expect(reviewMarkdown).toContain("tokenOverlap=");
    const ledgerText = await readText(ledger.artifactPaths.markdown);
    expect(ledgerText).toContain("Learn v2 Concept Conflict Ledger");
    expect(ledgerText).toContain("Diagnostics: scopeOverlap=true");
    expect(ledgerText).toContain("tokenOverlap=");
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
    expect(queue.reviewActions[conflictingCards[0]!.id]?.some((action) => action.command.includes("--concept-reject"))).toBe(true);
    expect(queue.reviewActions[conflictingCards[0]!.id]?.some((action) => action.command.includes("--concept-supersede"))).toBe(true);
    const markdown = await readText(queue.artifacts.markdown);
    expect(markdown).toContain("## Focus Cards");
    expect(markdown).toContain("Focus reasons: conflict:direct-opposite");
    expect(markdown).toContain("Suggested actions:");
    expect(markdown).toContain("openskill-kit osk review --concept-supersede");
    expect(markdown).toContain("## Full Store Appendix");
    expect(markdown).toContain(unrelatedActive.id);
  });

  it("renders safe bulk review commands with eligibility counts and safeguards", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:23:00.000Z");
    const [safeBase, oneOffBase, counterBase, broadBase] = mergeLearnV2ConceptCards([
      behaviorAtom("bulk_safe_ui", "Prefer focused UI checks for button style changes.", "positive"),
      behaviorAtom("bulk_one_off_ui", "Prefer green buttons for this one-off landing page.", "positive"),
      behaviorAtom("bulk_counter_ui", "Prefer dense dashboard cards.", "positive"),
      behaviorAtom("bulk_broad_ui", "Prefer all UI changes to use bright colors.", "positive")
    ], now);
    const safeCandidate = {
      ...safeBase!,
      status: "candidate" as const,
      risk: "low" as const,
      confidence: 0.95,
      sourceReliability: 0.95,
      scope: { ...safeBase!.scope, level: "path" as const, paths: ["packages/site/src/Button.tsx"], taskTypes: ["ui-design-change"] },
      atoms: safeBase!.atoms.map((atom) => ({ ...atom, risk: "low" as const, scope: { ...atom.scope, level: "path" as const, paths: ["packages/site/src/Button.tsx"], taskTypes: ["ui-design-change"] } }))
    };
    const oneOffCandidate = {
      ...oneOffBase!,
      status: "candidate" as const,
      durability: 0.32
    };
    const counterCandidate = {
      ...counterBase!,
      status: "candidate" as const,
      counterevidence: [{ evidenceId: "ev_counter_bulk", reason: "User later rejected dense dashboard cards." }]
    };
    const broadCandidate = {
      ...broadBase!,
      status: "candidate" as const,
      risk: "low" as const,
      confidence: 0.95,
      sourceReliability: 0.95,
      scope: { ...broadBase!.scope, level: "project" as const, paths: [], taskTypes: ["ui-design-change"] }
    };

    const queue = await writeLearnV2ReviewQueue(root, [safeCandidate, oneOffCandidate, counterCandidate, broadCandidate], now);
    expect(queue.safeBulkActionDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "accept-low-risk",
        eligibleCount: 1,
        command: "openskill-kit osk review --concept-bulk accept-low-risk",
        safeguards: expect.arrayContaining(["risk=low", "path-scoped", "no-counterevidence"])
      }),
      expect.objectContaining({ action: "reject-one-off", eligibleCount: 1 }),
      expect.objectContaining({ action: "mark-superseded", eligibleCount: 1 })
    ]));
    const markdown = await readText(queue.artifacts.markdown);
    expect(markdown).toContain("accept-low-risk: 1 eligible");
    expect(markdown).toContain("Command: openskill-kit osk review --concept-bulk accept-low-risk");
    expect(markdown).toContain("Safeguards: confidence>=");
    expect(markdown).toContain("reject-one-off: 1 eligible");
    expect(markdown).toContain("mark-superseded: 1 eligible");
    expect(markdown).not.toContain(root);
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
    const supersessionConflict = strongLedger.ledger.conflicts.find((conflict) => conflict.conflictType === "newer-supersedes-older")!;
    expect(supersessionConflict.diagnostics).toMatchObject({
      newerConceptId: strongNewer!.id,
      olderConceptId: older!.id,
      confidenceDelta: 0.23,
      authorityReasons: expect.arrayContaining(["rationale:explicit-preference"]),
      protectedReasons: []
    });
    const strongLedgerText = await readText(strongLedger.artifactPaths.markdown);
    expect(strongLedgerText).toContain("Supersession pair:");
    expect(strongLedgerText).toContain("Authority:");
    expect(strongLedgerText).toContain("rationale:explicit-preference");

    const justBelowThreshold = await writeLearnV2ConflictLedger(root, [
      { ...older!, status: "active", confidence: 0.73 },
      { ...strongNewer!, confidence: 0.87 }
    ], "project", newerTime);
    expect(justBelowThreshold.ledger.conflicts.map((conflict) => conflict.conflictType)).not.toContain("newer-supersedes-older");

    const atThreshold = await writeLearnV2ConflictLedger(root, [
      { ...older!, status: "active", confidence: 0.72 },
      { ...strongNewer!, confidence: 0.87 }
    ], "project", newerTime);
    expect(atThreshold.ledger.conflicts.map((conflict) => conflict.conflictType)).toContain("newer-supersedes-older");

    const protectedLedger = await writeLearnV2ConflictLedger(root, [
      { ...older!, status: "locked", confidence: 0.72 },
      { ...strongNewer!, confidence: 0.95 }
    ], "project", newerTime);
    expect(protectedLedger.ledger.conflicts.map((conflict) => conflict.conflictType)).not.toContain("newer-supersedes-older");
  });

  it("suggests concrete supersede commands for ledger-authorized replacements", async () => {
    const root = await tempProject();
    const olderTime = new Date("2026-06-30T00:20:00.000Z");
    const newerTime = new Date("2026-06-30T00:40:00.000Z");
    const [older] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("review_action_old_parser_tests", "Prefer focused parser tests for parser changes.", "positive"),
      confidence: 0.82
    }], olderTime);
    const [newer] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("review_action_new_parser_tests", "Prefer focused parser tests for parser changes.", "positive"),
      confidence: 0.95,
      rationale: "Explicit preference or correction language in episode.",
      evidenceIds: ["ev_user_review_action_new_parser_tests"]
    }], newerTime);
    const olderCard = {
      ...older!,
      id: "concept_review_action_old",
      status: "active" as const,
      confidence: 0.72,
      lifecycle: { ...older!.lifecycle, updatedAt: olderTime.toISOString() }
    };
    const newerCard = {
      ...newer!,
      id: "concept_review_action_new",
      confidence: 0.95,
      lifecycle: { ...newer!.lifecycle, updatedAt: newerTime.toISOString() }
    };
    const cards = [olderCard, newerCard];
    const ledger = await writeLearnV2ConflictLedger(root, cards, "project", newerTime);
    expect(ledger.ledger.conflicts.map((conflict) => conflict.conflictType)).toContain("newer-supersedes-older");

    const queue = await writeLearnV2ReviewQueue(root, cards, newerTime, {
      ledger: ledger.ledger,
      markdownPath: ledger.artifactPaths.markdown
    });
    const supersedeAction = queue.reviewActions[olderCard.id]?.find((action) => action.command.includes("--concept-supersede"));
    expect(supersedeAction?.command).toContain(`"supersededId":"${olderCard.id}"`);
    expect(supersedeAction?.command).toContain(`"supersededById":"${newerCard.id}"`);
    expect(supersedeAction?.command).toContain("Deterministic conflict ledger newer-supersedes-older");
    expect(supersedeAction?.command).not.toContain("concept_replacement");
    expect(supersedeAction?.rationale).toContain(newerCard.id);
    const markdown = await readText(queue.artifacts.markdown);
    expect(markdown).toContain(`"supersededById":"${newerCard.id}"`);
    expect(markdown).not.toContain(`"supersededById":"concept_replacement"`);
  });

  it("suggests concrete narrow commands for ledger-authorized scope overlaps", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:45:00.000Z");
    const [testsConcept] = mergeLearnV2ConceptCards([
      behaviorAtom("review_action_narrow_tests", "Prefer parser regression tests for parser changes.", "positive")
    ], now);
    const [fixtureConcept] = mergeLearnV2ConceptCards([
      behaviorAtom("review_action_narrow_fixtures", "Prefer parser fixture coverage for parser edits.", "positive")
    ], now);
    const cards = [
      { ...testsConcept!, id: "concept_review_action_narrow_tests" },
      { ...fixtureConcept!, id: "concept_review_action_narrow_fixtures" }
    ];
    const ledger = await writeLearnV2ConflictLedger(root, cards, "project", now);
    expect(ledger.ledger.conflicts.map((conflict) => conflict.conflictType)).toContain("scope-overlap");
    expect(ledger.ledger.conflicts.map((conflict) => conflict.resolutionAction)).toContain("auto-narrow");

    const queue = await writeLearnV2ReviewQueue(root, cards, now, {
      ledger: ledger.ledger,
      markdownPath: ledger.artifactPaths.markdown
    });
    const narrowAction = queue.reviewActions[cards[0]!.id]?.find((action) => action.command.includes("--concept-narrow"));

    expect(narrowAction?.command).toContain(`"id":"${cards[0]!.id}"`);
    expect(narrowAction?.command).toContain("\"paths\":[\"packages/core/src/parser.ts\"]");
    expect(narrowAction?.command).toContain("\"taskTypes\":[\"parser-change\"]");
    expect(narrowAction?.command).toContain(cards[1]!.title);
    expect(narrowAction?.rationale).toContain(cards[1]!.id);
    const markdown = await readText(queue.artifacts.markdown);
    expect(markdown).toContain("Narrow scope:");
    expect(markdown).toContain("--concept-narrow");
    expect(markdown).toContain(cards[1]!.title);
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
    expect(queue.driftSummary.staleCandidates[0]).toMatchObject({
      conceptId: active.id,
      reason: "recent-negative-outcomes",
      negativeOutcomeCount: 2
    });
    expect(queue.reviewActions[active.id]?.map((action) => action.command)).toContain(`openskill-kit osk review --concept-demote ${active.id}`);
    const reviewMarkdown = await readText(queue.artifacts.markdown);
    expect(reviewMarkdown).toContain("Drift Summary");
    expect(reviewMarkdown).toContain("recent-negative-outcomes");
    expect(reviewMarkdown).toContain(`- ${active.id}: recent-negative-outcomes; negative=2`);
    expect(reviewMarkdown).toContain("Drift suggestion: Concept has 2 recent negative outcome(s)");
    expect(reviewMarkdown).toContain(`Demote: openskill-kit osk review --concept-demote ${active.id}`);
  });

  it("calibrates concept scoring from activation outcome telemetry without copying raw reasons", async () => {
    const root = await tempProject();
    const createdAt = new Date("2026-06-30T00:20:00.000Z");
    const now = new Date("2026-06-30T00:35:00.000Z");
    const [candidate] = mergeLearnV2ConceptCards([
      behaviorAtom("outcome_calibrated_parser_fixture", "Prefer parser regression fixtures before parser refactors.", "positive")
    ], createdAt);
    const active = { ...candidate!, status: "active" as const };
    const initial = await writeLearnV2ConceptStore(root, [active], createdAt);
    const initialCard = initial.cards.find((card) => card.id === active.id)!;

    await recordLearnV2ConceptOutcome(root, {
      conceptId: active.id,
      outcome: "helpful",
      reason: "first helpful reason must stay local"
    }, new Date("2026-06-30T00:25:00.000Z"));
    await recordLearnV2ConceptOutcome(root, {
      conceptId: active.id,
      outcome: "helpful",
      reason: "second helpful reason must stay local"
    }, new Date("2026-06-30T00:26:00.000Z"));
    await recordLearnV2ConceptOutcome(root, {
      conceptId: active.id,
      outcome: "harmful",
      reason: "raw calibration reason sk-local-secret-must-not-enter-store"
    }, new Date("2026-06-30T00:27:00.000Z"));

    const result = await applyLearnV2ConceptReview(root, { now, compileActive: false });
    expect(result.messages).toContain("Recalibrated 1 concept score(s) from activation outcome telemetry.");
    const calibrated = await readLearnV2ConceptStore(root, now);
    const card = calibrated.cards.find((item) => item.id === active.id)!;
    expect(card.scoring?.calibratedFrom).toEqual(expect.arrayContaining(["deterministic-heuristic", "activation-outcome"]));
    expect(card.scoring).toMatchObject({
      outcomeHelpfulCount: 2,
      outcomeHarmfulCount: 1,
      outcomeBoost: 0.06,
      outcomePenalty: 0.12
    });
    expect(card.confidence).toBeLessThan(initialCard.confidence);
    expect(card.durability).toBeLessThan(initialCard.durability);
    const activationIndex = JSON.parse(await readText(path.join(root, ".openskill-kit", "learn-v2", "activation-index.json")));
    expect(activationIndex.entries.find((entry: { conceptId: string; confidence: number }) => entry.conceptId === active.id)?.confidence).toBe(card.confidence);
    const storeText = await readText(learnV2ConceptStorePath(root));
    expect(storeText).not.toContain("raw calibration reason");
    expect(storeText).not.toContain("sk-local-secret-must-not-enter-store");
    const queue = await writeLearnV2ReviewQueue(root, [card], now);
    expect(queue.reviewFocus.reasons[card.id]).toContain("scoring:activation-outcome");
    const reviewMarkdown = await readText(queue.artifacts.markdown);
    expect(reviewMarkdown).toContain("Scoring: calibrated=deterministic-heuristic, activation-outcome; outcomes helpful=2, ignored=0, wrong=0, harmful=1, superseded=0; boost=0.06 penalty=0.12");
    expect(reviewMarkdown).toContain("Scoring penalties: activation-outcome-negative:0.12");
    expect(reviewMarkdown).not.toContain("sk-local-secret-must-not-enter-store");
  });

  it("refreshes and links Learn v2 concept review from the legacy review queue", async () => {
    const root = await tempProject();
    const createdAt = new Date("2026-03-01T00:00:00.000Z");
    const [candidate] = mergeLearnV2ConceptCards([
      behaviorAtom("legacy_review_link_parser_fixture", "Prefer parser regression fixtures before parser refactors.", "positive")
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
    await writeLearnV2ConceptStore(root, [active], createdAt);
    await recordLearnV2ConceptOutcome(root, {
      conceptId: active.id,
      outcome: "harmful"
    }, new Date("2026-06-25T00:00:00.000Z"));
    await recordLearnV2ConceptOutcome(root, {
      conceptId: active.id,
      outcome: "wrong"
    }, new Date("2026-06-26T00:00:00.000Z"));

    const queue = await buildReviewQueue(root);

    expect(queue.learnV2ReviewQueue).toMatchObject({
      conceptCount: 1,
      focusCardCount: 1,
      staleCandidateCount: 1
    });
    expect(queue.candidateCount).toBeGreaterThanOrEqual(1);
    const legacyMarkdown = await readText(queue.markdownPath);
    expect(legacyMarkdown).toContain("Learn v2 Concept Review");
    expect(legacyMarkdown).toContain("Focus cards: 1");
    const learnV2Markdown = await readText(queue.learnV2ReviewQueue!.markdownPath);
    expect(learnV2Markdown).toContain("recent-negative-outcomes");
    expect(learnV2Markdown).toContain(`openskill-kit osk review --concept-demote ${active.id}`);
  });

  it("detects Python AST symbols and Go/Rust structural symbols with honest fallback metadata", async () => {
    const diff = [
      "diff --git a/python/openskillkit_evolution/cli.py b/python/openskillkit_evolution/cli.py",
      "--- a/python/openskillkit_evolution/cli.py",
      "+++ b/python/openskillkit_evolution/cli.py",
      "@@",
      "+import os, sys as system",
      "+from osk.parser import parse_skill",
      "+class ReportBuilder:",
      "+    async def build_async(self, value):",
      "+        return parse_skill(value)",
      "+def build_report(value):",
      "+    return parse_skill(value)",
      "diff --git a/src/server.go b/src/server.go",
      "--- a/src/server.go",
      "+++ b/src/server.go",
      "@@",
      "+import \"net/http\"",
      "+import router \"github.com/acme/router\"",
      "+type Handler[T any] struct{}",
      "+func (h *Handler[T]) Route(r router.Router) {}",
      "+func ServeHTTP(w http.ResponseWriter, r *http.Request) {}",
      "diff --git a/src/lib.rs b/src/lib.rs",
      "--- a/src/lib.rs",
      "+++ b/src/lib.rs",
      "@@",
      "+use crate::parser::{parse_skill, Parser};",
      "+pub(crate) struct CompilePlan;",
      "+impl CompilePlan {",
      "+  pub async fn run_checked(&self) {}",
      "+}",
      "+pub fn compile_skill() {}"
    ].join("\n");
    const summary = analyzeLearnV2StructuralDiff(diff);
    expect(summary.languages).toEqual(["go", "python", "rust"]);
    expect(summary.changedSymbols).toEqual(expect.arrayContaining([
      "CompilePlan",
      "Handler",
      "ReportBuilder",
      "Route",
      "ServeHTTP",
      "build_async",
      "build_report",
      "compile_skill",
      "run_checked"
    ]));
    expect(summary.changedImports).toEqual(expect.arrayContaining([
      "github.com/acme/router",
      "net/http",
      "os",
      "osk.parser",
      "sys",
      "crate::parser::Parser",
      "crate::parser::parse_skill"
    ]));
    expect(summary.semanticChange).toBe(true);
    expect(summary.fileSummaries.every((file) => file.classes.includes("api"))).toBe(true);
    const pythonSummary = summary.fileSummaries.find((file) => file.language === "python")!;
    expect(pythonSummary.parserBackend).toBe("python-ast");
    expect(pythonSummary.structuralConfidence).toBe("parser");
    expect(pythonSummary.confidenceCap).toBe(0.94);
    expect(pythonSummary.parserLimitations).not.toContain("not-ast-equivalent");
    expect(summary.fileSummaries.filter((file) => file.language === "go" || file.language === "rust").every((file) => file.parserBackend === "language-structural-scanner")).toBe(true);
    expect(summary.fileSummaries.filter((file) => file.language === "go" || file.language === "rust").every((file) => file.structuralConfidence === "fallback")).toBe(true);
    expect(summary.fileSummaries.filter((file) => file.language === "go" || file.language === "rust").every((file) => file.confidenceCap === 0.78)).toBe(true);
  });

  it("falls back to capped Python structural scanner when Python AST runtime is unavailable", () => {
    const previous = process.env.OPENSKILLKIT_PYTHON;
    process.env.OPENSKILLKIT_PYTHON = "__openskillkit_missing_python__";
    try {
      const diff = [
        "diff --git a/python/openskillkit_evolution/report.py b/python/openskillkit_evolution/report.py",
        "--- a/python/openskillkit_evolution/report.py",
        "+++ b/python/openskillkit_evolution/report.py",
        "@@",
        "+class ReportBuilder:",
        "+    def build(self, value):",
        "+        return value"
      ].join("\n");
      const summary = analyzeLearnV2StructuralDiff(diff);
      const pythonSummary = summary.fileSummaries[0]!;
      expect(pythonSummary.parserBackend).toBe("language-structural-scanner");
      expect(pythonSummary.structuralConfidence).toBe("fallback");
      expect(pythonSummary.confidenceCap).toBe(0.78);
      expect(pythonSummary.parserLimitations).toEqual(expect.arrayContaining(["fallback-confidence-cap", "not-ast-equivalent"]));
      expect(summary.changedSymbols).toEqual(expect.arrayContaining(["ReportBuilder", "build"]));
    } finally {
      if (previous === undefined) delete process.env.OPENSKILLKIT_PYTHON;
      else process.env.OPENSKILLKIT_PYTHON = previous;
    }
  });

  it("caps patch-pair confidence when only fallback structural parsers are available", async () => {
    const proposed = [
      "diff --git a/src/report.go b/src/report.go",
      "--- a/src/report.go",
      "+++ b/src/report.go",
      "@@",
      " func BuildReport(value string) string {",
      "-  return oldReport(value)",
      "+  return proposedReport(value)",
      " }"
    ].join("\n");
    const finalPatch = [
      "diff --git a/src/report.go b/src/report.go",
      "--- a/src/report.go",
      "+++ b/src/report.go",
      "@@",
      " func BuildReport(value string) string {",
      "-  return oldReport(value)",
      "+  return finalRegressionReport(value)",
      " }"
    ].join("\n");
    const patches = summarizeLearnV2Patches([
      normalizedFileChange("ev_agent_fallback_patch", proposed, { metadata: { patchKind: "proposed patch" } }),
      normalizedFileChange("ev_final_fallback_patch", finalPatch, { metadata: { patchKind: "final-patch" } })
    ]);
    const final = patches.find((patch) => patch.kind === "final-patch")!;

    expect(final.structuralSummary.fileSummaries.every((file) => file.parserBackend === "language-structural-scanner")).toBe(true);
    expect(final.comparison?.confidence).toBeLessThanOrEqual(0.78);
    expect(final.comparison?.confidence).toBeGreaterThanOrEqual(0.5);
    expect(final.summary).toContain("structural=go:language-structural-scanner:fallback");
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

  it("attributes body-only Python Go and Rust edits to enclosing structural scopes", async () => {
    const diff = [
      "diff --git a/python/openskillkit_evolution/report.py b/python/openskillkit_evolution/report.py",
      "--- a/python/openskillkit_evolution/report.py",
      "+++ b/python/openskillkit_evolution/report.py",
      "@@",
      " class ReportBuilder:",
      "     async def build_async(self, value):",
      "-        return old_report(value)",
      "+        return regression_report(value)",
      "diff --git a/src/server.go b/src/server.go",
      "--- a/src/server.go",
      "+++ b/src/server.go",
      "@@",
      " func (h *Handler[T]) Route(r router.Router) {",
      "-\twriteOldResponse(r)",
      "+\twriteNewResponse(r)",
      " }",
      "diff --git a/src/lib.rs b/src/lib.rs",
      "--- a/src/lib.rs",
      "+++ b/src/lib.rs",
      "@@",
      " impl CompilePlan {",
      "   pub async fn run_checked(&self) {",
      "-    compile_old();",
      "+    compile_checked();",
      "   }",
      " }"
    ].join("\n");

    const summary = analyzeLearnV2StructuralDiff(diff);

    expect(summary.changedSymbols).toEqual(expect.arrayContaining([
      "CompilePlan",
      "Handler",
      "ReportBuilder",
      "Route",
      "build_async",
      "run_checked"
    ]));
    expect(summary.fileSummaries.find((file) => file.path.endsWith("report.py"))?.changedSymbols).toEqual(expect.arrayContaining(["ReportBuilder", "build_async"]));
    expect(summary.fileSummaries.find((file) => file.path.endsWith("server.go"))?.changedSymbols).toEqual(expect.arrayContaining(["Handler", "Route"]));
    expect(summary.fileSummaries.find((file) => file.path.endsWith("lib.rs"))?.changedSymbols).toEqual(expect.arrayContaining(["CompilePlan", "run_checked"]));
  });

  it("attributes decorator and attribute-only edits to adjacent Python Go and Rust declarations", async () => {
    const diff = [
      "diff --git a/python/openskillkit_evolution/report.py b/python/openskillkit_evolution/report.py",
      "--- a/python/openskillkit_evolution/report.py",
      "+++ b/python/openskillkit_evolution/report.py",
      "@@",
      " class ReportBuilder:",
      "-    @cached_property",
      "+    @property",
      "     def summary(self):",
      "         return build_summary()",
      "diff --git a/src/server.go b/src/server.go",
      "--- a/src/server.go",
      "+++ b/src/server.go",
      "@@",
      "-//go:noinline",
      "+//go:generate stringer -type=Handler",
      " func (h *Handler[T]) Route(r router.Router) {}",
      "diff --git a/src/lib.rs b/src/lib.rs",
      "--- a/src/lib.rs",
      "+++ b/src/lib.rs",
      "@@",
      "-#[derive(Debug)]",
      "+#[derive(Debug, Clone)]",
      " pub struct CompilePlan;",
      " impl CompilePlan {",
      "-  #[tracing::instrument]",
      "+  #[tracing::instrument(skip(self))]",
      "   pub async fn run_checked(&self) {}",
      " }"
    ].join("\n");

    const summary = analyzeLearnV2StructuralDiff(diff);

    expect(summary.changedSymbols).toEqual(expect.arrayContaining([
      "CompilePlan",
      "Handler",
      "ReportBuilder",
      "Route",
      "run_checked",
      "summary"
    ]));
    expect(summary.fileSummaries.find((file) => file.path.endsWith("report.py"))?.changedSymbols).toEqual(expect.arrayContaining(["ReportBuilder", "summary"]));
    expect(summary.fileSummaries.find((file) => file.path.endsWith("server.go"))?.changedSymbols).toEqual(expect.arrayContaining(["Handler", "Route"]));
    expect(summary.fileSummaries.find((file) => file.path.endsWith("lib.rs"))?.changedSymbols).toEqual(expect.arrayContaining(["CompilePlan", "run_checked"]));
  });

  it("extracts Python Go and Rust API symbols from constants import blocks macros and trait impls", async () => {
    const diff = [
      "diff --git a/python/openskillkit_evolution/settings.py b/python/openskillkit_evolution/settings.py",
      "--- a/python/openskillkit_evolution/settings.py",
      "+++ b/python/openskillkit_evolution/settings.py",
      "@@",
      "+from osk.parser import (",
      "+    parse_skill,",
      "+    ParserConfig,",
      "+)",
      "+DEFAULT_TIMEOUT: int = 30",
      "+class SettingsBuilder:",
      "+    def build(self):",
      "+        return ParserConfig(timeout=DEFAULT_TIMEOUT)",
      "diff --git a/src/server.go b/src/server.go",
      "--- a/src/server.go",
      "+++ b/src/server.go",
      "@@",
      "+import (",
      "+\t\"context\"",
      "+\trouter \"github.com/acme/router\"",
      "+)",
      "+const (",
      "+\tDefaultTimeout = 30",
      "+)",
      "+var (",
      "+\tErrPlan = errors.New(\"plan failed\")",
      "+)",
      "+type RouteMap map[string]Handler",
      "diff --git a/src/lib.rs b/src/lib.rs",
      "--- a/src/lib.rs",
      "+++ b/src/lib.rs",
      "@@",
      "+use crate::parser::{self, Parser as PlanParser};",
      "+pub const DEFAULT_TIMEOUT: u64 = 30;",
      "+pub static FEATURE_FLAG: bool = true;",
      "+macro_rules! compile_plan { () => {}; }",
      "+impl Parser for CompilePlan {",
      "+  fn parse(&self) {}",
      "+}"
    ].join("\n");

    const summary = analyzeLearnV2StructuralDiff(diff);

    expect(summary.changedSymbols).toEqual(expect.arrayContaining([
      "CompilePlan",
      "DEFAULT_TIMEOUT",
      "DEFAULT_TIMEOUT",
      "DefaultTimeout",
      "ErrPlan",
      "FEATURE_FLAG",
      "Parser",
      "RouteMap",
      "SettingsBuilder",
      "build",
      "compile_plan",
      "parse"
    ]));
    expect(summary.fileSummaries.find((file) => file.path.endsWith("settings.py"))?.changedSymbols).toEqual(expect.arrayContaining(["DEFAULT_TIMEOUT", "SettingsBuilder", "build"]));
    expect(summary.fileSummaries.find((file) => file.path.endsWith("server.go"))?.changedSymbols).toEqual(expect.arrayContaining(["DefaultTimeout", "ErrPlan", "RouteMap"]));
    expect(summary.fileSummaries.find((file) => file.path.endsWith("lib.rs"))?.changedSymbols).toEqual(expect.arrayContaining(["CompilePlan", "DEFAULT_TIMEOUT", "FEATURE_FLAG", "Parser", "compile_plan", "parse"]));
    expect(summary.changedImports).toEqual(expect.arrayContaining([
      "context",
      "github.com/acme/router",
      "osk.parser",
      "crate::parser",
      "crate::parser::Parser"
    ]));
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
      "user: Change packages/core/src/parser.ts and prefer focused parser regression tests.\nassistant: ok"
    ).map((item) => ({ ...item, paths: ["packages/core/src/parser.ts"] }));
    const [episode] = reconstructLearnV2Episodes(evidence);
    const bundle = buildLearnV2EpisodeLearningBundle(episode!);
    const prompt = renderLearnV2ConceptExtractionPrompt(bundle);
    expect(JSON.stringify(bundle)).not.toContain("raw_bundle_secret_ref");
    expect(bundle.evidenceIds).toContain(episode!.evidenceIds[0]);
    expect(prompt).toContain("OpenCode-configured model routing");
    expect(prompt).toContain("\"phases\"");
    expect(prompt).toContain("appliesWhen");
    expect(prompt).toContain("counterevidence");
    expect(prompt).toContain("confidenceCap");
    expect(prompt).toContain("Every atom must cite");

    const scopedPath = episode!.pathCluster[0]!;
    const parsed = parseLearnV2LlmConceptExtractionOutput(JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
      atoms: [{
        statement: "For parser changes, prefer focused regression tests before broad suites.",
        kind: "verification",
        polarity: "positive",
        evidenceIds: [episode!.evidenceIds[0]],
        scope: {
          level: "path",
          paths: [scopedPath],
          taskTypes: ["parser-change"]
        },
        appliesWhen: ["Parser files changed and regression behavior is under test."],
        doesNotApplyWhen: ["Task is documentation-only or unrelated to parser behavior."],
        activation: {
          phrases: ["parser regression fixture"],
          pathGlobs: [scopedPath.split("/").slice(0, -1).join("/") + "/**"],
          commands: ["npm test -- parser"],
          negativeTriggers: ["docs-only"]
        },
        counterevidence: [{
          evidenceId: episode!.evidenceIds[0],
          reason: "Same episode shows this is scoped to parser work, not every task."
        }],
        risk: "low",
        confidence: 0.74,
        confidenceCap: 0.76,
        rationale: "The user explicitly requested parser regression tests."
      }],
      rejected: []
    }));
    const valid = validateLearnV2LlmConceptExtractionOutput(episode!, parsed);
    expect(valid.atoms).toHaveLength(1);
    expect(valid.atoms[0]!.confidenceCap).toBeLessThanOrEqual(0.78);
    expect(valid.atoms[0]!.scope.paths).toContain(scopedPath);
    expect(valid.atoms[0]!.conditions?.appliesWhen).toContain("Parser files changed and regression behavior is under test.");
    expect(valid.atoms[0]!.activationHints?.phrases).toContain("parser regression fixture");
    expect(valid.atoms[0]!.activationHints?.commands).toContain("npm test -- parser");
    expect(valid.atoms[0]!.counterevidence[0]?.reason).toContain("scoped to parser work");
    const [concept] = mergeLearnV2ConceptCards(valid.atoms, new Date("2026-06-30T00:00:00Z"));
    expect(concept!.conditions?.appliesWhen).toContain("Parser files changed and regression behavior is under test.");
    expect(concept!.conditions?.doesNotApplyWhen).toContain("Task is documentation-only or unrelated to parser behavior.");
    expect(concept!.scope.negativeTriggers).toEqual(expect.arrayContaining(["docs-only", "Task is documentation-only or unrelated to parser behavior."]));
    expect(concept!.activation.phrases).toContain("parser regression fixture");
    expect(concept!.activation.commands).toContain("npm test -- parser");
    expect(concept!.counterevidence).toHaveLength(1);
    expect(concept!.scoring?.counterevidenceCount).toBe(1);

    const invalid = validateLearnV2LlmConceptExtractionOutput(episode!, {
      schemaVersion: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
      atoms: [{
        statement: "Never log sk-12345678901234567890.",
        kind: "security",
        polarity: "negative",
        evidenceIds: ["missing"],
        confidence: 0.9
      }, {
        statement: "For parser changes, prefer focused regression tests before broad suites.",
        kind: "verification",
        polarity: "positive",
        evidenceIds: [episode!.evidenceIds[0]],
        scope: {
          level: "path",
          paths: ["other-project/src/parser.ts"],
          taskTypes: ["parser-change"]
        }
      }],
      rejected: []
    });
    expect(invalid.rejected.map((item) => item.reason)).toContain("missing-or-invalid-evidence-id");
    expect(invalid.rejected.map((item) => item.reason)).toContain("invalid-scope");
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
      }],
      behaviorDeltaScenarios: [{
        schemaVersion: "openskill-kit.learn-v2.behavior-delta-golden.v1",
        id: "parser-plan-delta",
        title: "Parser behavior plan delta",
        task: {
          prompt: "Fix quoted grammar handling without rewriting the parser.",
          paths: ["packages/core/src/parser.ts"],
          commands: [],
          taskTypes: ["parser-change"]
        },
        expectedConceptText: ["parser regression tests"],
        expectedKinds: ["verification"],
        expectedPlanIncludes: ["parser regression tests"],
        expectedPlanExcludes: ["broad parser rewrite"],
        minActivatedConcepts: 1
      }]
    }), "utf8");
    const report = await runLearnV2Eval(root, episodes, concepts, new Date("2026-06-30T00:01:00Z"), {
      goldensPath,
      sandboxProbe: true
    });
    expect(report.status).toBe("pass");
    expect(report.extractionGoldenCount).toBe(1);
    expect(report.behaviorDeltaGoldenCount).toBe(1);
    expect(report.counterfactualTraceCaseCount).toBeGreaterThanOrEqual(1);
    expect(report.summary.resultCounts.fail).toBe(0);
    expect(report.summary.behaviorDelta).toMatchObject({
      status: "pass",
      scenarioCount: 1,
      passedScenarios: 1,
      failedScenarios: 0,
      regressionFindingCount: 0
    });
    expect(report.summary.behaviorDelta.tokenOverheadTokens).toBeGreaterThan(0);
    expect(report.summary.behaviorDelta.averageTokenOverheadTokens).toBeGreaterThan(0);
    expect(report.summary.behaviorDelta.maxTokenOverheadTokens).toBeGreaterThan(0);
    expect(report.summary.activationReplay.retrievalRate).toBeGreaterThan(0);
    expect(report.summary.counterfactualTrace.activationRate).toBe(1);
    expect(report.proofBoundary).toMatchObject({
      method: "deterministic-local-replay",
      sandboxExecuted: true,
      agentExecuted: false
    });
    expect(report.proofBoundary.doesNotProve).toEqual(expect.arrayContaining(["real agent task success"]));
    expect(report.proofBoundary.doesNotProve).not.toContain("sandbox execution success");
    expect(report.proofBoundary.proves).toEqual(expect.arrayContaining([
      "configured behavior-delta golden checks",
      "deterministic counterfactual trace activation checks",
      "conditional memory admission non-overlearning checks",
      "open-world grounding authority and evidence-separation checks",
      "local sandbox verifier command execution"
    ]));
    expect(report.proofBoundary.doesNotProve).not.toContain("configured behavior-delta golden checks");
    expect(report.results.some((result) => result.id === "sandbox-eval-probe" && result.status === "pass")).toBe(true);
    expect(report.results.some((result) => result.id === "golden:parser-regression" && result.status === "pass")).toBe(true);
    expect(report.results.some((result) => result.id === "behavior-delta:parser-plan-delta" && result.status === "pass")).toBe(true);
    expect(report.results.some((result) => result.id === "counterfactual-trace-eval" && result.status === "pass")).toBe(true);
    const conditionalBoundary = report.results.find((result) => result.id === "conditional-admission-boundary");
    expect(conditionalBoundary?.status).toBe("pass");
    expect(conditionalBoundary?.checks.map((item) => item.name)).toEqual(expect.arrayContaining([
      "sparse-hypotheses-kept-weak",
      "weak-hypotheses-explain-admission",
      "one-off-observations-trace-only"
    ]));
    const groundingBoundary = report.results.find((result) => result.id === "open-world-grounding-boundary");
    expect(groundingBoundary?.status).toBe("pass");
    expect(groundingBoundary?.checks.map((item) => item.name)).toEqual(expect.arrayContaining([
      "grounding-anchors-carry-authority",
      "resource-precedence-is-review-only",
      "user-evidence-remains-separate-from-grounding",
      "evidence-classes-counted-separately"
    ]));
    expect(JSON.stringify(groundingBoundary)).toContain("external");
    const counterfactualCases = await readText(report.artifacts.counterfactualCases!);
    expect(counterfactualCases).toContain("openskill-kit.counterfactual-trace-eval-case.v1");
    expect(counterfactualCases).not.toContain("raw_");
    expect(counterfactualCases).not.toContain(root);
    const behaviorDeltaCases = await readText(report.artifacts.behaviorDeltaCases!);
    expect(behaviorDeltaCases).toContain("openskill-kit.behavior-delta-eval-case.v1");
    expect(behaviorDeltaCases).toContain("parser regression tests");
    expect(behaviorDeltaCases).toContain("tokenOverheadTokens");
    expect(behaviorDeltaCases).toContain("regressionFindings");
    expect(behaviorDeltaCases).not.toContain("raw_");
    expect(behaviorDeltaCases).not.toContain(root);
    const behaviorDeltaCasesJson = JSON.parse(behaviorDeltaCases);
    expect(behaviorDeltaCasesJson.cases[0]).toMatchObject({
      id: "parser-plan-delta",
      regressionFindings: [],
      baselinePlanChars: expect.any(Number),
      withConceptPlanChars: expect.any(Number),
      tokenOverheadChars: expect.any(Number),
      tokenOverheadTokens: expect.any(Number)
    });
    expect(behaviorDeltaCasesJson.cases[0].withConceptPlanChars).toBeGreaterThan(behaviorDeltaCasesJson.cases[0].baselinePlanChars);
    const sandboxProbe = await readText(report.artifacts.sandboxProbe!);
    expect(sandboxProbe).toContain("openskill-kit.learn-v2.sandbox-probe-result.v1");
    expect(JSON.parse(sandboxProbe).status).toBe("pass");
    expect(sandboxProbe).not.toContain(root);
    const markdown = await readText(report.artifacts.markdown);
    expect(markdown).toContain("## Proof Boundary");
    expect(markdown).toContain("Sandbox executed: true");
    expect(markdown).toContain("Does not prove: real agent task success");
    expect(markdown).toContain("## Behavior Delta");
    expect(markdown).toContain("Token overhead:");
    expect(markdown).toContain("Regression findings: 0");
    expect(markdown).toContain("Result rows:");
    expect(markdown).toContain("Activated cases:");

    const proposalPath = path.join(root, "eval-goldens-proposal.json");
    await writeFile(proposalPath, JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.eval-golden-proposal.v1",
      generatedAt: "2026-06-30T00:01:30.000Z",
      source: "eval-planner-model-proposal",
      scenarios: [{
        schemaVersion: "openskill-kit.learn-v2.extraction-golden.v1",
        id: "parser-regression-proposal",
        title: "Parser regression extraction proposal",
        expectedConceptText: ["parser regression tests"],
        expectedKinds: ["verification"],
        expectedTaskHints: ["parser-change"]
      }],
      behaviorDeltaScenarios: [],
      reviewRequired: true
    }), "utf8");
    await expect(runLearnV2Eval(root, episodes, concepts, new Date("2026-06-30T00:01:31Z"), {
      goldensPath: proposalPath
    })).rejects.toThrow(/requires review before use/);
    const proposalPreview = await runLearnV2Eval(root, episodes, concepts, new Date("2026-06-30T00:01:32Z"), {
      goldensPath: proposalPath,
      allowUnreviewedProposal: true
    });
    expect(proposalPreview.extractionGoldenCount).toBe(1);
    expect(proposalPreview.proofBoundary.doesNotProve).toContain("reviewed eval golden quality");
  });

  it("fails eval leak check for raw concept scope while declassifying counterfactual artifacts", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_eval_leak_scope");
    const evidence = normalizeLearnV2Evidence(
      { adapterId: "codex", sourcePath: "a", contentKind: "transcript", rawText: "", detectedFormat: "plain" },
      record,
      "user: Prefer focused parser regression tests before broad parser rewrites.\ntool: npm test -- parser\nPASS"
    );
    const episodes = reconstructLearnV2Episodes(evidence);
    const [baseConcept] = mergeLearnV2ConceptCards(extractLearnV2BehaviorAtoms(episodes).atoms, new Date("2026-06-30T00:04:00Z"));
    const rootForward = root.replace(/\\/g, "/");
    const concept = {
      ...baseConcept!,
      scope: {
        ...baseConcept!.scope,
        paths: [path.join(root, "private", "parser.ts"), "C:/Users/alice/secret/parser.ts"]
      },
      activation: {
        ...baseConcept!.activation,
        phrases: [...baseConcept!.activation.phrases, "C:/Users/alice/secret parser task"],
        commands: [
          ...baseConcept!.activation.commands,
          `npm test -- ${rootForward}/private/parser.ts`,
          "node C:/Users/alice/secret/run.js --token npm_12345678901234567890"
        ]
      }
    };

    const report = await runLearnV2Eval(root, episodes, [concept], new Date("2026-06-30T00:05:00Z"));
    expect(report.status).toBe("fail");
    expect(report.leakCheck.status).toBe("fail");
    expect(report.leakCheck.issues).toEqual(expect.arrayContaining([
      "project root leaked",
      "absolute user path leaked",
      "secret-like token leaked"
    ]));
    expect(report.summary.counterfactualTrace.caseCount).toBe(1);

    const counterfactualCases = await readText(report.artifacts.counterfactualCases!);
    expect(counterfactualCases).toContain("[PROJECT_ROOT]");
    expect(counterfactualCases).toContain("[USER_HOME]");
    expect(counterfactualCases).toContain("[SECRET]");
    expect(counterfactualCases).not.toContain(root);
    expect(counterfactualCases).not.toContain(rootForward);
    expect(counterfactualCases).not.toContain("C:/Users/alice");
    expect(counterfactualCases).not.toContain("npm_12345678901234567890");
  });

  it("uses runtime semantic activation entries during eval replay", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:01:30Z");
    const [episode] = reconstructLearnV2Episodes([
      normalizedMessage("ev_semantic_eval", "Grammar spec needed for syntax bug.", "user")
    ]);
    const [card] = mergeLearnV2ConceptCards([{
      schemaVersion: "openskill-kit.learn-v2.behavior-atom.v1",
      id: "atom_semantic_eval",
      kind: "verification",
      statement: "Prefer focused parser regression fixtures before broad parser rewrites.",
      polarity: "positive",
      scope: {
        level: "project",
        paths: [],
        taskTypes: []
      },
      confidence: 0.82,
      confidenceCap: 0.9,
      sourceReliability: 0.82,
      evidenceIds: ["ev_semantic_eval"],
      rawRefs: ["raw_semantic_eval"],
      rationale: "Explicit preference or correction language in episode.",
      risk: "low"
    }], now);
    const concept = {
      ...card!,
      activation: {
        phrases: [],
        pathGlobs: [],
        commands: []
      }
    };

    const oldThinEntryMatches = scoreLearnV2ActivationEntries([{
      conceptId: concept.id,
      status: concept.status,
      title: concept.title,
      phrases: concept.activation.phrases,
      pathGlobs: concept.activation.pathGlobs,
      commands: concept.activation.commands,
      taskTypes: concept.scope.taskTypes,
      negativeTriggers: concept.scope.negativeTriggers,
      confidence: concept.confidence,
      risk: concept.risk
    }], {
      includeCandidates: true,
      query: episode!.messages.map((message) => message.text).join(" ")
    });
    expect(oldThinEntryMatches.some((match) => match.conceptId === concept.id && match.score > 0)).toBe(false);

    const report = await runLearnV2Eval(root, [episode!], [concept], now);
    const replay = report.results.find((result) => result.id === "activation-replay")!;
    expect(replay.status).toBe("pass");
    expect(replay.checks[0]!.details).toContain("1/1 concept(s) retrieved");
  });

  it("proves memory admission keeps one-off concepts out of activation eval artifacts", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:01:40Z");
    const [episode] = reconstructLearnV2Episodes([
      normalizedMessage("ev_one_off_eval", "Make this button green for this landing page only here.", "user"),
      normalizedMessage("ev_parser_eval", "Prefer focused parser regression fixtures before parser edits.", "user")
    ]);
    const [oneOffBase, activeBase] = mergeLearnV2ConceptCards([
      behaviorAtom("one_off_eval", "Prefer green button color for this landing page only here.", "positive"),
      behaviorAtom("active_eval", "Prefer focused parser regression fixtures before parser edits.", "positive")
    ], now);
    const oneOff = {
      ...oneOffBase!,
      id: "concept_one_off_eval",
      status: "one-off" as const,
      evidenceIds: ["ev_one_off_eval"],
      rawRefs: ["raw_one_off_eval"],
      activation: {
        phrases: ["green button", "landing page"],
        pathGlobs: ["packages/site/src/LandingButton.tsx"],
        commands: []
      }
    };
    const active = {
      ...activeBase!,
      id: "concept_active_eval",
      status: "active" as const,
      evidenceIds: ["ev_parser_eval"],
      rawRefs: ["raw_active_eval"],
      activation: {
        phrases: ["parser edits", "parser regression"],
        pathGlobs: ["packages/core/src/parser.ts"],
        commands: []
      },
      scope: {
        ...activeBase!.scope,
        paths: ["packages/core/src/parser.ts"],
        taskTypes: ["parser-change"]
      }
    };

    const report = await runLearnV2Eval(root, [episode!], [oneOff, active], now);
    const boundary = report.results.find((result) => result.id === "memory-admission-boundary")!;
    expect(boundary.status).toBe("pass");
    expect(boundary.checks.find((item) => item.name === "one-off-excluded-from-activation")?.details)
      .toContain("1 one-off concept(s) excluded");
    expect(report.summary.activationReplay.replayableConcepts).toBe(1);
    expect(report.summary.counterfactualTrace.caseCount).toBe(1);
    expect(report.proofBoundary.proves).toContain("memory-admission activation exclusion for one-off/rejected/superseded concepts");
    const counterfactualCases = await readText(report.artifacts.counterfactualCases!);
    expect(counterfactualCases).toContain("concept_active_eval");
    expect(counterfactualCases).not.toContain("concept_one_off_eval");
    const markdown = await readText(report.artifacts.markdown);
    expect(markdown).toContain("### memory-admission-boundary");
    expect(markdown).toContain("one-off-excluded-from-activation");
  });

  it("surfaces counterevidence in activation and suppresses active counterevidenced concepts", () => {
    const baseEntry = {
      conceptId: "concept_counterevidence_activation",
      status: "active" as const,
      title: "Focused parser regression tests",
      phrases: ["parser regression"],
      pathGlobs: ["packages/core/src/**"],
      commands: [],
      taskTypes: ["parser-change"],
      negativeTriggers: [],
      confidence: 0.9,
      risk: "low" as const,
      counterevidenceCount: 1
    };

    const activeMatches = scoreLearnV2ActivationEntries([baseEntry], {
      query: "parser regression",
      paths: ["packages/core/src/parser.ts"],
      taskTypes: ["parser-change"]
    });
    expect(activeMatches[0]!.suppressed).toBe(true);
    expect(activeMatches[0]!.score).toBe(0);
    expect(activeMatches[0]!.reasons).toContain("counterevidence:1");
    expect(activeMatches[0]!.counterevidenceCount).toBe(1);

    const candidateMatches = scoreLearnV2ActivationEntries([{ ...baseEntry, status: "candidate" as const }], {
      includeCandidates: true,
      query: "parser regression",
      paths: ["packages/core/src/parser.ts"],
      taskTypes: ["parser-change"]
    });
    expect(candidateMatches[0]!.suppressed).toBe(false);
    expect(candidateMatches[0]!.score).toBeGreaterThan(0);
    expect(candidateMatches[0]!.counterevidenceCount).toBe(1);
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

  it("compiles active Learn v2 command concepts into structured command policy artifacts", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:02:30Z");
    const [card] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("compile_command_policy", "When changing parser code, run `npm test -- parser` before final summary.", "positive"),
      kind: "command-policy",
      scope: {
        level: "path",
        paths: ["packages/core/src/parser.ts"],
        taskTypes: ["parser-change"]
      },
      evidenceIds: ["ev_compile_command_policy_a", "ev_compile_command_policy_b"],
      rawRefs: ["raw_compile_command_policy_a", "raw_compile_command_policy_b"],
      confidence: 0.84,
      sourceReliability: 0.84,
      risk: "low"
    }], now);
    await writeLearnV2ConceptStore(root, [{
      ...card!,
      status: "active",
      risk: "low",
      activation: {
        ...card!.activation,
        commands: ["npm test -- parser"],
        pathGlobs: ["packages/core/src/**"]
      }
    }], now);

    const compiled = await compileBehaviorLayer(root, { targets: ["project-rules"] });
    const commandPolicyPath = compiled.policyArtifactPaths.find((item) => item.endsWith("command-policy.md"))!;
    const commandPolicyJsonPath = compiled.policyArtifactPaths.find((item) => item.endsWith("command-policy.json"))!;
    const markdown = await readText(commandPolicyPath);
    const json = JSON.parse(await readText(commandPolicyJsonPath));

    expect(markdown).toContain("Learn v2 Structured Command Rules");
    expect(markdown).toContain("npm test -- parser");
    expect(markdown).toContain("Changes touch packages/core/src/parser.ts");
    expect(json.learnV2.schemaVersion).toBe("openskill-kit.learn-v2.command-policy.v1");
    expect(json.learnV2.ruleCount).toBe(1);
    expect(json.learnV2.rules[0]).toMatchObject({
      command: "npm test -- parser",
      status: "suggested",
      scopePaths: ["packages/core/src/parser.ts"],
      taskTypes: ["parser-change"],
      costClass: "cheap",
      evidenceConceptIds: [card!.id]
    });
    expect(JSON.stringify(json.learnV2)).not.toContain("raw_compile_command_policy");
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
    const persistedPreview = await readFile(preview.artifacts.json, "utf8");
    expect(persistedPreview).not.toContain("raw_compile");
    expect(persistedPreview).not.toContain(root);
  });

  it("scans compiled Learn v2 artifacts with the shared declassification boundary", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:01:05Z");
    const [base] = mergeLearnV2ConceptCards([
      behaviorAtom("compiled_boundary", "Prefer parser regression tests before parser changes.", "positive")
    ], now);
    const unsafe = {
      ...base!,
      status: "active" as const,
      canonicalBehavior: `Never compile local path ${root} or raw_compiled_boundary_secret into behavior.`,
      behaviorDelta: "This unsafe concept intentionally crosses the output boundary."
    };

    const preview = await compileLearnV2ConceptPreview(root, (await readProjectConfig(root)), [unsafe], now);
    expect(preview.declassificationReport.status).toBe("fail");
    expect(preview.declassificationReport.issues.join(" ")).toContain("project-root");
    expect(preview.declassificationReport.issues.join(" ")).toContain("raw-ref");

    await mkdir(path.dirname(learnV2ConceptStorePath(root)), { recursive: true });
    await writeFile(learnV2ConceptStorePath(root), JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.concept-store.v1",
      projectId: (await readProjectConfig(root)).projectId,
      updatedAt: now.toISOString(),
      cards: [unsafe]
    }), "utf8");
    await expect(compileBehaviorLayer(root, { targets: ["project-rules"] })).rejects.toThrow("Compile-time declassification checks failed");
    await expect(compileBehaviorLayer(root, { targets: ["mcp-resources"] })).rejects.toThrow("Compile-time declassification checks failed");
  });

  it("allows approved declassification placeholders in model outputs while blocking raw leaks", async () => {
    const root = await tempProject();
    const config = (await initAdaptiveProject({ projectRoot: root })).config;

    expect(validateLearnV2ModelOutputBoundary(root, config, {
      proposals: [{
        statement: "Prefer bounded diagnostics under [PROJECT_ROOT] and redact user mail as [REDACTED:email].",
        rationale: "This uses approved placeholders instead of raw local values."
      }]
    })).toEqual({ ok: true });

    const unsafe = validateLearnV2ModelOutputBoundary(root, config, {
      proposals: [{
        statement: `Do not emit ${root}, raw_model_boundary_123456, or ghp_123456789012345678901234567890123456.`
      }]
    });
    expect(unsafe.ok).toBe(false);
    expect(unsafe.ok ? "" : unsafe.detail).toContain("raw-ref");
    expect(unsafe.ok ? "" : unsafe.detail).toContain("secret-like-token");
  });

  it("hard-blocks unsafe active concept graph sync without letting unsafe candidates block safe active concepts", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:02:00Z");
    const [safeBase] = mergeLearnV2ConceptCards([
      behaviorAtom("safe_active_sync", "Prefer parser regression tests before parser changes.", "positive")
    ], now);
    const [unsafeBase] = mergeLearnV2ConceptCards([
      behaviorAtom("unsafe_candidate_sync", "Prefer focused parser tests before parser changes.", "positive")
    ], now);
    const safeActive = { ...safeBase!, status: "active" as const };
    const unsafeCandidate = {
      ...unsafeBase!,
      status: "candidate" as const,
      canonicalBehavior: `Do not leak ${root} or raw_unsafe_candidate_sync into compiled behavior.`,
      behaviorDelta: "Unsafe candidate remains review-only and must not block active-safe graph sync."
    };

    await syncLearnV2ActiveConcepts(root, [safeActive, unsafeCandidate], now);
    const graph = await readPreferenceGraph(root);
    expect(graph.nodes.some((node) => node.id === `pref_${safeActive.id}`)).toBe(true);
    expect(JSON.stringify(graph)).not.toContain("raw_unsafe_candidate_sync");
    expect(JSON.stringify(graph)).not.toContain(root);

    await expect(syncLearnV2ActiveConcepts(root, [{ ...unsafeCandidate, status: "active" }], now))
      .rejects.toThrow("Learn v2 active concept sync blocked by declassification report");
    const blockedPreviewJson = await readFile(path.join(root, ".openskill-kit", "learn-v2", "compiled-preview", "concept-compile-preview.json"), "utf8");
    const blockedPreviewMarkdown = await readFile(path.join(root, ".openskill-kit", "learn-v2", "compiled-preview", "concept-compile-preview.md"), "utf8");
    expect(JSON.parse(blockedPreviewJson).declassificationReport.status).toBe("fail");
    expect(blockedPreviewMarkdown).toContain("blocked by declassification boundary");
    expect(blockedPreviewJson).not.toContain("raw_unsafe_candidate_sync");
    expect(blockedPreviewMarkdown).not.toContain("raw_unsafe_candidate_sync");
    expect(blockedPreviewJson).not.toContain(root);
    expect(blockedPreviewMarkdown).not.toContain(root);
    await expect(writeLearnV2ConceptStore(root, [{ ...unsafeCandidate, status: "active" }], now))
      .rejects.toThrow("Learn v2 active concept sync blocked by declassification report");
    const activated = await activateLearnV2Concepts(root, {
      query: "unsafe candidate sync",
      paths: ["packages/core/src/parser.ts"]
    }, now);
    expect(activated.matches.some((match) => match.conceptId === unsafeCandidate.id)).toBe(false);
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
    expect(result.modelExecution.requestArtifacts.status).toBe("written");
    expect(result.modelExecution.requestArtifacts.requestCount).toBe(result.learnV2.modelRequestCount);
    expect(result.modelExecution.sanitizedOpenCodeExecution.command).toContain("--execute-model-requests");
    expect(result.modelExecution.sanitizedOpenCodeExecution.command).toContain("request-manifest.json");
    expect(result.modelExecution.rawToModelExecution).toMatchObject({
      supported: false,
      status: "rejected",
      saferPolicy: "opencode-host-sanitized-only"
    });
    const observability = JSON.parse(await readText(result.artifacts.learnV2ObservabilityReportPath));
    expect(observability.modelExecution.requestArtifacts.status).toBe("written");
    expect(observability.modelExecution.rawToModelExecution.status).toBe("rejected");
    const observabilityMarkdown = await readText(observability.artifactsWritten.markdown.replace("[PROJECT_ROOT]/", `${root}/`));
    expect(observabilityMarkdown).toContain("## Model Execution Policy");
    expect(observabilityMarkdown).toContain("Raw-to-model execution: rejected");
    expect(JSON.stringify(result.concepts)).not.toContain(root);
    expect(result.learnV2).toBeTruthy();
  });

  it("runs conditional learning inside raw-local pipeline and exposes debug artifacts", async () => {
    const root = await tempProject();
    const transcript = path.join(root, "ui-contrast-session.md");
    await writeFile(transcript, [
      `user: ${root} packages/site/src/LandingButton.tsx Make independent button green on white landing page.`,
      "user: packages/site/src/DarkButton.tsx No, this time I want blue for independent button on dark page.",
      "user: packages/site/src/CardButton.tsx For dark card button, make it orange."
    ].join("\n"), "utf8");

    const result = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: false,
      allowDuplicateImports: true,
      now: new Date("2026-06-30T00:00:20Z")
    });

    expect(result.artifacts.learnV2ConditionalLearningPath).toContain("conditional-learning");
    expect(result.digest.conditionalObservations).toBe(3);
    expect(result.digest.conditionalHypotheses).toBeGreaterThanOrEqual(2);
    expect(result.digest.promotedConditionalHypotheses).toBe(0);
    expect(result.digest.behaviorAtoms).toBe(0);
    expect(result.digest.currentRunConceptCards).toBe(0);
    const conditionalMarkdown = await readText(result.artifacts.learnV2ConditionalLearningPath);
    expect(conditionalMarkdown).toContain("Promoted hypotheses: 0");
    expect(conditionalMarkdown).toContain("Weak observations:");
    expect(conditionalMarkdown).toContain("component.container=card");
    expect(conditionalMarkdown).not.toContain(root);
    const conditionalDebug = await readLearnV2ConditionalLearningDebugView(root);
    expect(conditionalDebug.schemaVersion).toBe("openskill-kit.learn-v2.conditional-learning-debug-view.v1");
    expect(conditionalDebug.observations).toHaveLength(3);
    expect(conditionalDebug.hypotheses.length).toBeGreaterThanOrEqual(2);
    expect(conditionalDebug.hypotheses.every((hypothesis) => hypothesis.status === "weak")).toBe(true);
    expect(conditionalDebug.admissionDecisions.filter((decision) => decision.subjectKind === "hypothesis").every((decision) =>
      decision.decision === "weak-observation" && decision.reasons.includes("single-support-hypothesis-kept-weak")
    )).toBe(true);
    expect(conditionalDebug.observations.some((observation) =>
      observation.factors.some((factor) => factor.key === "component.container" && factor.value === "card")
    )).toBe(true);
    const conditionalDebugText = JSON.stringify(conditionalDebug);
    expect(conditionalDebugText).toContain("textHash");
    expect(conditionalDebugText).not.toContain(root);
    expect(conditionalDebugText).not.toContain("Make independent button green");
    expect(conditionalDebugText).not.toContain("No, this time I want blue");
    const focusedConditionalDebug = await readLearnV2ConditionalLearningDebugView(root, { hypothesisId: conditionalDebug.hypotheses[0]!.id });
    expect(focusedConditionalDebug.hypotheses).toHaveLength(1);
    expect(focusedConditionalDebug.observations.length).toBeGreaterThanOrEqual(1);
    expect(result.learnV2.currentRunConcepts).toHaveLength(0);
    const skillOntologyJson = JSON.parse(await readText(result.artifacts.learnV2SkillOntologyPath.replace(/\.md$/, ".json")));
    expect(skillOntologyJson.counts.namespaces).toBe(0);
    const groundingJson = JSON.parse(await readText(result.artifacts.learnV2OpenWorldGroundingPath.replace(/\.md$/, ".json")));
    expect(groundingJson.counts.anchors).toBe(0);
    expect(result.artifacts.learnV2ConceptDebugTracePath).toContain("concept-debug-trace");
    expect(result.digest.conceptDebugTraces).toBe(0);
    const debugTraceMarkdown = await readText(result.artifacts.learnV2ConceptDebugTracePath);
    expect(debugTraceMarkdown).toContain("Traced concepts: 0");
    expect(debugTraceMarkdown).not.toContain(root);
    const debugTraceJson = JSON.parse(await readText(result.artifacts.learnV2ConceptDebugTracePath.replace(/\.md$/, ".json")));
    expect(debugTraceJson.counts.tracedConcepts).toBe(0);
    expect(debugTraceJson.counts.conditionalLinks).toBe(0);
    expect(debugTraceJson.counts.openWorldLinks).toBe(0);
    const conceptText = JSON.stringify(result.learnV2.currentRunConcepts.map((concept) => ({
      behavior: concept.canonicalBehavior,
      conditions: concept.conditions
    }))).toLowerCase();
    expect(conceptText).not.toContain("prefer green for button color");
    expect(conceptText).not.toContain("prefer blue for button color");
    expect(conceptText).not.toContain("prefer orange for button color");
    const observability = JSON.parse(await readText(result.artifacts.learnV2ObservabilityReportPath));
    expect(observability.learningIntelligence).toMatchObject({
      observations: 3,
      promotedHypotheses: 0,
      episodeNotes: 1,
      weakObservations: expect.any(Number)
    });
    expect(observability.learningIntelligence.hypotheses).toBeGreaterThanOrEqual(2);
    expect(observability.skillOntology.operations).toBe(0);
    expect(observability.openWorldGrounding.anchors).toBe(0);
    expect(observability.conceptDebugTrace.tracedConcepts).toBe(0);
    expect(observability.outcomePolicy.decisions).toBe(0);
    const observabilityMarkdown = await readText(observability.artifactsWritten.markdown.replace("[PROJECT_ROOT]/", `${root}/`));
    expect(observabilityMarkdown).toContain("Conditional hypotheses: 2 (0 promoted)");
    expect(observabilityMarkdown).toContain("Memory admission:");
  });

  it("extracts UI context factors from CSS component tree screenshot and design-token metadata", () => {
    const factors = extractLearnV2ContextFactors({
      text: "Make button orange.",
      metadata: {
        className: "rounded-lg bg-black shadow-sm",
        componentTree: ["DashboardPage", "BillingCard", "PrimaryCTAButton"],
        screenshotLabels: ["dark background", "card"],
        designTokens: ["--color-surface-dark", "color.brand.primary"]
      },
      evidenceIds: ["ev_ui_factor_metadata"]
    });

    expect(factors).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "ui.theme", value: "dark", source: "css" }),
      expect.objectContaining({ key: "component.container", value: "card", source: "component-tree" }),
      expect.objectContaining({ key: "component.role", value: "primary-cta", source: "component-tree" }),
      expect.objectContaining({ key: "ui.design-token", value: "color-surface-dark", source: "design-token" })
    ]));
    expect(JSON.stringify(factors)).not.toContain("ev_ui_factor_metadata_secret");
  });

  it("uses structured UI metadata to infer hidden conditional factors without prompt words", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_structured_ui_factors");
    const evidence = normalizeLearnV2Evidence({
      adapterId: "codex",
      sourcePath: "ui-events.json",
      contentKind: "structured",
      rawText: "",
      detectedFormat: "json"
    }, record, JSON.stringify([
      {
        role: "user",
        text: "Make button green.",
        paths: ["packages/site/src/LandingButton.tsx"],
        metadata: {
          className: "bg-white",
          componentTree: ["LandingPage", "PrimaryCTAButton"],
          designTokens: ["--color-surface-light"]
        }
      },
      {
        role: "user",
        text: "Make button blue.",
        paths: ["packages/site/src/DarkButton.tsx"],
        metadata: {
          className: "bg-black",
          componentTree: ["DashboardPage", "PrimaryCTAButton"],
          designTokens: ["--color-surface-dark"]
        }
      },
      {
        role: "user",
        text: "Make button orange.",
        paths: ["packages/site/src/CardButton.tsx"],
        metadata: {
          className: "bg-black",
          componentTree: ["DashboardPage", "SettingsCard", "PrimaryCTAButton"],
          designTokens: ["--color-surface-dark", "--color-card-background"]
        }
      }
    ]));

    const observations = buildLearnV2LearningObservationsFromEvidence(evidence);
    const hypotheses = inferLearnV2ConditionalHypotheses(observations);
    const orange = hypotheses.find((hypothesis) => hypothesis.desiredOutcome === "orange");

    expect(observations).toHaveLength(3);
    expect(observations.some((observation) =>
      observation.desiredOutcome === "orange" &&
      observation.factors.some((factor) => factor.key === "component.container" && factor.value === "card")
    )).toBe(true);
    expect(observations.some((observation) =>
      observation.desiredOutcome === "blue" &&
      observation.factors.some((factor) => factor.key === "ui.theme" && factor.value === "dark")
    )).toBe(true);
    expect(orange?.factorSet).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "component.container", value: "card" })
    ]));
    expect(JSON.stringify({ observations, hypotheses })).not.toContain(root);
  });

  it("builds reviewable ontology operations for multi-namespace concepts", () => {
    const [card] = mergeLearnV2ConceptCards([
      {
        ...behaviorAtom(
          "parser_verification_multi_namespace",
          "Prefer parser grammar regression tests and verification fixtures for parser syntax changes.",
          "positive"
        ),
        kind: "workflow"
      }
    ], new Date("2026-06-30T00:00:00Z"));

    const namespaces = buildLearnV2SkillNamespaces([card!]);
    const labels = namespaces.map((namespace) => namespace.label);
    expect(labels).toEqual(expect.arrayContaining([
      "Parser behavior",
      "Parser language structure",
      "Verification workflow",
      "Verification test workflow"
    ]));
    expect(namespaces.some((namespace) => namespace.parentNamespaceId && namespace.hierarchyPath.length >= 2)).toBe(true);

    const operations = buildLearnV2SkillOntologyOperations([card!], namespaces);
    expect(operations.some((operation) => operation.operation === "create-namespace")).toBe(true);
    expect(operations.some((operation) => operation.operation === "nest-namespace" && operation.status === "needs-review")).toBe(true);
    expect(operations.some((operation) => operation.operation === "attach-concept" && operation.namespaceIds.length >= 2)).toBe(true);
    expect(operations.some((operation) => operation.operation === "merge-namespaces" && operation.status === "needs-review")).toBe(true);
    expect(operations.some((operation) => operation.operation === "split-namespace" && operation.status === "needs-review")).toBe(true);
    expect(operations.every((operation) => operation.reviewHint.length > 0 && operation.rationale.length > 0)).toBe(true);
  });

  it("grounds verification concepts in project resources before external references", async () => {
    const root = await tempProject();
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "learn-v2-project",
      scripts: {
        test: "vitest --run"
      }
    }), "utf8");
    await writeFile(path.join(root, "README.md"), [
      "# Learn v2 Project",
      "",
      `For parser changes under ${path.join(root, "packages/core/src/parser.ts")}, prefer focused Vitest regression tests before broad rewrites. Contact reviewer@example.com only outside generated artifacts.`
    ].join("\n"), "utf8");
    const [card] = mergeLearnV2ConceptCards([
      {
        ...behaviorAtom("project_grounded_verification", "Prefer focused Vitest regression tests before parser changes.", "positive"),
        kind: "verification"
      }
    ], new Date("2026-06-30T00:13:00Z"));

    const artifact = await writeLearnV2OpenWorldGroundingArtifact(root, [card!], new Date("2026-06-30T00:14:00Z"));
    const projectAnchor = artifact.anchors.find((anchor) => anchor.title === "Project package scripts");
    expect(projectAnchor).toMatchObject({
      trustTier: "project",
      resourceKind: "project-doc",
      precedence: "project-doc-over-external",
      uri: "project://package.json#scripts"
    });
    expect(artifact.counts.projectAnchors).toBeGreaterThanOrEqual(1);
    expect(artifact.anchors.some((anchor) => anchor.title === "Vitest Guide" && anchor.trustTier === "official")).toBe(true);
    const readmeAnchor = artifact.anchors.find((anchor) => anchor.title === "Project doc: README.md");
    expect(readmeAnchor).toMatchObject({
      trustTier: "project",
      resourceKind: "project-doc",
      precedence: "project-doc-over-external",
      declassifiedSnippetIds: expect.arrayContaining([expect.stringMatching(/^snippet_[0-9a-f]+$/)])
    });
    expect(readmeAnchor?.alignedClaims.join("\n")).toContain("[PROJECT_ROOT]");
    expect(readmeAnchor?.alignedClaims.join("\n")).toContain("[REDACTED:email]");
    expect(readmeAnchor?.alignedClaims.join("\n")).not.toContain(root);
    expect(readmeAnchor?.alignedClaims.join("\n")).not.toContain("reviewer@example.com");
    const markdown = await readText(artifact.artifacts.markdown);
    expect(markdown).toContain("Project package scripts");
    expect(markdown).toContain("Project package scripts are highest-authority local evidence");
    expect(markdown).toContain("Project doc: README.md");
    expect(markdown).toContain("Project doc snippet snippet_");
    expect(markdown).toContain("[PROJECT_ROOT]");
    expect(markdown).toContain("[REDACTED:email]");
    expect(markdown).not.toContain(root);
    expect(markdown).not.toContain("reviewer@example.com");
  });

  it("grounds concepts against user-approved external resources without overriding user evidence", async () => {
    const root = await tempProject();
    const configPath = path.join(root, ".openskill-kit", "config.json");
    const config = await readProjectConfig(root);
    config.learning.openWorldResources.approvedResources = [{
      title: "Approved dashboard density guide",
      uri: "https://example.com/design/dashboard-density",
      matchTerms: ["dashboard clutter", "information density", "card layout"],
      summary: "Prefer calm dashboard cards with one primary action and clear hierarchy. Ask designer@example.com only in private planning notes.",
      resourceKind: "reference",
      trustTier: "community",
      licenseRisk: "unknown",
      usedFor: ["conditions", "skill-text"]
    }];
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const [card] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("approved_external_dashboard_density", "Prefer low-clutter dashboard card layout with one primary action.", "positive"),
      kind: "preference"
    }], new Date("2026-06-30T00:14:30Z"));

    const artifact = await writeLearnV2OpenWorldGroundingArtifact(root, [card!], new Date("2026-06-30T00:15:00Z"));
    const approvedAnchor = artifact.anchors.find((anchor) => anchor.title === "Approved dashboard density guide");

    expect(approvedAnchor).toMatchObject({
      uri: "https://example.com/design/dashboard-density",
      trustTier: "community",
      resourceKind: "reference",
      precedence: "resource-informs-review-only",
      licenseRisk: "unknown",
      declassifiedSnippetIds: expect.arrayContaining([expect.stringMatching(/^resource_[0-9a-f]+$/)])
    });
    expect(approvedAnchor?.usedFor).toEqual(expect.arrayContaining(["conditions", "skill-text", "eval"]));
    expect(approvedAnchor?.retrievalScore).toBeGreaterThanOrEqual(0.38);
    expect(approvedAnchor?.matchReasons.length).toBeGreaterThan(0);
    expect(approvedAnchor?.alignedClaims.join("\n")).toContain("Approved resource snippet resource_");
    expect(approvedAnchor?.alignedClaims.join("\n")).toContain("[REDACTED:email]");
    expect(approvedAnchor?.alignedClaims.join("\n")).not.toContain("designer@example.com");
    expect(approvedAnchor?.rationale).toContain("cannot override direct corrections");
    expect(artifact.counts.reviewOnlyAnchors).toBeGreaterThanOrEqual(1);
    const markdown = await readText(artifact.artifacts.markdown);
    expect(markdown).toContain("Approved dashboard density guide");
    expect(markdown).toContain("resource-informs-review-only");
    expect(markdown).toContain("Retrieval score:");
    expect(markdown).toContain("Match reasons:");
    expect(markdown).not.toContain("designer@example.com");
  });

  it("ranks approved grounding resources and rejects weak accidental matches", async () => {
    const root = await tempProject();
    const configPath = path.join(root, ".openskill-kit", "config.json");
    const config = await readProjectConfig(root);
    config.learning.openWorldResources.approvedResources = [
      {
        title: "Generic design card archive",
        uri: "https://example.com/generic-card",
        matchTerms: ["card"],
        summary: "Generic card examples only.",
        resourceKind: "reference",
        trustTier: "community",
        licenseRisk: "unknown",
        usedFor: ["skill-text"]
      },
      {
        title: "Official dashboard density guide",
        uri: "https://example.com/dashboard-density-official",
        matchTerms: ["dashboard density", "low clutter card layout", "primary action hierarchy"],
        summary: "Use one primary action, restrained density, and clear card hierarchy.",
        resourceKind: "official-docs",
        trustTier: "official",
        licenseRisk: "low",
        usedFor: ["conditions", "skill-text", "eval"]
      },
      {
        title: "Unrelated card security guide",
        uri: "https://example.com/security-card",
        matchTerms: ["security card authentication token"],
        summary: "Security card authentication notes.",
        resourceKind: "reference",
        trustTier: "community",
        licenseRisk: "unknown",
        usedFor: ["verification"]
      }
    ];
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const [card] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("ranked_dashboard_grounding", "Prefer low clutter dashboard card layout with one primary action hierarchy.", "positive"),
      kind: "preference"
    }], new Date("2026-06-30T00:15:30Z"));

    const artifact = await writeLearnV2OpenWorldGroundingArtifact(root, [card!], new Date("2026-06-30T00:16:00Z"));
    const approved = artifact.anchors.filter((anchor) => anchor.conceptId === card!.id && anchor.uri.startsWith("https://example.com/"));
    const official = approved.find((anchor) => anchor.title === "Official dashboard density guide");

    expect(approved.map((anchor) => anchor.title)).toContain("Official dashboard density guide");
    expect(approved.map((anchor) => anchor.title)).not.toContain("Generic design card archive");
    expect(approved.map((anchor) => anchor.title)).not.toContain("Unrelated card security guide");
    expect(official?.retrievalScore).toBeGreaterThanOrEqual(0.7);
    expect(official?.matchReasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/^term:/),
      "trust:official"
    ]));
    expect(approved[0]?.title).toBe("Official dashboard density guide");
  });

  it("joins ranked grounding details into concept debug trace", async () => {
    const root = await tempProject();
    const configPath = path.join(root, ".openskill-kit", "config.json");
    const config = await readProjectConfig(root);
    config.learning.openWorldResources.approvedResources = [{
      title: "Approved dashboard hierarchy guide",
      uri: "https://example.com/dashboard-hierarchy",
      matchTerms: ["dashboard hierarchy", "primary action"],
      summary: "Use one primary action and clear dashboard hierarchy.",
      resourceKind: "reference",
      trustTier: "community",
      licenseRisk: "unknown",
      usedFor: ["conditions", "skill-text"]
    }];
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const [card] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("debug_grounding_rank", "Prefer dashboard hierarchy with one primary action.", "positive"),
      kind: "preference"
    }], new Date("2026-06-30T00:16:30Z"));
    const grounding = await writeLearnV2OpenWorldGroundingArtifact(root, [card!], new Date("2026-06-30T00:17:00Z"));
    const trace = await writeLearnV2ConceptDebugTraceArtifact(root, [card!], new Date("2026-06-30T00:17:30Z"), {
      openWorldGrounding: grounding
    });
    const entry = trace.traces.find((item) => item.conceptId === card!.id)!;

    expect(entry.openWorldGrounding.rankedAnchors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Approved dashboard hierarchy guide",
        retrievalScore: expect.any(Number),
        matchReasons: expect.arrayContaining([expect.stringMatching(/^term:/)])
      })
    ]));
    expect(entry.evidenceSeparation.externalGrounding).toBeGreaterThanOrEqual(1);
    const markdown = await readText(trace.artifacts.markdown);
    expect(markdown).toContain("Approved dashboard hierarchy guide");
    expect(markdown).toContain("score=");
    expect(markdown).toContain("reasons=term:");
    expect(markdown).not.toContain(root);
  });

  it("keeps non-accepted raw sources out of Learn v2 extraction and canonical state", async () => {
    const root = await tempProject();
    const terminal = path.join(os.tmpdir(), `osk-review-needed-${Date.now()}.log`);
    const globalMemory = path.join(os.tmpdir(), `osk-rejected-global-${Date.now()}.txt`);
    await writeFile(terminal, [
      "$ npm test -- parser",
      "PASS parser suite",
      "PRIVATE_REVIEW_ONLY_MARKER_12345"
    ].join("\n"), "utf8");
    await writeFile(globalMemory, "global memory across repos: always use a personal deployment token", "utf8");

    const result = await runRawLocalLearning(root, {
      sourceFiles: [terminal, globalMemory],
      previewOnly: false,
      allowDuplicateImports: true,
      now: new Date("2026-06-30T00:01:10Z")
    });

    expect(result.sources.map((source) => source.projectRelevance.decision)).toEqual(expect.arrayContaining(["ask", "exclude"]));
    expect(result.digest.sourcesIncluded).toBe(0);
    expect(result.digest.sourcesAsk).toBe(1);
    expect(result.digest.sourcesExcluded).toBe(1);
    expect(result.digest.currentRunConceptCards).toBe(0);
    expect(result.digest.behaviorAtoms).toBe(0);
    expect(result.digest.canonicalConceptStateWritten).toBe(false);
    expect(result.learnV2.episodes).toEqual([]);
    expect(result.learnV2.currentRunConcepts).toEqual([]);
    expect((await readLearnV2ConceptStore(root)).cards).toEqual([]);
    expect(result.sources.every((source) => source.rawVaultRecordPath === undefined)).toBe(true);
    for (const source of result.sources) {
      const analysisFrame = JSON.parse(await readText(source.analysisFramePath));
      expect(analysisFrame.promptSafe).toBe(false);
      expect(analysisFrame.sourceGate.extractionEligible).toBe(false);
      expect(analysisFrame.sourceGate.normalizedEvidenceSuppressed).toBe(true);
      expect(analysisFrame.normalizedEvidence).toEqual([]);
    }
    const sourceGate = JSON.parse(await readText(result.artifacts.learnV2SourceGateReviewJsonPath));
    expect(sourceGate.schemaVersion).toBe("openskill-kit.learn-v2.source-gate-review.v1");
    expect(sourceGate.counts).toMatchObject({
      total: 2,
      accepted: 0,
      review: 1,
      rejected: 1,
      extractionEligible: 0,
      normalizedEvidenceSuppressed: 2
    });
    expect(sourceGate.entries.find((entry: { decision: string; reviewSnippet?: string }) => entry.decision === "review")?.reviewSnippet).toBeUndefined();
    expect(sourceGate.entries.find((entry: { decision: string }) => entry.decision === "reject")?.reviewSnippet).toBeUndefined();
    const sourceGateJson = JSON.stringify(sourceGate);
    const sourceGateMarkdown = await readText(result.artifacts.learnV2SourceGateReviewPath);
    expect(sourceGateJson).not.toContain("npm test");
    expect(sourceGateJson).not.toContain("PRIVATE_REVIEW_ONLY_MARKER_12345");
    expect(sourceGateMarkdown).toContain("Suppressed normalized evidence: 2");
    expect(sourceGateMarkdown).toContain("review-metadata-only");
    expect(sourceGateMarkdown).not.toContain("npm test");
    expect(sourceGateMarkdown).not.toContain("PRIVATE_REVIEW_ONLY_MARKER_12345");

    const sourceDebug = await readLearnV2SourceGateDebugView(root);
    expect(sourceDebug.schemaVersion).toBe("openskill-kit.learn-v2.source-gate-debug-view.v1");
    expect(sourceDebug.counts.normalizedEvidenceSuppressed).toBe(2);
    expect(sourceDebug.entries).toHaveLength(2);
    expect(sourceDebug.entries.map((entry) => entry.decision)).toEqual(expect.arrayContaining(["review", "reject"]));
    const debugJson = JSON.stringify(sourceDebug);
    expect(debugJson).not.toContain("npm test");
    expect(debugJson).not.toContain("PRIVATE_REVIEW_ONLY_MARKER_12345");
    expect(debugJson).not.toContain(root);

    const oneSourceDebug = await readLearnV2SourceGateDebugView(root, { sourceId: sourceDebug.entries[0]!.id });
    expect(oneSourceDebug.entries).toHaveLength(1);
    expect(oneSourceDebug.entries[0]!.id).toBe(sourceDebug.entries[0]!.id);
  });

  it("preserves canonical Learn v2 artifacts when a later raw run has no accepted sources", async () => {
    const root = await tempProject();
    const accepted = path.join(root, "accepted-parser-session.md");
    await writeFile(
      accepted,
      `${root}\npackages/core/src/parser.ts\nuser: Prefer focused parser regression fixtures before broad parser rewrites.`,
      "utf8"
    );
    const seeded = await runRawLocalLearning(root, {
      sourceFiles: [accepted],
      previewOnly: false,
      allowDuplicateImports: true,
      now: new Date("2026-06-30T00:01:20Z")
    });
    expect(seeded.digest.sourcesIncluded).toBe(1);
    expect(seeded.learnV2.modelRequestCount).toBeGreaterThanOrEqual(1);

    const before = {
      episodeStore: await readText(seeded.artifacts.learnV2EpisodeStorePath),
      reviewQueue: await readText(seeded.artifacts.learnV2ReviewQueuePath),
      compilePreview: await readText(seeded.artifacts.learnV2CompilePreviewPath),
      evalReport: await readText(seeded.artifacts.learnV2EvalReportPath),
      modelRequestDirs: await topLevelDirNames(seeded.artifacts.learnV2ModelRequestDir)
    };

    const reviewOnly = path.join(os.tmpdir(), `osk-review-only-${Date.now()}.log`);
    const rejected = path.join(os.tmpdir(), `osk-rejected-memory-${Date.now()}.txt`);
    await writeFile(reviewOnly, "$ npm test\nPASS parser suite", "utf8");
    await writeFile(rejected, "global memory across repos: always use personal release token", "utf8");

    const gated = await runRawLocalLearning(root, {
      sourceFiles: [reviewOnly, rejected],
      previewOnly: false,
      allowDuplicateImports: true,
      now: new Date("2026-06-30T00:01:30Z")
    });

    expect(gated.digest.sourcesIncluded).toBe(0);
    expect(gated.digest.learningWindows).toBe(0);
    expect(gated.digest.behaviorAtoms).toBe(0);
    expect(gated.learnV2.modelRequestCount).toBe(0);
    expect(gated.privacy.join("\n")).toContain("preserved canonical episode stores");
    expect(await readText(seeded.artifacts.learnV2EpisodeStorePath)).toBe(before.episodeStore);
    expect(await readText(seeded.artifacts.learnV2ReviewQueuePath)).toBe(before.reviewQueue);
    expect(await readText(seeded.artifacts.learnV2CompilePreviewPath)).toBe(before.compilePreview);
    expect(await readText(seeded.artifacts.learnV2EvalReportPath)).toBe(before.evalReport);
    expect(await topLevelDirNames(seeded.artifacts.learnV2ModelRequestDir)).toEqual(before.modelRequestDirs);
  });

  it("preserves existing project relevance calibration across raw learning runs", async () => {
    const root = await tempProject();
    const calibrationPath = path.join(root, ".openskill-kit", "learn-v2", "relevance-calibration.json");
    const customCalibration = {
      schemaVersion: "openskill-kit.project-relevance-calibration.v1",
      policyVersion: "custom-human-reviewed-v9",
      features: ["sourceFileInsideProject", "projectRootMentioned", "repoRelativePathMentioned"],
      weights: {
        sourceFileInsideProject: 0.11,
        projectRootMentioned: 0.22,
        repoRelativePathMentioned: 0.33
      },
      thresholds: {
        accept: 0.55,
        review: 0.25,
        reject: 0
      },
      trainedFrom: ["human-review"],
      updatedAt: "2026-06-29T00:00:00.000Z",
      notes: ["custom calibration must not be overwritten by ensure"]
    };
    await mkdir(path.dirname(calibrationPath), { recursive: true });
    await writeFile(calibrationPath, `${JSON.stringify(customCalibration, null, 2)}\n`, "utf8");
    const transcript = path.join(root, "calibrated-session.md");
    await writeFile(transcript, `user: ${root} prefer focused parser tests in packages/core/src/parser.ts.`, "utf8");

    const result = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: true,
      now: new Date("2026-06-30T00:02:00Z")
    });

    expect(result.sources[0]!.projectRelevance.score).toBeGreaterThanOrEqual(customCalibration.thresholds.accept);
    const persisted = JSON.parse(await readText(calibrationPath));
    expect(persisted.policyVersion).toBe("custom-human-reviewed-v9");
    expect(persisted.weights.sourceFileInsideProject).toBe(0.11);
    expect(persisted.notes).toEqual(customCalibration.notes);
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
    expect(aliased.modelExecution.requestArtifacts.status).toBe("skipped-preview");
    expect(aliased.modelExecution.rawToModelExecution.status).toBe("rejected");
    expect(aliased.privacy.join("\n")).toContain("Model execution policy is deterministic-only");

    const sanitized = await runRawLocalLearning(root, {
      sourceFiles: [transcript],
      previewOnly: true,
      modelMode: "remote-redacted",
      now: new Date("2026-06-30T00:01:00Z")
    });
    expect(sanitized.modelMode).toBe("opencode-host-sanitized-only");
    expect(sanitized.modelExecution.requestArtifacts.status).toBe("skipped-preview");
    expect(sanitized.modelExecution.sanitizedOpenCodeExecution.requiresExplicitApproval).toBe(true);

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
      activation: { ...existing!.activation, pathGlobs: ["packages/core/src/**"] },
      counterevidence: [{
        evidenceId: existing!.evidenceIds[0]!,
        reason: "Contradictory local review note requires human confirmation."
      }]
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
    expect(reviewQueue).toContain("## Counterevidence Summary");
    expect(reviewQueue).toContain("Counterevidence ledger:");
    const counterevidenceLedgerMarkdown = await readText(result.artifacts.learnV2CounterevidenceLedgerPath);
    expect(counterevidenceLedgerMarkdown).toContain("# Learn v2 Counterevidence Ledger");
    expect(counterevidenceLedgerMarkdown).toContain(existing!.id);
    expect(counterevidenceLedgerMarkdown).not.toContain(root);
    const counterevidenceLedger = JSON.parse(await readText(result.artifacts.learnV2CounterevidenceLedgerPath.replace(/\.md$/, ".json")));
    expect(counterevidenceLedger.schemaVersion).toBe("openskill-kit.learn-v2.counterevidence-ledger.v1");
    expect(counterevidenceLedger.totalItems).toBeGreaterThanOrEqual(1);
    expect(counterevidenceLedger.conceptCount).toBeGreaterThanOrEqual(1);
    expect(counterevidenceLedger.activationBlockingCount).toBeGreaterThanOrEqual(1);
    expect(counterevidenceLedger.entries.some((entry: { conceptId: string; reason: string }) => entry.conceptId === existing!.id && entry.reason.length > 0)).toBe(true);
    expect(JSON.stringify(counterevidenceLedger)).not.toContain(root);
    expect(result.learnV2.concepts.some((card) => card.id === existing!.id)).toBe(true);
  });

  it("writes counterevidence ledger with local path redaction", async () => {
    const root = await tempProject();
    const [card] = mergeLearnV2ConceptCards([
      { ...behaviorAtom("counterevidence_local_path", "Prefer focused parser tests for parser changes.", "positive"), kind: "workflow" }
    ], new Date("2026-06-30T00:00:00Z"));
    const written = await writeLearnV2CounterevidenceLedger(root, [{
      ...card!,
      status: "candidate",
      counterevidence: [{
        evidenceId: card!.evidenceIds[0]!,
        reason: `Review note contradicted this behavior in ${root}.`
      }]
    }], new Date("2026-06-30T00:01:00Z"));

    expect(written.ledger.totalItems).toBe(1);
    expect(written.ledger.activationBlockingCount).toBe(1);
    expect(written.ledger.entries[0]!.reason).toContain("[LOCAL_PATH]");
    expect(JSON.stringify(written.ledger)).not.toContain(root);
    const markdown = await readText(written.artifactPaths.markdown);
    expect(markdown).toContain("[LOCAL_PATH]");
    expect(markdown).not.toContain(root);
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
    expect(extracted.skillNamespaceCount).toBeGreaterThanOrEqual(1);
    expect(extracted.openWorldAnchorCount).toBeGreaterThanOrEqual(1);
    expect(extracted.conceptDebugTraceCount).toBeGreaterThanOrEqual(1);
    expect(extracted.outcomePolicySuppressionCount).toBe(0);
    expect(await readText(extracted.skillOntologyPath)).toContain("Skill Ontology");
    expect(await readText(extracted.openWorldGroundingPath)).toContain("Open-World Grounding");
    expect(await readText(extracted.conceptDebugTracePath)).toContain("Concept Debug Trace");
    expect(await readText(extracted.outcomePolicyPath)).toContain("Outcome Policy");
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
    expect(manifest.promptHash).toBe(request.promptHash);
    expect(manifest.bundleHash).toBe(request.bundleHash);
    expect(manifest.executionBoundary).toBe("opencode-host-sanitized-only");
    expect(manifest.opencodeAgentId).toBe("osk-learn-v2-concept-extractor");
    expect(manifest.rawRefsIncluded).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain("raw_");
    expect(JSON.stringify(manifest)).not.toContain(root);

    const requestEpisode = learned.learnV2.episodes.find((episode) => episode.id === request.episodeId)!;
    const [evidenceId] = requestEpisode.evidenceIds;
    const requestPath = requestEpisode.pathCluster[0]!;
    expect(requestPath).toBeTruthy();
    const outputPath = request.expectedOutputPath;
    await writeFile(outputPath, JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
      atoms: [{
        statement: "For parser changes, prefer focused parser regression tests before broad suites.",
        kind: "verification",
        polarity: "positive",
        evidenceIds: [evidenceId],
        scope: {
          level: "path",
          paths: [requestPath],
          taskTypes: ["parser-change"]
        },
        appliesWhen: ["Parser behavior changes need focused regression coverage."],
        doesNotApplyWhen: ["Task is unrelated to parser behavior."],
        activation: {
          phrases: ["focused parser regression"],
          pathGlobs: [requestPath.split("/").slice(0, -1).join("/") + "/**"],
          commands: ["npm test -- parser"],
          negativeTriggers: ["unrelated-task-scope"]
        },
        counterevidence: [{
          evidenceId,
          reason: "Evidence supports parser scope only."
        }],
        risk: "low",
        confidence: 0.74,
        confidenceCap: 0.76,
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
    const unsafeBoundaryDir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", "episode_unsafe_boundary");
    const unsafeBoundaryOutputPath = path.join(unsafeBoundaryDir, "response.json");
    await mkdir(unsafeBoundaryDir, { recursive: true });
    await writeFile(path.join(unsafeBoundaryDir, "concept-extraction-prompt.md"), prompt, "utf8");
    await writeFile(path.join(unsafeBoundaryDir, "episode-learning-bundle.json"), bundle, "utf8");
    await writeFile(path.join(unsafeBoundaryDir, "request-manifest.json"), JSON.stringify({
      ...manifest,
      episodeId: request.episodeId,
      promptPath: projectRel(root, path.join(unsafeBoundaryDir, "concept-extraction-prompt.md")),
      bundlePath: projectRel(root, path.join(unsafeBoundaryDir, "episode-learning-bundle.json")),
      expectedOutputPath: projectRel(root, unsafeBoundaryOutputPath),
      evidenceIds: [evidenceId]
    }), "utf8");
    await writeFile(unsafeBoundaryOutputPath, JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
      atoms: [{
        statement: "Prefer parser fixtures after checking [PROJECT_ROOT]/secret and /home/user/.ssh/id_rsa.",
        kind: "verification",
        polarity: "positive",
        evidenceIds: [evidenceId],
        appliesWhen: ["Private user reviewer@example.com asked from raw_abc12345."],
        activation: {
          phrases: ["[PROJECT_ROOT] parser"],
          pathGlobs: [requestPath],
          commands: ["npm test -- parser"],
          negativeTriggers: []
        },
        counterevidence: [{
          evidenceId,
          reason: "Unsafe raw_abc12345 marker must not enter concept state."
        }],
        confidence: 0.72,
        rationale: "Model leaked reviewer@example.com, raw_abc12345, and [PROJECT_ROOT]."
      }],
      rejected: []
    }), "utf8");
    const tamperedPromptDir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", "episode_tampered_prompt");
    const tamperedPromptOutputPath = path.join(tamperedPromptDir, "response.json");
    await mkdir(tamperedPromptDir, { recursive: true });
    await writeFile(path.join(tamperedPromptDir, "episode-learning-bundle.json"), bundle, "utf8");
    await writeFile(path.join(tamperedPromptDir, "request-manifest.json"), JSON.stringify({
      ...manifest,
      episodeId: request.episodeId,
      promptPath: ".openskill-kit/learn-v2/model-requests/other/concept-extraction-prompt.md",
      bundlePath: projectRel(root, path.join(tamperedPromptDir, "episode-learning-bundle.json")),
      expectedOutputPath: projectRel(root, tamperedPromptOutputPath),
      evidenceIds: [evidenceId]
    }), "utf8");
    await writeFile(tamperedPromptOutputPath, JSON.stringify({
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
    const tamperedMissingDir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", "episode_missing_bundle");
    const tamperedMissingOutputPath = path.join(tamperedMissingDir, "response.json");
    await mkdir(tamperedMissingDir, { recursive: true });
    await writeFile(path.join(tamperedMissingDir, "concept-extraction-prompt.md"), prompt, "utf8");
    await writeFile(path.join(tamperedMissingDir, "request-manifest.json"), JSON.stringify({
      ...manifest,
      episodeId: request.episodeId,
      promptPath: projectRel(root, path.join(tamperedMissingDir, "concept-extraction-prompt.md")),
      bundlePath: projectRel(root, path.join(tamperedMissingDir, "episode-learning-bundle.json")),
      expectedOutputPath: projectRel(root, tamperedMissingOutputPath),
      evidenceIds: [evidenceId]
    }), "utf8");
    await writeFile(tamperedMissingOutputPath, JSON.stringify({
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
    const tamperedBundleDir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", "episode_tampered_bundle");
    const tamperedBundleOutputPath = path.join(tamperedBundleDir, "response.json");
    await mkdir(tamperedBundleDir, { recursive: true });
    await writeFile(path.join(tamperedBundleDir, "concept-extraction-prompt.md"), prompt, "utf8");
    await writeFile(path.join(tamperedBundleDir, "episode-learning-bundle.json"), `${bundle}\n{"tampered":true}\n`, "utf8");
    await writeFile(path.join(tamperedBundleDir, "request-manifest.json"), JSON.stringify({
      ...manifest,
      episodeId: request.episodeId,
      promptPath: projectRel(root, path.join(tamperedBundleDir, "concept-extraction-prompt.md")),
      bundlePath: projectRel(root, path.join(tamperedBundleDir, "episode-learning-bundle.json")),
      expectedOutputPath: projectRel(root, tamperedBundleOutputPath),
      evidenceIds: [evidenceId]
    }), "utf8");
    await writeFile(tamperedBundleOutputPath, JSON.stringify({
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
    const staleDir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", "episode_stale");
    const staleOutputPath = path.join(staleDir, "response.json");
    await mkdir(staleDir, { recursive: true });
    await writeFile(path.join(staleDir, "concept-extraction-prompt.md"), prompt, "utf8");
    await writeFile(path.join(staleDir, "episode-learning-bundle.json"), bundle, "utf8");
    await writeFile(path.join(staleDir, "request-manifest.json"), JSON.stringify({
      ...manifest,
      episodeId: "episode_missing",
      promptPath: projectRel(root, path.join(staleDir, "concept-extraction-prompt.md")),
      bundlePath: projectRel(root, path.join(staleDir, "episode-learning-bundle.json")),
      expectedOutputPath: projectRel(root, staleOutputPath),
      evidenceIds: [evidenceId]
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
    const malformedDir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", "episode_malformed");
    const malformedOutputPath = path.join(malformedDir, "response.json");
    await mkdir(malformedDir, { recursive: true });
    await writeFile(path.join(malformedDir, "concept-extraction-prompt.md"), prompt, "utf8");
    await writeFile(path.join(malformedDir, "episode-learning-bundle.json"), bundle, "utf8");
    await writeFile(path.join(malformedDir, "request-manifest.json"), JSON.stringify({
      ...manifest,
      episodeId: request.episodeId,
      promptPath: projectRel(root, path.join(malformedDir, "concept-extraction-prompt.md")),
      bundlePath: projectRel(root, path.join(malformedDir, "episode-learning-bundle.json")),
      expectedOutputPath: projectRel(root, malformedOutputPath),
      evidenceIds: [evidenceId]
    }), "utf8");
    await writeFile(malformedOutputPath, "{", "utf8");
    const bareDir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", "episode_no_manifest");
    const bareOutputPath = path.join(bareDir, "response.json");
    await mkdir(bareDir, { recursive: true });
    await writeFile(bareOutputPath, JSON.stringify({
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

    const applied = await applyLearnV2ModelProposalOutputs(root, [
      request.manifestPath,
      badOutputPath,
      unsafeBoundaryOutputPath,
      tamperedPromptOutputPath,
      tamperedMissingOutputPath,
      tamperedBundleOutputPath,
      staleOutputPath,
      malformedOutputPath,
      bareOutputPath
    ], new Date("2026-06-30T00:02:00Z"));
    const store = await readLearnV2ConceptStore(root);
    expect(applied.outputFiles).toContain(outputPath);
    expect(applied.atomCount).toBe(1);
    expect(applied.rejected.map((item) => item.reason)).toEqual(expect.arrayContaining([
      "unexpected-request-file-path",
      "unsafe-output-content",
      "missing-request-file",
      "request-file-hash-mismatch",
      "stale-request-manifest",
      "invalid-json-or-schema",
      "missing-request-manifest"
    ]));
    expect(applied.evalStatus).toBe("pass");
    expect(await readText(applied.reviewQueuePath)).toContain("Evidence Snippet Summary");
    expect(await readText(applied.reviewQueuePath)).toContain("For parser changes, prefer focused parser regression tests before broad suites.");
    expect(await readText(applied.conflictLedgerPath)).toContain("Learn v2 Conflict Ledger");
    expect(await readText(applied.evalReportPath)).toContain("Learn v2 Eval");
    expect(await readText(applied.declassifiedSnippetsPath)).toContain("Learn v2 Declassified Evidence Snippets");
    expect(await readText(applied.conceptDriftPath)).toContain("openskill-kit.learn-v2.concept-drift.v1");
    const richCard = store.cards.find((card) => card.conditions?.appliesWhen.includes("Parser behavior changes need focused regression coverage."))!;
    expect(richCard).toBeTruthy();
    expect(richCard.conditions?.appliesWhen).toContain("Parser behavior changes need focused regression coverage.");
    expect(richCard.conditions?.doesNotApplyWhen).toContain("Task is unrelated to parser behavior.");
    expect(richCard.activation.phrases).toContain("focused parser regression");
    expect(richCard.activation.commands).toContain("npm test -- parser");
    expect(richCard.counterevidence.some((item) => item.reason === "Evidence supports parser scope only.")).toBe(true);
    expect(JSON.stringify(store)).not.toContain("sk-12345678901234567890");
    expect(JSON.stringify(store)).not.toContain("[PROJECT_ROOT]");
    expect(JSON.stringify(store)).not.toContain("raw_abc12345");
    expect(JSON.stringify(store)).not.toContain("reviewer@example.com");
    expect(JSON.stringify(store)).not.toContain("/home/user");
  });

  it("executes sanitized OpenCode model requests with hash binding and strict output validation", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:03:00Z");
    const [episode] = reconstructLearnV2Episodes([
      normalizedMessage("ev_exec_prefer", "Wrong approach. Prefer focused parser regression fixtures before broad parser rewrites.", "user")
    ]);
    await writeLearnV2EpisodeStore(root, [episode!], now);
    const requests = await writeLearnV2ModelRequests(root, undefined, now);
    const request = requests.requests[0]!;
    const invocationLog: LearnV2OpenCodeInvocation[] = [];
    const result = await executeLearnV2ModelRequests(root, {
      requestManifests: [request.manifestPath],
      opencodeCommand: "opencode-test",
      timeoutMs: 20_000,
      now,
      runner: async (invocation) => {
        invocationLog.push(invocation);
        const config = JSON.parse(invocation.env.OPENCODE_CONFIG_CONTENT ?? "{}");
        expect(invocation.command).toBe("opencode-test");
        expect(invocation.cwd).not.toBe(root);
        expect(path.relative(root, invocation.cwd).startsWith("..") || path.isAbsolute(path.relative(root, invocation.cwd))).toBe(true);
        expect(invocation.timeoutMs).toBe(20_000);
        expect(invocation.args).toContain("run");
        expect(invocation.args).toContain("--agent");
        expect(invocation.args).toContain("osk-learn-v2-concept-extractor");
        expect(invocation.args[invocation.args.indexOf("--dir") + 1]).toBe(invocation.cwd);
        expect(invocation.args).toContain("--file");
        expect(invocation.args).not.toContain(request.promptPath);
        expect(invocation.args).not.toContain(request.bundlePath);
        expect(path.basename(invocation.args[invocation.args.indexOf("--file") + 1])).toBe("concept-extraction-prompt.md");
        expect(path.basename(invocation.args[invocation.args.lastIndexOf("--file") + 1])).toBe("episode-learning-bundle.json");
        expect(JSON.stringify(config)).toContain("osk-learn-v2-concept-extractor");
        expect(config.agent["osk-learn-v2-concept-extractor"].permission.bash).toBe("deny");
        expect(config.agent["osk-learn-v2-concept-extractor"].permission.edit).toBe("deny");
        expect(JSON.stringify(invocation.args)).not.toContain(root);
        expect(JSON.stringify(invocation.args)).not.toContain("raw_");
        expect(JSON.stringify(config)).not.toContain("raw_");
        const proposal = {
          schemaVersion: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
          atoms: [{
            statement: "For parser changes, prefer focused parser regression fixtures before broad parser rewrites.",
            kind: "verification",
            polarity: "positive",
            evidenceIds: [episode!.evidenceIds[0]],
            confidence: 0.76,
            rationale: "The episode contains an explicit correction."
          }],
          rejected: []
        };
        return {
          exitCode: 0,
          stdout: `OpenCode diagnostic preface\n\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\`\nOpenCode diagnostic suffix`,
          stderr: "diagnostic line that must not be persisted"
        };
      }
    });

    expect(result.writtenCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.results[0]?.status).toBe("written");
    expect(result.results[0]?.modelRole).toBe("concept-extractor");
    expect(result.results[0]?.argsShape).toContain("[ATTACHED_FILE]");
    expect(result.results[0]?.argsShape).toContain("[EXECUTION_DIR]");
    expect(result.results[0]?.stdoutHash).toMatch(/^sha256:/);
    expect(result.results[0]?.stderrHash).toMatch(/^sha256:/);
    expect(invocationLog).toHaveLength(1);
    expect(await readText(request.expectedOutputPath)).toContain("openskill-kit.learn-v2.llm-concept-extraction-output.v1");
    expect(await readText(result.executionReportPath)).toContain("model-request-execution-result");
    expect(await readText(result.executionReportPath)).not.toContain("diagnostic line");

    await writeFile(request.promptPath, `${await readText(request.promptPath)}\nTampered after manifest.\n`, "utf8");
    const tampered = await executeLearnV2ModelRequests(root, {
      requestManifests: [request.manifestPath],
      opencodeCommand: "opencode-test",
      runner: async () => {
        throw new Error("runner should not be called for tampered manifests");
      }
    });
    expect(tampered.writtenCount).toBe(0);
    expect(tampered.failedCount).toBe(1);
    expect(tampered.results[0]?.reason).toBe("request-file-hash-mismatch");
    expect(invocationLog).toHaveLength(1);
  });

  it("rejects model request manifests outside OSK request roots and unsafe manifest paths", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:03:10Z");
    const [episode] = reconstructLearnV2Episodes([
      normalizedMessage("ev_exec_confine", "Prefer focused parser regression fixtures before broad parser rewrites.", "user")
    ]);
    await writeLearnV2EpisodeStore(root, [episode!], now);
    const requests = await writeLearnV2ModelRequests(root, undefined, now);
    const request = requests.requests[0]!;
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "osk-external-model-request-"));
    await mkdir(outsideDir, { recursive: true });
    await writeFile(path.join(outsideDir, "request-manifest.json"), await readText(request.manifestPath), "utf8");

    const outside = await executeLearnV2ModelRequests(root, {
      requestManifests: [path.join(outsideDir, "request-manifest.json")],
      opencodeCommand: "opencode-test",
      runner: async () => {
        throw new Error("runner should not execute external manifests");
      }
    });
    expect(outside.writtenCount).toBe(0);
    expect(outside.failedCount).toBe(1);
    expect(outside.results[0]?.reason).toBe("request-manifest-outside-model-requests");

    const manifest = JSON.parse(await readText(request.manifestPath));
    await writeFile(request.manifestPath, JSON.stringify({
      ...manifest,
      expectedOutputPath: path.join(outsideDir, "response.json")
    }, null, 2), "utf8");
    const unsafePath = await executeLearnV2ModelRequests(root, {
      requestManifests: [request.manifestPath],
      opencodeCommand: "opencode-test",
      runner: async () => {
        throw new Error("runner should not execute unsafe manifests");
      }
    });
    expect(unsafePath.writtenCount).toBe(0);
    expect(unsafePath.failedCount).toBe(1);
    expect(unsafePath.results[0]?.reason).toBe("unexpected-request-file-path");
  });

  it("prepares executes and applies scope-inferencer proposals without broadening concept scope", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:03:20Z");
    const [episode] = reconstructLearnV2Episodes([
      normalizedMessage("ev_scope_parser", "Prefer focused parser regression fixtures for parser changes in packages/core/src/parser.ts.", "user")
    ]);
    await writeLearnV2EpisodeStore(root, [episode!], now);
    const extracted = extractLearnV2BehaviorAtoms([episode!]);
    const [card] = mergeLearnV2ConceptCards(extracted.atoms, now);
    expect(card).toBeTruthy();
    const scopedCard = {
      ...card!,
      scope: {
        ...card!.scope,
        level: "path" as const,
        paths: ["packages/core/src/parser.ts"]
      },
      activation: {
        ...card!.activation,
        pathGlobs: ["packages/core/src/parser.ts"]
      }
    };
    await writeLearnV2ConceptStore(root, [scopedCard], now);

    const requests = await writeLearnV2ScopeInferenceRequests(root, [scopedCard.id], now);
    expect(requests.requestCount).toBe(1);
    const request = requests.requests[0]!;
    const manifest = JSON.parse(await readText(request.manifestPath));
    expect(manifest.modelRole).toBe("scope-inferencer");
    expect(manifest.conceptId).toBe(scopedCard.id);
    expect(manifest.outputSchema).toBe("openskill-kit.learn-v2.llm-scope-inference-output.v1");
    expect(manifest.opencodeAgentId).toBe("osk-learn-v2-scope-inferencer");
    expect(await readText(request.promptPath)).toContain("ConceptScopeBundle");
    expect(await readText(request.bundlePath)).not.toContain("raw_");
    expect(JSON.stringify(manifest)).not.toContain(root);

    const scopeProposal = {
      schemaVersion: "openskill-kit.learn-v2.llm-scope-inference-output.v1",
      conceptId: scopedCard.id,
      appliesWhen: ["Parser behavior changes need focused regression fixtures."],
      doesNotApplyWhen: ["Docs-only edits should not run parser regression scope."],
      scope: {
        level: "path",
        paths: ["packages/core/src/parser.ts"],
        taskTypes: ["parser-change"]
      },
      activation: {
        phrases: ["parser regression fixture"],
        pathGlobs: ["packages/core/src/parser.ts"],
        commands: ["npm test -- parser"],
        negativeTriggers: ["docs-only edits"]
      },
      counterevidence: [{
        evidenceId: scopedCard.evidenceIds[0],
        reason: "Evidence is specifically parser scoped."
      }],
      confidence: 0.74,
      rationale: "The concept only cites parser behavior evidence.",
      rejected: []
    };

    const executed = await executeLearnV2ModelRequests(root, {
      requestManifests: [request.manifestPath],
      opencodeCommand: "opencode-test",
      runner: async (invocation) => {
        const config = JSON.parse(invocation.env.OPENCODE_CONFIG_CONTENT ?? "{}");
        expect(invocation.args).toContain("osk-learn-v2-scope-inferencer");
        expect(invocation.cwd).not.toBe(root);
        expect(invocation.args[invocation.args.indexOf("--dir") + 1]).toBe(invocation.cwd);
        expect(invocation.args).not.toContain(request.promptPath);
        expect(invocation.args).not.toContain(request.bundlePath);
        expect(path.basename(invocation.args[invocation.args.indexOf("--file") + 1])).toBe("scope-inference-prompt.md");
        expect(path.basename(invocation.args[invocation.args.lastIndexOf("--file") + 1])).toBe("concept-scope-bundle.json");
        expect(JSON.stringify(config)).toContain("osk-learn-v2-scope-inferencer");
        expect(config.agent["osk-learn-v2-scope-inferencer"].permission.bash).toBe("deny");
        expect(JSON.stringify(invocation.args)).not.toContain(root);
        expect(JSON.stringify(invocation.args)).not.toContain("raw_");
        return {
          exitCode: 0,
          stdout: `diagnostic\n\`\`\`json\n${JSON.stringify(scopeProposal)}\n\`\`\``,
          stderr: "scope diagnostic must be hashed only"
        };
      }
    });
    expect(executed.writtenCount).toBe(1);
    expect(executed.results[0]?.modelRole).toBe("scope-inferencer");
    expect(await readText(executed.executionReportPath)).not.toContain("scope diagnostic must be hashed only");

    const applied = await applyLearnV2ScopeInferenceOutputs(root, [request.manifestPath], new Date("2026-06-30T00:03:21Z"));
    expect(applied.updatedConceptIds).toEqual([scopedCard.id]);
    expect(applied.rejected).toEqual([]);
    const scopedStore = await readLearnV2ConceptStore(root);
    const scoped = scopedStore.cards.find((item) => item.id === scopedCard.id)!;
    expect(scoped.conditions?.appliesWhen).toContain("Parser behavior changes need focused regression fixtures.");
    expect(scoped.conditions?.doesNotApplyWhen).toContain("Docs-only edits should not run parser regression scope.");
    expect(scoped.activation.phrases).toContain("parser regression fixture");
    expect(scoped.scope.negativeTriggers).toContain("docs-only edits");
    expect(scoped.activation.commands).toContain("npm test -- parser");
    expect(scoped.counterevidence.some((item) => item.reason === "Evidence is specifically parser scoped.")).toBe(true);

    await writeFile(request.expectedOutputPath, JSON.stringify({
      ...scopeProposal,
      scope: { level: "path", paths: ["packages"], taskTypes: ["parser-change"] },
      activation: { ...scopeProposal.activation, pathGlobs: ["packages/**"] }
    }), "utf8");
    const unsafe = await applyLearnV2ScopeInferenceOutputs(root, [request.manifestPath], new Date("2026-06-30T00:03:22Z"));
    expect(unsafe.updatedConceptIds).toEqual([]);
    expect(unsafe.rejected[0]?.reason).toBe("scope-broadening-rejected");
  });

  it("blocks scope-inferencer outputs from bypassing reviewer-locked scope", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:03:30Z");
    const [card] = mergeLearnV2ConceptCards([
      behaviorAtom("scope_infer_lock", "Prefer focused parser tests for parser changes.", "positive")
    ], now);
    const lockedCard = {
      ...card!,
      status: "active" as const,
      scope: {
        ...card!.scope,
        level: "path" as const,
        paths: ["packages/core/src/parser.ts"],
        taskTypes: ["parser-change"],
        negativeTriggers: ["docs-only"],
        reviewLocked: true,
        reviewedAt: "2026-06-30T00:03:30.000Z"
      },
      activation: {
        phrases: ["parser regression coverage"],
        pathGlobs: ["packages/core/src/parser.ts"],
        commands: []
      },
      conditions: undefined,
      atoms: card!.atoms.map((atom) => ({
        ...atom,
        scope: {
          ...atom.scope,
          paths: ["packages/core/src/parser.ts", "docs/parser-guide.md"],
          taskTypes: ["parser-change", "docs-change"]
        }
      }))
    };
    await writeLearnV2ConceptStore(root, [lockedCard], now);

    const requests = await writeLearnV2ScopeInferenceRequests(root, [lockedCard.id], now);
    expect(requests.requestCount).toBe(1);
    expect(requests.requests[0]?.routing.reasons).toContain("reviewer-scope-locked-conditions-only");
    const request = requests.requests[0]!;

    await writeFile(request.expectedOutputPath, JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-scope-inference-output.v1",
      conceptId: lockedCard.id,
      appliesWhen: ["Parser behavior changes need focused regression coverage."],
      doesNotApplyWhen: ["Docs-only edits stay outside parser coverage scope."],
      scope: {
        level: "path",
        paths: ["packages/core/src/parser.ts", "docs/parser-guide.md"],
        taskTypes: ["parser-change", "docs-change"]
      },
      activation: {
        phrases: ["parser guide docs"],
        pathGlobs: ["docs/**"],
        commands: [],
        negativeTriggers: ["docs-only"]
      },
      counterevidence: [],
      rejected: []
    }), "utf8");
    const rejected = await applyLearnV2ScopeInferenceOutputs(root, [request.manifestPath], new Date("2026-06-30T00:03:31Z"));
    expect(rejected.updatedConceptIds).toEqual([]);
    expect(rejected.rejected[0]?.reason).toBe("review-locked-scope-change");

    await writeFile(request.expectedOutputPath, JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-scope-inference-output.v1",
      conceptId: lockedCard.id,
      appliesWhen: ["Parser behavior changes need focused regression coverage."],
      doesNotApplyWhen: ["Docs-only edits stay outside parser coverage scope."],
      scope: {
        paths: [],
        taskTypes: []
      },
      activation: {
        phrases: [],
        pathGlobs: [],
        commands: [],
        negativeTriggers: []
      },
      counterevidence: [],
      rejected: []
    }), "utf8");
    const applied = await applyLearnV2ScopeInferenceOutputs(root, [request.manifestPath], new Date("2026-06-30T00:03:32Z"));
    expect(applied.updatedConceptIds).toEqual([lockedCard.id]);
    expect(applied.rejected).toEqual([]);
    const store = await readLearnV2ConceptStore(root);
    const scoped = store.cards.find((item) => item.id === lockedCard.id)!;
    expect(scoped.conditions?.appliesWhen).toContain("Parser behavior changes need focused regression coverage.");
    expect(scoped.conditions?.doesNotApplyWhen).toContain("Docs-only edits stay outside parser coverage scope.");
    expect(scoped.scope.paths).toEqual(["packages/core/src/parser.ts"]);
    expect(scoped.scope.taskTypes).toEqual(["parser-change"]);
    expect(scoped.scope.negativeTriggers).toEqual(["docs-only"]);
    expect(scoped.scope.reviewLocked).toBe(true);
    expect(scoped.scope.reviewedAt).toBe("2026-06-30T00:03:30.000Z");
    expect(scoped.activation.phrases).toEqual(["parser regression coverage"]);
    expect(scoped.activation.pathGlobs).toEqual(["packages/core/src/parser.ts"]);
  });

  it("prepares executes and applies contradiction-reviewer counterevidence under deterministic ledger authority", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:03:25Z");
    const cards = mergeLearnV2ConceptCards([
      behaviorAtom("contradict_positive", "Prefer focused parser regression tests for parser changes.", "positive"),
      behaviorAtom("contradict_negative", "Avoid focused parser regression tests for parser changes.", "negative")
    ], now);
    await writeLearnV2ConceptStore(root, cards, now);
    await writeLearnV2EpisodeStore(root, reconstructLearnV2Episodes([
      normalizedMessage("ev_contradiction_episode", "Parser review showed focused regression guidance has conflicting evidence.", "reviewer")
    ]), now);

    const requests = await writeLearnV2ContradictionReviewRequests(root, [], now);
    expect(requests.requestCount).toBe(1);
    const request = requests.requests[0]!;
    const prompt = await readText(request.promptPath);
    const bundle = await readText(request.bundlePath);
    const parsedBundle = JSON.parse(bundle);
    const manifest = JSON.parse(await readText(request.manifestPath));
    expect(prompt).toContain("ContradictionReviewBundle");
    expect(prompt).toContain("Treat conflict.diagnostics as declassified deterministic ledger facts");
    expect(prompt).toContain("tokenOverlap");
    expect(prompt).not.toContain("raw_contradict");
    expect(bundle).not.toContain("raw_contradict");
    expect(parsedBundle.conflict.diagnostics).toMatchObject({
      scopeOverlap: true,
      sameKind: true,
      oppositePolarity: true
    });
    expect(parsedBundle.conflict.diagnostics.tokenOverlap).toBeGreaterThanOrEqual(3);
    expect(manifest.modelRole).toBe("contradiction-reviewer");
    expect(manifest.outputSchema).toBe("openskill-kit.learn-v2.llm-contradiction-review-output.v1");
    expect(manifest.opencodeAgentId).toBe("osk-learn-v2-contradiction-reviewer");
    expect(manifest.rawRefsIncluded).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain(root);

    const targetConceptId = request.conceptIds[0]!;
    const targetEvidenceId = cards.find((card) => card.id === targetConceptId)!.evidenceIds[0]!;
    const counterevidenceProposal = {
      schemaVersion: "openskill-kit.learn-v2.llm-contradiction-review-output.v1",
      reviewId: request.reviewId,
      findings: [{
        kind: "counterevidence",
        conceptIds: request.conceptIds,
        evidenceIds: [targetEvidenceId],
        rationale: "The opposing concept limits when the target concept should apply.",
        counterevidence: [{
          conceptId: targetConceptId,
          evidenceId: targetEvidenceId,
          reason: "Contradiction reviewer found bounded counterevidence for parser test guidance."
        }],
        requiresHumanReview: false
      }],
      rejected: []
    };

    const executed = await executeLearnV2ModelRequests(root, {
      requestManifests: [request.manifestPath],
      opencodeCommand: "opencode-test",
      runner: async (invocation) => {
        const config = JSON.parse(invocation.env.OPENCODE_CONFIG_CONTENT ?? "{}");
        expect(invocation.args).toContain("osk-learn-v2-contradiction-reviewer");
        expect(invocation.cwd).not.toBe(root);
        expect(invocation.args[invocation.args.indexOf("--dir") + 1]).toBe(invocation.cwd);
        expect(invocation.args).not.toContain(request.promptPath);
        expect(invocation.args).not.toContain(request.bundlePath);
        expect(path.basename(invocation.args[invocation.args.indexOf("--file") + 1])).toBe("contradiction-review-prompt.md");
        expect(path.basename(invocation.args[invocation.args.lastIndexOf("--file") + 1])).toBe("contradiction-review-bundle.json");
        expect(JSON.stringify(config)).toContain("osk-learn-v2-contradiction-reviewer");
        expect(config.agent["osk-learn-v2-contradiction-reviewer"].permission.bash).toBe("deny");
        expect(JSON.stringify(invocation.args)).not.toContain(root);
        expect(JSON.stringify(invocation.args)).not.toContain("raw_contradict");
        return {
          exitCode: 0,
          stdout: `diagnostic\n\`\`\`json\n${JSON.stringify(counterevidenceProposal)}\n\`\`\``,
          stderr: "contradiction diagnostic must be hashed only"
        };
      }
    });
    expect(executed.writtenCount).toBe(1);
    expect(executed.results[0]?.modelRole).toBe("contradiction-reviewer");
    expect(await readText(executed.executionReportPath)).not.toContain("contradiction diagnostic must be hashed only");

    const applied = await applyLearnV2ContradictionReviewOutputs(root, [request.manifestPath], new Date("2026-06-30T00:03:26Z"));
    expect(applied.appliedCounterevidence).toBe(1);
    expect(applied.appliedSupersessions).toBe(0);
    expect(applied.appliedNarrowings).toBe(0);
    expect(applied.rejected).toEqual([]);
    expect(await readText(applied.reviewQueuePath)).toContain("Contradiction reviewer found bounded counterevidence");
    const updatedStore = await readLearnV2ConceptStore(root);
    expect(updatedStore.cards.find((card) => card.id === targetConceptId)?.counterevidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceId: targetEvidenceId, reason: "Contradiction reviewer found bounded counterevidence for parser test guidance." })
    ]));

    await writeFile(request.expectedOutputPath, JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-contradiction-review-output.v1",
      reviewId: request.reviewId,
      findings: [{
        kind: "scope-narrowing",
        conceptIds: request.conceptIds,
        evidenceIds: [targetEvidenceId],
        rationale: "Unsafe model tried to broaden a parser file concept to all packages.",
        narrowScopes: [{
          conceptId: targetConceptId,
          paths: ["packages"],
          taskTypes: ["parser-change"]
        }],
        requiresHumanReview: false
      }],
      rejected: []
    }), "utf8");
    const unsafeNarrow = await applyLearnV2ContradictionReviewOutputs(root, [request.manifestPath], new Date("2026-06-30T00:03:27Z"));
    expect(unsafeNarrow.appliedNarrowings).toBe(0);
    expect(unsafeNarrow.rejected[0]?.reason).toBe("invalid-narrow-scope");

    await writeFile(request.expectedOutputPath, JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.llm-contradiction-review-output.v1",
      reviewId: request.reviewId,
      findings: [{
        kind: "supersession",
        conceptIds: request.conceptIds,
        evidenceIds: [targetEvidenceId],
        rationale: "Unsafe model tried to supersede a manual direct conflict.",
        supersession: {
          supersededId: request.conceptIds[0],
          supersededById: request.conceptIds[1],
          reason: "Direct opposite conflict still needs human review."
        },
        requiresHumanReview: false
      }],
      rejected: []
    }), "utf8");
    const unsafeSupersession = await applyLearnV2ContradictionReviewOutputs(root, [request.manifestPath], new Date("2026-06-30T00:03:28Z"));
    expect(unsafeSupersession.appliedSupersessions).toBe(0);
    expect(unsafeSupersession.rejected[0]?.reason).toBe("unsafe-supersession");
  });

  it("prepares executes and applies eval-planner outputs as review-required golden proposals", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:03:29Z");
    const [baseCard] = mergeLearnV2ConceptCards([
      behaviorAtom("eval_parser", "Prefer focused parser regression tests for parser changes.", "positive")
    ], now);
    const card = { ...baseCard!, status: "active" as const, risk: "medium" as const };
    await writeLearnV2ConceptStore(root, [card], now);
    await writeLearnV2EpisodeStore(root, reconstructLearnV2Episodes([
      { ...normalizedMessage("ev_eval_parser", "User corrected parser work: prefer focused parser regression tests before broad rewrites."), paths: ["packages/core/src/parser.ts"] }
    ]), now);

    const prepared = await writeLearnV2EvalPlannerRequests(root, [card.id], now);
    expect(prepared.schemaVersion).toBe("openskill-kit.learn-v2.eval-planner-request-result.v1");
    expect(prepared.requestCount).toBe(1);
    const request = prepared.requests[0]!;
    const manifest = JSON.parse(await readText(request.manifestPath));
    expect(manifest.modelRole).toBe("eval-planner");
    expect(manifest.outputSchema).toBe("openskill-kit.learn-v2.llm-eval-plan-output.v1");
    expect(manifest.opencodeAgentId).toBe("osk-learn-v2-eval-planner");
    expect(manifest.rawRefsIncluded).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain(root);
    expect(await readText(request.promptPath)).toContain("Learn v2 eval planner");

    const evalProposal = {
      schemaVersion: "openskill-kit.learn-v2.llm-eval-plan-output.v1",
      extractionScenarios: [{
        schemaVersion: "openskill-kit.learn-v2.extraction-golden.v1",
        id: "golden_parser_regression_tests",
        title: "Parser regression preference extraction",
        episodeIdIncludes: "episode_",
        expectedConceptText: ["focused parser regression"],
        expectedKinds: ["verification"],
        expectedTaskHints: ["parser"],
        expectedPathText: ["packages/core/src/parser.ts"],
        forbiddenText: ["broad rewrite only"]
      }],
      behaviorDeltaScenarios: [{
        schemaVersion: "openskill-kit.learn-v2.behavior-delta-golden.v1",
        id: "delta_parser_regression_tests",
        title: "Parser task activates regression guidance",
        task: {
          prompt: "Change parser behavior in packages/core/src/parser.ts",
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
    };

    const executed = await executeLearnV2ModelRequests(root, {
      requestManifests: [request.manifestPath],
      opencodeCommand: "opencode-test",
      runner: async (invocation) => {
        const config = JSON.parse(invocation.env.OPENCODE_CONFIG_CONTENT ?? "{}");
        expect(invocation.args).toContain("osk-learn-v2-eval-planner");
        expect(invocation.cwd).not.toBe(root);
        expect(invocation.args[invocation.args.indexOf("--dir") + 1]).toBe(invocation.cwd);
        expect(path.basename(invocation.args[invocation.args.indexOf("--file") + 1])).toBe("eval-planner-prompt.md");
        expect(path.basename(invocation.args[invocation.args.lastIndexOf("--file") + 1])).toBe("eval-planner-bundle.json");
        expect(config.agent["osk-learn-v2-eval-planner"].permission.bash).toBe("deny");
        expect(JSON.stringify(invocation.args)).not.toContain(root);
        return { exitCode: 0, stdout: JSON.stringify(evalProposal), stderr: "eval planner diagnostic must be hashed only" };
      }
    });
    expect(executed.writtenCount).toBe(1);
    expect(executed.results[0]?.modelRole).toBe("eval-planner");
    expect(await readText(executed.executionReportPath)).not.toContain("eval planner diagnostic must be hashed only");

    const applied = await applyLearnV2EvalPlannerOutputs(root, [request.manifestPath], new Date("2026-06-30T00:03:30Z"));
    expect(applied.rejected).toEqual([]);
    expect(applied.extractionScenarioCount).toBe(1);
    expect(applied.behaviorDeltaScenarioCount).toBe(1);
    expect(applied.proposalPath).toContain(".openskill-kit");
    const proposal = JSON.parse(await readText(applied.proposalPath!));
    expect(proposal.schemaVersion).toBe("openskill-kit.learn-v2.eval-golden-proposal.v1");
    expect(proposal.reviewRequired).toBe(true);
    expect(proposal.scenarios[0].id).toBe("golden_parser_regression_tests");
    expect(proposal.behaviorDeltaScenarios[0].id).toBe("delta_parser_regression_tests");
    expect(await readText(path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json"))).toContain(card.id);

    const badDir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", "eval_bad_manifest");
    await mkdir(badDir, { recursive: true });
    const badManifestPath = path.join(badDir, "request-manifest.json");
    await writeFile(badManifestPath, "{not-json", "utf8");
    const rejected = await applyLearnV2EvalPlannerOutputs(root, [badManifestPath], new Date("2026-06-30T00:03:31Z"));
    expect(rejected.proposalPath).toBeUndefined();
    expect(rejected.rejected[0]?.reason).toBe("invalid-request-manifest");
  });

  it("prepares executes and applies behavior-evaluator outputs for agent-backed behavior proof", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:03:32Z");
    const [baseCard] = mergeLearnV2ConceptCards([
      behaviorAtom("behavior_eval_parser", "Prefer focused parser regression tests before broad parser rewrites.", "positive")
    ], now);
    const card = {
      ...baseCard!,
      status: "active" as const,
      risk: "medium" as const,
      scope: { ...baseCard!.scope, paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] },
      activation: { ...baseCard!.activation, pathGlobs: ["packages/core/src/**"], commands: ["npm test -- parser"] },
      conditions: { appliesWhen: ["parser behavior changes"], doesNotApplyWhen: ["docs-only"] }
    };
    await writeLearnV2ConceptStore(root, [card], now);

    const goldensPath = path.join(root, "behavior-eval-goldens.json");
    await writeFile(goldensPath, JSON.stringify({
      behaviorDeltaScenarios: [{
        schemaVersion: "openskill-kit.learn-v2.behavior-delta-golden.v1",
        id: "delta_agent_parser_regression",
        title: "Agent parser behavior eval",
        task: {
          prompt: "Change parser behavior without broad rewrite",
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
      }]
    }), "utf8");

    const prepared = await writeLearnV2BehaviorEvalRequests(root, goldensPath, now);
    expect(prepared.schemaVersion).toBe("openskill-kit.learn-v2.behavior-eval-request-result.v1");
    expect(prepared.requestCount).toBe(1);
    const request = prepared.requests[0]!;
    const manifest = JSON.parse(await readText(path.resolve(root, request.manifestPath)));
    expect(manifest.modelRole).toBe("behavior-evaluator");
    expect(manifest.outputSchema).toBe("openskill-kit.learn-v2.llm-behavior-eval-output.v1");
    expect(manifest.opencodeAgentId).toBe("osk-learn-v2-behavior-evaluator");
    expect(manifest.executionBoundary).toBe("opencode-host-sanitized-only");
    expect(manifest.rawRefsIncluded).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain(root);
    expect(await readText(path.resolve(root, request.promptPath))).toContain("Learn v2 behavior evaluator");
    expect(await readText(path.resolve(root, request.bundlePath))).not.toContain(root);

    const behaviorOutput = {
      schemaVersion: "openskill-kit.learn-v2.llm-behavior-eval-output.v1",
      evalId: request.evalId,
      results: [{
        scenarioId: "delta_agent_parser_regression",
        status: "pass",
        behaviorImproved: true,
        baselineOutcome: "Baseline plan changes parser and runs broad verification.",
        withConceptOutcome: "Learned plan adds focused parser regression test before broad suite.",
        regressions: [],
        tokenOverheadAssessment: "acceptable",
        rationale: "With learned concept, plan includes focused parser regression without forbidden broad rewrite only behavior."
      }],
      rejected: []
    };
    const executed = await executeLearnV2ModelRequests(root, {
      requestManifests: [request.manifestPath],
      opencodeCommand: "opencode-test",
      runner: async (invocation) => {
        expect(invocation.args).toContain("osk-learn-v2-behavior-evaluator");
        expect(path.basename(invocation.args[invocation.args.indexOf("--file") + 1])).toBe("behavior-eval-prompt.md");
        expect(path.basename(invocation.args[invocation.args.lastIndexOf("--file") + 1])).toBe("behavior-eval-bundle.json");
        expect(JSON.stringify(invocation.args)).not.toContain(root);
        return { exitCode: 0, stdout: JSON.stringify(behaviorOutput), stderr: "behavior eval stderr must be hash-only" };
      }
    });
    expect(executed.writtenCount).toBe(1);
    expect(executed.results[0]?.modelRole).toBe("behavior-evaluator");
    expect(await readText(executed.executionReportPath)).not.toContain("behavior eval stderr must be hash-only");

    const applied = await applyLearnV2BehaviorEvalOutputs(root, [request.manifestPath], new Date("2026-06-30T00:03:33Z"));
    expect(applied.rejected).toEqual([]);
    expect(applied.status).toBe("pass");
    expect(applied.resultCount).toBe(1);
    expect(applied.artifactPath).toContain(".openskill-kit");
    const artifact = JSON.parse(await readText(applied.artifactPath!));
    expect(artifact.agentExecuted).toBe(true);
    expect(JSON.stringify(artifact)).not.toContain(root);
    const evalReport = await runLearnV2Eval(root, [], [card], new Date("2026-06-30T00:03:33Z"), {
      goldensPath,
      behaviorAgentEvalPath: applied.artifactPath
    });
    expect(evalReport.summary.behaviorDelta.agentStatus).toBe("pass");
    expect(evalReport.summary.behaviorDelta.agentResultCount).toBe(1);
    expect(evalReport.proofBoundary.agentExecuted).toBe(true);
    expect(evalReport.proofBoundary.proves).toContain("agent-backed behavior-delta judgment");
    expect(evalReport.results.some((result) => result.id === "behavior-agent-eval" && result.status === "pass")).toBe(true);

    await writeFile(path.resolve(root, request.expectedOutputPath), JSON.stringify({
      ...behaviorOutput,
      results: [{ ...behaviorOutput.results[0], scenarioId: "unknown_delta" }]
    }), "utf8");
    const rejected = await applyLearnV2BehaviorEvalOutputs(root, [request.manifestPath], new Date("2026-06-30T00:03:34Z"));
    expect(rejected.resultCount).toBe(0);
    expect(rejected.rejected[0]?.reason).toBe("invalid-behavior-eval-output");
  });

  it("rejects unsafe or malformed OpenCode execution outputs before writing response files", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:03:30Z");
    const [episode] = reconstructLearnV2Episodes([
      normalizedMessage("ev_exec_invalid", "Prefer focused parser regression fixtures for parser changes.", "user")
    ]);
    await writeLearnV2EpisodeStore(root, [episode!], now);
    const requests = await writeLearnV2ModelRequests(root, undefined, now);
    const request = requests.requests[0]!;

    const invalid = await executeLearnV2ModelRequests(root, {
      requestManifests: [request.manifestPath],
      runner: async () => ({
        exitCode: 0,
        stdout: "Here is JSON:\n```json\n{}\n```",
        stderr: ""
      })
    });
    expect(invalid.writtenCount).toBe(0);
    expect(invalid.failedCount).toBe(1);
    expect(invalid.results[0]?.reason).toBe("invalid-json-or-schema");
    await expect(stat(request.expectedOutputPath)).rejects.toThrow();

    const ungrounded = await executeLearnV2ModelRequests(root, {
      requestManifests: [request.manifestPath],
      runner: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          schemaVersion: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
          atoms: [{
            statement: "Prefer unsupported parser behavior from missing evidence.",
            kind: "verification",
            polarity: "positive",
            evidenceIds: ["ev_missing_from_episode"],
            confidence: 0.8
          }],
          rejected: []
        }),
        stderr: ""
      })
    });
    expect(ungrounded.writtenCount).toBe(0);
    expect(ungrounded.failedCount).toBe(1);
    expect(ungrounded.results[0]?.reason).toBe("model-output-evidence-validation-failed");
    expect(ungrounded.results[0]?.detail).toContain("missing-or-invalid-evidence-id");
    await expect(stat(request.expectedOutputPath)).rejects.toThrow();

    const unsafeOutput = await executeLearnV2ModelRequests(root, {
      requestManifests: [request.manifestPath],
      runner: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          schemaVersion: "openskill-kit.learn-v2.llm-concept-extraction-output.v1",
          atoms: [{
            statement: "Prefer parser fixtures after opening [PROJECT_ROOT]/secret and /home/user/.ssh/id_rsa.",
            kind: "verification",
            polarity: "positive",
            evidenceIds: [episode!.evidenceIds[0]],
            confidence: 0.72,
            rationale: "Unsafe reviewer@example.com and raw_abc12345 markers must not be persisted."
          }],
          rejected: []
        }),
        stderr: ""
      })
    });
    expect(unsafeOutput.writtenCount).toBe(0);
    expect(unsafeOutput.failedCount).toBe(1);
    expect(unsafeOutput.results[0]?.reason).toBe("model-output-evidence-validation-failed");
    expect(unsafeOutput.results[0]?.detail).toContain("unsafe-output-content");
    await expect(stat(request.expectedOutputPath)).rejects.toThrow();

    const unsafeDir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", "unsafe-boundary");
    await mkdir(unsafeDir, { recursive: true });
    await writeFile(path.join(unsafeDir, "concept-extraction-prompt.md"), await readText(request.promptPath), "utf8");
    await writeFile(path.join(unsafeDir, "episode-learning-bundle.json"), await readText(request.bundlePath), "utf8");
    await writeFile(path.join(unsafeDir, "request-manifest.json"), JSON.stringify({
      ...JSON.parse(await readText(request.manifestPath)),
      promptPath: path.join(unsafeDir, "concept-extraction-prompt.md"),
      bundlePath: path.join(unsafeDir, "episode-learning-bundle.json"),
      expectedOutputPath: path.join(unsafeDir, "response.json"),
      executionBoundary: "opencode-host-raw-allowed",
      rawRefsIncluded: true
    }), "utf8");
    const unsafe = await executeLearnV2ModelRequests(root, {
      requestManifests: [path.join(unsafeDir, "request-manifest.json")],
      runner: async () => {
        throw new Error("runner should not be called for unsafe requests");
      }
    });
    expect(unsafe.writtenCount).toBe(0);
    expect(unsafe.failedCount).toBe(1);
    expect(unsafe.results[0]?.reason).toBe("invalid-request-manifest");
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
      "behavior-evaluator",
      "publish-export-auditor"
    ]);
    const routeJson = await readText(path.join(root, artifact.artifacts.routingJson));
    expect(routeJson).toContain("deterministicFallback");
    expect(routeJson).toContain("behavior pack publish audit scanners");
    expect(routeJson).toContain("Compare baseline and learned-behavior eval plans");
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

  it("preserves reviewer-narrowed concept scope while accumulating future support", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:00:00Z");
    const [base] = mergeLearnV2ConceptCards([
      behaviorAtom("scope_lock_parser_a", "Prefer focused parser tests for parser changes.", "positive")
    ], now);
    await writeLearnV2ConceptStore(root, [base!], now);

    const reviewed = await applyLearnV2ConceptReview(root, {
      accept: [base!.id],
      edits: [{
        id: base!.id,
        canonicalBehavior: "Prefer focused parser regression coverage before changing parser behavior.",
        activationPhrases: ["parser regression coverage"]
      }],
      narrowScopes: [{
        id: base!.id,
        paths: ["packages/core/src/parser.ts"],
        taskTypes: ["parser-change"],
        negativeTriggers: ["unrelated-docs-change"]
      }],
      now: new Date("2026-06-30T00:01:00Z")
    });
    const reviewedConcept = reviewed.store.cards.find((card) => card.id === base!.id)!;
    expect(reviewedConcept.scope.reviewLocked).toBe(true);
    expect(reviewedConcept.scope.reviewedAt).toBe("2026-06-30T00:01:00.000Z");

    const incomingAtom = {
      ...behaviorAtom("scope_lock_parser_b", "Prefer focused parser tests for parser changes.", "positive"),
      scope: {
        level: "path" as const,
        paths: ["packages/core/src/parser.ts", "docs/parser-guide.md"],
        taskTypes: ["parser-change", "docs-change"]
      },
      evidenceIds: ["ev_scope_lock_parser_b"],
      rawRefs: ["raw_scope_lock_parser_b"]
    };
    const [incoming] = mergeLearnV2ConceptCards([incomingAtom], new Date("2026-06-30T00:02:00Z"));
    await writeLearnV2ConceptStore(root, [incoming!], new Date("2026-06-30T00:02:00Z"));
    const store = await readLearnV2ConceptStore(root);
    const merged = store.cards.find((card) => card.id === base!.id)!;

    expect(merged.status).toBe("active");
    expect(merged.canonicalBehavior).toBe("Prefer focused parser regression coverage before changing parser behavior.");
    expect(merged.evidenceIds).toEqual(expect.arrayContaining(["ev_scope_lock_parser_a", "ev_scope_lock_parser_b"]));
    expect(merged.rawRefs).toEqual(expect.arrayContaining(["raw_scope_lock_parser_a", "raw_scope_lock_parser_b"]));
    expect(merged.atoms.map((atom) => atom.id)).toEqual(expect.arrayContaining(["scope_lock_parser_a", "scope_lock_parser_b"]));
    expect(merged.scope.paths).toEqual(["packages/core/src/parser.ts"]);
    expect(merged.scope.taskTypes).toEqual(["parser-change"]);
    expect(merged.scope.negativeTriggers).toEqual(["unrelated-docs-change"]);
    expect(merged.scope.reviewLocked).toBe(true);
    expect(merged.activation.phrases).toEqual(["parser regression coverage"]);
    expect(merged.activation.phrases).not.toContain("docs change");
    expect(merged.scope.paths).not.toContain("docs/parser-guide.md");
    expect(merged.scope.taskTypes).not.toContain("docs-change");
  });

  it("removes stale Learn v2 compatibility graph nodes after concepts are rejected", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:00:00Z");
    const [concept] = mergeLearnV2ConceptCards([
      behaviorAtom("graph_cleanup_parser_tests", "Prefer focused parser tests for parser changes.", "positive")
    ], now);
    await writeLearnV2ConceptStore(root, [concept!], now);

    const activated = await applyLearnV2ConceptReview(root, {
      accept: [concept!.id],
      narrowScopes: [{ id: concept!.id, paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] }],
      now: new Date("2026-06-30T00:01:00Z")
    });
    const config = await readProjectConfig(root);
    expect(activated.graphReconciliationPath).toContain("graph-reconciliation.json");
    expect(activated.prunedPreferenceNodeIds).toEqual([]);
    expect(activated.prunedWorkflowNodeIds).toEqual([]);
    expect((await readPreferenceGraph(root)).nodes.some((node) => node.id === `pref_${concept!.id}`)).toBe(true);
    expect((await readWorkflowGraph(root, config.projectId, new Date("2026-06-30T00:01:00Z"))).nodes.some((node) => node.id === `workflow_${concept!.id}`)).toBe(true);

    const rejected = await applyLearnV2ConceptReview(root, {
      reject: [concept!.id],
      now: new Date("2026-06-30T00:02:00Z")
    });

    expect((await readPreferenceGraph(root)).nodes.some((node) => node.id === `pref_${concept!.id}`)).toBe(false);
    expect((await readWorkflowGraph(root, config.projectId, new Date("2026-06-30T00:02:00Z"))).nodes.some((node) => node.id === `workflow_${concept!.id}`)).toBe(false);
    expect(rejected.prunedPreferenceNodeIds).toEqual([`pref_${concept!.id}`]);
    expect(rejected.prunedWorkflowNodeIds).toEqual([`workflow_${concept!.id}`]);
    const reconciliation = JSON.parse(await readText(rejected.graphReconciliationPath!));
    expect(reconciliation.schemaVersion).toBe("openskill-kit.learn-v2.graph-reconciliation.v1");
    expect(reconciliation.activeConceptIds).toEqual([]);
    expect(reconciliation.prunedPreferenceNodeIds).toEqual([`pref_${concept!.id}`]);
    expect(reconciliation.prunedWorkflowNodeIds).toEqual([`workflow_${concept!.id}`]);
  });

  it("auto-demotes repeatedly harmful active concepts and prunes their generated graph nodes", async () => {
    const root = await tempProject();
    const createdAt = new Date("2026-06-30T00:00:00Z");
    const [activeConcept] = mergeLearnV2ConceptCards([
      behaviorAtom("outcome_demote_parser_tests", "Prefer parser regression fixtures before parser behavior changes.", "positive")
    ], createdAt);
    const lockedAtom = {
      ...behaviorAtom("outcome_demote_locked_lexer_tests", "Prefer lexer smoke fixtures before lexer behavior changes.", "positive"),
      scope: {
        level: "path" as const,
        paths: ["packages/core/src/lexer.ts"],
        taskTypes: ["lexer-change"]
      }
    };
    const [lockedConcept] = mergeLearnV2ConceptCards([lockedAtom], createdAt);
    await writeLearnV2ConceptStore(root, [activeConcept!, lockedConcept!], createdAt);

    await applyLearnV2ConceptReview(root, {
      accept: [activeConcept!.id],
      lock: [lockedConcept!.id],
      now: new Date("2026-06-30T00:01:00Z")
    });
    const config = await readProjectConfig(root);
    expect((await readPreferenceGraph(root)).nodes.some((node) => node.id === `pref_${activeConcept!.id}`)).toBe(true);
    expect((await readPreferenceGraph(root)).nodes.some((node) => node.id === `pref_${lockedConcept!.id}`)).toBe(true);
    expect((await readWorkflowGraph(root, config.projectId, new Date("2026-06-30T00:01:00Z"))).nodes.some((node) => node.id === `workflow_${activeConcept!.id}`)).toBe(true);

    await recordLearnV2ConceptOutcome(root, {
      conceptId: activeConcept!.id,
      outcome: "harmful",
      reason: "activated during unrelated parser task"
    }, new Date("2026-06-30T00:02:00Z"));
    await recordLearnV2ConceptOutcome(root, {
      conceptId: activeConcept!.id,
      outcome: "wrong",
      reason: "reviewer rejected activation"
    }, new Date("2026-06-30T00:03:00Z"));
    await recordLearnV2ConceptOutcome(root, {
      conceptId: lockedConcept!.id,
      outcome: "harmful",
      reason: "locked concept needs human review"
    }, new Date("2026-06-30T00:02:00Z"));
    await recordLearnV2ConceptOutcome(root, {
      conceptId: lockedConcept!.id,
      outcome: "wrong",
      reason: "locked concept remains locked"
    }, new Date("2026-06-30T00:03:00Z"));

    const reviewed = await applyLearnV2ConceptReview(root, {
      autoPolicy: true,
      now: new Date("2026-06-30T00:04:00Z")
    });
    const store = await readLearnV2ConceptStore(root);
    const demoted = store.cards.find((card) => card.id === activeConcept!.id)!;
    const locked = store.cards.find((card) => card.id === lockedConcept!.id)!;

    expect(demoted.status).toBe("conflict");
    expect(demoted.counterevidence.some((item) => item.reason.includes("Auto-demoted active concept"))).toBe(true);
    expect(locked.status).toBe("locked");
    expect(reviewed.messages.join("\n")).toContain(`Auto-demoted active concept ${activeConcept!.id}`);
    expect(reviewed.prunedPreferenceNodeIds).toEqual([`pref_${activeConcept!.id}`]);
    expect(reviewed.prunedWorkflowNodeIds).toEqual([`workflow_${activeConcept!.id}`]);
    expect((await readPreferenceGraph(root)).nodes.some((node) => node.id === `pref_${activeConcept!.id}`)).toBe(false);
    expect((await readPreferenceGraph(root)).nodes.some((node) => node.id === `pref_${lockedConcept!.id}`)).toBe(true);
    const workflowGraph = await readWorkflowGraph(root, config.projectId, new Date("2026-06-30T00:04:00Z"));
    expect(workflowGraph.nodes.some((node) => node.id === `workflow_${activeConcept!.id}`)).toBe(false);
    expect(workflowGraph.nodes.some((node) => node.id === `workflow_${lockedConcept!.id}`)).toBe(true);
  });

  it("respects configured harmful outcome demotion thresholds", async () => {
    const root = await tempProject();
    const createdAt = new Date("2026-06-30T00:00:00Z");
    const [concept] = mergeLearnV2ConceptCards([
      behaviorAtom("outcome_demote_threshold_parser_tests", "Prefer parser smoke fixtures before parser behavior changes.", "positive")
    ], createdAt);
    await writeLearnV2ConceptStore(root, [concept!], createdAt);
    await applyLearnV2ConceptReview(root, {
      accept: [concept!.id],
      now: new Date("2026-06-30T00:01:00Z")
    });
    const config = await readProjectConfig(root);
    config.learning.outcomePolicy = {
      demoteAfterNegativeOutcomes: 3,
      recentNegativeOutcomeDays: 7
    };
    await writeFile(path.join(root, ".openskill-kit", "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

    await recordLearnV2ConceptOutcome(root, {
      conceptId: concept!.id,
      outcome: "harmful"
    }, new Date("2026-06-30T00:02:00Z"));
    await recordLearnV2ConceptOutcome(root, {
      conceptId: concept!.id,
      outcome: "wrong"
    }, new Date("2026-06-30T00:03:00Z"));

    const afterTwo = await applyLearnV2ConceptReview(root, {
      autoPolicy: true,
      now: new Date("2026-06-30T00:04:00Z")
    });
    let store = await readLearnV2ConceptStore(root);
    expect(store.cards.find((card) => card.id === concept!.id)?.status).toBe("active");
    expect(afterTwo.messages.join("\n")).not.toContain("Auto-demoted active concept");
    expect((await readPreferenceGraph(root)).nodes.some((node) => node.id === `pref_${concept!.id}`)).toBe(true);

    await recordLearnV2ConceptOutcome(root, {
      conceptId: concept!.id,
      outcome: "superseded"
    }, new Date("2026-06-30T00:05:00Z"));
    const afterThree = await applyLearnV2ConceptReview(root, {
      autoPolicy: true,
      now: new Date("2026-06-30T00:06:00Z")
    });
    store = await readLearnV2ConceptStore(root);
    const demoted = store.cards.find((card) => card.id === concept!.id)!;

    expect(demoted.status).toBe("conflict");
    expect(demoted.counterevidence.some((item) => item.reason.includes("policy threshold 3 within 7 day"))).toBe(true);
    expect(afterThree.messages.join("\n")).toContain("policy threshold 3 within 7 day");
    expect(afterThree.prunedPreferenceNodeIds).toEqual([`pref_${concept!.id}`]);
  });

  it("prunes stale Learn v2 graph nodes even when active concept compilation is skipped", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:00:00Z");
    const [parserConcept, lexerConcept] = mergeLearnV2ConceptCards([
      behaviorAtom("graph_skip_compile_parser_tests", "Prefer focused parser tests for parser changes.", "positive"),
      {
        ...behaviorAtom("graph_skip_compile_lexer_tests", "Prefer focused lexer tests for lexer changes.", "positive"),
        scope: {
          level: "path",
          paths: ["packages/core/src/lexer.ts"],
          taskTypes: ["lexer-change"]
        }
      }
    ], now);
    await writeLearnV2ConceptStore(root, [parserConcept!, lexerConcept!], now);

    await applyLearnV2ConceptReview(root, {
      accept: [parserConcept!.id, lexerConcept!.id],
      narrowScopes: [
        { id: parserConcept!.id, paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] },
        { id: lexerConcept!.id, paths: ["packages/core/src/lexer.ts"], taskTypes: ["lexer-change"] }
      ],
      now: new Date("2026-06-30T00:01:00Z")
    });
    const config = await readProjectConfig(root);
    expect((await readPreferenceGraph(root)).nodes.some((node) => node.id === `pref_${parserConcept!.id}`)).toBe(true);
    expect((await readPreferenceGraph(root)).nodes.some((node) => node.id === `pref_${lexerConcept!.id}`)).toBe(true);
    expect((await readWorkflowGraph(root, config.projectId, new Date("2026-06-30T00:01:00Z"))).nodes.some((node) => node.id === `workflow_${parserConcept!.id}`)).toBe(true);
    expect((await readWorkflowGraph(root, config.projectId, new Date("2026-06-30T00:01:00Z"))).nodes.some((node) => node.id === `workflow_${lexerConcept!.id}`)).toBe(true);

    const rejected = await applyLearnV2ConceptReview(root, {
      reject: [parserConcept!.id],
      compileActive: false,
      now: new Date("2026-06-30T00:02:00Z")
    });
    const preferenceGraph = await readPreferenceGraph(root);
    const workflowGraph = await readWorkflowGraph(root, config.projectId, new Date("2026-06-30T00:02:00Z"));

    expect(preferenceGraph.nodes.some((node) => node.id === `pref_${parserConcept!.id}`)).toBe(false);
    expect(workflowGraph.nodes.some((node) => node.id === `workflow_${parserConcept!.id}`)).toBe(false);
    expect(preferenceGraph.nodes.some((node) => node.id === `pref_${lexerConcept!.id}`)).toBe(true);
    expect(workflowGraph.nodes.some((node) => node.id === `workflow_${lexerConcept!.id}`)).toBe(true);
    expect(rejected.prunedPreferenceNodeIds).toEqual([`pref_${parserConcept!.id}`]);
    expect(rejected.prunedWorkflowNodeIds).toEqual([`workflow_${parserConcept!.id}`]);
    expect(rejected.messages.join("\n")).toContain("Active concept graph sync skipped by option");
    const reconciliation = JSON.parse(await readText(rejected.graphReconciliationPath!));
    expect(reconciliation.activeConceptIds).toEqual([lexerConcept!.id]);
    expect(reconciliation.incomingPreferenceNodeIds).toEqual([`pref_${lexerConcept!.id}`]);
    expect(reconciliation.incomingWorkflowNodeIds).toEqual([`workflow_${lexerConcept!.id}`]);
    expect(reconciliation.prunedPreferenceNodeIds).toEqual([`pref_${parserConcept!.id}`]);
    expect(reconciliation.prunedWorkflowNodeIds).toEqual([`workflow_${parserConcept!.id}`]);
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
    expect(mergedReview.messages.join("\n")).toContain("Merge semantic validation reconciled");
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
    expect(finalChild.counterevidence.some((item) => item.reason === "Folded back after reviewer decision.")).toBe(true);
    expect(finalChild.scoring?.penalties.join(",")).toContain("counterevidence:");
    expect(supersedeReview.messages.join("\n")).toContain("Supersede semantic validation accepted");
    expect(supersedeReview.messages.join("\n")).toContain("superseded by");
  });

  it("rejects unsafe concept merges that collapse unrelated behaviors", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:00:00Z");
    const [parserConcept] = mergeLearnV2ConceptCards([
      behaviorAtom("unsafe_merge_parser_tests", "Prefer focused parser tests for parser changes.", "positive")
    ], now);
    const [docsConcept] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("unsafe_merge_docs", "Prefer concise documentation updates for docs changes.", "positive"),
      scope: {
        level: "path",
        paths: ["docs/guide.md"],
        taskTypes: ["docs-change"]
      }
    }], now);
    await writeLearnV2ConceptStore(root, [parserConcept!, docsConcept!], now);

    await expect(applyLearnV2ConceptReview(root, {
      mergeConcepts: [{
        targetId: parserConcept!.id,
        sourceIds: [docsConcept!.id],
        canonicalBehavior: "Prefer focused parser tests and concise docs updates."
      }],
      compileActive: false,
      now: new Date("2026-06-30T00:01:00Z")
    })).rejects.toThrow("Unsafe learn-v2 concept merge");

    const store = await readLearnV2ConceptStore(root);
    expect(store.cards.find((card) => card.id === parserConcept!.id)?.lifecycle.supersedes).not.toContain(docsConcept!.id);
    expect(store.cards.find((card) => card.id === docsConcept!.id)?.status).toBe("candidate");
  });

  it("rejects unsafe concept supersede operations that retire unrelated concepts", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:00:00Z");
    const [parserConcept] = mergeLearnV2ConceptCards([
      behaviorAtom("unsafe_supersede_parser_tests", "Prefer focused parser tests for parser changes.", "positive")
    ], now);
    const [docsConcept] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("unsafe_supersede_docs", "Prefer concise documentation updates for docs changes.", "positive"),
      scope: {
        level: "path",
        paths: ["docs/guide.md"],
        taskTypes: ["docs-change"]
      }
    }], now);
    await writeLearnV2ConceptStore(root, [parserConcept!, docsConcept!], now);

    await expect(applyLearnV2ConceptReview(root, {
      supersedeConcepts: [{
        supersededId: parserConcept!.id,
        supersededById: docsConcept!.id,
        reason: "Reviewer selected the wrong successor id."
      }],
      compileActive: false,
      now: new Date("2026-06-30T00:01:00Z")
    })).rejects.toThrow("Unsafe learn-v2 concept supersede");

    const store = await readLearnV2ConceptStore(root);
    const retainedParser = store.cards.find((card) => card.id === parserConcept!.id)!;
    const retainedDocs = store.cards.find((card) => card.id === docsConcept!.id)!;
    expect(retainedParser.status).toBe("candidate");
    expect(retainedParser.lifecycle.supersededBy).toBeUndefined();
    expect(retainedDocs.lifecycle.supersedes).not.toContain(parserConcept!.id);
  });

  it("keeps split counterevidence attached to the atoms it still describes", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:00:00Z");
    const [concept] = mergeLearnV2ConceptCards([
      behaviorAtom("split_counter_parser_a", "Prefer parser regression fixtures before parser changes.", "positive"),
      behaviorAtom("split_counter_parser_b", "Prefer parser regression fixtures before parser changes.", "positive")
    ], now);
    const source = {
      ...concept!,
      counterevidence: [
        { evidenceId: "ev_split_counter_parser_a", reason: "Selected atom objection." },
        { evidenceId: "ev_split_counter_parser_b", reason: "Remaining atom objection." },
        { evidenceId: "external_review_note", reason: "Whole concept objection without atom evidence id." }
      ]
    };
    await writeLearnV2ConceptStore(root, [source], now);

    const reviewed = await applyLearnV2ConceptReview(root, {
      splitConcepts: [{
        sourceId: source.id,
        atomIds: ["split_counter_parser_a"],
        canonicalBehavior: "Prefer parser regression fixtures before parser changes."
      }],
      compileActive: false,
      now: new Date("2026-06-30T00:01:00Z")
    });
    const child = reviewed.store.cards.find((card) => card.id !== source.id)!;
    const parent = reviewed.store.cards.find((card) => card.id === source.id)!;

    expect(child.atoms.map((atom) => atom.id)).toEqual(["split_counter_parser_a"]);
    expect(child.counterevidence.map((item) => item.evidenceId)).toEqual(["ev_split_counter_parser_a"]);
    expect(parent.atoms.map((atom) => atom.id)).toEqual(["split_counter_parser_b"]);
    expect(parent.counterevidence.map((item) => item.evidenceId)).toEqual(["ev_split_counter_parser_b", "external_review_note"]);
    expect(child.scoring?.penalties.join(",")).toContain("counterevidence:");
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
      }, {
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
    expect(rescored.counterevidence).toHaveLength(1);
    expect(rescored.scoring?.penalties.join(",")).toContain("counterevidence:");
    expect(rescored.confidence).toBeLessThan(stored.confidence);

    const repeated = await applyLearnV2ConceptReview(root, {
      addCounterevidence: [{
        id: stored.id,
        evidenceId: stored.evidenceIds[0]!,
        reason: "Reviewer marked this concept too broad for automatic use."
      }],
      compileActive: false,
      now: new Date("2026-06-30T00:03:00Z")
    });
    const repeatedCard = repeated.store.cards.find((card) => card.id === stored.id)!;
    expect(repeatedCard.counterevidence).toHaveLength(1);
    expect(repeatedCard.scoring?.counterevidenceCount).toBe(1);
    expect(repeatedCard.confidence).toBe(rescored.confidence);
  });

  it("marks accepted concept scores as human-review calibrated", async () => {
    const root = await tempProject();
    const record = previewRecord(root, "raw_human_review_scoring");
    const evidence = normalizeLearnV2Evidence(
      { adapterId: "codex", sourcePath: "a", contentKind: "transcript", rawText: "", detectedFormat: "plain" },
      record,
      "user: Prefer focused parser tests for packages/core/src/parser.ts."
    ).map((item) => ({ ...item, paths: ["packages/core/src/parser.ts"] }));
    const [concept] = mergeLearnV2ConceptCards(extractLearnV2BehaviorAtoms(reconstructLearnV2Episodes(evidence)).atoms, new Date("2026-06-30T00:00:00Z"));
    await writeLearnV2ConceptStore(root, [concept!], new Date("2026-06-30T00:01:00Z"));
    const stored = (await readLearnV2ConceptStore(root)).cards[0]!;

    const accepted = await applyLearnV2ConceptReview(root, {
      accept: [stored.id],
      compileActive: false,
      now: new Date("2026-06-30T00:02:00Z")
    });
    const active = accepted.store.cards.find((card) => card.id === stored.id)!;
    expect(active.status).toBe("active");
    expect(active.scoring?.calibratedFrom).toEqual(expect.arrayContaining(["deterministic-heuristic", "human-review"]));
    expect(active.scoring?.humanReviewBoost).toBe(0.04);
    expect(active.scoring?.reasons.join(",")).toContain("human-review-approved:0.04");
    expect(active.confidence).toBeGreaterThanOrEqual(stored.confidence);

    await writeLearnV2ConceptStore(root, [concept!], new Date("2026-06-30T00:03:00Z"));
    const merged = (await readLearnV2ConceptStore(root)).cards.find((card) => card.id === stored.id)!;
    expect(merged.scoring?.calibratedFrom).toContain("human-review");
    expect(merged.scoring?.humanReviewBoost).toBe(0.04);
  });

  it("uses stable semantic concept identity independent of evidence ids", () => {
    const now = new Date("2026-06-30T00:00:00Z");
    const [first] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("semantic_identity_first", "Prefer focused parser tests for parser changes.", "positive"),
      evidenceIds: ["ev_semantic_identity_first"],
      rawRefs: ["raw_semantic_identity_first"]
    }], now);
    const [second] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("semantic_identity_second", "Prefer focused parser tests for parser changes.", "positive"),
      evidenceIds: ["ev_semantic_identity_second"],
      rawRefs: ["raw_semantic_identity_second"]
    }], now);

    expect(first!.id).toBe(second!.id);
    expect(first!.semanticKey).toBe(second!.semanticKey);
    expect(first!.semanticKey).toContain("behavior:focused-parser-test");
  });

  it("accumulates same concept evidence across runs without duplicating cards", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:00:00Z");
    const [first] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("cross_run_first", "Prefer focused parser tests for parser changes.", "positive"),
      evidenceIds: ["ev_cross_run_first"],
      rawRefs: ["raw_cross_run_first"],
      conditions: {
        appliesWhen: ["Parser implementation changed."],
        doesNotApplyWhen: []
      },
      activationHints: {
        phrases: ["parser implementation"],
        pathGlobs: [],
        commands: [],
        negativeTriggers: []
      }
    }], now);
    await writeLearnV2ConceptStore(root, [first!], now);
    const [second] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("cross_run_second", "Prefer focused parser tests for parser changes.", "positive"),
      evidenceIds: ["ev_cross_run_second"],
      rawRefs: ["raw_cross_run_second"],
      conditions: {
        appliesWhen: [],
        doesNotApplyWhen: ["Docs-only parser mention."]
      },
      activationHints: {
        phrases: [],
        pathGlobs: [],
        commands: ["npm test -- parser"],
        negativeTriggers: ["docs-only"]
      }
    }], new Date("2026-06-30T00:01:00Z"));

    const store = await writeLearnV2ConceptStore(root, [second!], new Date("2026-06-30T00:02:00Z"));
    const cards = store.cards.filter((card) => /focused parser tests/i.test(card.canonicalBehavior));

    expect(cards).toHaveLength(1);
    expect(cards[0]!.id).toBe(first!.id);
    expect(cards[0]!.evidenceIds).toEqual(expect.arrayContaining(["ev_cross_run_first", "ev_cross_run_second"]));
    expect(cards[0]!.rawRefs).toEqual(expect.arrayContaining(["raw_cross_run_first", "raw_cross_run_second"]));
    expect(cards[0]!.atoms.map((atom) => atom.id)).toEqual(expect.arrayContaining(["cross_run_first", "cross_run_second"]));
    expect(cards[0]!.conditions?.appliesWhen).toContain("Parser implementation changed.");
    expect(cards[0]!.conditions?.doesNotApplyWhen).toContain("Docs-only parser mention.");
    expect(cards[0]!.activation.phrases).toContain("parser implementation");
    expect(cards[0]!.activation.commands).toContain("npm test -- parser");
    expect(cards[0]!.scope.negativeTriggers).toContain("docs-only");
    expect(cards[0]!.scoring?.supportAtomCount).toBe(2);
  });

  it("merges legacy evidence-bound concepts by semantic signature and scope", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:00:00Z");
    const [stable] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("legacy_semantic_first", "Prefer focused parser tests for parser changes.", "positive"),
      evidenceIds: ["ev_legacy_semantic_first"],
      rawRefs: ["raw_legacy_semantic_first"]
    }], now);
    const legacy = {
      ...stable!,
      id: "concept_legacy_evidence_bound",
      semanticKey: undefined
    };
    await writeLearnV2ConceptStore(root, [legacy], now);
    const [incoming] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("legacy_semantic_second", "Prefer focused parser tests for parser changes.", "positive"),
      evidenceIds: ["ev_legacy_semantic_second"],
      rawRefs: ["raw_legacy_semantic_second"]
    }], new Date("2026-06-30T00:01:00Z"));

    const store = await writeLearnV2ConceptStore(root, [incoming!], new Date("2026-06-30T00:02:00Z"));

    expect(store.cards).toHaveLength(1);
    expect(store.cards[0]!.id).toBe("concept_legacy_evidence_bound");
    expect(store.cards[0]!.semanticKey).toBe(incoming!.semanticKey);
    expect(store.cards[0]!.evidenceIds).toEqual(expect.arrayContaining(["ev_legacy_semantic_first", "ev_legacy_semantic_second"]));
  });

  it("preserves reviewer-edited concept behavior while adding later support", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:00:00Z");
    const [initial] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("review_edit_first", "Prefer focused parser tests for parser changes.", "positive"),
      evidenceIds: ["ev_review_edit_first"],
      rawRefs: ["raw_review_edit_first"]
    }], now);
    await writeLearnV2ConceptStore(root, [initial!], now);
    await applyLearnV2ConceptReview(root, {
      edits: [{
        id: initial!.id,
        title: "Parser regression verification",
        canonicalBehavior: "For parser changes, keep regression verification focused before broad work.",
        activationPhrases: ["parser focused verification"]
      }],
      addCounterevidence: [{
        id: initial!.id,
        evidenceId: "ev_review_edit_first",
        reason: "Reviewer narrowed wording before accepting future support."
      }],
      compileActive: false,
      now: new Date("2026-06-30T00:01:00Z")
    });
    const [incoming] = mergeLearnV2ConceptCards([{
      ...behaviorAtom("review_edit_second", "Prefer focused parser tests for parser changes.", "positive"),
      evidenceIds: ["ev_review_edit_second"],
      rawRefs: ["raw_review_edit_second"]
    }], new Date("2026-06-30T00:02:00Z"));

    const merged = await writeLearnV2ConceptStore(root, [incoming!], new Date("2026-06-30T00:03:00Z"));
    const card = merged.cards.find((item) => item.id === initial!.id)!;

    expect(card.title).toBe("Parser regression verification");
    expect(card.canonicalBehavior).toBe("For parser changes, keep regression verification focused before broad work.");
    expect(card.activation.phrases).toContain("parser focused verification");
    expect(card.counterevidence).toEqual(expect.arrayContaining([{
      evidenceId: "ev_review_edit_first",
      reason: "Reviewer narrowed wording before accepting future support."
    }]));
    expect(card.evidenceIds).toEqual(expect.arrayContaining(["ev_review_edit_first", "ev_review_edit_second"]));
    expect(card.rawRefs).toEqual(expect.arrayContaining(["raw_review_edit_first", "raw_review_edit_second"]));
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
    // Fixture-style assertion: parse the persisted activation-run JSONL so the
    // local telemetry shape is inspectable. Only hashed query/path/command
    // fields are stored; raw query text, paths, and commands must never appear.
    const activationRunLines = activationRunText.split(/\r?\n/).filter(Boolean);
    expect(activationRunLines).toHaveLength(1);
    const activationRunRecord = JSON.parse(activationRunLines[0]!) as {
      schemaVersion: string;
      queryHash?: string;
      pathHashes: string[];
      commandHashes: string[];
      matchCount: number;
      suppressedCount: number;
      matches: Array<{ conceptId: string; status: string; score: number; suppressed: boolean }>;
    };
    expect(activationRunRecord.schemaVersion).toBe("openskill-kit.learn-v2.activation-run.v1");
    expect(activationRunRecord.queryHash).toMatch(/^sha256:[0-9a-f]+$/);
    expect(activationRunRecord.queryHash).not.toContain("parser");
    expect(activationRunRecord.pathHashes).toHaveLength(1);
    expect(activationRunRecord.pathHashes[0]).toMatch(/^sha256:[0-9a-f]+$/);
    expect(activationRunRecord.pathHashes.join(" ")).not.toContain("parser.ts");
    expect(activationRunRecord.commandHashes).toEqual([]);
    expect(activationRunRecord.matchCount).toBe(activated.diagnostics.visiblePositiveMatchCount);
    expect(activationRunRecord.suppressedCount).toBe(activated.diagnostics.suppressedMatchCount);
    expect(activationRunRecord.matches.some((match) => match.conceptId === concept.id)).toBe(true);
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
    expect(activationRuns).toHaveLength(1);
    expect(activationRuns[0]!.schemaVersion).toBe("openskill-kit.learn-v2.activation-run.v1");
    expect(activationRuns[0]!.queryHash).toBe(activationRunRecord.queryHash);
    expect(activationRuns[0]!.pathHashes).toEqual(activationRunRecord.pathHashes);
    expect(activationRuns[0]!.commandHashes).toEqual(activationRunRecord.commandHashes);
    expect(activationRuns[0]!.matchCount).toBe(activationRunRecord.matchCount);
    expect(activationRuns[0]!.suppressedCount).toBe(activationRunRecord.suppressedCount);
    expect(activationRuns[0]!.matches.some((match) => match.conceptId === concept.id)).toBe(true);

    const sensitiveOutcomeReason = `matched future parser task at ${path.join(root, "packages/core/src/parser.ts")} using npm test -- parser for reviewer shuva@example.com`;
    const outcome = await recordLearnV2ConceptOutcome(root, {
      conceptId: concept.id,
      outcome: "helpful",
      activationScore: activated.matches[0]!.score,
      query: `${root} parser change needs focused test`,
      paths: [path.join(root, "packages/core/src/parser.ts")],
      commands: ["npm test -- parser"],
      reason: sensitiveOutcomeReason
    }, new Date("2026-06-30T00:04:00Z"));
    const rawOutcome = await readText(outcome.outcomePath);
    expect(rawOutcome).toContain(concept.id);
    expect(rawOutcome).toContain("queryHash");
    expect(rawOutcome).toContain("reasonHash");
    expect(rawOutcome).toContain("reasonKinds");
    expect(rawOutcome).not.toContain(root);
    expect(rawOutcome).not.toContain("npm test -- parser");
    expect(rawOutcome).not.toContain("packages/core/src/parser.ts");
    expect(rawOutcome).not.toContain("matched future parser task");
    expect(rawOutcome).not.toContain("shuva@example.com");
    const outcomeLines = rawOutcome.split(/\r?\n/).filter(Boolean);
    expect(outcomeLines).toHaveLength(1);
    const outcomeRecord = JSON.parse(outcomeLines[0]!) as {
      reason?: string;
      reasonHash?: string;
      reasonKinds: string[];
      reasonPlaceholders: string[];
      reasonRedactionMatches: string[];
      reasonRedacted: boolean;
    };
    expect(outcomeRecord.reason).toBeUndefined();
    expect(outcomeRecord.reasonHash).toMatch(/^sha256:[0-9a-f]+$/);
    expect(outcomeRecord.reasonKinds).toEqual(expect.arrayContaining(["path", "command", "test", "task", "correction", "contact"]));
    expect(outcomeRecord.reasonPlaceholders).toEqual(expect.arrayContaining(["[PROJECT_ROOT]", "[REDACTED:email]"]));
    expect(outcomeRecord.reasonRedactionMatches).toEqual(expect.arrayContaining(["project-root", "email"]));
    expect(outcomeRecord.reasonRedacted).toBe(true);

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

    const [wrongBase] = mergeLearnV2ConceptCards([
      behaviorAtom("outcome_wrong_threshold", "Prefer broad parser rewrite for parser changes.", "positive")
    ], new Date("2026-06-30T00:07:10Z"));
    const wrongActive = {
      ...wrongBase!,
      status: "active" as const,
      activation: {
        phrases: ["broad parser rewrite", "parser changes"],
        pathGlobs: ["packages/core/src/parser.ts"],
        commands: []
      },
      scope: {
        ...wrongBase!.scope,
        paths: ["packages/core/src/parser.ts"],
        taskTypes: ["parser-change"],
        negativeTriggers: []
      }
    };
    await writeLearnV2ConceptStore(root, [wrongActive], new Date("2026-06-30T00:07:15Z"));
    await recordLearnV2ConceptOutcome(root, {
      conceptId: wrongActive.id,
      outcome: "wrong",
      query: "parser changes broad parser rewrite",
      reason: "first wrong activation"
    }, new Date("2026-06-30T00:07:20Z"));
    const oneWrong = await activateLearnV2Concepts(root, {
      query: "parser changes broad parser rewrite",
      paths: ["packages/core/src/parser.ts"],
      taskTypes: ["parser-change"]
    }, new Date("2026-06-30T00:07:30Z"));
    expect(oneWrong.matches.some((match) => match.conceptId === wrongActive.id)).toBe(true);
    expect(oneWrong.matches.find((match) => match.conceptId === wrongActive.id)?.reasons.join(",")).toContain("outcome:wrong:1");
    await recordLearnV2ConceptOutcome(root, {
      conceptId: wrongActive.id,
      outcome: "wrong",
      query: "parser changes broad parser rewrite",
      reason: "second wrong activation"
    }, new Date("2026-06-30T00:07:40Z"));
    const wrongSuppressed = await activateLearnV2Concepts(root, {
      query: "parser changes broad parser rewrite",
      paths: ["packages/core/src/parser.ts"],
      taskTypes: ["parser-change"]
    }, new Date("2026-06-30T00:07:50Z"));
    expect(wrongSuppressed.matches.some((match) => match.conceptId === wrongActive.id)).toBe(false);
    expect(wrongSuppressed.suppressed.find((match) => match.conceptId === wrongActive.id)?.reasons).toContain("outcome:wrong-threshold:2");

    const [ignoredBase] = mergeLearnV2ConceptCards([
      behaviorAtom("outcome_ignored_threshold", "Prefer parser snapshot reports for parser changes.", "positive")
    ], new Date("2026-06-30T00:08:00Z"));
    const ignoredActive = {
      ...ignoredBase!,
      status: "active" as const,
      activation: {
        phrases: ["parser snapshot reports", "parser changes"],
        pathGlobs: ["packages/core/src/parser.ts"],
        commands: []
      },
      scope: {
        ...ignoredBase!.scope,
        paths: ["packages/core/src/parser.ts"],
        taskTypes: ["parser-change"],
        negativeTriggers: []
      }
    };
    await writeLearnV2ConceptStore(root, [ignoredActive], new Date("2026-06-30T00:08:10Z"));
    for (const offset of [20, 30, 40]) {
      await recordLearnV2ConceptOutcome(root, {
        conceptId: ignoredActive.id,
        outcome: "ignored",
        query: "parser changes parser snapshot reports",
        reason: `ignored activation ${offset}`
      }, new Date(`2026-06-30T00:08:${offset}Z`));
    }
    const ignoredSuppressed = await activateLearnV2Concepts(root, {
      query: "parser changes parser snapshot reports",
      paths: ["packages/core/src/parser.ts"],
      taskTypes: ["parser-change"]
    }, new Date("2026-06-30T00:08:50Z"));
    expect(ignoredSuppressed.matches.some((match) => match.conceptId === ignoredActive.id)).toBe(false);
    expect(ignoredSuppressed.suppressed.find((match) => match.conceptId === ignoredActive.id)?.reasons).toContain("outcome:ignored-threshold:3");

    const policy = await writeLearnV2OutcomePolicyArtifact(root, [wrongActive, ignoredActive], new Date("2026-06-30T00:09:00Z"));
    expect(policy.counts.suppressed).toBe(2);
    expect(policy.decisions.find((decision) => decision.conceptId === wrongActive.id)?.reasons).toContain("outcome:wrong-threshold:2");
    expect(policy.decisions.find((decision) => decision.conceptId === ignoredActive.id)?.reasons).toContain("outcome:ignored-threshold:3");
    const policyMarkdown = await readText(policy.artifacts.markdown);
    expect(policyMarkdown).toContain("Outcome Policy");
    expect(policyMarkdown).toContain("Suppress wrong count: 2");
    expect(policyMarkdown).toContain("Suppress ignored count: 3");
    expect(policyMarkdown).not.toContain("parser changes parser snapshot reports");
    expect(policyMarkdown).not.toContain(root);
    const trace = await writeLearnV2ConceptDebugTraceArtifact(root, [wrongActive, ignoredActive], new Date("2026-06-30T00:09:10Z"), {
      outcomePolicy: policy
    });
    expect(trace.counts.outcomePolicyLinks).toBe(2);
    expect(trace.counts.outcomeSuppressedConcepts).toBe(2);
    const wrongTrace = trace.traces.find((item) => item.conceptId === wrongActive.id)!;
    expect(wrongTrace.outcomePolicy).toMatchObject({
      action: "suppress-activation",
      suppressed: true,
      counts: {
        wrong: 2
      }
    });
    expect(wrongTrace.outcomePolicy.reasons).toContain("outcome:wrong-threshold:2");
    const traceMarkdown = await readText(trace.artifacts.markdown);
    expect(traceMarkdown).toContain("Outcome policy:");
    expect(traceMarkdown).toContain("Action: suppress-activation");
    expect(traceMarkdown).toContain("outcome:wrong-threshold:2");
    expect(traceMarkdown).not.toContain(root);
  });

  it("builds declassified Learn v2 episode debug views without raw text or absolute paths", async () => {
    const root = await tempProject();
    const secretInstruction = "raw private instruction: use secret token abc123";
    const absoluteParserPath = path.join(root, "packages", "core", "src", "parser.ts");
    const episode: LearnV2TaskEpisode = {
      ...episodeWithCommand("debug_episode", "npm test -- --runInBand", "pass", ["parser-change"]),
      id: "episode_debug_parser",
      traceIds: ["trace_debug"],
      evidenceIds: ["ev_message", "ev_tool"],
      rawRefs: ["raw_message", "raw_tool"],
      cwdHints: [root],
      pathCluster: [absoluteParserPath, "packages/core/src/parser.ts"],
      phases: [{
        phase: "review/correction",
        evidenceIds: ["ev_message"],
        summary: secretInstruction,
        confidence: 0.76
      }],
      messages: [{
        ...normalizedMessage("ev_message", secretInstruction, "user"),
        paths: [absoluteParserPath],
        commands: ["npm test -- --runInBand"]
      }],
      toolSummaries: [{
        ...episodeWithCommand("debug_tool", "npm test -- --runInBand", "pass").toolSummaries[0]!,
        id: "tool_debug",
        evidenceId: "ev_tool",
        paths: [absoluteParserPath]
      }],
      tokenBudget: {
        inputChars: 120,
        compressedChars: 40,
        compressionRatio: 0.33
      }
    };
    await writeLearnV2EpisodeStore(root, [episode], new Date("2026-06-30T00:10:00Z"));

    const view = await readLearnV2EpisodeDebugView(root, { episodeId: "episode_debug_parser" });
    expect(view.schemaVersion).toBe("openskill-kit.learn-v2.episode-debug-view.v1");
    expect(view.counts.selectedEpisodes).toBe(1);
    expect(view.episodes[0]!.phases[0]!.summaryHash).toMatch(/^sha256:/);
    expect(view.episodes[0]!.phases[0]!.summaryChars).toBe(secretInstruction.length);
    expect(view.episodes[0]!.messageSummary).toMatchObject({
      total: 1,
      pathMentions: 1,
      commandMentions: 1,
      textChars: secretInstruction.length
    });
    expect(view.episodes[0]!.cwdHints).toEqual(["[PROJECT_ROOT]"]);
    expect(view.episodes[0]!.pathCluster).toContain("[PROJECT_ROOT]/packages/core/src/parser.ts");
    expect(view.episodes[0]!.toolSummaries[0]!.paths).toEqual(["[PROJECT_ROOT]/packages/core/src/parser.ts"]);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain(secretInstruction);
    expect(serialized).not.toContain("raw_message");
  });

  it("includes active Learn v2 activation in normal task context and suppresses explicit negative triggers", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:03:00Z");
    const [activeBase] = mergeLearnV2ConceptCards([
      behaviorAtom("task_context_active", "Prefer focused parser regression tests before parser changes.", "positive")
    ], now);
    const [candidateBase] = mergeLearnV2ConceptCards([
      behaviorAtom("task_context_candidate", "Prefer parser smoke checks from candidate concepts.", "positive")
    ], now);
    const active = {
      ...activeBase!,
      status: "active" as const,
      activation: {
        phrases: ["focused parser regression", "parser change"],
        pathGlobs: ["packages/core/src/parser.ts"],
        commands: []
      },
      scope: {
        ...activeBase!.scope,
        paths: ["packages/core/src/parser.ts"],
        taskTypes: ["parser-change"],
        negativeTriggers: ["skip-parser-learned-concept"]
      }
    };
    const candidate = {
      ...candidateBase!,
      status: "candidate" as const,
      activation: {
        phrases: ["parser smoke candidate"],
        pathGlobs: ["packages/core/src/parser.ts"],
        commands: []
      }
    };
    await writeLearnV2ConceptStore(root, [active, candidate], now);

    const context = await getAgentTaskContext({
      projectRoot: root,
      query: "parser change needs focused regression",
      paths: ["packages/core/src/parser.ts"],
      limit: 8
    });

    expect(context.learnV2Activation.matches.some((match) => match.conceptId === active.id)).toBe(true);
    expect(context.learnV2Activation.matches.some((match) => match.conceptId === candidate.id)).toBe(false);
    expect(context.learnedConcepts.shown.some((match) => match.conceptId === active.id)).toBe(true);
    expect(context.compactMarkdown).toContain("Relevant Learned Concepts");
    expect(context.compactMarkdown).toContain("focused parser regression");

    const suppressedContext = await getAgentTaskContext({
      projectRoot: root,
      query: "parser change needs focused regression",
      paths: ["packages/core/src/parser.ts"],
      negativeSignals: ["skip-parser-learned-concept"],
      limit: 8
    });
    expect(suppressedContext.learnV2Activation.matches.some((match) => match.conceptId === active.id)).toBe(false);
    expect(suppressedContext.learnV2Activation.suppressed.find((match) => match.conceptId === active.id)?.reasons)
      .toContain("negative-trigger:skip-parser-learned-concept");
    expect(suppressedContext.learnedConcepts.suppressed.some((match) => match.conceptId === active.id)).toBe(true);
  });

  it("dedupes task-context Learn v2 activation when generated preference already covers the concept", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:08:00Z");
    const [activeBase] = mergeLearnV2ConceptCards([
      behaviorAtom("task_context_dedupe", "Prefer focused parser regression tests before parser changes.", "positive")
    ], now);
    const active = {
      ...activeBase!,
      status: "active" as const,
      activation: {
        phrases: ["focused parser regression", "parser change"],
        pathGlobs: ["packages/core/src/parser.ts"],
        commands: []
      },
      scope: {
        ...activeBase!.scope,
        paths: ["packages/core/src/parser.ts"],
        taskTypes: ["parser-change"]
      }
    };
    await writeLearnV2ConceptStore(root, [active], now);
    await syncLearnV2ActiveConcepts(root, [active], new Date("2026-06-30T00:09:00Z"));

    const context = await getAgentTaskContext({
      projectRoot: root,
      query: "parser change needs focused regression",
      paths: ["packages/core/src/parser.ts"],
      limit: 8
    });

    expect(context.preferences.items.some((item) => item.node.id === `pref_${active.id}`)).toBe(true);
    expect(context.learnV2Activation.matches.some((match) => match.conceptId === active.id)).toBe(true);
    expect(context.learnedConcepts.shown.some((match) => match.conceptId === active.id)).toBe(false);
    expect(context.learnedConcepts.dedupedByPreference.some((match) => match.conceptId === active.id)).toBe(true);
    expect(context.learnedConcepts.dedupeReasons).toContainEqual({
      conceptId: active.id,
      preferenceIds: [`pref_${active.id}`],
      reasons: ["behavior-key", "generated-preference-id", "learn-v2-evidence-link"]
    });
    expect(context.compactMarkdown).toContain("already covered by relevant preference nodes");
    expect(context.compactMarkdown).toContain(`${active.id} covered by pref_${active.id}`);
    expect(context.compactMarkdown).not.toContain(`- ${active.title}: score`);
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

  it("activates path-scoped concepts for new files through deterministic subsystem labels", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:10:00Z");
    const [concept] = mergeLearnV2ConceptCards([{
      schemaVersion: "openskill-kit.learn-v2.behavior-atom.v1",
      id: "atom_subsystem_parser_fixture",
      kind: "verification",
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
      evidenceIds: ["ev_subsystem_parser_fixture"],
      rawRefs: ["raw_subsystem_parser_fixture"],
      rationale: "Explicit preference or correction language in episode.",
      risk: "low"
    }], now);
    const activeConcept = {
      ...concept!,
      status: "active" as const,
      activation: {
        phrases: [],
        pathGlobs: [],
        commands: []
      },
      scope: {
        ...concept!.scope,
        taskTypes: []
      }
    };
    await writeLearnV2ConceptStore(root, [activeConcept], now);
    const activationIndex = await readText(path.join(root, ".openskill-kit", "learn-v2", "activation-index.json"));
    expect(activationIndex).toContain("subsystemLabels");
    expect(activationIndex).toContain("parser subsystem");

    const result = await activateLearnV2Concepts(root, {
      paths: ["packages/core/src/parser/new-token-rule.ts"],
      limit: 5
    }, new Date("2026-06-30T00:11:00Z"));

    expect(result.matches[0]?.conceptId).toBe(activeConcept.id);
    expect(result.matches[0]?.reasons.join(",")).toContain("subsystem:");
    expect(result.matches[0]?.reasons.join(",")).not.toContain("path:");
    expect(result.matches[0]?.score).toBeGreaterThan(0);
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
    const stageCandidate = {
      ...safe,
      id: `${safe.id}_stage`,
      semanticKey: undefined,
      title: "Dependency-light parser fixes",
      canonicalBehavior: "Prefer dependency-light fixes for parser changes.",
      activation: { ...safe.activation, phrases: ["dependency light parser"] },
      atoms: safe.atoms.map((atom) => ({ ...atom, id: `${atom.id}_stage`, statement: "Prefer dependency-light fixes for parser changes." })),
      lifecycle: { ...safe.lifecycle, supersededBy: undefined }
    };
    const stagedStore = await writeLearnV2ConceptStore(root, [{ ...stageCandidate, status: "candidate" as const }], new Date("2026-06-30T00:02:00Z"));
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

  it("keeps one-off UI corrections as observations without durable concept admission", async () => {
    const evidence = [{
      ...normalizedMessage("ui_one_off_green", "Make this button green for this landing page only here. It is light and independent.", "user"),
      paths: ["packages/site/src/LandingButton.tsx"],
      metadata: {
        theme: "light",
        container: "independent",
        componentRole: "button",
        surfaceKind: "landing-page"
      }
    }];

    const observations = buildLearnV2LearningObservationsFromEvidence(evidence);
    const hypotheses = inferLearnV2ConditionalHypotheses(observations);
    const admission = decideLearnV2MemoryAdmission({ observations, hypotheses });

    expect(observations).toHaveLength(1);
    expect(observations[0]!.desiredOutcome).toBe("green");
    expect(observations[0]!.durabilitySignals.oneOff).toBe(true);
    expect(hypotheses).toHaveLength(0);
    expect(admission.find((item) => item.subjectId === observations[0]!.id)).toMatchObject({
      subjectKind: "observation",
      decision: "episode-note",
      requiredReview: false,
      reviewPriority: "none"
    });
    expect(learnV2ConditionalHypothesesToBehaviorAtoms(hypotheses, observations)).toHaveLength(0);
  });

  it("routes security and privacy learning through strict human review admission", () => {
    const evidence = [{
      ...normalizedMessage("security_privacy_durable", "Never store auth tokens or private credentials in durable project memory.", "user"),
      paths: ["packages/core/src/security.ts"]
    }];

    const observations = buildLearnV2LearningObservationsFromEvidence(evidence);
    const admission = decideLearnV2MemoryAdmission({ observations, hypotheses: [] });
    const decision = admission.find((item) => item.subjectId === observations[0]!.id)!;

    expect(decision).toMatchObject({
      subjectKind: "observation",
      decision: "requires-human-review",
      requiredReview: true,
      reviewPriority: "critical",
      riskLevel: "high",
      privacyBoundary: "high",
      scopeLevel: "path"
    });
    expect(decision.reasons).toEqual(expect.arrayContaining([
      "strict-review-gate-for-sensitive-behavior",
      "explicit-durable-user-language"
    ]));
  });

  it("derives UI context factors from path names when user text omits them", () => {
    const factors = extractLearnV2ContextFactors({
      text: "Make it orange.",
      paths: ["packages/site/src/DarkCardButton.tsx"],
      evidenceIds: ["ev_path_factor"]
    });

    expect(factors.map((factor) => `${factor.key}:${factor.value}:${factor.source}`)).toEqual(expect.arrayContaining([
      "ui.theme:dark:path",
      "component.container:card:path",
      "component.role:button:path",
      "framework:react:path"
    ]));
  });

  it("infers contrastive UI color hypotheses from theme and card factors instead of global preferences", async () => {
    const evidence = [
      {
        ...normalizedMessage("ui_light_green", "Make independent button green on white landing page.", "user"),
        paths: ["packages/site/src/LandingButton.tsx"],
        metadata: { theme: "light", container: "independent", componentRole: "button", surfaceKind: "landing-page" }
      },
      {
        ...normalizedMessage("ui_dark_blue", "No, this time I want blue for independent button on dark page.", "user"),
        paths: ["packages/site/src/DarkButton.tsx"],
        metadata: { theme: "dark", container: "independent", componentRole: "button" }
      },
      {
        ...normalizedMessage("ui_dark_card_orange", "For dark card button, make it orange.", "user"),
        paths: ["packages/site/src/CardButton.tsx"],
        metadata: { theme: "dark", container: "card", componentRole: "button" }
      }
    ];

    const observations = buildLearnV2LearningObservationsFromEvidence(evidence);
    const hypotheses = inferLearnV2ConditionalHypotheses(observations);
    const admission = decideLearnV2MemoryAdmission({ observations, hypotheses });
    const atoms = learnV2ConditionalHypothesesToBehaviorAtoms(hypotheses, observations);

    expect(observations).toHaveLength(3);
    expect(hypotheses.map((item) => item.desiredOutcome).sort()).toEqual(["blue", "green", "orange"]);
    expect(hypotheses.every((item) => item.status === "weak")).toBe(true);
    expect(hypotheses.every((item) => item.statement.includes("When "))).toBe(true);
    expect(hypotheses.some((item) => item.statement.includes("buttons are green"))).toBe(false);
    expect(hypotheses.find((item) => item.desiredOutcome === "orange")!.factorSet.map((factor) => `${factor.key}:${factor.value}`))
      .toContain("component.container:card");
    expect(hypotheses.find((item) => item.desiredOutcome === "blue")!.factorSet.map((factor) => `${factor.key}:${factor.value}`))
      .toEqual(expect.arrayContaining(["ui.theme:dark", "component.container:independent"]));
    expect(admission.filter((item) => item.subjectKind === "hypothesis").every((item) =>
      item.decision === "weak-observation" &&
      !item.requiredReview &&
      item.reasons.includes("single-support-hypothesis-kept-weak")
    )).toBe(true);
    expect(admission.filter((item) => item.subjectKind === "hypothesis").every((item) => item.reviewPriority === "none")).toBe(true);
    expect(atoms).toHaveLength(0);
  });

  it("infers contrastive UI hypotheses from path-only theme and container clues", () => {
    const evidence = [
      {
        ...normalizedMessage("ui_path_light_green", "Make button green.", "user"),
        paths: ["packages/site/src/LightButton.tsx"]
      },
      {
        ...normalizedMessage("ui_path_dark_blue", "No, I want button blue.", "user"),
        paths: ["packages/site/src/DarkButton.tsx"]
      },
      {
        ...normalizedMessage("ui_path_dark_card_orange", "Make button orange.", "user"),
        paths: ["packages/site/src/DarkCardButton.tsx"]
      }
    ];

    const observations = buildLearnV2LearningObservationsFromEvidence(evidence);
    const hypotheses = inferLearnV2ConditionalHypotheses(observations);
    const green = hypotheses.find((item) => item.desiredOutcome === "green")!;
    const blue = hypotheses.find((item) => item.desiredOutcome === "blue")!;
    const orange = hypotheses.find((item) => item.desiredOutcome === "orange")!;

    expect(observations.flatMap((observation) => observation.factors.map((factor) => `${factor.key}:${factor.value}:${factor.source}`)))
      .toEqual(expect.arrayContaining([
        "ui.theme:light:path",
        "ui.theme:dark:path",
        "component.container:card:path"
      ]));
    expect(green.factorSet.map((factor) => `${factor.key}:${factor.value}`)).toContain("ui.theme:light");
    expect(blue.factorSet.map((factor) => `${factor.key}:${factor.value}`)).toContain("ui.theme:dark");
    expect(orange.factorSet.map((factor) => `${factor.key}:${factor.value}`)).toEqual(expect.arrayContaining([
      "ui.theme:dark",
      "component.container:card"
    ]));
    expect(hypotheses.every((hypothesis) => hypothesis.status === "weak")).toBe(true);
  });

  it("promotes repeated conditional hypotheses while keeping counterexamples scoped", () => {
    const evidence = [
      {
        ...normalizedMessage("ui_light_green_first", "Make independent button green on white landing page.", "user"),
        paths: ["packages/site/src/LandingButton.tsx"],
        metadata: { theme: "light", container: "independent", componentRole: "button", surfaceKind: "landing-page" }
      },
      {
        ...normalizedMessage("ui_light_green_second", "Make independent button green on light marketing page.", "user"),
        paths: ["packages/site/src/MarketingButton.tsx"],
        metadata: { theme: "light", container: "independent", componentRole: "button", surfaceKind: "landing-page" }
      },
      {
        ...normalizedMessage("ui_dark_blue_counter", "No, this time I want blue for independent button on dark page.", "user"),
        paths: ["packages/site/src/DarkButton.tsx"],
        metadata: { theme: "dark", container: "independent", componentRole: "button" }
      }
    ];

    const observations = buildLearnV2LearningObservationsFromEvidence(evidence);
    const hypotheses = inferLearnV2ConditionalHypotheses(observations);
    const admission = decideLearnV2MemoryAdmission({ observations, hypotheses });
    const atoms = learnV2ConditionalHypothesesToBehaviorAtoms(hypotheses, observations);
    const green = hypotheses.find((item) => item.desiredOutcome === "green")!;
    const blue = hypotheses.find((item) => item.desiredOutcome === "blue")!;

    expect(green.status).toBe("candidate");
    expect(green.supportObservationIds).toHaveLength(2);
    expect(green.counterObservationIds).toHaveLength(1);
    expect(green.factorSet.map((factor) => `${factor.key}:${factor.value}`)).toEqual(expect.arrayContaining(["ui.theme:light", "surface.kind:landing-page"]));
    expect(blue.status).toBe("weak");
    expect(admission.find((item) => item.subjectKind === "hypothesis" && item.subjectId === green.id)).toMatchObject({
      decision: "candidate-concept",
      requiredReview: true,
      reviewPriority: "normal"
    });
    expect(admission.find((item) => item.subjectKind === "hypothesis" && item.subjectId === blue.id)).toMatchObject({
      decision: "weak-observation",
      requiredReview: false,
      reviewPriority: "none"
    });
    expect(atoms).toHaveLength(1);
    expect(atoms.every((atom) => atom.scope.taskTypes.includes("ui-design-change"))).toBe(true);
  });

  it("keeps repeated explicit one-off conditional support out of durable candidates", () => {
    const evidence = [
      {
        ...normalizedMessage("ui_oneoff_green_first", "This time make independent button green on white landing page.", "user"),
        paths: ["packages/site/src/LandingButton.tsx"],
        metadata: { theme: "light", container: "independent", componentRole: "button", surfaceKind: "landing-page" }
      },
      {
        ...normalizedMessage("ui_oneoff_green_second", "Only here make independent button green on light marketing page.", "user"),
        paths: ["packages/site/src/MarketingButton.tsx"],
        metadata: { theme: "light", container: "independent", componentRole: "button", surfaceKind: "landing-page" }
      },
      {
        ...normalizedMessage("ui_oneoff_blue_counter", "No, this time I want blue for independent button on dark page.", "user"),
        paths: ["packages/site/src/DarkButton.tsx"],
        metadata: { theme: "dark", container: "independent", componentRole: "button" }
      }
    ];

    const observations = buildLearnV2LearningObservationsFromEvidence(evidence);
    const hypotheses = inferLearnV2ConditionalHypotheses(observations);
    const admission = decideLearnV2MemoryAdmission({ observations, hypotheses });
    const atoms = learnV2ConditionalHypothesesToBehaviorAtoms(hypotheses, observations);

    expect(observations.every((observation) => observation.durabilitySignals.oneOff)).toBe(true);
    expect(hypotheses.length).toBeGreaterThan(0);
    expect(hypotheses.every((hypothesis) => hypothesis.status === "weak")).toBe(true);
    expect(admission.filter((item) => item.subjectKind === "observation").every((item) => item.decision === "episode-note")).toBe(true);
    expect(admission.filter((item) => item.subjectKind === "hypothesis").every((item) => item.decision === "weak-observation")).toBe(true);
    expect(atoms).toHaveLength(0);
  });

  it("renders behavior-visible Learn v2 activation payload in task context", async () => {
    const root = await tempProject();
    const now = new Date("2026-06-30T00:12:00Z");
    const [base] = mergeLearnV2ConceptCards([
      behaviorAtom("task_context_behavior_payload", "Run focused parser regression before parser edits.", "positive")
    ], now);
    const active = {
      ...base!,
      title: "Parser Verification Rule",
      canonicalBehavior: "Run focused parser regression before parser edits.",
      status: "active" as const,
      conditions: {
        appliesWhen: ["Task changes parser source files"],
        doesNotApplyWhen: ["User explicitly asks to skip parser tests"]
      },
      activation: {
        phrases: ["parser edits", "parser regression"],
        pathGlobs: ["packages/core/src/parser.ts"],
        commands: ["npm test -- parser"]
      },
      scope: {
        ...base!.scope,
        paths: ["packages/core/src/parser.ts"],
        taskTypes: ["parser-change"],
        negativeTriggers: ["user says skip parser tests"]
      }
    };
    await writeLearnV2ConceptStore(root, [active], now);

    const context = await getAgentTaskContext({
      projectRoot: root,
      query: "parser edits need verification",
      paths: ["packages/core/src/parser.ts"],
      limit: 8
    });

    expect(context.learnV2Activation.matches[0]).toMatchObject({
      conceptId: active.id,
      behavior: "Run focused parser regression before parser edits.",
      appliesWhen: ["Task changes parser source files"],
      doesNotApplyWhen: ["User explicitly asks to skip parser tests"],
      negativeTriggers: ["user says skip parser tests"],
      preferredCommands: ["npm test -- parser"]
    });
    expect(context.compactMarkdown).toContain("Parser Verification Rule: Run focused parser regression before parser edits.");
    expect(context.compactMarkdown).toContain("Apply when: Task changes parser source files");
    expect(context.compactMarkdown).toContain("Do not apply when: User explicitly asks to skip parser tests");
    expect(context.compactMarkdown).toContain("Negative triggers: user says skip parser tests");
    expect(context.compactMarkdown).toContain("Commands: npm test -- parser");
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

function normalizedFileChange(
  id: string,
  text: string,
  overrides: Partial<LearnV2NormalizedEvidence> = {}
) {
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
    metadata: {},
    ...overrides
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

async function topLevelDirNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function projectRel(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/g, "/");
}
