import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("Codex plugin manifest", () => {
  it("declares openskill-kit skill path", () => {
    const root = path.resolve("packages/codex-plugin");
    const manifest = JSON.parse(readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));
    expect(manifest.name).toBe("openskill-kit");
    expect(manifest.skills[0].path).toBe("skills/openskill-kit");
    const mcp = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers["openskill-kit"].command).toBe("openskill-kit-mcp");
  });
});
