import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import {
  buildVirtualSuiteFromAnchors,
  assessOpenWorldVerifierQuality,
  buildOpenWorldRetrievalAdapters,
  buildOpenWorldEvalReport,
  buildOpenWorldHiddenOracleHarness,
  buildOpenWorldTaskReport,
  buildReviewQueue,
  draftAnchorFromOpenWorldSource,
  executeOpenWorldResearchPlan,
  generateOpenWorldCandidateSkill,
  ingestLocalOpenWorldSource,
  ingestWebOpenWorldSource,
  initOpenWorldTask,
  planOpenWorldResearch,
  readOpenWorldSourceContent,
  readOpenWorldSourceIndex,
  readOpenWorldTrustCache,
  promoteOpenWorldRunToReview,
  runOpenWorldCandidateRepairLoop,
  runOpenWorldRefinement,
  runVirtualTestSuite
} from "../src/index.js";

describe("OpenWorld local research", () => {
  it("plans source candidates with leakage blocks and sanitized queries before ingestion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-openworld-plan-"));
    await writeFile(path.join(root, "README.md"), "OpenSkillKit uses local-first source planning before retrieval.\n", "utf8");
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs", "architecture.md"), "Architecture docs describe verifier-first OpenWorld anchors.\n", "utf8");
    await writeFile(path.join(root, "docs", "leaked.md"), "hidden/oracle.txt contains target answer material.\n", "utf8");
    const task = await initOpenWorldTask(root, {
      title: "Verifier-first anchors",
      prompt: "Find architecture docs without hidden oracle evidence.",
      paths: ["docs"],
      forbiddenPaths: ["hidden/oracle.txt"],
      allowWeb: true,
      now: new Date("2026-06-27T01:00:00.000Z")
    });

    const plan = await planOpenWorldResearch(root, task.task.id, {
      query: "Find hidden/oracle.txt docs for verifier anchors",
      paths: ["docs"],
      maxCandidates: 5,
      now: new Date("2026-06-27T01:01:00.000Z")
    });

    expect(plan.queryPlan.some((query) => query.status === "sanitized" && !query.sanitizedQuery.includes("hidden/oracle.txt"))).toBe(true);
    expect(plan.candidates.some((candidate) => candidate.uri === "docs/architecture.md" && candidate.status === "recommended")).toBe(true);
    expect(plan.candidates.some((candidate) => candidate.uri === "docs/leaked.md" && candidate.status === "blocked")).toBe(true);
    expect(plan.retrievalAdapters.map((adapter) => adapter.id)).toEqual(["local-project-files", "explicit-http-cache", "explicit-http-fetch", "autonomous-docs-repo-discovery"]);
    expect(plan.retrievalAdapters.find((adapter) => adapter.id === "explicit-http-fetch")?.status).toBe("enabled");
    expect(plan.summary.enabledAdapterCount).toBe(4);
    expect(plan.recommendedNextCommands.some((command) => command.includes("openworld research") && command.includes("docs/architecture.md"))).toBe(true);
    expect(plan.recommendedNextCommands.some((command) => command.includes("fetch-source"))).toBe(true);
    expect(plan.planPath).toContain("/research/plans/");
    expect(plan.leakageAuditPath).toContain("/audits/");
    await expect(stat(path.join(root, plan.planPath ?? ""))).resolves.toBeTruthy();

    const dry = await planOpenWorldResearch(root, task.task.id, {
      paths: ["docs"],
      write: false,
      now: new Date("2026-06-27T01:02:00.000Z")
    });
    expect(dry.planPath).toBeUndefined();

    const dryExecution = await executeOpenWorldResearchPlan(root, task.task.id, {
      planId: plan.id,
      dryRun: true,
      now: new Date("2026-06-27T01:03:00.000Z")
    });
    expect(dryExecution.execution.status).toBe("planned");
    expect(dryExecution.execution.summary.ingestedCount).toBe(0);
    expect(dryExecution.execution.executionPath).toBeUndefined();

    const execution = await executeOpenWorldResearchPlan(root, task.task.id, {
      planId: plan.id,
      maxLocalSources: 2,
      now: new Date("2026-06-27T01:04:00.000Z")
    });
    expect(execution.execution.status).toBe("completed");
    expect(execution.execution.summary.ingestedCount).toBe(1);
    expect(execution.execution.summary.adapterCount).toBe(4);
    expect(execution.execution.adapterResults.some((result) => result.adapterId === "local-project-files" && result.status === "completed" && result.ingestedCount === 1)).toBe(true);
    expect(execution.execution.adapterResults.some((result) => result.adapterId === "explicit-http-fetch" && result.status === "skipped")).toBe(true);
    expect(execution.execution.ingested[0]?.uri).toBe("docs/architecture.md");
    expect(execution.execution.executionPath).toContain("/research/executions/");
    await expect(stat(execution.executionPath ?? "")).resolves.toBeTruthy();
    const index = await readOpenWorldSourceIndex(root);
    expect(index.entries.some((entry) => entry.uri === "docs/architecture.md")).toBe(true);

    const disabledAdapters = buildOpenWorldRetrievalAdapters({ allowWeb: false, privacyClass: "project-private" });
    expect(disabledAdapters.find((adapter) => adapter.id === "explicit-http-fetch")?.status).toBe("disabled");
    expect(disabledAdapters.find((adapter) => adapter.id === "autonomous-docs-repo-discovery")?.status).toBe("disabled");
  });

  it("ingests local files, drafts anchors, and builds visible/holdout suite", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-openworld-local-"));
    await writeFile(path.join(root, "notes.md"), "Prefer local-only retrieval before any web adapter.\nSecond useful line.\n", "utf8");
    const task = await initOpenWorldTask(root, {
      title: "Local retrieval",
      prompt: "Extract anchors from notes.",
      forbiddenIdentifiers: ["hidden-local-case"],
      forbiddenPaths: ["hidden/oracle.txt"],
      now: new Date("2026-06-26T01:00:00.000Z")
    });

    const source = await ingestLocalOpenWorldSource(root, task.task.id, "notes.md", new Date("2026-06-26T01:01:00.000Z"));
    expect(source.source.kind).toBe("local-doc");
    expect(source.source.schemaVersion).toBe("openskill-kit.openworld-source.v2");
    expect(source.source.trust.score).toBeGreaterThan(0.5);
    expect(source.audit.status).toBe("pass");
    expect(await readOpenWorldSourceContent(root, task.task.id, source.source.id)).toContain("local-only retrieval");
    const index = await readOpenWorldSourceIndex(root);
    expect(index.entries.some((entry) => entry.sourceId === source.source.id && entry.cachePath?.includes("/cache/"))).toBe(true);
    const trust = await readOpenWorldTrustCache(root);
    expect(Object.values(trust.entries).some((entry) => entry.sourceType === "local-doc")).toBe(true);

    const anchors = [];
    for (let index = 0; index < 4; index += 1) {
      const anchor = await draftAnchorFromOpenWorldSource(
        root,
        task.task.id,
        source.source.id,
        index === 0 ? undefined : `Anchor ${index} preserves local-only source cache evidence.`,
        new Date(`2026-06-26T01:02:0${index}.000Z`)
      );
      anchors.push(anchor.anchor);
      await expect(stat(anchor.anchorPath)).resolves.toBeTruthy();
    }
    expect(anchors[0]?.claim).toContain("local-only retrieval");

    const candidateSkill = await generateOpenWorldCandidateSkill(root, task.task.id, {
      anchorIds: anchors.map((anchor) => anchor.id),
      name: "local retrieval candidate",
      now: new Date("2026-06-26T01:02:45.000Z")
    });
    expect(candidateSkill.candidate.status).toBe("ready");
    expect(candidateSkill.candidate.hiddenOracleProof).toBe(false);
    expect(candidateSkill.candidate.safety.status).toBe("pass");
    expect(candidateSkill.candidate.artifacts.skillPath).toContain("/candidates/");
    await expect(stat(candidateSkill.skillPath ?? "")).resolves.toBeTruthy();
    const repair = await runOpenWorldCandidateRepairLoop(root, task.task.id, {
      candidateSkillId: candidateSkill.candidate.id,
      failureType: "unknown",
      notes: ["Exercise local repair probe before refinement."],
      now: new Date("2026-06-26T01:02:50.000Z")
    });
    expect(repair.run.status).toBe("passed");
    expect(repair.run.sandboxMode).toBe("local-process");
    expect(repair.run.rounds[0]?.revisionId).toContain("owskillrev_");
    expect(repair.run.rounds[0]?.probeSummary.fail).toBe(0);
    expect(repair.run.rounds[0]?.probeResultPath).toContain("repair-probe-result.json");

    const suite = await buildVirtualSuiteFromAnchors(root, task.task.id, anchors, new Date("2026-06-26T01:03:00.000Z"));
    expect(suite.suite.cases).toHaveLength(4);
    expect(suite.suite.cases[0]?.split).toBe("visible");
    expect(suite.suite.cases.some((testCase) => testCase.split === "holdout")).toBe(true);
    expect(suite.suite.cases.every((testCase) => testCase.runner === "node" && testCase.status === "ready" && testCase.file && testCase.command[0] === "node")).toBe(true);
    await expect(stat(suite.manifestPath)).resolves.toBeTruthy();
    await expect(stat(suite.traceabilityMapPath)).resolves.toBeTruthy();
    expect(JSON.parse(await readFile(suite.manifestPath, "utf8")).holdout).toHaveLength(1);
    await expect(runVirtualTestSuite(root, task.task.id, suite.suite.id, {
      sandboxMode: "docker"
    })).rejects.toThrow(/dockerImage/);
    const quality = await assessOpenWorldVerifierQuality(root, task.task.id, suite.suite.id, {
      now: new Date("2026-06-26T01:03:30.000Z")
    });
    expect(quality.report.status).toBe("pass");
    expect(quality.report.metrics.anchorCoverage).toBe(1);
    expect(quality.report.metrics.determinismScore).toBe(1);
    expect(quality.report.metrics.holdoutCount).toBe(1);
    expect(quality.report.markdownPath).toContain("/reports/");

    const execution = await runVirtualTestSuite(root, task.task.id, suite.suite.id, {
      split: "all",
      now: new Date("2026-06-26T01:04:00.000Z")
    });
    expect(execution.summary).toMatchObject({ pass: 4, fail: 0, blocked: 0, timeout: 0, skipped: 0 });
    expect(execution.sandboxMode).toBe("local-process");
    expect(execution.resultPath).toContain("/results/");

    const refined = await runOpenWorldRefinement(root, task.task.id, suite.suite.id, {
      candidateSkillId: candidateSkill.candidate.id,
      now: new Date("2026-06-26T01:04:30.000Z")
    });
    expect(refined.status).toBe("passed");
    expect(refined.candidateSkillIds).toContain(candidateSkill.candidate.id);
    expect(refined.rounds.map((round) => round.split)).toEqual(["visible", "holdout"]);
    expect(refined.sourceIds).toContain(source.source.id);
    const report = await buildOpenWorldEvalReport(root, refined.id, new Date("2026-06-26T01:04:45.000Z"));
    expect(report.report.proofLevel).toBe("artifact-verifier");
    expect(report.report.hiddenOracleProof).toBe(false);
    expect(report.report.metrics.visiblePassRate).toBe(1);
    expect(report.report.metrics.holdoutPassRate).toBe(1);
    expect(await readFile(report.markdownPath, "utf8")).toContain("Hidden-oracle proof: no");
    const harness = await buildOpenWorldHiddenOracleHarness(root, task.task.id, {
      suiteId: suite.suite.id,
      now: new Date("2026-06-26T01:04:46.000Z")
    });
    expect(harness.harness.status).toBe("pass");
    expect(harness.harness.hiddenOracleProof).toBe(false);
    expect(harness.harness.deniedPathProof.osBoundaryEnforced).toBe(false);
    expect(harness.harness.deniedPathProof.scannedArtifactCount).toBeGreaterThan(0);
    expect(JSON.stringify(harness.harness.deniedPaths)).not.toContain("hidden/oracle.txt");
    expect(await readFile(harness.markdownPath, "utf8")).toContain("OS path boundary enforced: no");
    const taskReport = await buildOpenWorldTaskReport(root, task.task.id, { write: true });
    expect(taskReport.markdownPath).toContain("task-report.md");
    expect(taskReport.sources).toHaveLength(1);
    expect(taskReport.anchors).toHaveLength(4);
    expect(taskReport.candidateSkills).toHaveLength(1);
    expect(taskReport.candidateRepairRuns.some((item) => item.id === repair.run.id)).toBe(true);
    expect(taskReport.suites).toHaveLength(1);
    expect(taskReport.qualityReports.length).toBeGreaterThan(0);
    expect(taskReport.executions.length).toBeGreaterThan(0);
    expect(taskReport.runs.some((run) => run.id === refined.id)).toBe(true);
    expect(taskReport.evalReports.some((evalReport) => evalReport.runId === refined.id)).toBe(true);
    expect(taskReport.hiddenOracleHarnesses.some((item) => item.id === harness.harness.id)).toBe(true);
    expect(taskReport.proofSummary).toMatchObject({
      status: "ready-for-review",
      proofLevel: "artifact-verifier",
      hiddenOracleProof: false,
      promotionEligible: true,
      latestRunId: refined.id,
      visiblePassRate: 1,
      holdoutPassRate: 1,
      overfitRisk: false
    });
    expect(taskReport.proofSummary.satisfiedEvidence).toEqual(expect.arrayContaining(["visible verifier pass", "holdout verifier pass", "artifact eval report", "denied-path harness pass"]));
    expect(taskReport.proofSummary.missingEvidence).toEqual([]);
    expect(taskReport.markdown).toContain("## Next Actions");
    expect(taskReport.markdown).toContain("## Proof Summary");
    expect(taskReport.markdown).toContain("- Promotion eligible: yes");
    expect(taskReport.markdown).toContain("## Hidden-Oracle Harnesses");
    expect(taskReport.markdown).toContain(`promote-review --run-id ${refined.id}`);
    expect(await readFile(taskReport.markdownPath ?? "", "utf8")).toContain("## Sources");
    const plannedPromotion = await promoteOpenWorldRunToReview(root, refined.id, {
      dryRun: true,
      now: new Date("2026-06-26T01:04:49.000Z")
    });
    expect(plannedPromotion.status).toBe("planned");
    await expect(stat(path.join(root, ".openskill-kit", "reviews"))).rejects.toThrow();
    const promotion = await promoteOpenWorldRunToReview(root, refined.id, {
      now: new Date("2026-06-26T01:04:50.000Z")
    });
    expect(promotion.status).toBe("proposed");
    expect(promotion.proposal?.proposal.risk).toBe("medium");
    expect(promotion.messages.join(" ")).toContain("No active behavior changed");
    const queue = await buildReviewQueue(root);
    expect(queue.proposals.some((proposal) => proposal.id === promotion.proposal?.proposal.id)).toBe(true);

    await writeFile(path.join(root, source.source.cachePath ?? ""), "Tampered cache text.\n", "utf8");
    const failed = await runVirtualTestSuite(root, task.task.id, suite.suite.id, {
      split: "visible",
      now: new Date("2026-06-26T01:05:00.000Z")
    });
    expect(failed.summary.fail).toBeGreaterThan(0);
    const failedRefinement = await runOpenWorldRefinement(root, task.task.id, suite.suite.id, {
      candidateSkillId: candidateSkill.candidate.id,
      now: new Date("2026-06-26T01:06:00.000Z")
    });
    expect(failedRefinement.status).toBe("failed");
    expect(failedRefinement.rounds[0]?.failureType).toBe("source-conflict");
    expect(failedRefinement.rounds[0]?.candidateRevisionId).toContain("owskillrev_");
    expect(failedRefinement.rounds[0]?.notes.some((note) => note.includes("Candidate repair run written"))).toBe(true);
    await expect(stat(path.join(root, failedRefinement.rounds[0]?.candidateRevisionPath ?? ""))).resolves.toBeTruthy();
    const failedTaskReport = await buildOpenWorldTaskReport(root, task.task.id);
    expect(failedTaskReport.proofSummary.status).toBe("failed");
    expect(failedTaskReport.proofSummary.promotionEligible).toBe(false);
    expect(failedTaskReport.proofSummary.latestRunId).toBe(failedRefinement.id);
    expect(failedTaskReport.proofSummary.missingEvidence).toEqual(expect.arrayContaining(["visible verifier pass", "holdout verifier pass"]));
    await expect(promoteOpenWorldRunToReview(root, failedRefinement.id)).rejects.toThrow(/only passed runs/);
  });

  it("warns when a verifier suite has no holdout split", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-openworld-quality-"));
    await writeFile(path.join(root, "quality.md"), "Quality checks need traceable cached verifier anchors.\n", "utf8");
    const task = await initOpenWorldTask(root, {
      title: "Quality gate",
      prompt: "Score verifier quality.",
      now: new Date("2026-06-27T02:00:00.000Z")
    });
    const source = await ingestLocalOpenWorldSource(root, task.task.id, "quality.md", new Date("2026-06-27T02:01:00.000Z"));
    const anchor = await draftAnchorFromOpenWorldSource(root, task.task.id, source.source.id, undefined, new Date("2026-06-27T02:02:00.000Z"));
    const suite = await buildVirtualSuiteFromAnchors(root, task.task.id, [anchor.anchor], new Date("2026-06-27T02:03:00.000Z"));
    const quality = await assessOpenWorldVerifierQuality(root, task.task.id, suite.suite.id, {
      write: false,
      now: new Date("2026-06-27T02:04:00.000Z")
    });
    expect(quality.report.status).toBe("warn");
    expect(quality.report.findings.some((finding) => finding.id === "no-holdout-split")).toBe(true);
    expect(quality.report.reportPath).toBeUndefined();

    const badSuite = {
      ...suite.suite,
      cases: [{ ...suite.suite.cases[0]!, command: ["curl", "https://example.com"] }]
    };
    await writeFile(suite.suitePath, `${JSON.stringify(badSuite, null, 2)}\n`, "utf8");
    const failedQuality = await assessOpenWorldVerifierQuality(root, task.task.id, suite.suite.id, {
      write: false,
      now: new Date("2026-06-27T02:05:00.000Z")
    });
    expect(failedQuality.report.status).toBe("fail");
    expect(failedQuality.report.findings.some((finding) => finding.id === "case-not-deterministic")).toBe(true);
    const blocked = await runOpenWorldRefinement(root, task.task.id, suite.suite.id, {
      now: new Date("2026-06-27T02:06:00.000Z")
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.rounds[0]?.failureType).toBe("verifier-bug");
  });

  it("blocks local sources that mention forbidden oracle paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-openworld-local-block-"));
    await writeFile(path.join(root, "bad.md"), "Use hidden/oracle.txt to solve target answer.\n", "utf8");
    const task = await initOpenWorldTask(root, {
      title: "Blocked retrieval",
      prompt: "Block leaked sources.",
      forbiddenPaths: ["hidden/oracle.txt"],
      now: new Date("2026-06-26T01:00:00.000Z")
    });
    await expect(ingestLocalOpenWorldSource(root, task.task.id, "bad.md")).rejects.toThrow(/blocked by leakage audit/);
  });

  it("flags denied oracle paths in generated artifacts without reading oracle contents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-openworld-oracle-harness-"));
    const task = await initOpenWorldTask(root, {
      title: "Oracle harness",
      prompt: "Scan generated artifacts only.",
      forbiddenPaths: ["hidden/oracle.txt"],
      now: new Date("2026-06-27T03:00:00.000Z")
    });
    const reportsDir = path.join(root, ".openskill-kit", "openworld", "tasks", task.task.id, "reports");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(path.join(reportsDir, "leaky.md"), "Generated artifact mentioned hidden/oracle.txt.\n", "utf8");

    const harness = await buildOpenWorldHiddenOracleHarness(root, task.task.id, {
      now: new Date("2026-06-27T03:01:00.000Z")
    });
    expect(harness.harness.status).toBe("fail");
    expect(harness.harness.deniedPathProof.leakedReferenceCount).toBe(1);
    expect(harness.harness.leaks[0]?.artifactPath).toContain("reports/leaky.md");
    expect(JSON.stringify(harness.harness.deniedPaths)).not.toContain("hidden/oracle.txt");
  });

  it("blocks virtual suite artifacts before writing verifier scripts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-openworld-suite-block-"));
    await writeFile(path.join(root, "safe.md"), "Safe public behavior must stay grounded in cached source text.\n", "utf8");
    const task = await initOpenWorldTask(root, {
      title: "Blocked suite",
      prompt: "Block leaked verifier artifacts.",
      forbiddenIdentifiers: ["private-suite-case"],
      now: new Date("2026-06-26T01:00:00.000Z")
    });
    const source = await ingestLocalOpenWorldSource(root, task.task.id, "safe.md", new Date("2026-06-26T01:01:00.000Z"));
    const anchor = await draftAnchorFromOpenWorldSource(root, task.task.id, source.source.id, undefined, new Date("2026-06-26T01:02:00.000Z"));
    await expect(buildVirtualSuiteFromAnchors(root, task.task.id, [{ ...anchor.anchor, claim: "private-suite-case must never reach verifier files" }], new Date("2026-06-26T01:03:00.000Z"))).rejects.toThrow(/blocked by leakage audit/);
    await expect(stat(path.join(root, ".openskill-kit", "openworld", "tasks", task.task.id, "verifiers"))).rejects.toThrow();
  });

  it("registers explicit web sources only when task allows web", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-openworld-web-"));
    const blocked = await initOpenWorldTask(root, {
      title: "Blocked web",
      prompt: "Research docs.",
      allowWeb: false,
      now: new Date("2026-06-26T01:00:00.000Z")
    });
    await expect(ingestWebOpenWorldSource(root, blocked.task.id, {
      url: "https://docs.example.com/sdk",
      content: "Official SDK docs describe retry behavior.",
      now: new Date("2026-06-26T01:01:00.000Z")
    })).rejects.toThrow(/allowWeb is false/);

    const allowed = await initOpenWorldTask(root, {
      title: "Allowed web",
      prompt: "Research docs.",
      allowWeb: true,
      forbiddenIdentifiers: ["private-case-7"],
      now: new Date("2026-06-26T01:02:00.000Z")
    });
    const source = await ingestWebOpenWorldSource(root, allowed.task.id, {
      url: "https://docs.example.com/sdk",
      content: "Official SDK docs describe retry behavior.",
      now: new Date("2026-06-26T01:03:00.000Z")
    });
    expect(source.source.kind).toBe("official-docs");
    expect(source.source.privacyClass).toBe("openworld-public");
    expect(source.source.locator.url).toBe("https://docs.example.com/sdk");
    expect(source.source.trust.score).toBeGreaterThan(0.7);
    const index = await readOpenWorldSourceIndex(root);
    expect(index.entries.some((entry) => entry.sourceId === source.source.id && entry.privacyClass === "openworld-public")).toBe(true);

    await expect(ingestWebOpenWorldSource(root, allowed.task.id, {
      url: "https://docs.example.com/private-case-7",
      content: "safe text",
      now: new Date("2026-06-26T01:04:00.000Z")
    })).rejects.toThrow(/blocked by leakage audit/);
  });

  it("fetches explicit web sources over HTTP with content-type and size guards", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-openworld-http-"));
    const task = await initOpenWorldTask(root, {
      title: "HTTP web",
      prompt: "Fetch public docs.",
      allowWeb: true,
      now: new Date("2026-06-26T02:00:00.000Z")
    });
    const server = createServer((request, response) => {
      if (request.url === "/sdk") {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("Official SDK docs describe deterministic retry behavior.\n");
        return;
      }
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not expose a port");
      const source = await ingestWebOpenWorldSource(root, task.task.id, {
        url: `http://127.0.0.1:${address.port}/sdk`,
        maxBytes: 2_000,
        now: new Date("2026-06-26T02:01:00.000Z")
      });
      expect(source.source.kind).toBe("web");
      expect(await readOpenWorldSourceContent(root, task.task.id, source.source.id)).toContain("deterministic retry behavior");
      await expect(ingestWebOpenWorldSource(root, task.task.id, {
        url: `http://127.0.0.1:${address.port}/sdk`,
        maxBytes: 10,
        now: new Date("2026-06-26T02:02:00.000Z")
      })).rejects.toThrow(/too large/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("discovers and fetches autonomous docs/repo candidates from package metadata only when requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-openworld-autonomous-web-"));
    const server = createServer((request, response) => {
      if (request.url === "/sdk") {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("Autonomous package docs describe source-plan execution.\n");
        return;
      }
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not expose a port");
      await writeFile(path.join(root, "package.json"), JSON.stringify({
        name: "autonomous-docs-fixture",
        homepage: `http://127.0.0.1:${address.port}/sdk`
      }), "utf8");
      const task = await initOpenWorldTask(root, {
        title: "Autonomous package docs",
        prompt: "Find package docs without operator URL entry.",
        allowWeb: true,
        now: new Date("2026-06-26T03:00:00.000Z")
      });
      const plan = await planOpenWorldResearch(root, task.task.id, {
        maxCandidates: 5,
        now: new Date("2026-06-26T03:01:00.000Z")
      });
      expect(plan.candidates.some((candidate) => candidate.adapterId === "autonomous-docs-repo-discovery" && candidate.locator.url?.endsWith("/sdk"))).toBe(true);

      const dry = await executeOpenWorldResearchPlan(root, task.task.id, {
        planId: plan.id,
        maxLocalSources: 0,
        dryRun: true,
        now: new Date("2026-06-26T03:02:00.000Z")
      });
      expect(dry.execution.adapterResults.find((result) => result.adapterId === "autonomous-docs-repo-discovery")?.plannedCount).toBe(0);

      const execution = await executeOpenWorldResearchPlan(root, task.task.id, {
        planId: plan.id,
        maxLocalSources: 0,
        includeAutonomousWeb: true,
        maxAutonomousWebSources: 1,
        now: new Date("2026-06-26T03:03:00.000Z")
      });
      expect(execution.execution.status).toBe("completed");
      expect(execution.execution.adapterResults.find((result) => result.adapterId === "autonomous-docs-repo-discovery")?.ingestedCount).toBe(1);
      const index = await readOpenWorldSourceIndex(root);
      expect(index.entries.some((entry) => entry.uri.endsWith("/sdk") && entry.privacyClass === "openworld-public")).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
