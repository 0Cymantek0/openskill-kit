import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendEvent,
  applyPreferenceReview,
  extractSignals,
  initAdaptiveProject,
  readPreferenceGraph,
  updatePreferenceGraph
} from "../src/index.js";

describe("advanced preference review actions", () => {
  it("edits, merges, splits, promotes, demotes, and blocks disabled global promotion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-review-actions-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "review-actions" }), "utf8");
    await initAdaptiveProject({ projectRoot: root, now: new Date("2026-06-25T01:00:00.000Z") });
    await appendEvent(root, {
      sessionId: "review-actions",
      eventType: "user-prompt-submit",
      source: { adapter: "test" },
      normalized: { text: "Always run focused tests before final answer." }
    });
    await appendEvent(root, {
      sessionId: "review-actions",
      eventType: "user-prompt-submit",
      source: { adapter: "test" },
      normalized: { text: "Always run smoke before release." }
    });
    await extractSignals(root, new Date("2026-06-25T01:01:00.000Z"));
    const update = await updatePreferenceGraph(root, new Date("2026-06-25T01:02:00.000Z"));
    const candidates = update.graph.nodes.filter((node) => node.status === "candidate");
    expect(candidates.length).toBeGreaterThanOrEqual(2);

    const target = candidates[0]!;
    const source = candidates[1]!;
    const edited = await applyPreferenceReview(root, {
      edits: [{
        id: target.id,
        statement: "Prefer targeted regression tests before final answer",
        category: "testing",
        scope: { level: "path", paths: ["src/parser"] },
        confidence: 0.93
      }]
    }, new Date("2026-06-25T01:03:00.000Z"));
    const editedNode = edited.nodes.find((node) => node.id === target.id)!;
    expect(editedNode.statement).toContain("targeted regression tests");
    expect(editedNode.scope.paths).toEqual(["src/parser"]);
    expect(editedNode.confidence).toBe(0.93);

    const merged = await applyPreferenceReview(root, {
      merges: [{ targetId: target.id, sourceIds: [source.id], statement: "Prefer regression and smoke checks before release" }]
    }, new Date("2026-06-25T01:04:00.000Z"));
    expect(merged.nodes.find((node) => node.id === target.id)?.statement).toContain("regression and smoke");
    expect(merged.nodes.find((node) => node.id === source.id)?.status).toBe("rejected");

    const split = await applyPreferenceReview(root, {
      splits: [{
        id: target.id,
        statements: [
          "Prefer focused regression tests before final answer",
          "Prefer smoke checks before release"
        ]
      }]
    }, new Date("2026-06-25T01:05:00.000Z"));
    expect(split.nodes.find((node) => node.id === target.id)?.status).toBe("rejected");
    const child = split.nodes.find((node) => node.statement === "Prefer focused regression tests before final answer")!;
    expect(child.status).toBe("candidate");

    const promoted = await applyPreferenceReview(root, {
      activate: [child.id],
      promote: [child.id]
    }, new Date("2026-06-25T01:06:00.000Z"));
    const promotedNode = promoted.nodes.find((node) => node.id === child.id)!;
    expect(promotedNode.status).toBe("active");
    expect(promotedNode.scope.level).toBe("user");

    const demoted = await applyPreferenceReview(root, {
      demote: [child.id]
    }, new Date("2026-06-25T01:07:00.000Z"));
    expect(demoted.nodes.find((node) => node.id === child.id)?.status).toBe("candidate");
    const global = await applyPreferenceReview(root, { promoteGlobal: [child.id] });
    expect(global.nodes.find((node) => node.id === child.id)?.scope.level).toBe("global");

    const finalGraph = await readPreferenceGraph(root);
    expect(finalGraph.nodes.some((node) => node.status === "candidate")).toBe(true);
  });
});
