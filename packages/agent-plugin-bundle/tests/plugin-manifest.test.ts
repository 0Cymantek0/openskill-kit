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
    expect(manifest.privacy.requiresExplicitApproval).toContain("interaction imports");
    expect(manifest.privacy.neverIncludes).toContain("hidden benchmark answers");
    const mcp = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers["openskill-kit"].command).toBe("openskill-kit-mcp");
  });
});
