import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendEvent,
  buildReviewQueue,
  initAdaptiveProject,
  mineWorkflowGraph,
  readWorkflowGraph,
  renderWorkflowGraph
} from "../src/index.js";

describe("Workflow Graph mining", () => {
  it("mines repeated passing command sequences into review-safe candidates", async () => {
    const root = await tempProject();
    await recordWorkflowSession(root, "session-a", "2026-06-27T01:00:00.000Z");
    await recordWorkflowSession(root, "session-b", "2026-06-27T02:00:00.000Z");

    const result = await mineWorkflowGraph({
      projectRoot: root,
      now: new Date("2026-06-27T03:00:00.000Z")
    });

    expect(result.mined).toHaveLength(1);
    expect(result.updated[0]?.status).toBe("candidate");
    expect(result.updated[0]?.trigger.commands).toEqual(["npm test", "npm run typecheck"]);
    expect(result.updated[0]?.steps.map((step) => step.kind)).toEqual(["command", "command", "summarize"]);
    expect(result.updated[0]?.sourceSignalIds).toHaveLength(4);
    expect(result.evidencePaths).toHaveLength(1);
    const evidence = JSON.parse(await readFile(result.evidencePaths[0]!, "utf8"));
    expect(evidence.occurrences).toHaveLength(2);
    expect(evidence.occurrences[0].eventIds).toHaveLength(2);

    const graph = await readWorkflowGraph(root, result.graph.projectId, new Date("2026-06-27T03:01:00.000Z"));
    expect(graph.nodes[0]?.id).toBe(result.updated[0]?.id);
    expect(renderWorkflowGraph(graph)).toContain("npm test -> npm run typecheck");
    const queue = await buildReviewQueue(root);
    expect(queue.workflowCandidateCount).toBe(1);
    expect(queue.candidateCount).toBe(1);
    expect(queue.workflowCandidates[0]?.id).toBe(result.updated[0]?.id);
    expect(await readFile(queue.markdownPath, "utf8")).toContain("## Workflow Candidates");
  });

  it("stages high-confidence workflow candidates only when auto-stage is enabled", async () => {
    const root = await tempProject();
    const configPath = path.join(root, ".openskill-kit", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.learning.mode = "auto-stage";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await recordWorkflowSession(root, "session-a", "2026-06-27T01:00:00.000Z");
    await recordWorkflowSession(root, "session-b", "2026-06-27T02:00:00.000Z");

    const result = await mineWorkflowGraph({
      projectRoot: root,
      now: new Date("2026-06-27T03:00:00.000Z")
    });

    expect(result.updated[0]?.status).toBe("staged");
    expect(result.messages.join(" ")).toContain("candidate/staged");
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "osk-workflow-"));
  await initAdaptiveProject({ projectRoot: root, projectName: "workflow", now: new Date("2026-06-27T00:00:00.000Z") });
  return root;
}

async function recordWorkflowSession(root: string, sessionId: string, start: string): Promise<void> {
  const first = new Date(start);
  const second = new Date(first.getTime() + 60_000);
  await appendEvent(root, {
    sessionId,
    timestamp: first.toISOString(),
    eventType: "post-tool-use",
    source: { adapter: "test" },
    intent: "run focused tests",
    files: [{ path: "packages/core/src/workflows/miner.ts", action: "edit" }],
    commands: [{ command: "npm", args: ["test"], status: "pass", exitCode: 0 }]
  });
  await appendEvent(root, {
    sessionId,
    timestamp: second.toISOString(),
    eventType: "post-tool-use",
    source: { adapter: "test" },
    intent: "run typecheck after tests",
    files: [{ path: "packages/core/src/workflows/miner.ts", action: "edit" }],
    commands: [{ command: "npm", args: ["run", "typecheck"], status: "pass", exitCode: 0 }]
  });
}
