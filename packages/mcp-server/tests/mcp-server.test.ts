import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("openskill-kit MCP server", () => {
  it("uses OPENSKILLKIT_PROJECT_ROOT when host omits projectRoot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-mcp-env-root-"));
    const launcherCwd = await mkdtemp(path.join(os.tmpdir(), "osk-mcp-launcher-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "mcp-env-root-fixture" }), "utf8");

    const client = new Client({ name: "openskill-kit-env-root-test", version: "0.1.0" }, { capabilities: {} });
    const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repoRoot, "packages", "mcp-server", "src", "index.ts")],
      cwd: launcherCwd,
      env: { ...inheritedEnv, OPENSKILLKIT_PROJECT_ROOT: root },
      stderr: "pipe"
    });

    try {
      await client.connect(transport);
      const boot = await client.callTool({
        name: "osk_bootstrap_session",
        arguments: { init: true }
      });
      const bootText = boot.content.find((item) => item.type === "text")?.text;
      const parsed = JSON.parse(bootText ?? "{}");
      expect(parsed.initResult.configPath).toContain(".openskill-kit");
      await expect(readFile(path.join(root, ".openskill-kit", "config.json"), "utf8")).resolves.toContain("mcp-env-root-fixture");
      await expect(readFile(path.join(launcherCwd, ".openskill-kit", "config.json"), "utf8")).rejects.toThrow();
    } finally {
      await client.close();
    }
  });

  it("lists tools and drafts a skill through stdio transport", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-mcp-"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "mcp-fixture" }), "utf8");

    const client = new Client({ name: "openskill-kit-test", version: "0.1.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repoRoot, "packages", "mcp-server", "src", "index.ts")],
      cwd: root,
      stderr: "pipe"
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);

      expect(names).toEqual(
        expect.arrayContaining([
          "openskill_doctor",
          "openskill_draft",
          "openskill_evolve",
          "openskill_audit",
          "openskill_test",
          "openskill_evaluate",
          "openskill_install",
          "openskill_list",
          "openskill_inspect",
          "osk_bootstrap_session",
          "osk_record_event",
          "osk_learn_from_session",
          "osk_compile_behavior_layer",
          "osk_agent_doctor",
          "osk_install_agent_hooks",
          "osk_preview_plugin_attach",
          "osk_apply_plugin_attach",
          "osk_get_plugin_attach_status",
          "osk_get_agent_task_context",
          "osk_run_lifecycle_once",
          "osk_openworld_retrieval_adapters",
          "osk_openworld_execute_source_plan",
          "osk_openworld_repair_candidate",
          "osk_openworld_hidden_oracle_harness",
          "osk_openworld_candidate_skill",
          "osk_openworld_verifier_quality"
        ])
      );

      const boot = await client.callTool({
        name: "osk_bootstrap_session",
        arguments: { projectRoot: root, init: true }
      });
      const bootText = boot.content.find((item) => item.type === "text")?.text;
      expect(bootText).toBeTruthy();
      expect(bootText).not.toContain(root);
      const bootParsed = JSON.parse(bootText ?? "{}");
      expect(bootParsed.schemaVersion).toBe("openskill-kit.bootstrap-session.v1");
      expect(bootParsed.plugin.ready).toBe(false);
      expect(bootParsed.plugin.nextActions[0]).toContain("compile --target plugin");

      await client.callTool({
        name: "osk_record_event",
        arguments: {
          projectRoot: root,
          sessionId: "mcp-adaptive",
          eventType: "user-prompt-submit",
          normalized: { text: "Always run npm test before finishing." }
        }
      });
      const learned = await client.callTool({
        name: "osk_learn_from_session",
        arguments: { projectRoot: root }
      });
      const learnedText = learned.content.find((item) => item.type === "text")?.text;
      expect(learnedText).toContain("run npm test");

      await client.callTool({
        name: "osk_apply_review_actions",
        arguments: { projectRoot: root, activateAll: true }
      });
      await client.callTool({
        name: "osk_compile_behavior_layer",
        arguments: { projectRoot: root, targets: ["plugin"] }
      });
      const bootReady = await client.callTool({
        name: "osk_bootstrap_session",
        arguments: { projectRoot: root, init: false }
      });
      const bootReadyText = bootReady.content.find((item) => item.type === "text")?.text;
      const bootReadyParsed = JSON.parse(bootReadyText ?? "{}");
      expect(bootReadyParsed.plugin.ready).toBe(true);
      expect(bootReadyParsed.plugin.skills).toEqual(expect.arrayContaining(["skills/project-behavior", "skills/project-testing"]));
      expect(bootReadyParsed.plugin.nextActions).toContain("Attach `.openskill-kit/compiled/plugin/` as the local plugin directory.");

      const attachPlan = await client.callTool({
        name: "osk_preview_plugin_attach",
        arguments: { projectRoot: root, host: "generic-mcp" }
      });
      const attachPlanParsed = JSON.parse(attachPlan.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(attachPlanParsed.status).toBe("planned");
      expect(attachPlanParsed.files[0].destination).toContain(".mcp.json");
      const healthPlan = await client.callTool({
        name: "osk_get_plugin_attach_status",
        arguments: { projectRoot: root }
      });
      const healthPlanParsed = JSON.parse(healthPlan.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(healthPlanParsed.attached).toBe(false);

      const attachApply = await client.callTool({
        name: "osk_apply_plugin_attach",
        arguments: { projectRoot: root, host: "generic-mcp", yes: true }
      });
      const attachApplyParsed = JSON.parse(attachApply.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(attachApplyParsed.status).toBe("attached");
      const bootAttached = await client.callTool({
        name: "osk_bootstrap_session",
        arguments: { projectRoot: root, init: false }
      });
      const bootAttachedParsed = JSON.parse(bootAttached.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(bootAttachedParsed.status.compiled.pluginAttachment.attached).toBe(true);
      const healthAttached = await client.callTool({
        name: "osk_get_plugin_attach_status",
        arguments: { projectRoot: root }
      });
      const healthAttachedParsed = JSON.parse(healthAttached.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(healthAttachedParsed.attached).toBe(true);

      const taskContext = await client.callTool({
        name: "osk_get_agent_task_context",
        arguments: { projectRoot: root, query: "finish with npm test", commands: ["npm test"] }
      });
      const taskContextParsed = JSON.parse(taskContext.content.find((item) => item.type === "text")?.text ?? "{}");
      expect(taskContextParsed.schemaVersion).toBe("openskill-kit.agent-task-context.v1");
      expect(taskContextParsed.compactMarkdown).toContain("OpenSkillKit Task Context");
      expect(taskContextParsed.preferences.items.some((item: { node?: { statement?: string } }) => item.node?.statement?.includes("run npm test"))).toBe(true);
      expect(taskContextParsed.plugin.attached).toBe(true);

      const lifecycle = await client.callTool({
        name: "osk_run_lifecycle_once",
        arguments: { projectRoot: root }
      });
      const lifecycleText = lifecycle.content.find((item) => item.type === "text")?.text;
      expect(lifecycleText).toContain("highValueEvents");

      const draft = await client.callTool({
        name: "openskill_draft",
        arguments: { topic: "mcp agent handoff", projectRoot: root, noLlm: true }
      });
      const text = draft.content.find((item) => item.type === "text")?.text;
      expect(text).toBeTruthy();
      expect(text).not.toContain(root);

      const parsed = JSON.parse(text ?? "{}");
      expect(parsed.skillName).toBe("mcp-agent-handoff");
      expect(parsed.skillDir).toContain(".openskill-kit");

      const skillMarkdown = await readFile(path.join(root, ".openskill-kit", "runs", parsed.runId, "candidate", parsed.skillName, "SKILL.md"), "utf8");
      expect(skillMarkdown).toContain("mcp agent handoff");

      const evaluation = await client.callTool({
        name: "openskill_evaluate",
        arguments: { skillPath: parsed.skillDir, projectRoot: root }
      });
      const evaluationText = evaluation.content.find((item) => item.type === "text")?.text;
      expect(evaluationText).toBeTruthy();
      const evaluationParsed = JSON.parse(evaluationText ?? "{}");
      expect(evaluationParsed.schemaVersion).toBe("openskill-kit.evaluation.v0");
      expect(evaluationParsed.status).not.toBe("fail");
    } finally {
      await client.close();
    }
  });
});
