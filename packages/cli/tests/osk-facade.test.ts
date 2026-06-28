import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const tsxBin = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const cli = path.join(repoRoot, "packages", "cli", "src", "index.ts");

describe("osk CLI facade", () => {
  it("prints the public command-family help contract", async () => {
    const { stdout } = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "help", "--json"], { cwd: repoRoot, windowsHide: true });
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe("openskill-kit.osk-help.v1");
    expect(parsed.commands).toHaveLength(12);
    expect(parsed.commands.some((item: { publicCommand: string }) => item.publicCommand === "/osk learn")).toBe(true);
  });

  it("plans /osk learn without applying imports", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-learn-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    const { stdout } = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "learn", "--json"], { cwd: root, windowsHide: true });
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe("openskill-kit.learn-source-plan.v1");
    expect(parsed.defaults.previewOnly).toBe(true);
    expect(parsed.privacyPreview.join(" ")).toContain("No raw prompts");
  });

  it("prompts for /osk learn sources in interactive terminal mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-learn-picker-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    const result = await runCliWithInput(["osk", "learn"], "\n", root, { OPENSKILLKIT_FORCE_INTERACTIVE: "1" });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("What should OpenSkillKit learn from?");
    expect(result.stdout).toContain("current-session");
    expect(result.stdout).toContain("git-local");
    expect(result.stdout).toContain("Sources used: 2");
    expect(result.stdout).toContain("Events appended: 0");
    expect(result.stdout).toContain("Preview complete");
  });

  it("prints failing full doctor checks in human output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-doctor-routing-"));
    await execFileAsync(process.execPath, [tsxBin, cli, "init", "--json"], { cwd: root, windowsHide: true });
    await writeFile(path.join(root, ".openskill-kit", "model-routing.json"), JSON.stringify({
      schemaVersion: "openskill-kit.model-routing.v1",
      routes: {
        learner: {
          maxStep: 24
        }
      }
    }, null, 2), "utf8");

    const result = await execFileAsync(process.execPath, [tsxBin, cli, "doctor", "--full"], { cwd: root, windowsHide: true }).catch((error: Error & { stdout?: string; stderr?: string; code?: number }) => error);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Doctor fail:");
    expect(result.stdout).toContain("FAIL Model routing:");
    expect(result.stdout).toContain("maxStep");
  });


  it("previews setup without attaching unless approved", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-setup-preview-"));
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({ plugin: ["./custom.ts"], keep: true }, null, 2), "utf8");

    const { stdout } = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "setup", "--non-interactive", "--json"], { cwd: root, windowsHide: true });
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe("openskill-kit.setup-wizard.v1");
    expect(parsed.status).toBe("planned");
    expect(parsed.applied).toBe(false);
    expect(parsed.plannedFiles).toBeGreaterThan(0);
    await expect(stat(path.join(root, ".openskill-kit", "compiled", "plugin", "plugin.json"))).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).rejects.toThrow();
    const config = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8"));
    expect(config.plugin).toEqual(["./custom.ts"]);
  });

  it("applies setup and safely previews/applies uninstall", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-setup-apply-"));
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({ plugin: ["./custom.ts"], keep: true }, null, 2), "utf8");

    const setup = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "setup", "--non-interactive", "--yes", "--skip-hooks", "--skip-manifests", "--json"], { cwd: root, windowsHide: true });
    const setupParsed = JSON.parse(setup.stdout);
    expect(setupParsed.status).toBe("installed");
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".opencode", "skills", "osk-learning", "SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".opencode", "plugins", "openskillkit.ts"))).resolves.toBeTruthy();
    await mkdir(path.join(root, ".opencode", "skills", "osk-custom"), { recursive: true });
    await writeFile(path.join(root, ".opencode", "commands", "osk-custom.md"), "user command\n", "utf8");
    await writeFile(path.join(root, ".opencode", "agents", "osk-custom.md"), "user agent\n", "utf8");
    await writeFile(path.join(root, ".opencode", "skills", "osk-custom", "SKILL.md"), "user skill\n", "utf8");
    let config = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8"));
    expect(config.plugin).toEqual(["./custom.ts", ".opencode/plugins/openskillkit.ts"]);
    expect(config.mcp["openskill-kit"].command).toEqual(["openskill-kit-mcp"]);

    const preview = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "uninstall", "--non-interactive", "--dry-run", "--json"], { cwd: root, windowsHide: true });
    const previewParsed = JSON.parse(preview.stdout);
    expect(previewParsed.status).toBe("planned");
    expect(previewParsed.planned).toEqual(expect.arrayContaining([".opencode/commands/osk-learn.md", ".opencode/skills/osk-learning"]));
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).resolves.toBeTruthy();

    const uninstalled = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "uninstall", "--non-interactive", "--yes", "--json"], { cwd: root, windowsHide: true });
    const uninstallParsed = JSON.parse(uninstalled.stdout);
    expect(uninstallParsed.status).toBe("uninstalled");
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).rejects.toThrow();
    await expect(stat(path.join(root, ".opencode", "skills", "osk-learning"))).rejects.toThrow();
    await expect(stat(path.join(root, ".opencode", "commands", "osk-custom.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".opencode", "agents", "osk-custom.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".opencode", "skills", "osk-custom", "SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".openskill-kit", "config.json"))).resolves.toBeTruthy();
    config = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8"));
    expect(config.plugin).toEqual(["./custom.ts"]);
    expect(config.mcp).toBeUndefined();
  });

  it("blocks OpenCode setup and uninstall facade when a different host is requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-host-block-"));
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({ plugin: ["./custom.ts"], mcp: { keep: { command: ["keep"] } } }, null, 2), "utf8");

    const setup = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "setup", "--host", "codex", "--non-interactive", "--yes", "--json"], { cwd: root, windowsHide: true }).catch((error: Error & { stdout?: string; stderr?: string; code?: number }) => error);
    expect(setup.code).toBe(1);
    expect(JSON.parse(setup.stdout).status).toBe("blocked");

    const uninstall = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "uninstall", "--host", "codex", "--non-interactive", "--yes", "--json"], { cwd: root, windowsHide: true }).catch((error: Error & { stdout?: string; stderr?: string; code?: number }) => error);
    expect(uninstall.code).toBe(1);
    expect(JSON.parse(uninstall.stdout).status).toBe("blocked");
    const config = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8"));
    expect(config.plugin).toEqual(["./custom.ts"]);
    expect(config.mcp.keep.command).toEqual(["keep"]);
  });

  it("runs /osk pack export, verify, import preview, and gated apply", async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), "osk-cli-pack-source-"));
    const target = await mkdtemp(path.join(os.tmpdir(), "osk-cli-pack-target-"));
    await execFileAsync(process.execPath, [tsxBin, cli, "init", "--json"], { cwd: source, windowsHide: true });
    await execFileAsync(process.execPath, [tsxBin, cli, "init", "--json"], { cwd: target, windowsHide: true });

    const exported = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "pack", "export", "--json"], { cwd: source, windowsHide: true });
    const pack = JSON.parse(exported.stdout);
    expect(pack.schemaVersion).toBe("openskill-kit.project-pack.v1");
    expect(pack.packPath).toContain("project-behavior-pack");
    const packPath = path.resolve(source, pack.packPath);

    const verified = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "pack", "verify", packPath, "--json"], { cwd: target, windowsHide: true });
    expect(JSON.parse(verified.stdout).status).toBe("pass");

    const planned = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "pack", "import", packPath, "--json"], { cwd: target, windowsHide: true });
    const plannedParsed = JSON.parse(planned.stdout);
    expect(plannedParsed.status).toBe("planned");
    expect(plannedParsed.issues).toContain("Hooks excluded until trustHooks is true");

    const blockedApply = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "pack", "apply", packPath, "--json"], { cwd: target, windowsHide: true }).catch((error: Error & { stdout?: string; stderr?: string; code?: number }) => error);
    expect(blockedApply.code).toBe(1);
    expect(blockedApply.stderr).toContain("requires --yes");

    const applied = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "pack", "apply", packPath, "--yes", "--json"], { cwd: target, windowsHide: true });
    expect(JSON.parse(applied.stdout).status).toBe("imported");
  });
});

async function runCliWithInput(args: string[], input: string, cwd: string, env: Record<string, string> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxBin, cli, ...args], {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    setTimeout(() => child.stdin.end(input), 100);
  });
}
