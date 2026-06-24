import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { diagnoseVerifierReport, forgeSkill, type VerifierReport } from "../src/index.js";

describe("evolution loop", () => {
  it("forges a deterministic skill and writes round artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-forge-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest --run" } }), "utf8");

    const run = await forgeSkill({
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
});
