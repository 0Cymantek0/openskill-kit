import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { draftSkill, evaluateSkill } from "../src/index.js";

describe("evaluation harness", () => {
  it("writes leakage-aware verifier evaluation artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-evaluation-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: {
        "verify:repo": "node -e \"console.log('evaluation repo check ok')\""
      }
    }), "utf8");

    const draft = await draftSkill({
      topic: "evaluation harness skill",
      projectRoot: root,
      noLlm: true,
      now: new Date("2026-06-24T00:00:00.000Z")
    });
    const report = await evaluateSkill(draft.skillDir, { runRepoChecks: true });

    expect(report.status).toBe("pass");
    expect(report.verifierStatus).toBe("pass");
    expect(report.leakageStatus).toBe("pass");
    expect(report.metrics.commandsExecuted).toBe(1);
    expect(report.metrics.mutationsKilled).toBe(1);
    expect(report.gates.every((gate) => gate.status === "pass")).toBe(true);
    await expect(stat(report.artifacts.evaluation)).resolves.toBeTruthy();
    await expect(stat(report.artifacts.markdown)).resolves.toBeTruthy();
    expect(await readFile(report.artifacts.markdown, "utf8")).toContain("# OpenSkill Evaluation");
  });
});
