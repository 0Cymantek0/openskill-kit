import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("planned launch documentation coverage", () => {
  it("keeps harness guides present with dry-run and privacy boundaries", async () => {
    const harnesses = ["opencode", "codex", "claude-code", "cursor"];
    for (const harness of harnesses) {
      const markdown = await readDoc(`docs/harnesses/${harness}.md`);
      expect(markdown).toContain("--dry-run");
      expect(markdown).toMatch(/No raw prompts|raw prompts/i);
      expect(markdown).toMatch(/No raw diffs|raw diffs/i);
    }

    const opencode = await readDoc("docs/harnesses/opencode.md");
    expect(opencode).toContain(".opencode/commands/osk-*.md");
    expect(opencode).toContain(".opencode/plugins/openskillkit.ts");
    expect(opencode).toContain("opencode-ambient");
    expect(opencode).toContain("Behavior packs exclude ambient hook metadata");
  });

  it("documents MCP profiles, command privacy, and command registry invariants", async () => {
    const mcpProfiles = await readDoc("docs/mcp-profiles.md");
    expect(mcpProfiles).toContain("Public profile must stay at 12 tools or fewer");
    expect(mcpProfiles).toContain("descriptor-drift");
    expect(mcpProfiles).toContain("osk_compile_deploy");

    const privacy = await readDoc("docs/security/privacy-by-command.md");
    expect(privacy).toContain("| `/osk learn` |");
    expect(privacy).toContain("Never import user/global memories silently");
    expect(privacy).toContain("hiddenOracleProof=false");

    const registry = await readDoc("docs/developer/command-family-registry.md");
    expect(registry).toContain("packages/core/src/commands/families.ts");
    expect(registry).toContain("Exactly 12 public command families");
    expect(registry).toContain("No duplicate command files");
  });
});

async function readDoc(relative: string): Promise<string> {
  return readFile(path.resolve(relative), "utf8");
}
