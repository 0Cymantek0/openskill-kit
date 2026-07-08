import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const tsxBin = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const cli = path.join(repoRoot, "packages", "cli", "src", "index.ts");
const opencodeBin = process.platform === "win32"
  ? path.join(repoRoot, "node_modules", "opencode-ai", "bin", "opencode.exe")
  : path.join(repoRoot, "node_modules", ".bin", "opencode");
const mcpDistBin = path.join(repoRoot, "dist", "openskill-kit-mcp.cjs");
const maybeIt = existsSync(opencodeBin) && existsSync(mcpDistBin) && canRunOpenCode(opencodeBin) ? it : it.skip;

describe("OpenCode CLI smoke", () => {
  maybeIt("loads generated OSK config, agents, and MCP server in real OpenCode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-opencode-cli-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "osk-opencode-home-"));
    const data = await mkdtemp(path.join(os.tmpdir(), "osk-opencode-data-"));
    const shimDir = await mkdtemp(path.join(os.tmpdir(), "osk-opencode-bin-"));
    await writeOpenSkillKitMcpShim(shimDir);
    await writeFile(path.join(root, "custom.ts"), "export default async function CustomPlugin() { return {}; }\n", "utf8");
    await writeFile(path.join(root, "opencode.json"), `${JSON.stringify({
      plugin: [["./custom.ts", { strict: true }]],
      share: "manual",
      mcp: {
        keep: { type: "local", command: ["keep-mcp"], enabled: false }
      }
    }, null, 2)}\n`, "utf8");
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: path.join(home, "AppData", "Roaming"),
      LOCALAPPDATA: data,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_DATA_HOME: path.join(home, ".local", "share"),
      PATH: [shimDir, path.join(repoRoot, "node_modules", ".bin"), process.env.PATH ?? ""].join(path.delimiter)
    };

    const setup = await execJson(process.execPath, [tsxBin, cli, "osk", "setup", "--non-interactive", "--yes", "--json"], root, env);
    expect(setup.status).toBe("installed");

    const verify = await execJson(process.execPath, [tsxBin, cli, "osk", "verify", "--json"], root, env);
    expect(verify.status).toBe("pass");
    expect(verify.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "opencode-config-schema:opencode.json", severity: "pass" })
    ]));

    const version = await execFileAsync(opencodeBin, ["--version"], { cwd: root, env, windowsHide: true, timeout: 30_000 });
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);

    const resolved = await execJson(opencodeBin, ["debug", "config", "--pure"], root, env);
    expect(resolved.plugin.some((item: unknown) => typeof item === "string" && item.endsWith("/.opencode/plugins/openskillkit.ts"))).toBe(true);
    expect(resolved.agent["osk-learner"].mode).toBe("subagent");
    expect(resolved.agent["osk-router"].mode).toBe("subagent");
    expect(resolved.mcp["openskill-kit"].command).toEqual(["openskill-kit-mcp"]);
    expect(resolved.mcp.keep.enabled).toBe(false);

    const agents = await execFileAsync(opencodeBin, ["agent", "list", "--pure"], { cwd: root, env, windowsHide: true, timeout: 30_000 });
    expect(agents.stdout.trim().length).toBeGreaterThan(0);

    const mcps = await execFileAsync(opencodeBin, ["mcp", "list", "--pure"], { cwd: root, env, windowsHide: true, timeout: 45_000 });
    expect(mcps.stdout).toContain("openskill-kit");
    expect(mcps.stdout).toContain("connected");
  }, 90_000);
});

async function execJson(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<any> {
  const { stdout } = await execFileAsync(command, args, { cwd, env, windowsHide: true, timeout: 45_000, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function canRunOpenCode(command: string): boolean {
  try {
    execFileSync(command, ["--version"], { windowsHide: true, timeout: 30_000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function writeOpenSkillKitMcpShim(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  if (process.platform === "win32") {
    await writeFile(path.join(dir, "openskill-kit-mcp.cmd"), [
      "@echo off",
      `node "${mcpDistBin}" %*`,
      ""
    ].join("\r\n"), "utf8");
    return;
  }
  const shim = path.join(dir, "openskill-kit-mcp");
  await writeFile(shim, [
    "#!/bin/sh",
    `exec node "${mcpDistBin}" "$@"`,
    ""
  ].join("\n"), "utf8");
  await chmod(shim, 0o755);
}
