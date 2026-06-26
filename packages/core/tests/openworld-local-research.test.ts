import { describe, expect, it } from "vitest";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
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
  readOpenWorldTrustCache
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

    const anchor = await draftAnchorFromOpenWorldSource(root, task.task.id, source.source.id, undefined, new Date("2026-06-26T01:02:00.000Z"));
    expect(anchor.anchor.claim).toContain("local-only retrieval");
    await expect(stat(anchor.anchorPath)).resolves.toBeTruthy();

    const suite = await buildVirtualSuiteFromAnchors(root, task.task.id, [anchor.anchor], new Date("2026-06-26T01:03:00.000Z"));
    expect(suite.suite.cases).toHaveLength(1);
    expect(suite.suite.cases[0]?.split).toBe("visible");
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
