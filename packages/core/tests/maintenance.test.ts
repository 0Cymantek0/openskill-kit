import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendEvent,
  archiveProjectState,
  applyLearnV2ConceptReview,
  compactProjectState,
  compileBehaviorLayer,
  explainAdaptiveStatus,
  extractSignals,
  initAdaptiveProject,
  mergeLearnV2ConceptCards,
  pruneProjectState,
  resetProjectState,
  runFullDoctor,
  updatePreferenceGraph,
  writeLearnV2ConceptStore,
  type LearnV2BehaviorAtom
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

    await writeFile(path.join(root, ".openskill-kit", "model-routing.json"), JSON.stringify({
      schemaVersion: "openskill-kit.model-routing.v1",
      routes: {
        learner: {
          permissionsProfile: "learner-sfae"
        }
      }
    }, null, 2), "utf8");

    const profileDoctor = await runFullDoctor(root);
    const profileCheck = profileDoctor.checks.find((item) => item.name === "Model routing");
    expect(profileDoctor.status).toBe("fail");
    expect(profileCheck?.status).toBe("fail");
    expect(profileCheck?.message).toContain("permissionsProfile");
  });

  it("warns when legacy graphs contain stale Learn v2-generated nodes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-maintenance-learn-v2-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "learn-v2-stale", now: new Date("2026-06-25T00:00:00.000Z") });
    const now = new Date("2026-06-25T00:01:00.000Z");
    const [concept] = mergeLearnV2ConceptCards([
      learnV2MaintenanceAtom("doctor_stale_graph", "Prefer focused parser regression tests for parser changes.", "positive")
    ], now);
    await writeLearnV2ConceptStore(root, [concept!], now);
    await applyLearnV2ConceptReview(root, {
      accept: [concept!.id],
      narrowScopes: [{ id: concept!.id, paths: ["packages/core/src/parser.ts"], taskTypes: ["parser-change"] }],
      now: new Date("2026-06-25T00:02:00.000Z")
    });
    const cleanDoctor = await runFullDoctor(root);
    const cleanCheck = cleanDoctor.checks.find((check) => check.name === "Learn v2 graph freshness");
    expect(cleanCheck?.status).toBe("pass");

    const storePath = path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json");
    const store = JSON.parse(await readFile(storePath, "utf8"));
    store.cards = store.cards.map((card: { id: string; status: string; lifecycle: { updatedAt: string } }) => card.id === concept!.id
      ? { ...card, status: "rejected", lifecycle: { ...card.lifecycle, updatedAt: "2026-06-25T00:03:00.000Z" } }
      : card);
    await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

    const staleDoctor = await runFullDoctor(root);
    const staleCheck = staleDoctor.checks.find((check) => check.name === "Learn v2 graph freshness");
    expect(staleDoctor.status).toBe("warn");
    expect(staleCheck?.status).toBe("warn");
    expect(staleCheck?.message).toContain(`pref_${concept!.id}`);
    expect(staleCheck?.message).toContain(`workflow_${concept!.id}`);
  });
});

function learnV2MaintenanceAtom(id: string, statement: string, polarity: LearnV2BehaviorAtom["polarity"]): LearnV2BehaviorAtom {
  return {
    schemaVersion: "openskill-kit.learn-v2.behavior-atom.v1",
    id,
    kind: "verification",
    statement,
    polarity,
    scope: {
      level: "path",
      paths: ["packages/core/src/parser.ts"],
      taskTypes: ["parser-change"]
    },
    confidence: 0.84,
    confidenceCap: 0.9,
    sourceReliability: 0.82,
    evidenceIds: [`ev_${id}_a`, `ev_${id}_b`],
    rawRefs: [`raw_${id}_a`, `raw_${id}_b`],
    rationale: "test fixture atom",
    risk: "low"
  };
}
