import { execFile } from "node:child_process";
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
    let config = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8"));
    expect(config.plugin).toEqual(expect.arrayContaining(["./custom.ts", ".opencode/plugins/openskillkit.ts"]));
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
    await expect(stat(path.join(root, ".openskill-kit", "config.json"))).resolves.toBeTruthy();
    config = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8"));
    expect(config.plugin).toEqual(["./custom.ts"]);
    expect(config.mcp).toBeUndefined();
  });
});
