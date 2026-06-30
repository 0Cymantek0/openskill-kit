import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("agent plugin manifest", () => {
  it("declares openskill-kit skill path", () => {
    const root = path.resolve("packages/agent-plugin-bundle");
    const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(path.join(root, ".agent-plugin", "plugin.json"), "utf8"));
    expect(manifest.schemaVersion).toBe("openskill-kit.agent-plugin.v1");
    expect(manifest.name).toBe("openskill-kit");
    expect(manifest.compatibility).toEqual(expect.arrayContaining(["agent-plugin", "mcp-stdio", "opencode"]));
    expect(manifest.capabilities).toContain("local-mcp-tools");
    expect(manifest.capabilities).toContain("openworld-review-promotion");
    expect(manifest.skills).toEqual(expect.arrayContaining(["skills/project-behavior"]));
    expect(manifest.entrypoints.mcpServer.command).toBe("openskill-kit-mcp");
    expect(manifest.entrypoints.installGuides).toBe("install-guides");
    expect(manifest.entrypoints.commands).toBe("commands/commands.json");
    expect(manifest.entrypoints.commandGuide).toBe("commands/osk.md");
    expect(manifest.entrypoints.mcpPublicDescriptors).toBe("mcp/descriptors.public.json");
    expect(manifest.hostCompatibility).toEqual(expect.arrayContaining([
      expect.objectContaining({ host: "opencode", configPath: "opencode.json", supportLevel: "supported" }),
      expect.objectContaining({ host: "codex", configPath: ".codex/config.toml", supportLevel: "supported" }),
      expect.objectContaining({ host: "generic-mcp", configPath: ".mcp.json", supportLevel: "supported" })
    ]));
    expect(manifest.installProfile.schemaVersion).toBe("openskill-kit.agent-plugin-install-profile.v1");
    expect(manifest.installProfile.pluginDirectory).toBe("packages/agent-plugin-bundle");
    expect(manifest.installProfile.firstCall).toEqual({ mcpTool: "osk_get_status", cliFallback: "openskill-kit status --json" });
    expect(manifest.installProfile.mcp.requiredEnv.OPENSKILLKIT_PROJECT_ROOT).toBe("<absolute project root>");
    expect(manifest.installProfile.mcp.requiredEnv.OPENSKILLKIT_MCP_PROFILE).toBe("public");
    expect(manifest.installProfile.mcp.publicDescriptors).toBe("mcp/descriptors.public.json");
    expect(manifest.installProfile.mcp.profiles).toBe("mcp/profiles.json");
    expect(manifest.installProfile.mcp.defaultProfile).toBe("public");
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
    expect(manifest.installProfile.readOnlyFirstTools).toEqual(expect.arrayContaining(["osk_get_status", "osk_detect_environment", "osk_get_plugin_attach_status", "osk_get_plugin_install_profile", "osk_get_docs_help"]));
    expect(manifest.commands).toHaveLength(12);
    expect(manifest.commands.some((item: { command: string; mcpTool?: string }) => item.command === "/osk status" && item.mcpTool === "osk_get_status")).toBe(true);
    expect(manifest.commands.some((item: { command: string; mcpTool?: string; aliases: string[] }) => item.command === "/osk task" && item.mcpTool === "osk_get_task_context" && item.aliases.includes("/osk context"))).toBe(true);
    expect(manifest.commands.some((item: { command: string; mcpTool?: string; cli: string; approvalRequired: boolean }) => item.command === "/osk learn" && item.mcpTool === "osk_plan_learning_sources" && item.cli === "openskill-kit osk learn" && item.approvalRequired === true)).toBe(true);
    expect(manifest.commands.some((item: { command: string; mcpTool?: string; approvalRequired: boolean }) => item.command === "/osk deploy" && item.mcpTool === "osk_compile_deploy" && item.approvalRequired === true)).toBe(true);
    expect(manifest.commands.some((item: { command: string; mcpTool?: string }) => item.command === "/osk eval" && item.mcpTool === "osk_run_eval")).toBe(true);
    expect(manifest.install.requiresExplicitApproval).toContain("importing interaction exports or private memories");
    expect(manifest.privacy.neverIncludes).toContain("hidden benchmark answers");
    const mcp = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers["openskill-kit"].command).toBe("openskill-kit-mcp");
    expect(mcp.mcpServers["openskill-kit"].env.OPENSKILLKIT_MCP_PROFILE).toBe("public");
    const mcpProfiles = JSON.parse(readFileSync(path.join(root, "mcp", "profiles.json"), "utf8"));
    const publicDescriptors = JSON.parse(readFileSync(path.join(root, "mcp", "descriptors.public.json"), "utf8"));
    expect(mcpProfiles.defaultProfile).toBe("public");
    expect(mcpProfiles.profiles.public).toHaveLength(12);
    expect(publicDescriptors.profile).toBe("public");
    expect(publicDescriptors.tools).toHaveLength(12);
    const commandMap = JSON.parse(readFileSync(path.join(root, "commands", "commands.json"), "utf8"));
    expect(commandMap.publicFamilyCount).toBe(12);
    expect(commandMap.commands).toHaveLength(12);
    expect(commandMap.commands.some((item: { command: string; cli: string }) => item.command === "/osk task" && item.cli.includes("openskill-kit osk task context"))).toBe(true);
    expect(commandMap.commands.some((item: { command: string; mcpTool?: string }) => item.command === "/osk learn" && item.mcpTool === "osk_plan_learning_sources")).toBe(true);
    expect(commandMap.commands.some((item: { command: string; cli: string }) => item.command === "/osk pack" && item.cli === "openskill-kit osk pack export")).toBe(true);
    expect(commandMap.commands.some((item: { command: string; mcpTool?: string }) => item.command === "/osk eval" && item.mcpTool === "osk_run_eval")).toBe(true);
    expect(manifest.commands.map((item: { command: string; mcpTool?: string }) => ({ command: item.command, mcpTool: item.mcpTool }))).toEqual(commandMap.commands.map((item: { command: string; mcpTool?: string }) => ({ command: item.command, mcpTool: item.mcpTool })));
    const commandGuide = readFileSync(path.join(root, "commands", "osk.md"), "utf8");
    expect(commandGuide).toContain("Prefer MCP");
    expect(commandGuide).toContain("MCP tool: `osk_run_eval`");
    const codexGuide = readFileSync(path.join(root, "install-guides", "codex.md"), "utf8");
    const genericGuide = readFileSync(path.join(root, "install-guides", "generic-mcp.md"), "utf8");
    const opencodeGuide = readFileSync(path.join(root, "install-guides", "opencode.md"), "utf8");
    expect(codexGuide).toContain("AGENTS.md");
    expect(codexGuide).toContain(".codex/config.toml");
    expect(genericGuide).toContain("osk_get_status");
    expect(opencodeGuide).toContain("preserves existing `plugin` entries");
    expect(opencodeGuide).toContain(".opencode/plugins/openskillkit.ts");
    expect(opencodeGuide).toContain(".opencode/plugins");
    expect(readFileSync(path.join(root, "opencode", "commands", "osk-learn.md"), "utf8")).toContain("osk_plan_learning_sources");
    expect(readFileSync(path.join(root, "opencode", "agents", "osk-learner.md"), "utf8")).toContain("question: allow");
    expect(readFileSync(path.join(root, "opencode", "plugins", "openskillkit.ts"), "utf8")).toContain("Metadata-only by default");
    expect(readFileSync(path.join(root, "opencode", "plugins", "openskillkit.ts"), "utf8")).toContain("import type { Plugin } from \"@opencode-ai/plugin\"");
    expect(readFileSync(path.join(root, "opencode", "plugins", "openskillkit.ts"), "utf8")).toContain("\"permission.ask\"");
    expect(packageJson.files).toEqual(expect.arrayContaining([
      "dist/**/*",
      "packages/agent-plugin-bundle/.agent-plugin/",
      "packages/agent-plugin-bundle/mcp/",
      "packages/agent-plugin-bundle/model-routing.resolved.json",
      "packages/agent-plugin-bundle/opencode/"
    ]));
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.bin["openskill-kit"]).toBe("dist/index.cjs");
    expect(packageJson.bin["openskill-kit-mcp"]).toBe("dist/openskill-kit-mcp.cjs");
  });
});
