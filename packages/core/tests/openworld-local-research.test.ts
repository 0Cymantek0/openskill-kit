import { describe, expect, it } from "vitest";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildVirtualSuiteFromAnchors,
  draftAnchorFromOpenWorldSource,
  ingestLocalOpenWorldSource,
  initOpenWorldTask,
  readOpenWorldSourceContent
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
    expect(source.audit.status).toBe("pass");
    expect(await readOpenWorldSourceContent(root, task.task.id, source.source.id)).toContain("local-only retrieval");

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
});
