import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildVirtualSuiteFromAnchors,
  draftAnchorFromOpenWorldSource,
  ingestLocalOpenWorldSource,
  ingestWebOpenWorldSource,
  initOpenWorldTask,
  readOpenWorldSourceContent,
  readOpenWorldSourceIndex,
  readOpenWorldTrustCache,
  runVirtualTestSuite
} from "../src/index.js";

describe("OpenWorld local research", () => {
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

    await writeFile(path.join(root, source.source.cachePath ?? ""), "Tampered cache text.\n", "utf8");
    const failed = await runVirtualTestSuite(root, task.task.id, suite.suite.id, {
      split: "visible",
      now: new Date("2026-06-26T01:05:00.000Z")
    });
    expect(failed.summary.fail).toBeGreaterThan(0);
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
});
