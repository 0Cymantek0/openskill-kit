import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendEvent,
  archiveProjectState,
  compactProjectState,
  compileBehaviorLayer,
  explainAdaptiveStatus,
  extractSignals,
  initAdaptiveProject,
  pruneProjectState,
  resetProjectState,
  runFullDoctor,
  updatePreferenceGraph
} from "../src/index.js";

describe("maintenance and full status", () => {
  it("explains status, runs full doctor, compacts, prunes, archives, and resets safely", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-maintenance-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "maintenance", now: new Date("2026-06-25T00:00:00.000Z") });
    const event = await appendEvent(root, {
      sessionId: "maintenance",
      eventType: "user-prompt-submit",
      source: { adapter: "test" },
      normalized: { text: "Always run focused tests before final response." }
    });
    await extractSignals(root, new Date("2026-06-25T00:01:00.000Z"));
    await updatePreferenceGraph(root, new Date("2026-06-25T00:02:00.000Z"));
    await compileBehaviorLayer(root);

    const explained = await explainAdaptiveStatus(root);
    expect(explained.schemaVersion).toBe("openskill-kit.status-explain.v1");
    expect(explained.nextActions.length).toBeGreaterThan(0);

    const doctor = await runFullDoctor(root);
    expect(doctor.checks.some((check) => check.name === "Adaptive initialized" && check.status === "pass")).toBe(true);

    const compact = await compactProjectState(root);
    expect(compact.status).toBe("done");
    await expect(stat(path.join(root, ".openskill-kit", "compact", "summary.json"))).resolves.toBeTruthy();

    const runOld = path.join(root, ".openskill-kit", "evals", "runs", "20260101T000000Z");
    const runNew = path.join(root, ".openskill-kit", "evals", "runs", "20260201T000000Z");
    await mkdir(runOld, { recursive: true });
    await mkdir(runNew, { recursive: true });
    const prunePlan = await pruneProjectState(root, { keepRuns: 1 });
    expect(prunePlan.status).toBe("planned");
    const pruned = await pruneProjectState(root, { keepRuns: 1, yes: true });
    expect(pruned.paths).toContain(runOld);
    await expect(stat(runNew)).resolves.toBeTruthy();

    const archivePlan = await archiveProjectState(root, { now: new Date("2026-06-25T00:03:00.000Z") });
    expect(archivePlan.status).toBe("planned");
    const archived = await archiveProjectState(root, { yes: true, now: new Date("2026-06-25T00:03:00.000Z") });
    expect(archived.status).toBe("done");
    await expect(stat(path.join(root, ".openskill-kit", "archive", "20260625T000300Z", "events"))).resolves.toBeTruthy();

    await mkdir(path.dirname(event.eventPath), { recursive: true });
    await writeFile(event.eventPath, "{}\n", "utf8");
    const resetPlan = await resetProjectState(root, ["events"]);
    expect(resetPlan.status).toBe("planned");
    const reset = await resetProjectState(root, ["events"], { yes: true });
    expect(reset.status).toBe("done");
    await expect(stat(path.join(root, ".openskill-kit", "events"))).rejects.toThrow();
  });

  it("reports invalid model routing through full doctor before compile/setup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-maintenance-routing-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "routing", now: new Date("2026-06-25T00:00:00.000Z") });
    await writeFile(path.join(root, ".openskill-kit", "model-routing.json"), JSON.stringify({
      schemaVersion: "openskill-kit.model-routing.v1",
      routes: {
        learner: {
          maxStep: 24
        }
      }
    }, null, 2), "utf8");

    const doctor = await runFullDoctor(root);
    const check = doctor.checks.find((item) => item.name === "Model routing");
    expect(doctor.status).toBe("fail");
    expect(check?.status).toBe("fail");
    expect(check?.message).toContain("routes.learner");
    expect(check?.message).toContain("maxStep");
  });
});
