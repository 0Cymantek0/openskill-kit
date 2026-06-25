import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendEvent,
  applyPreferenceReview,
  compileBehaviorLayer,
  extractSignals,
  initAdaptiveProject,
  updatePreferenceGraph
} from "../src/index.js";

describe("acceptance learning scenarios", () => {
  it("learns negative, scoped edit, and repeated command-policy candidates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-acceptance-learning-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "acceptance-learning" }), "utf8");
    await initAdaptiveProject({ projectRoot: root, now: new Date("2026-06-25T03:00:00.000Z") });

    await appendEvent(root, {
      sessionId: "acceptance",
      eventType: "user-rejected",
      source: { adapter: "test" },
      normalized: { text: "Rejected broad rewrite because it ignored existing parser boundaries." }
    });
    await appendEvent(root, {
      sessionId: "acceptance",
      eventType: "user-edited",
      source: { adapter: "test" },
      files: [{ path: "src/parser/tokenizer.ts", action: "edit" }],
      normalized: { text: "User restored small parser helpers and local tests." }
    });
    for (const id of ["cmd-1", "cmd-2"]) {
      await appendEvent(root, {
        sessionId: "acceptance",
        eventType: "post-tool-use",
        source: { adapter: "test" },
        id,
        commands: [{ command: "npm", args: ["test", "--", "parser"], status: "pass", exitCode: 0 }]
      });
    }

    const signals = await extractSignals(root, new Date("2026-06-25T03:01:00.000Z"));
    expect(signals.signals.some((signal) => signal.polarity === "negative" && signal.statement.startsWith("Do not repeat rejected"))).toBe(true);
    expect(signals.signals.some((signal) => signal.kind === "edit-delta" && signal.scope.paths.includes("src/parser/tokenizer.ts"))).toBe(true);
    expect(signals.signals.some((signal) => signal.category === "command-policy" && signal.statement.includes("npm test -- parser"))).toBe(true);

    const graph = await updatePreferenceGraph(root, new Date("2026-06-25T03:02:00.000Z"));
    expect(graph.graph.nodes.some((node) => node.polarity === "negative" && node.status === "candidate")).toBe(true);
    const scoped = graph.graph.nodes.find((node) => node.statement.includes("user-edited patterns"))!;
    expect(scoped.scope.paths).toEqual(["src/parser/tokenizer.ts"]);
    expect(graph.graph.nodes.some((node) => node.category === "command-policy" && node.status === "candidate")).toBe(true);

    await applyPreferenceReview(root, { activateAll: true }, new Date("2026-06-25T03:03:00.000Z"));
    const compiled = await compileBehaviorLayer(root);
    const commandPolicy = await readFile(compiled.policyArtifactPaths.find((file) => file.endsWith("command-policy.md"))!, "utf8");
    expect(commandPolicy).toContain("Prefer repeated successful command: npm test -- parser");
  });
});
