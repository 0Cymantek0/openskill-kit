import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import {
  buildVirtualSuiteFromAnchors,
  buildOpenWorldEvalReport,
  buildOpenWorldTaskReport,
  buildReviewQueue,
  draftAnchorFromOpenWorldSource,
  ingestLocalOpenWorldSource,
  ingestWebOpenWorldSource,
  initOpenWorldTask,
  planOpenWorldResearch,
  readOpenWorldSourceContent,
  readOpenWorldSourceIndex,
  readOpenWorldTrustCache,
  promoteOpenWorldRunToReview,
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

    const suite = await buildVirtualSuiteFromAnchors(root, task.task.id, anchors, new Date("2026-06-26T01:03:00.000Z"));
    expect(suite.suite.cases).toHaveLength(4);
    expect(suite.suite.cases[0]?.split).toBe("visible");
    expect(suite.suite.cases.some((testCase) => testCase.split === "holdout")).toBe(true);
    expect(suite.suite.cases.every((testCase) => testCase.runner === "node" && testCase.status === "ready" && testCase.file && testCase.command[0] === "node")).toBe(true);
    await expect(stat(suite.manifestPath)).resolves.toBeTruthy();
    await expect(stat(suite.traceabilityMapPath)).resolves.toBeTruthy();
    expect(JSON.parse(await readFile(suite.manifestPath, "utf8")).holdout).toHaveLength(1);

    const execution = await runVirtualTestSuite(root, task.task.id, suite.suite.id, {
      split: "all",
      now: new Date("2026-06-26T01:04:00.000Z")
    });
    expect(execution.summary).toMatchObject({ pass: 4, fail: 0, blocked: 0, timeout: 0, skipped: 0 });
    expect(execution.resultPath).toContain("/results/");

    const refined = await runOpenWorldRefinement(root, task.task.id, suite.suite.id, {
      now: new Date("2026-06-26T01:04:30.000Z")
    });
    expect(refined.status).toBe("passed");
    expect(refined.rounds.map((round) => round.split)).toEqual(["visible", "holdout"]);
    expect(refined.sourceIds).toContain(source.source.id);
    const report = await buildOpenWorldEvalReport(root, refined.id, new Date("2026-06-26T01:04:45.000Z"));
    expect(report.report.proofLevel).toBe("artifact-verifier");
    expect(report.report.hiddenOracleProof).toBe(false);
    expect(report.report.metrics.visiblePassRate).toBe(1);
    expect(report.report.metrics.holdoutPassRate).toBe(1);
    expect(await readFile(report.markdownPath, "utf8")).toContain("Hidden-oracle proof: no");
    const taskReport = await buildOpenWorldTaskReport(root, task.task.id, { write: true });
    expect(taskReport.markdownPath).toContain("task-report.md");
    expect(taskReport.sources).toHaveLength(1);
    expect(taskReport.anchors).toHaveLength(4);
    expect(taskReport.suites).toHaveLength(1);
    expect(taskReport.executions.length).toBeGreaterThan(0);
    expect(taskReport.runs.some((run) => run.id === refined.id)).toBe(true);
    expect(taskReport.evalReports.some((evalReport) => evalReport.runId === refined.id)).toBe(true);
    expect(taskReport.markdown).toContain("## Next Actions");
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
      now: new Date("2026-06-26T01:06:00.000Z")
    });
    expect(failedRefinement.status).toBe("failed");
    expect(failedRefinement.rounds[0]?.failureType).toBe("source-conflict");
    await expect(promoteOpenWorldRunToReview(root, failedRefinement.id)).rejects.toThrow(/only passed runs/);
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
});
