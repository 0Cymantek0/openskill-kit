import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("agent plugin manifest", () => {
  it("declares openskill-kit skill path", () => {
    const root = path.resolve("packages/agent-plugin-bundle");
    const manifest = JSON.parse(readFileSync(path.join(root, ".agent-plugin", "plugin.json"), "utf8"));
    expect(manifest.schemaVersion).toBe("openskill-kit.agent-plugin.v1");
    expect(manifest.name).toBe("openskill-kit");
    expect(manifest.compatibility).toEqual(expect.arrayContaining(["agent-plugin", "mcp-stdio"]));
    expect(manifest.capabilities).toContain("local-mcp-tools");
    expect(manifest.skills[0].path).toBe("skills/openskill-kit");
    expect(manifest.mcp.server).toBe("openskill-kit-mcp");
    expect(manifest.commands.map).toBe("commands/commands.json");
    expect(manifest.commands.items).toHaveLength(11);
    expect(manifest.commands.items.some((item: { command: string; mcpTool?: string }) => item.command === "/osk status" && item.mcpTool === "osk_bootstrap_session")).toBe(true);
    expect(manifest.commands.items.some((item: { command: string; approvalRequired: boolean }) => item.command === "/osk install hooks" && item.approvalRequired === true)).toBe(true);
    expect(manifest.privacy.requiresExplicitApproval).toContain("interaction imports");
    expect(manifest.privacy.neverIncludes).toContain("hidden benchmark answers");
    const mcp = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers["openskill-kit"].command).toBe("openskill-kit-mcp");
    const commandMap = JSON.parse(readFileSync(path.join(root, "commands", "commands.json"), "utf8"));
    expect(commandMap.commands).toHaveLength(11);
    expect(commandMap.commands.some((item: { command: string; cli: string }) => item.command === "/osk update skills" && item.cli === "openskill-kit compile --target agent-skills")).toBe(true);
    expect(commandMap.commands.some((item: { command: string; mcpTool?: string }) => item.command === "/osk evolve this skill" && !item.mcpTool)).toBe(true);
    const commandGuide = readFileSync(path.join(root, "commands", "osk.md"), "utf8");
    expect(commandGuide).toContain("Prefer MCP");
  });
});
