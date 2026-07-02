import { execFile, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
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

  it("defaults low-level plugin attach preview to OpenCode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-attach-default-"));
    await execFileAsync(process.execPath, [tsxBin, cli, "init", "--json"], { cwd: root, windowsHide: true });

    const { stdout } = await execFileAsync(process.execPath, [tsxBin, cli, "agent", "attach-plugin", "--dry-run", "--json"], { cwd: root, windowsHide: true });
    const parsed = JSON.parse(stdout);

    expect(parsed.status).toBe("planned");
    expect(parsed.host).toBe("opencode");
    expect(parsed.files.some((file: { destination: string }) => file.destination.endsWith("opencode.json"))).toBe(true);
    expect(parsed.files.some((file: { destination: string }) => file.destination.endsWith(".mcp.json"))).toBe(false);
    await expect(stat(path.join(root, "opencode.json"))).rejects.toThrow();
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

  it("renders the Learn v2 observability dashboard from latest report", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-learn-observability-"));
    const dir = path.join(root, ".openskill-kit", "learn-v2", "observability");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "pipeline-20260630001000.json"), JSON.stringify(sampleLearnV2ObservabilityReport(), null, 2), "utf8");

    const jsonResult = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "learn", "--observability", "--json"], { cwd: root, windowsHide: true });
    const parsed = JSON.parse(jsonResult.stdout);
    expect(parsed.schemaVersion).toBe("openskill-kit.learn-v2.pipeline-observability.v1");
    expect(parsed.compression.patchFilterReasonCounts["generated-only"]).toBe(1);

    const textResult = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "learn", "--observability"], { cwd: root, windowsHide: true });
    expect(textResult.stdout).toContain("Learn v2 observability");
    expect(textResult.stdout).toContain("Patches: 1 behavior-eligible, 1 audit-only / 2");
    expect(textResult.stdout).toContain("Review focus: 1 focus, 2 appendix");
    expect(textResult.stdout).toContain("Health: warn (0.84), blockers 0, warnings 2");
    expect(textResult.stdout).toContain("Health focus: Resolve concept conflicts before activation.");
    expect(textResult.stdout).not.toContain(root);
    expect(textResult.stdout).not.toContain("raw_");
  });

  it("renders Learn v2 activation diagnostics without a browser UI", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-learn-activation-"));
    await execFileAsync(process.execPath, [tsxBin, cli, "init", "--json"], { cwd: root, windowsHide: true });
    const dir = path.join(root, ".openskill-kit", "learn-v2");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "activation-index.json"), JSON.stringify({
      schemaVersion: "openskill-kit.learn-v2.activation-index.v1",
      projectId: "project",
      updatedAt: "2026-06-30T00:00:00.000Z",
      entries: [{
        conceptId: "concept_candidate",
        status: "candidate",
        title: "Candidate parser behavior",
        phrases: ["parser behavior"],
        pathGlobs: ["packages/core/src/**"],
        commands: [],
        taskTypes: ["parser-change"],
        negativeTriggers: [],
        confidence: 0.7,
        risk: "low"
      }]
    }, null, 2), "utf8");

    const result = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "learn", "--activation-query", "parser behavior"], { cwd: root, windowsHide: true });
    expect(result.stdout).toContain("Index entries: 1 total (0 active, 0 locked, 1 candidate/staged/conflict)");
    expect(result.stdout).toContain("No active or locked concepts are available");
    expect(result.stdout).toContain("--include-candidate-concepts");
    expect(result.stdout).toContain("Activation telemetry: [PROJECT_ROOT]/.openskill-kit/learn-v2/activation-runs/");
    expect(result.stdout).not.toContain(root);
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

  it("fails /osk learn clearly for unknown selected sources", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-learn-bad-source-"));
    await mkdir(path.join(root, "src"), { recursive: true });

    const result = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "learn", "--source", "not-a-source", "--json"], { cwd: root, windowsHide: true }).catch((error: Error & { stdout?: string; stderr?: string; code?: number }) => error);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown learning source(s): not-a-source");
    expect(result.stderr).toContain("Supported source ids: current-session, git-local");
  });

  it("records private-safe /osk command telemetry in status", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-telemetry-"));
    await execFileAsync(process.execPath, [tsxBin, cli, "osk", "init", "--json"], { cwd: root, windowsHide: true });
    await execFileAsync(process.execPath, [tsxBin, cli, "osk", "learn", "--source", "not-a-source", "--json"], { cwd: root, windowsHide: true }).catch(() => undefined);

    const { stdout } = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "status", "--json"], { cwd: root, windowsHide: true });
    const parsed = JSON.parse(stdout);
    const telemetry = parsed.status.operations.commandTelemetry;
    expect(telemetry.total).toBeGreaterThanOrEqual(2);
    expect(telemetry.byFamily.init.success).toBe(1);
    expect(telemetry.byFamily.learn.failure).toBe(1);
    expect(telemetry.bySurface.cli.total).toBeGreaterThanOrEqual(2);
    const text = await readFile(path.join(root, ".openskill-kit", "telemetry", "commands.jsonl"), "utf8");
    expect(text).not.toContain("not-a-source");
  });

  it("does not create telemetry state for read-only status before init", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-status-readonly-"));
    const { stdout } = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "status", "--json"], { cwd: root, windowsHide: true });
    const parsed = JSON.parse(stdout);
    expect(parsed.status.initialized).toBe(false);
    await expect(stat(path.join(root, ".openskill-kit", "telemetry", "commands.jsonl"))).rejects.toThrow();
  });

  it("records full safe task finish evidence through the public /osk task facade", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-task-finish-"));
    await execFileAsync(process.execPath, [tsxBin, cli, "init", "--json"], { cwd: root, windowsHide: true });

    const { stdout } = await execFileAsync(process.execPath, [
      tsxBin,
      cli,
      "osk",
      "task",
      "finish",
      "--summary",
      "Accepted parser change after focused tests",
      "--outcome",
      "accepted",
      "--file",
      "src/parser.ts",
      "--command",
      "npm test",
      "--command-status",
      "pass",
      "--proposed-patch-hash",
      "patch_123",
      "--final-patch-hash",
      "patch_456",
      "--diff-added",
      "12",
      "--diff-removed",
      "3",
      "--diff-files",
      "1",
      "--no-learn",
      "--json"
    ], { cwd: root, windowsHide: true });
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe("openskill-kit.agent-task-finish.v1");
    expect(parsed.lifecycle).toBeUndefined();
    expect(parsed.nextActions.join(" ")).toContain("Learning skipped");
    const eventPath = path.resolve(root, parsed.eventPaths[0]);
    const eventText = await readFile(eventPath, "utf8");
    const events = eventText.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(events.some((event) => event.normalized.agent?.proposedPatchHash === "patch_123")).toBe(true);
    expect(events.some((event) => event.normalized.userAction?.finalPatchHash === "patch_456")).toBe(true);
    expect(events.some((event) => event.normalized.git?.diffStats?.added === 12 && event.normalized.git?.diffStats?.removed === 3 && event.normalized.git?.diffStats?.files === 1)).toBe(true);
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
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({ plugin: ["./custom.ts"], share: "manual" }, null, 2), "utf8");

    const { stdout } = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "setup", "--non-interactive", "--json"], { cwd: root, windowsHide: true });
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe("openskill-kit.setup-wizard.v1");
    expect(parsed.status).toBe("planned");
    expect(parsed.applied).toBe(false);
    expect(parsed.plannedFiles).toBeGreaterThan(0);
    expect(parsed.plannedHookFiles).toBe(1);
    expect(parsed.plannedManifestFiles).toBeGreaterThan(0);
    expect(parsed.messages.join("\n")).toContain("Hooks preview:");
    expect(parsed.messages.join("\n")).toContain("Instruction manifests preview:");
    await expect(stat(path.join(root, ".openskill-kit", "compiled", "plugin", "plugin.json"))).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).rejects.toThrow();
    await expect(stat(path.join(root, ".agents", "hooks", "openskill-kit.json"))).rejects.toThrow();
    await expect(stat(path.join(root, "AGENTS.md"))).rejects.toThrow();
    const config = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8"));
    expect(config.plugin).toEqual(["./custom.ts"]);
  });

  it("applies default setup surfaces and uninstall removes generated hooks/manifests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-setup-default-"));
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({ plugin: ["./custom.ts"], share: "manual" }, null, 2), "utf8");

    const setup = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "setup", "--non-interactive", "--yes", "--json"], { cwd: root, windowsHide: true });
    const setupParsed = JSON.parse(setup.stdout);
    expect(setupParsed.status).toBe("installed");
    expect(setupParsed.hooksStatus).toBe("installed");
    expect(setupParsed.manifestsStatus).toBe("installed");
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".agents", "hooks", "openskill-kit.json"))).resolves.toBeTruthy();
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("BEGIN MANAGED BY OPENSKILL-KIT");
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain("BEGIN MANAGED BY OPENSKILL-KIT");

    const uninstalled = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "uninstall", "--non-interactive", "--yes", "--json"], { cwd: root, windowsHide: true });
    const uninstallParsed = JSON.parse(uninstalled.stdout);
    expect(uninstallParsed.status).toBe("uninstalled");
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).rejects.toThrow();
    await expect(stat(path.join(root, ".agents", "hooks", "openskill-kit.json"))).rejects.toThrow();
    await expect(stat(path.join(root, "AGENTS.md"))).rejects.toThrow();
    await expect(stat(path.join(root, "CLAUDE.md"))).rejects.toThrow();
  });

  it("previews and applies /osk deploy as full OpenCode deployment", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-deploy-full-"));
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({ plugin: ["./custom.ts"], share: "manual" }, null, 2), "utf8");

    const preview = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "deploy", "--json"], { cwd: root, windowsHide: true });
    const previewParsed = JSON.parse(preview.stdout);
    expect(previewParsed.schemaVersion).toBe("openskill-kit.setup-wizard.v1");
    expect(previewParsed.status).toBe("planned");
    expect(previewParsed.plannedHookFiles).toBe(1);
    expect(previewParsed.plannedManifestFiles).toBeGreaterThan(0);
    expect(previewParsed.messages.join("\n")).toContain("Hooks preview:");
    expect(previewParsed.messages.join("\n")).toContain("Instruction manifests preview:");
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).rejects.toThrow();
    await expect(stat(path.join(root, ".agents", "hooks", "openskill-kit.json"))).rejects.toThrow();
    await expect(stat(path.join(root, "AGENTS.md"))).rejects.toThrow();

    const applied = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "deploy", "--yes", "--json"], { cwd: root, windowsHide: true });
    const appliedParsed = JSON.parse(applied.stdout);
    expect(appliedParsed.status).toBe("installed");
    expect(appliedParsed.hooksStatus).toBe("installed");
    expect(appliedParsed.manifestsStatus).toBe("installed");
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".agents", "hooks", "openskill-kit.json"))).resolves.toBeTruthy();
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("BEGIN MANAGED BY OPENSKILL-KIT");
  });

  it("uses existing opencode.jsonc for setup and uninstall without creating opencode.json", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-setup-jsonc-"));
    await writeFile(path.join(root, "opencode.jsonc"), [
      "{",
      "  // keep this OpenCode comment",
      "  \"plugin\": [\"./custom.ts\",],",
      "  \"username\": \"osk-user\",",
      "}",
      ""
    ].join("\n"), "utf8");

    const setup = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "setup", "--non-interactive", "--yes", "--skip-hooks", "--skip-manifests", "--json"], { cwd: root, windowsHide: true });
    expect(JSON.parse(setup.stdout).status).toBe("installed");
    await expect(stat(path.join(root, "opencode.json"))).rejects.toThrow();
    let jsonc = await readFile(path.join(root, "opencode.jsonc"), "utf8");
    expect(jsonc).toContain("// keep this OpenCode comment");
    expect(jsonc).toContain("\".opencode/plugins/openskillkit.ts\"");
    expect(jsonc).toContain("\"openskill-kit\"");

    const uninstalled = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "uninstall", "--non-interactive", "--yes", "--json"], { cwd: root, windowsHide: true });
    expect(JSON.parse(uninstalled.stdout).status).toBe("uninstalled");
    await expect(stat(path.join(root, "opencode.json"))).rejects.toThrow();
    jsonc = await readFile(path.join(root, "opencode.jsonc"), "utf8");
    expect(jsonc).toContain("// keep this OpenCode comment");
    expect(jsonc).toContain("\"./custom.ts\"");
    expect(jsonc).not.toContain("\"openskill-kit\"");
    expect(jsonc).not.toContain("\".opencode/plugins/openskillkit.ts\"");
  });

  it("applies setup and safely previews/applies uninstall", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-setup-apply-"));
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({ plugin: ["./custom.ts"], share: "manual" }, null, 2), "utf8");

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

  it("runs the end-to-end OpenCode ambient learning golden flow", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-golden-opencode-"));
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({ plugin: ["./custom.ts"], share: "manual" }, null, 2), "utf8");
    await writeFile(path.join(root, "custom.ts"), "export default async function CustomPlugin() { return {}; }\n", "utf8");

    const setupPreview = await execCliJson(["osk", "setup", "--non-interactive", "--json"], root);
    expect(setupPreview.status).toBe("planned");
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).rejects.toThrow();

    const setupApply = await execCliJson(["osk", "setup", "--non-interactive", "--yes", "--json"], root);
    expect(setupApply.status).toBe("installed");
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".opencode", "agents", "osk-learner.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".opencode", "skills", "osk-learning", "SKILL.md"))).resolves.toBeTruthy();

    const pluginPath = path.join(root, ".opencode", "plugins", "openskillkit.ts");
    const imported = await import(`${pathToFileURL(pluginPath).href}?case=${Date.now()}-golden`);
    const hooks = await imported.OpenSkillKitPlugin({
      worktree: root,
      client: { app: { log: async () => ({}) } }
    });
    await hooks["tool.execute.after"]({ tool: "bash", command: "npm test", path: "src/parser.ts" }, { status: "success", output: "secret output" });
    await hooks["tool.execute.after"]({ tool: "bash", command: "npm test", path: "src/parser.ts" }, { status: "success", output: "secret output" });

    const ambient = await readFile(path.join(root, ".openskill-kit", "ambient", "opencode-events.jsonl"), "utf8");
    expect(ambient).not.toContain("npm test");
    expect(ambient).not.toContain("src/parser.ts");
    expect(ambient).not.toContain("secret output");

    const learnPreview = await execCliJson(["osk", "learn", "--source", "opencode-ambient", "--json"], root);
    expect(learnPreview.previewOnly).toBe(true);
    expect(learnPreview.digest.eventsAppended).toBe(0);
    expect(learnPreview.preview.labelCandidates.some((item: { kind: string }) => item.kind === "command")).toBe(true);
    expect(await eventJsonlCount(root)).toBe(0);

    const learnApply = await execCliJson(["osk", "learn", "--source", "opencode-ambient", "--apply", "--json"], root);
    expect(learnApply.previewOnly).toBe(false);
    expect(learnApply.digest.eventsAppended).toBe(2);
    const commandCandidate = learnApply.safeMetadata.opencode.labelCandidates.find((item: { kind: string }) => item.kind === "command");
    expect(commandCandidate?.hash).toMatch(/^sha256:/);

    const reviewQueue = await execCliJson(["osk", "review", "--write", "--json"], root);
    expect(reviewQueue.labelCandidates.some((item: { hash: string }) => item.hash === commandCandidate.hash)).toBe(true);

    const reviewed = await execCliJson(["osk", "review", "--label-command", commandCandidate.hash, "--as", "npm test", "--json"], root);
    expect(reviewed.reviewedCount).toBe(1);

    const compiled = await execCliJson(["osk", "compile", "--json"], root);
    const commandPolicy = await readFile(path.resolve(root, compiled.policyArtifactPaths.find((file: string) => file.endsWith("command-policy.md"))), "utf8");
    expect(commandPolicy).toContain("npm test");

    const verify = await execCliJson(["osk", "verify", "--json"], root);
    expect(verify.status).toBe("pass");

    const context = await execCliJson(["osk", "task", "context", "parser verification", "--command", "npm test", "--json"], root);
    expect(context.compactMarkdown).toContain("OpenSkillKit Task Context");

    const uninstallPreview = await execCliJson(["osk", "uninstall", "--non-interactive", "--dry-run", "--json"], root);
    expect(uninstallPreview.status).toBe("planned");
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).resolves.toBeTruthy();

    const uninstallApply = await execCliJson(["osk", "uninstall", "--non-interactive", "--yes", "--json"], root);
    expect(uninstallApply.status).toBe("uninstalled");
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).rejects.toThrow();
    expect(JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8")).plugin).toEqual(["./custom.ts"]);
    await expect(stat(path.join(root, ".openskill-kit", "config.json"))).resolves.toBeTruthy();
  }, 60_000);

  it("sets up and uninstalls when opencode.json has a UTF-8 BOM", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-setup-bom-"));
    await writeFile(path.join(root, "opencode.json"), `\uFEFF${JSON.stringify({ plugin: ["./custom.ts"], share: "manual" }, null, 2)}\n`, "utf8");

    const setup = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "setup", "--non-interactive", "--yes", "--skip-hooks", "--skip-manifests", "--json"], { cwd: root, windowsHide: true });
    expect(JSON.parse(setup.stdout).status).toBe("installed");
    let text = await readFile(path.join(root, "opencode.json"), "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    let config = JSON.parse(text.replace(/^\uFEFF/, ""));
    expect(config.plugin).toEqual(["./custom.ts", ".opencode/plugins/openskillkit.ts"]);
    expect(config.mcp["openskill-kit"].command).toEqual(["openskill-kit-mcp"]);

    const uninstalled = await execFileAsync(process.execPath, [tsxBin, cli, "osk", "uninstall", "--non-interactive", "--yes", "--json"], { cwd: root, windowsHide: true });
    expect(JSON.parse(uninstalled.stdout).status).toBe("uninstalled");
    text = await readFile(path.join(root, "opencode.json"), "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    config = JSON.parse(text.replace(/^\uFEFF/, ""));
    expect(config.plugin).toEqual(["./custom.ts"]);
    expect(config.mcp).toBeUndefined();
  });

  it("blocks OpenCode setup and uninstall facade when a different host is requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-host-block-"));
    await writeFile(path.join(root, "opencode.json"), JSON.stringify({ plugin: ["./custom.ts"], mcp: { keep: { type: "local", command: ["keep"] } } }, null, 2), "utf8");

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

  it("previews OpenWorld source-plan execution unless --yes approves ingestion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-cli-openworld-execute-"));
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs", "adapter-guide.md"), "OpenWorld adapter guide covers local source planning and verifier evidence.\n", "utf8");

    const taskResult = await execFileAsync(process.execPath, [
      tsxBin,
      cli,
      "openworld",
      "init-task",
      "--title",
      "Adapter guide",
      "--prompt",
      "Use local source planning for adapter guide evidence",
      "--path",
      "docs",
      "--json"
    ], { cwd: root, windowsHide: true });
    const task = JSON.parse(taskResult.stdout);

    const planResult = await execFileAsync(process.execPath, [
      tsxBin,
      cli,
      "openworld",
      "source-plan",
      "--task-id",
      task.task.id,
      "--path",
      "docs",
      "--no-autonomous-web-candidates",
      "--json"
    ], { cwd: root, windowsHide: true });
    const plan = JSON.parse(planResult.stdout);
    expect(plan.summary.recommendedCount).toBeGreaterThan(0);

    const previewResult = await execFileAsync(process.execPath, [
      tsxBin,
      cli,
      "openworld",
      "execute-source-plan",
      "--task-id",
      task.task.id,
      "--plan-id",
      plan.id,
      "--json"
    ], { cwd: root, windowsHide: true });
    const preview = JSON.parse(previewResult.stdout);
    expect(preview.execution.status).toBe("planned");
    expect(preview.execution.dryRun).toBe(true);
    expect(preview.execution.summary.ingestedCount).toBe(0);
    expect(preview.execution.executionPath).toBeUndefined();
    await expect(stat(path.join(root, ".openskill-kit", "openworld", "tasks", task.task.id, "sources"))).rejects.toThrow();

    const appliedResult = await execFileAsync(process.execPath, [
      tsxBin,
      cli,
      "openworld",
      "execute-source-plan",
      "--task-id",
      task.task.id,
      "--plan-id",
      plan.id,
      "--yes",
      "--json"
    ], { cwd: root, windowsHide: true });
    const applied = JSON.parse(appliedResult.stdout);
    expect(applied.execution.status).toBe("completed");
    expect(applied.execution.dryRun).toBe(false);
    expect(applied.execution.summary.ingestedCount).toBe(1);
    expect(applied.execution.sourceIds).toHaveLength(1);
    await expect(stat(path.join(root, ".openskill-kit", "openworld", "tasks", task.task.id, "sources", `${applied.execution.sourceIds[0]}.json`))).resolves.toBeTruthy();
  });
});

function sampleLearnV2ObservabilityReport() {
  return {
    schemaVersion: "openskill-kit.learn-v2.pipeline-observability.v1",
    generatedAt: "2026-06-30T00:10:00.000Z",
    run: {
      previewOnly: true,
      modelMode: "deterministic-only",
      eventsAppended: 0,
      modelRequestCount: 0
    },
    sources: {
      considered: 1,
      included: 1,
      reviewNeeded: 0,
      excluded: 0,
      totalBytes: 120,
      redactedSources: 0
    },
    evidence: {
      normalizedEvidence: 2,
      episodes: 1,
      phaseCounts: { implementation: 1 },
      outcomeCounts: { unknown: 1 },
      stitchingMethodCounts: { "single-record": 1 },
      stitchingRiskCounts: { "single-record-only": 1 },
      confidenceBuckets: { high: 0, medium: 1, low: 0 },
      qualityTierCounts: { critical: 1, low: 1 },
      qualityActionCounts: { "process-immediately": 1, defer: 1 },
      qualitySignalCounts: { "user-actor": 1, "correction-or-security-language": 1 },
      declassifiedSnippets: 2,
      blockedDeclassifiedSnippets: 0,
      snippetResidualRiskCounts: { low: 2 }
    },
    compression: {
      tools: 1,
      toolStatusCounts: { pass: 1 },
      toolCompressionStrategyCounts: { "status-only": 1 },
      totalToolOmittedBytes: 10,
      patches: 2,
      behaviorEligiblePatches: 1,
      auditOnlyPatches: 1,
      patchFilterReasonCounts: { "generated-only": 1 },
      structuralClassCounts: { api: 1, generated: 1 }
    },
    concepts: {
      cards: 1,
      statusCounts: { candidate: 1 },
      riskCounts: { medium: 1 },
      counterevidenceItems: 0,
      reviewReadyCards: 1,
      reviewFocusCards: 1,
      reviewAppendixCards: 2,
      unresolvedConflicts: 1,
      conflictTypeCounts: { "direct-opposite": 1 },
      driftHealthScore: 0.5,
      staleDriftCandidates: 1,
      driftReasonCounts: { "stale-no-outcomes": 1 }
    },
    qualityGates: {
      evalStatus: "pass",
      leakStatus: "pass",
      reviewCards: 1,
      safeBulkActions: ["accept-low-risk"]
    },
    health: {
      status: "warn",
      score: 0.84,
      blockers: [],
      warnings: ["1 unresolved concept conflict(s).", "1 stale drift candidate(s); drift health 0.50."],
      reviewFocus: ["Resolve concept conflicts before activation.", "Review stale or negatively reinforced concepts."]
    },
    artifacts: {
      review: "[PROJECT_ROOT]/.openskill-kit/learn-v2/review/concept-review-queue.md"
    },
    privacy: {
      rawRefsExported: false,
      rawSourcePathsExported: false,
      localPathsRedacted: true,
      notes: ["Report contains counts only."]
    },
    nextActions: ["Inspect review queue."],
    artifactsWritten: {
      json: "[PROJECT_ROOT]/.openskill-kit/learn-v2/observability/pipeline-20260630001000.json",
      markdown: "[PROJECT_ROOT]/.openskill-kit/learn-v2/observability/pipeline-20260630001000.md"
    }
  };
}

async function execCliJson(args: string[], cwd: string): Promise<any> {
  const { stdout } = await execFileAsync(process.execPath, [tsxBin, cli, ...args], {
    cwd,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

async function eventJsonlCount(root: string): Promise<number> {
  const entries = await readdir(path.join(root, ".openskill-kit", "events")).catch(() => []);
  return entries.filter((entry) => entry.endsWith(".jsonl")).length;
}

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
