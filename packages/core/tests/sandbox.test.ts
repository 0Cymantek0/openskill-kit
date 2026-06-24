import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDockerSandboxPolicy, createLocalSandboxPolicy, runSandboxCommand } from "../src/index.js";

describe("local sandbox runner", () => {
  it("runs allowed commands without shell expansion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-sandbox-"));
    const policy = createLocalSandboxPolicy({
      projectRoot: root,
      allowedCommands: [process.execPath],
      timeoutMs: 5000
    });

    const result = await runSandboxCommand(policy, {
      command: process.execPath,
      args: ["-e", "console.log('ok')"],
      cwd: root
    });

    expect(result.status).toBe("pass");
    expect(result.stdout.trim()).toBe("ok");
    expect(result.cwd).toBe(".");
  });

  it("blocks cwd escape and disallowed commands", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-sandbox-"));
    const policy = createLocalSandboxPolicy({ projectRoot: root, allowedCommands: ["node"] });

    const cwdEscape = await runSandboxCommand(policy, {
      command: "node",
      args: ["--version"],
      cwd: path.dirname(root)
    });
    expect(cwdEscape.status).toBe("blocked");
    expect(cwdEscape.blockedReason).toContain("cwd");

    const badCommand = await runSandboxCommand(policy, {
      command: "git",
      args: ["--version"],
      cwd: root
    });
    expect(badCommand.status).toBe("blocked");
    expect(badCommand.blockedReason).toContain("command not allowed");
  });

  it("does not allow path-qualified commands by basename alone", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-sandbox-"));
    const policy = createLocalSandboxPolicy({ projectRoot: root, allowedCommands: ["node"] });

    const result = await runSandboxCommand(policy, {
      command: path.join(root, "node"),
      args: ["--version"],
      cwd: root
    });

    expect(result.status).toBe("blocked");
    expect(result.blockedReason).toContain("command not allowed");
  });

  it("supports docker sandbox policy while preserving command allowlist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-sandbox-"));
    const policy = createDockerSandboxPolicy({
      projectRoot: root,
      image: "node:20-alpine",
      allowedCommands: ["node"]
    });

    expect(policy.mode).toBe("docker");
    expect(policy.allowNetwork).toBe(false);
    expect(policy.dockerImage).toBe("node:20-alpine");

    const badCommand = await runSandboxCommand(policy, {
      command: "git",
      args: ["--version"],
      cwd: root
    });
    expect(badCommand.status).toBe("blocked");
    expect(badCommand.blockedReason).toContain("command not allowed");
  });

  it("blocks shell metacharacters and strips secret env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-sandbox-"));
    const policy = createLocalSandboxPolicy({
      projectRoot: root,
      allowedCommands: [process.execPath]
    });

    const blocked = await runSandboxCommand(policy, {
      command: process.execPath,
      args: ["-e", "console.log('ok');"],
      cwd: root
    });
    expect(blocked.status).toBe("blocked");

    const envResult = await runSandboxCommand(policy, {
      command: process.execPath,
      args: ["-e", "console.log(process.env.MY_SECRET_TOKEN ?? 'missing')"],
      cwd: root,
      env: { MY_SECRET_TOKEN: "leak" }
    });
    expect(envResult.status).toBe("pass");
    expect(envResult.stdout.trim()).toBe("missing");
  });
});
