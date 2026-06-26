import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  initOpenWorldTask,
  makeOpenWorldSource,
  readOpenWorldSource,
  readOpenWorldTask,
  writeAnchorCard,
  writeOpenWorldSource
} from "../src/index.js";

describe("OpenWorld store", () => {
  it("writes artifacts only under .openskill-kit/openworld", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-openworld-store-"));
    const record = await initOpenWorldTask(root, {
      title: "Local OpenWorld task",
      prompt: "Create anchors from local docs.",
      forbiddenIdentifiers: ["hidden-answer"],
      forbiddenPaths: ["hidden/oracle.txt"],
      now: new Date("2026-06-26T00:00:00.000Z")
    });
    await expect(stat(record.taskPath)).resolves.toBeTruthy();
    expect(record.taskPath).toContain(path.join(".openskill-kit", "openworld", "tasks"));

    const source = makeOpenWorldSource({
      id: "src_local_doc",
      taskId: record.task.id,
      kind: "local-doc",
      uri: "docs/architecture.md",
      title: "Architecture",
      content: "OpenWorld anchors must stay local-first.",
      privacyClass: "project-private"
    });
    const sourcePath = await writeOpenWorldSource(root, source);
    const readBack = await readOpenWorldSource(root, record.task.id, source.id);
    expect(readBack.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(sourcePath, "utf8")).toContain("src_local_doc");

    const anchorPath = await writeAnchorCard(root, {
      schemaVersion: "openskill-kit.anchor-card.v1",
      id: "anc_local_doc",
      taskId: record.task.id,
      sourceId: source.id,
      claim: "OpenWorld anchors must stay local-first.",
      anchorType: "constraint",
      verifiableAs: ["manual-review"],
      confidence: 0.8,
      createdAt: "2026-06-26T00:01:00.000Z"
    });
    await expect(stat(anchorPath)).resolves.toBeTruthy();

    const task = await readOpenWorldTask(root, record.task.id);
    expect(task.forbiddenIdentifiers).toEqual(["hidden-answer"]);
  });
});
