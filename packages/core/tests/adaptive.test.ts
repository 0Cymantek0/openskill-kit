import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  appendEvent,
  applyPreferenceReview,
  compileBehaviorLayer,
  exportEncryptedProjectBehaviorPack,
  exportProjectBehaviorPack,
  extractSignals,
  getAdaptiveStatus,
  initAdaptiveProject,
  importEncryptedProjectBehaviorPack,
  importProjectBehaviorPack,
  inspectProjectBehaviorPack,
  installSkill,
  runBehaviorEval,
  signProjectBehaviorPack,
  diffProjectBehaviorPacks,
  updatePreferenceGraph,
  verifyProjectBehaviorPack,
  verifySkill
} from "../src/index.js";

describe("adaptive behavior layer", () => {
  it("initializes, observes, learns, reviews, compiles, installs, and exports safely", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-adaptive-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "adaptive-fixture", scripts: { test: "vitest --run", typecheck: "tsc --noEmit" }, devDependencies: { vitest: "1.0.0", typescript: "1.0.0" } }), "utf8");

    const init = await initAdaptiveProject({ projectRoot: root, now: new Date("2026-06-24T00:00:00.000Z") });
    expect(init.status).toBe("created");
    expect(init.config.schemaVersion).toBe("openskill-kit.config.v1");
    const sentinelSecret = ["super", "secret", "value"].join("-");

    const event = await appendEvent(root, {
      sessionId: "s1",
      eventType: "user-prompt-submit",
      source: { adapter: "test" },
      normalized: { text: `Always run npm test before final answer. TOKEN=${sentinelSecret}` },
      privacy: { redacted: false, rawStored: false, containsUserText: true, containsCode: false }
    });
    expect(event.redactionMatches).toContain("secret-assignment");
    const eventLog = await readFile(event.eventPath, "utf8");
    expect(eventLog).not.toContain(sentinelSecret);
    expect(eventLog).toContain("[REDACTED:secret-assignment]");

    const signals = await extractSignals(root, new Date("2026-06-24T00:01:00.000Z"));
    expect(signals.signals.some((signal) => signal.statement.includes("run npm test"))).toBe(true);

    const graphUpdate = await updatePreferenceGraph(root, new Date("2026-06-24T00:02:00.000Z"));
    expect(graphUpdate.graph.nodes.length).toBeGreaterThan(0);
    const reviewed = await applyPreferenceReview(root, { activateAll: true }, new Date("2026-06-24T00:03:00.000Z"));
    expect(reviewed.nodes.some((node) => node.status === "active" && node.statement.includes("run npm test"))).toBe(true);

    const compiled = await compileBehaviorLayer(root);
    await expect(stat(compiled.contextPackPath)).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".openskill-kit", "compiled", "skills", "project-behavior", "SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".openskill-kit", "compiled", "skills", "project-testing", "SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(compiled.pluginManifestPath)).resolves.toBeTruthy();
    const mcpConfig = JSON.parse(await readFile(compiled.mcpConfigPath!, "utf8"));
    expect(mcpConfig.tools).toEqual(expect.arrayContaining(["osk_export_encrypted_behavior_pack", "osk_import_encrypted_behavior_pack", "osk_run_external_agent_eval", "osk_openworld_source_plan", "osk_openworld_execute_source_plan", "osk_openworld_candidate_skill", "osk_openworld_verifier_quality"]));

    const skillMarkdown = await readFile(path.join(root, ".openskill-kit", "compiled", "skills", "project-behavior", "SKILL.md"), "utf8");
    expect(skillMarkdown).toContain("## When to use");
    expect(skillMarkdown).toContain("run npm test");
    const verifier = await verifySkill(path.join(root, ".openskill-kit", "compiled", "skills", "project-behavior"));
    expect(verifier.status).not.toBe("fail");

    const install = await installSkill({ skillPath: path.join(root, ".openskill-kit", "compiled", "skills", "project-behavior"), target: "agents-project", projectRoot: root, yes: true });
    expect(install.status).toBe("installed");
    await expect(stat(path.join(root, ".agents", "skills", "project-behavior", "SKILL.md"))).resolves.toBeTruthy();

    const hook = spawnSync(process.execPath, [path.join(root, ".openskill-kit", "compiled", "hooks", "scripts", "osk-prompt-submit.cjs")], {
      cwd: root,
      input: JSON.stringify({ sessionId: "hook-s1", prompt: `Always keep hooks private. TOKEN=${sentinelSecret}` }),
      encoding: "utf8"
    });
    expect(hook.status).toBe(0);
    const hookLog = await readFile(event.eventPath, "utf8");
    expect(hookLog).not.toContain(sentinelSecret);
    expect(hookLog).toContain("openskill-kit-hook");

    const evalReport = await runBehaviorEval({ projectRoot: root, now: new Date("2026-06-24T00:04:00.000Z") });
    expect(evalReport.status).toBe("pass");
    await expect(stat(evalReport.artifacts.json)).resolves.toBeTruthy();

    const pack = await exportProjectBehaviorPack(root);
    await expect(stat(pack.manifestPath)).resolves.toBeTruthy();
    expect(pack.files).not.toContain(".openskill-kit/events/2026-06.jsonl");
    const manifest = JSON.parse(await readFile(pack.manifestPath, "utf8"));
    expect(manifest.project.name).toBe("adaptive-fixture");
    expect(manifest.compatibility.configSchema).toBe("openskill-kit.config.v1");
    expect(manifest.generatedArtifacts.some((artifact: { type: string }) => artifact.type === "skill")).toBe(true);
    expect(pack.files).toContain(".openskill-kit/compiled/skills/project-testing/SKILL.md");
    expect(manifest.privacyStatement).toContain("excludes raw events");
    const signed = await signProjectBehaviorPack(pack.packPath, path.join(root, ".openskill-kit", "keys"));
    expect(signed.keyId).toHaveLength(16);
    const packVerify = await verifyProjectBehaviorPack(pack.packPath);
    expect(packVerify.status).toBe("pass");
    expect(packVerify.signature?.status).toBe("valid");
    expect(packVerify.signature?.keyId).toBe(signed.keyId);
    const inspected = await inspectProjectBehaviorPack(pack.packPath);
    expect(inspected.signature.keyId).toBe(signed.keyId);
    const diff = await diffProjectBehaviorPacks(pack.packPath, pack.packPath);
    expect(diff.changed).toHaveLength(0);

    const importRoot = await mkdtemp(path.join(os.tmpdir(), "osk-import-"));
    await mkdir(path.join(importRoot, ".openskill-kit"), { recursive: true });
    await writeFile(path.join(importRoot, ".openskill-kit", "config.json"), "{\"old\":true}\n", "utf8");
    const blockedImport = await importProjectBehaviorPack(importRoot, pack.packPath, { maxChangedFiles: 0 });
    expect(blockedImport.status).toBe("blocked");
    expect(blockedImport.files.some((file) => file.status === "changed")).toBe(true);
    const importPlan = await importProjectBehaviorPack(importRoot, pack.packPath, { review: true });
    expect(importPlan.status).toBe("planned");
    expect(importPlan.issues).toContain("Hooks excluded until trustHooks is true");
    await expect(stat(importPlan.reviewPath!)).resolves.toBeTruthy();

    const encrypted = await exportEncryptedProjectBehaviorPack(root, { passphrase: "test-passphrase" });
    await expect(stat(encrypted.encryptedPath)).resolves.toBeTruthy();
    const encryptedText = await readFile(encrypted.encryptedPath, "utf8");
    expect(encryptedText).not.toContain(sentinelSecret);
    await expect(importEncryptedProjectBehaviorPack(importRoot, encrypted.encryptedPath, { passphrase: "wrong-passphrase" })).rejects.toThrow();
    const encryptedPlan = await importEncryptedProjectBehaviorPack(importRoot, encrypted.encryptedPath, { passphrase: "test-passphrase", review: true });
    expect(encryptedPlan.status).toBe("planned");
    expect(encryptedPlan.encryptedPath).toBe(encrypted.encryptedPath);

    const imported = await importProjectBehaviorPack(importRoot, pack.packPath, { dryRun: false, trustHooks: true });
    expect(imported.status).toBe("imported");
    await expect(stat(path.join(importRoot, ".openskill-kit", "compiled", "skills", "project-behavior", "SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(importRoot, ".openskill-kit", "compiled", "hooks", "hooks.json"))).resolves.toBeTruthy();

    const status = await getAdaptiveStatus(root);
    expect(status.initialized).toBe(true);
    expect(status.eventCount).toBe(2);
    expect(status.compiled.contextPack).toBe(true);
  });
});
