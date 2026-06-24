import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("openskill-kit MCP server", () => {
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
          "openskill_install",
          "openskill_list",
          "openskill_inspect"
        ])
      );

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
    } finally {
      await client.close();
    }
  });
});
