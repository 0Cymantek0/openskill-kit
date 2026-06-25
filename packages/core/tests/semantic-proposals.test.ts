import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendEvent,
  buildReviewQueue,
  extractSignals,
  initAdaptiveProject,
  proposeSemanticPreference,
  updatePreferenceGraph
} from "../src/index.js";

describe("semantic preference proposals", () => {
  it("stores redacted host-agent proposals and turns them into reviewable candidates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-semantic-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "semantic", now: new Date("2026-06-25T00:00:00.000Z") });
    const secret = ["semantic", "secret"].join("-");
    const event = await appendEvent(root, {
      sessionId: "semantic-session",
      eventType: "review-comment",
      source: { adapter: "test" },
      normalized: { text: "Reviewer asked to keep parser dependency-light." },
      files: [{ path: "src/parser/index.ts", action: "edit" }]
    });

    const proposed = await proposeSemanticPreference(root, {
      schemaVersion: "openskill-kit.semantic-proposal.v1",
      sessionId: "semantic-session",
      statement: `Prefer parser modules stay dependency-light TOKEN=${secret}`,
      category: "architecture",
      scope: { level: "directory", paths: ["src/parser"] },
      evidence: [{ eventId: event.event.id, quote: `Keep parser light TOKEN=${secret}`, file: "src/parser/index.ts" }],
      counterevidence: [{ eventId: "older-session", reason: "Past generated utility added a dependency" }],
      confidence: 0.91,
      risk: "medium",
      suggestedCompileTargets: ["context-pack", "path-map", "review-checklist"]
    }, new Date("2026-06-25T00:01:00.000Z"));
    expect(proposed.proposal.privacy.matches).toContain("secret-assignment");
    expect(JSON.stringify(proposed)).not.toContain(secret);

    const signals = await extractSignals(root, new Date("2026-06-25T00:02:00.000Z"));
    expect(signals.signals.some((signal) => signal.kind === "semantic-proposal" && signal.statement.includes("dependency-light"))).toBe(true);

    const graph = await updatePreferenceGraph(root, new Date("2026-06-25T00:03:00.000Z"));
    expect(graph.graph.nodes.some((node) => node.status === "candidate" && node.statement.includes("dependency-light"))).toBe(true);

    const queue = await buildReviewQueue(root);
    await expect(stat(queue.markdownPath)).resolves.toBeTruthy();
    const markdown = await readFile(queue.markdownPath, "utf8");
    expect(markdown).toContain("Semantic Proposals");
    expect(markdown).toContain("Counterevidence");
    expect(markdown).toContain("Risk: medium");
  });
});
