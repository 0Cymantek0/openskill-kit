import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendEvent,
  applyPreferenceReview,
  compileBehaviorLayer,
  extractSignals,
  initAdaptiveProject,
  installAgentHooks,
  runAgentDoctor,
  runLifecycleOnce,
  updatePreferenceGraph
} from "../src/index.js";

describe("autonomous lifecycle runner and agent hooks", () => {
  it("summarizes high-value sessions and stages learned candidates", async () => {
    const root = await tempProject();
    await appendEvent(root, {
      sessionId: "session-a",
      eventType: "user-rejected",
      source: { adapter: "test" },
      normalized: { text: "Never skip focused tests after changing parser files." }
    });
    await appendEvent(root, {
      sessionId: "session-a",
      eventType: "user-edited",
      source: { adapter: "test" },
      files: [{ path: "src/parser.ts", action: "edit" }],
      normalized: { diff: "user adjusted parser style" }
    });
    await appendEvent(root, {
      sessionId: "session-a",
      eventType: "post-tool-use",
      source: { adapter: "test" },
      commands: [{ command: "npm", args: ["test"], status: "pass" }],
      normalized: { tool: "shell" }
    });

    const result = await runLifecycleOnce({ projectRoot: root, now: new Date("2026-06-25T01:00:00.000Z") });
    expect(result.processedEventCount).toBe(3);
    expect(result.highValueEvents.flatMap((event) => event.reasons)).toEqual(expect.arrayContaining(["user-rejection", "manual-edit", "successful-command"]));
    expect(result.graph.candidateCount).toBeGreaterThan(0);
    expect(result.signals.signals.some((signal) => signal.polarity === "negative" && signal.statement.includes("skip focused tests"))).toBe(true);
    expect(result.signals.signals.some((signal) => signal.statement.includes("Use command recipe: npm test"))).toBe(true);
    const summary = JSON.parse(await readFile(result.summaryPaths[0]!, "utf8"));
    expect(summary.highValueReasons["manual-edit"]).toBe(1);
    expect(summary.files).toContain("src/parser.ts");
    await stat(path.join(root, ".openskill-kit", "runtime", "last-run.json"));
  });

  it("detects and installs generated agent hook config", async () => {
    const root = await tempProject();
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "agent-fixture" }), "utf8");
    await appendEvent(root, {
      sessionId: "agent-hooks",
      eventType: "user-prompt-submit",
      source: { adapter: "test" },
      normalized: { text: "Always run npm test before final response." }
    });
    await extractSignals(root, new Date("2026-06-25T01:00:00.000Z"));
    await updatePreferenceGraph(root, new Date("2026-06-25T01:01:00.000Z"));
    await applyPreferenceReview(root, { activateAll: true }, new Date("2026-06-25T01:02:00.000Z"));
    await compileBehaviorLayer(root);

    const doctor = await runAgentDoctor(root);
    expect(doctor.status).not.toBe("fail");
    expect(doctor.checks.some((check) => check.name === "Compiled hook config" && check.status === "pass")).toBe(true);

    const planned = await installAgentHooks({ projectRoot: root, target: "project", dryRun: true });
    expect(planned.status).toBe("planned");
    await expect(stat(path.join(root, ".agents", "hooks", "openskill-kit.json"))).rejects.toThrow();

    const installed = await installAgentHooks({ projectRoot: root, target: "project", yes: true });
    expect(installed.status).toBe("installed");
    const config = JSON.parse(await readFile(installed.configPath, "utf8"));
    expect(config.hooks.length).toBeGreaterThan(0);
    expect(config.hooks[0].cwd).toBe(root);
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "osk-lifecycle-"));
  await initAdaptiveProject({ projectRoot: root, projectName: "lifecycle", now: new Date("2026-06-25T00:00:00.000Z") });
  return root;
}
