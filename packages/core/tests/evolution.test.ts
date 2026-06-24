import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { diagnoseVerifierReport, draftSkill, evolveDraft, evolveSkill, type VerifierReport } from "../src/index.js";

describe("evolution loop", () => {
  it("evolves a deterministic skill and writes round artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-evolve-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest --run" } }), "utf8");

    const run = await evolveSkill({
      topic: "repo test workflow",
      projectRoot: root,
      noLlm: true,
      now: new Date("2026-06-24T00:00:00.000Z")
    });

    expect(run.status).toBe("frozen");
    expect(run.rounds[0]?.diagnosis.kind).toBe("pass");
    await expect(stat(run.artifacts.evolution)).resolves.toBeTruthy();
    await expect(stat(path.join(run.artifacts.roundsDir, "round-0.json"))).resolves.toBeTruthy();
    const round = JSON.parse(await readFile(path.join(run.artifacts.roundsDir, "round-0.json"), "utf8"));
    expect(round.reportPath).toContain("verifier.json");
  });

  it("diagnoses safety risk as manual review", () => {
    const report = {
      status: "fail",
      issues: [],
      safety: { status: "fail" },
      fixtureResults: []
    } as VerifierReport;

    expect(diagnoseVerifierReport(report).nextAction).toBe("manual-review");
  });

  it("repairs a broken draft across capped rounds", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-evolve-repair-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest --run" } }), "utf8");
    const draft = await draftSkill({
      topic: "repair generated skill",
      projectRoot: root,
      noLlm: true,
      now: new Date("2026-06-24T00:00:00.000Z")
    });
    const skillPath = path.join(draft.skillDir, "SKILL.md");
    const markdown = await readFile(skillPath, "utf8");
    await writeFile(skillPath, markdown.replace("## Verification checklist", "## Removed checklist"), "utf8");

    const run = await evolveDraft(draft, { topic: "repair generated skill", maxRounds: 3 });

    expect(run.status).toBe("frozen");
    expect(run.rounds).toHaveLength(2);
    expect(run.rounds[0]?.diagnosis.nextAction).toBe("refine-required");
    expect(run.rounds[0]?.repair?.status).toBe("applied");
    expect(run.rounds[1]?.diagnosis.kind).toBe("pass");
  });
});
