import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("agent plugin manifest", () => {
  it("declares openskill-kit skill path", () => {
    const root = path.resolve("packages/agent-plugin-bundle");
    const manifest = JSON.parse(readFileSync(path.join(root, ".agent-plugin", "plugin.json"), "utf8"));
    expect(manifest.schemaVersion).toBe("openskill-kit.agent-plugin.v1");
    expect(manifest.name).toBe("openskill-kit");
    expect(manifest.compatibility).toEqual(expect.arrayContaining(["agent-plugin", "mcp-stdio", "opencode"]));
    expect(manifest.capabilities).toContain("local-mcp-tools");
    expect(manifest.capabilities).toContain("openworld-review-promotion");
    expect(manifest.skills[0].path).toBe("skills/openskill-kit");
    expect(manifest.mcp.server).toBe("openskill-kit-mcp");
    expect(manifest.installGuides.hosts.opencode).toBe("install-guides/opencode.md");
    expect(manifest.installGuides.hosts.codex).toBe("install-guides/codex.md");
    expect(manifest.installGuides.hosts["generic-mcp"]).toBe("install-guides/generic-mcp.md");
    expect(manifest.commands.map).toBe("commands/commands.json");
    expect(manifest.installProfile.schemaVersion).toBe("openskill-kit.agent-plugin-install-profile.v1");
    expect(manifest.installProfile.pluginDirectory).toBe("packages/agent-plugin-bundle");
    expect(manifest.installProfile.firstCall).toEqual({ mcpTool: "osk_bootstrap_session", cliFallback: "openskill-kit status --json" });
    expect(manifest.installProfile.mcp.requiredEnv.OPENSKILLKIT_PROJECT_ROOT).toBe("<absolute project root>");
    expect(manifest.installProfile.commandRouting).toEqual({ map: "commands/commands.json", guide: "commands/osk.md", prefer: "mcp", fallback: "cli" });
    expect(manifest.installProfile.attach.previewCli).toBe("openskill-kit agent attach-plugin --host opencode --dry-run");
    expect(manifest.installProfile.attach.applyCli).toBe("openskill-kit agent attach-plugin --host opencode --yes");
    expect(manifest.installProfile.hostConfig).toEqual(expect.arrayContaining([
      expect.objectContaining({
        host: "opencode",
        configPath: "opencode.json",
        configFormat: "opencode-json",
        supportLevel: "supported",
        previewCli: "openskill-kit agent attach-plugin --host opencode --dry-run",
        applyCli: "openskill-kit agent attach-plugin --host opencode --yes",
        statusCli: "openskill-kit agent plugin-status --json"
      }),
      expect.objectContaining({
        host: "codex",
        configPath: ".codex/config.toml",
        configFormat: "codex-toml",
        supportLevel: "supported",
        previewCli: "openskill-kit agent attach-plugin --host codex --dry-run",
        applyCli: "openskill-kit agent attach-plugin --host codex --yes",
        statusCli: "openskill-kit agent plugin-status --json"
      })
    ]));
    expect(manifest.installProfile.approvalRequiredTools).toEqual(expect.arrayContaining(["osk_plan_learning_sources", "osk_review_behavior", "osk_compile_deploy", "osk_pack_behavior"]));
    expect(manifest.installProfile.readOnlyFirstTools).toEqual(expect.arrayContaining(["osk_bootstrap_session", "osk_detect_environment", "osk_get_plugin_attach_status", "osk_get_plugin_install_profile"]));
    expect(manifest.commands.items).toHaveLength(12);
    expect(manifest.commands.items.some((item: { command: string; mcpTool?: string }) => item.command === "/osk status" && item.mcpTool === "osk_bootstrap_session")).toBe(true);
    expect(manifest.commands.items.some((item: { command: string; mcpTool?: string; aliases: string[] }) => item.command === "/osk task" && item.mcpTool === "osk_get_agent_task_context" && item.aliases.includes("/osk context"))).toBe(true);
    expect(manifest.commands.items.some((item: { command: string; mcpTool?: string; approvalRequired: boolean }) => item.command === "/osk learn" && item.mcpTool === "osk_plan_learning_sources" && item.approvalRequired === true)).toBe(true);
    expect(manifest.commands.items.some((item: { command: string; mcpTool?: string; approvalRequired: boolean }) => item.command === "/osk deploy" && item.mcpTool === "osk_compile_deploy" && item.approvalRequired === true)).toBe(true);
    expect(manifest.privacy.requiresExplicitApproval).toContain("interaction imports");
    expect(manifest.privacy.neverIncludes).toContain("hidden benchmark answers");
    const mcp = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers["openskill-kit"].command).toBe("openskill-kit-mcp");
    const commandMap = JSON.parse(readFileSync(path.join(root, "commands", "commands.json"), "utf8"));
    expect(commandMap.publicFamilyCount).toBe(12);
    expect(commandMap.commands).toHaveLength(12);
    expect(commandMap.commands.some((item: { command: string; cli: string }) => item.command === "/osk task" && item.cli.includes("openskill-kit context"))).toBe(true);
    expect(commandMap.commands.some((item: { command: string; mcpTool?: string }) => item.command === "/osk learn" && item.mcpTool === "osk_plan_learning_sources")).toBe(true);
    expect(commandMap.commands.some((item: { command: string; mcpTool?: string }) => item.command === "/osk eval" && item.mcpTool === "osk_run_eval")).toBe(true);
    const commandGuide = readFileSync(path.join(root, "commands", "osk.md"), "utf8");
    expect(commandGuide).toContain("Prefer MCP");
    expect(commandGuide).toContain("MCP tool: `osk_run_eval`");
    const codexGuide = readFileSync(path.join(root, "install-guides", "codex.md"), "utf8");
    const genericGuide = readFileSync(path.join(root, "install-guides", "generic-mcp.md"), "utf8");
    const opencodeGuide = readFileSync(path.join(root, "install-guides", "opencode.md"), "utf8");
    expect(codexGuide).toContain("AGENTS.md");
    expect(codexGuide).toContain(".codex/config.toml");
    expect(genericGuide).toContain("osk_bootstrap_session");
    expect(opencodeGuide).toContain("preserves the user's `plugin` list");
    expect(opencodeGuide).toContain(".opencode/plugins");
  });
});
