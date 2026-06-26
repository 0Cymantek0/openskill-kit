import { describe, expect, it } from "vitest";
import { mkdtemp, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { runOpenWorldPython } from "../src/index.js";

const execFileAsync = promisify(execFile);

describe("OpenWorld Python runner", () => {
  it("executes the Python scaffold without a shell and returns JSON", async () => {
    await expectPython();
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-openworld-python-"));
    const result = await runOpenWorldPython({
      projectRoot: root,
      args: [
        "plan-task",
        "--title", "Bridge task",
        "--prompt", "Build local anchors only.",
        "--forbidden-identifier", "hidden-case"
      ],
      timeoutMs: 30000
    });
    const payload = result.result as { task?: { id?: string }; paths?: { task?: string }; audit?: { status?: string } };
    expect(payload.task?.id).toMatch(/^owtask_/);
    expect(payload.audit?.status).toBe("pass");
    await expect(stat(payload.paths?.task ?? "")).resolves.toBeTruthy();
    expect(path.resolve(payload.paths?.task ?? "").toLowerCase()).toContain("osk-openworld-python-");
  });

  it("surfaces leakage blocks as runner failures", async () => {
    await expectPython();
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-openworld-python-leak-"));
    await expect(runOpenWorldPython({
      projectRoot: root,
      args: [
        "plan-task",
        "--title", "Leakage task",
        "--prompt", "Use hidden-case target answer.",
        "--forbidden-identifier", "hidden-case"
      ],
      timeoutMs: 30000
    })).rejects.toThrow();
  });
});

async function expectPython(): Promise<void> {
  try {
    await execFileAsync("python", ["--version"], { timeout: 5000, windowsHide: true });
  } catch {
    throw new Error("Python is required for this test");
  }
}
