import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const inspectorCli = path.join(repoRoot, "node_modules", "@modelcontextprotocol", "inspector", "cli", "build", "cli.js");
const mcpDistBin = path.join(repoRoot, "dist", "openskill-kit-mcp.cjs");
const maybeIt = existsSync(inspectorCli) && existsSync(mcpDistBin) ? it : it.skip;

describe("MCP Inspector CLI smoke", () => {
  maybeIt("lists facade tools and calls status through the built stdio server", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-inspector-cli-"));

    const listed = await inspector(["--method", "tools/list"], root);
    const toolNames = listed.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining([
      "osk_get_status",
      "osk_get_task_context",
      "osk_finish_task",
      "osk_compile_deploy",
      "osk_verify_behavior"
    ]));

    const status = await inspector([
      "--method", "tools/call",
      "--tool-name", "osk_get_status",
      "--tool-arg", `projectRoot=${root}`,
      "--tool-arg", "init=true"
    ], root);
    const result = status.structuredContent?.result ?? JSON.parse(status.content[0]?.text ?? "{}");
    expect(result.schemaVersion).toBe("openskill-kit.status-facade.v1");
    expect(result.status.initialized).toBe(true);
    expect(result.plugin.ready).toBe(false);

    await expectInspectorMethodNotFound(["--method", "resources/list"], root);
    await expectInspectorMethodNotFound(["--method", "prompts/list"], root);
  }, 60_000);
});

async function inspector(args: string[], cwd: string): Promise<any> {
  const { stdout } = await execFileAsync(process.execPath, [
    inspectorCli,
    "--cli",
    process.execPath,
    mcpDistBin,
    ...args
  ], {
    cwd,
    windowsHide: true,
    timeout: 45_000,
    maxBuffer: 16 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

async function expectInspectorMethodNotFound(args: string[], cwd: string): Promise<void> {
  const result = await execFileAsync(process.execPath, [
    inspectorCli,
    "--cli",
    process.execPath,
    mcpDistBin,
    ...args
  ], {
    cwd,
    windowsHide: true,
    timeout: 45_000
  }).catch((error: Error & { code?: number; stdout?: string; stderr?: string }) => error);
  expect(result).toMatchObject({ code: 1 });
  expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).toContain("Method not found");
}
