import { describe, expect, it } from "vitest";
import { AnchorCardSchema, OpenWorldTaskSchema, SkillPlanSchema, VirtualTestSuiteSchema } from "../src/index.js";

describe("OpenWorld schemas", () => {
  it("validates task, anchor, verifier, and skill-plan artifacts", () => {
    const task = OpenWorldTaskSchema.parse({
      schemaVersion: "openskill-kit.openworld-task.v1",
      id: "owtask_schema",
      title: "Schema task",
      prompt: "Build a local verifier from project docs.",
      createdAt: "2026-06-26T00:00:00.000Z",
      forbiddenIdentifiers: ["hidden-case-7"],
      forbiddenPaths: ["hidden/oracle.json"]
    });
    expect(task.allowWeb).toBe(false);
    expect(task.privacyClass).toBe("project-private");

    const anchor = AnchorCardSchema.parse({
      schemaVersion: "openskill-kit.anchor-card.v1",
      id: "anc_schema",
      taskId: task.id,
      sourceId: "src_schema",
      claim: "The status command can emit JSON.",
      anchorType: "api-behavior",
      verifiableAs: ["json-schema"],
      confidence: 0.82,
      createdAt: "2026-06-26T00:01:00.000Z"
    });
    expect(anchor.usableFor).toEqual(["skill", "virtual-test"]);

    const suite = VirtualTestSuiteSchema.parse({
      schemaVersion: "openskill-kit.virtual-test-suite.v1",
      id: "vts_schema",
      taskId: task.id,
      createdAt: "2026-06-26T00:02:00.000Z",
      generatedFromAnchorIds: [anchor.id],
      cases: [{
        id: "case_schema",
        anchorIds: [anchor.id],
        runner: "vitest",
        split: "visible",
        name: "status emits JSON",
        description: "Validate JSON output contract.",
        assertions: ["stdout parses as JSON"]
      }]
    });
    expect(suite.cases[0]?.status).toBe("draft");

    const plan = SkillPlanSchema.parse({
      schemaVersion: "openskill-kit.skill-plan.v1",
      id: "skp_schema",
      taskId: task.id,
      createdAt: "2026-06-26T00:03:00.000Z",
      objective: "Create a verifier-first skill.",
      anchorIds: [anchor.id]
    });
    expect(plan.maxRefinementRounds).toBe(3);
  });
});
