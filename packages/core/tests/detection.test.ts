import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  detectAgentEnvironment,
  initAdaptiveProject,
  MANAGED_BLOCK_END,
  MANAGED_BLOCK_START
} from "../src/index.js";

describe("agent environment detection", () => {
  it("detects project agent surfaces with write and privacy policy metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-detect-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "detect", now: new Date("2026-06-26T00:00:00.000Z") });
    await writeText(root, "AGENTS.md", `User intro\n${MANAGED_BLOCK_START}\nmanaged\n${MANAGED_BLOCK_END}\n`);
    await writeText(root, "packages/api/AGENTS.md", "Nested instructions\n");
    await writeText(root, "CLAUDE.md", "Claude project memory\n");
    await writeText(root, ".claude/rules/api.md", "API rule\n");
    await writeText(root, ".claude/settings.json", JSON.stringify({
      mcpServers: {
        "claude-project": { command: "node", args: ["server.js"] }
      }
    }, null, 2));
    await writeText(root, ".mcp.json", "{\"mcpServers\":{}}\n");
    await writeText(root, ".cursor/rules/frontend.mdc", "Cursor rule\n");
    await writeText(root, ".codex/config.toml", "[mcp_servers.openskill-kit]\ncommand = \"openskill-kit-mcp\"\n");
    await writeText(root, "continue/config.json", JSON.stringify({
      mcpServers: {
        continueLocal: { command: "openskill-kit-mcp" }
      }
    }, null, 2));
    await writeText(root, ".roo/rules.md", "Roo rule\n");
    await writeText(root, ".agents/skills/review/SKILL.md", "---\nname: review\n---\n");
    await writeText(root, ".agents/hooks/openskill-kit.json", "{}\n");
    await writeText(root, ".openskill-kit/compiled/plugin/plugin.json", "{\"schemaVersion\":\"openskill-kit.agent-plugin.v1\"}\n");
    await writeText(root, ".openskill-kit/compiled/plugin/.agent-plugin/plugin.json", "{\"schemaVersion\":\"openskill-kit.agent-plugin.v1\"}\n");
    await writeText(root, ".openskill-kit/compiled/plugin/.mcp.json", "{\"mcpServers\":{\"openskill-kit\":{\"command\":\"openskill-kit-mcp\"}}}\n");
    await writeText(root, ".openskill-kit/compiled/plugin/commands/commands.json", "{\"commands\":[{\"command\":\"/osk status\"}]}\n");
    await writeText(root, ".openskill-kit/compiled/plugin/commands/osk.md", "# Command Map\n");
    await writeText(root, "session-codex.jsonl", "{\"role\":\"user\",\"content\":\"Prefer tests\"}\n");
    await writeText(root, ".codex-log/session-2026.jsonl", "{\"event\":\"user-prompt-submit\"}\n");

    const report = await detectAgentEnvironment(root, { now: new Date("2026-06-26T00:01:00.000Z") });
    expect(report.summary.total).toBeGreaterThanOrEqual(8);
    expect(report.surfaces.some((surface) => surface.relativePath === "AGENTS.md" && surface.writePolicy === "managed-block" && surface.metadata.managedBlockPresent === true)).toBe(true);
    expect(report.surfaces.some((surface) => surface.relativePath === "packages/api/AGENTS.md" && surface.writePolicy === "preview-only")).toBe(true);
    const projectMcp = report.surfaces.find((surface) => surface.adapter === "mcp" && surface.relativePath === ".mcp.json");
    expect(projectMcp?.metadata.mcpConfigValid).toBe(true);
    expect(projectMcp?.metadata.mcpServerNames).toEqual([]);
    expect(projectMcp?.metadata.openskillKitAttached).toBe(false);
    const claudeSettings = report.surfaces.find((surface) => surface.relativePath === ".claude/settings.json");
    expect(claudeSettings?.adapter).toBe("mcp");
    expect(claudeSettings?.metadata.mcpServerNames).toEqual(["claude-project"]);
    const codexConfig = report.surfaces.find((surface) => surface.relativePath === ".codex/config.toml");
    expect(codexConfig?.surfaceType).toBe("config-file");
    expect(codexConfig?.metadata.mcpConfigValid).toBeUndefined();
    const continueConfig = report.surfaces.find((surface) => surface.relativePath === "continue/config.json");
    expect(continueConfig?.metadata.mcpServerNames).toEqual(["continueLocal"]);
    expect(report.surfaces.some((surface) => surface.relativePath === ".roo" && surface.surfaceType === "rule-directory" && surface.readPolicy === "metadata-only")).toBe(true);
    expect(report.surfaces.some((surface) => surface.adapter === "skills" && surface.surfaceType === "skill")).toBe(true);
    expect(report.surfaces.some((surface) => surface.adapter === "openskill-kit" && surface.relativePath === ".openskill-kit/compiled/plugin/plugin.json" && surface.writePolicy === "generated-only")).toBe(true);
    expect(report.surfaces.some((surface) => surface.adapter === "openskill-kit" && surface.relativePath === ".openskill-kit/compiled/plugin/.agent-plugin/plugin.json")).toBe(true);
    expect(report.surfaces.some((surface) => surface.adapter === "openskill-kit" && surface.relativePath === ".openskill-kit/compiled/plugin/.mcp.json" && surface.surfaceType === "mcp-config")).toBe(true);
    expect(report.surfaces.some((surface) => surface.adapter === "openskill-kit" && surface.relativePath === ".openskill-kit/compiled/plugin/commands/commands.json" && surface.writePolicy === "generated-only")).toBe(true);
    expect(report.surfaces.some((surface) => surface.adapter === "openskill-kit" && surface.relativePath === ".openskill-kit/compiled/plugin/commands/osk.md")).toBe(true);
    const interactionExports = report.surfaces.filter((surface) => surface.surfaceType === "interaction-export");
    expect(interactionExports).toHaveLength(2);
    expect(interactionExports.every((surface) => surface.readPolicy === "explicit-import" && surface.writePolicy === "never" && surface.privacyRisk === "high")).toBe(true);
    expect(report.issues.some((issue) => issue.id === "interaction-export-explicit-import" && issue.severity === "warn")).toBe(true);
    expect(report.issues.some((issue) => issue.id === "hook-execution-surface" && issue.severity === "warn")).toBe(true);
    expect(report.issues.some((issue) => issue.id === "mcp-config-review")).toBe(true);
    expect(report.issues.some((issue) => issue.id === "plugin-not-attached-to-host-mcp")).toBe(true);
    expect(report.nextActions.some((action) => action.includes("interactions import"))).toBe(true);
    expect(report.nextActions.some((action) => action.includes("agent attach-plugin"))).toBe(true);
    expect(report.nextActions.some((action) => action.includes("project harness config files"))).toBe(true);
    expect(report.summary.previewOnly).toBeGreaterThan(0);
    expect(report.summary.issueCount).toBeGreaterThan(0);
    expect(report.summary.warningCount).toBeGreaterThan(0);
    await stat(report.artifacts.surfacesPath!);
    await stat(report.artifacts.lastScanPath!);
    const markdown = await readFile(report.artifacts.reportPath!, "utf8");
    expect(markdown).toContain("OpenSkillKit Agent Environment Detection");
    expect(markdown).toContain("## Issues");
    expect(markdown).toContain("## Next Actions");
  });

  it("keeps user agent surfaces metadata-only unless explicitly requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-detect-user-root-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "osk-detect-user-home-"));
    await initAdaptiveProject({ projectRoot: root, projectName: "detect-user", now: new Date("2026-06-26T00:00:00.000Z") });
    await writeText(home, ".codex/AGENTS.md", "Private user instruction\n");
    await writeText(home, ".claude/CLAUDE.md", "Private Claude memory\n");
    await mkdir(path.join(home, ".codex", "memories"), { recursive: true });

    const report = await detectAgentEnvironment(root, {
      includeUserSurfaces: true,
      homeDir: home,
      now: new Date("2026-06-26T00:02:00.000Z")
    });
    const userSurfaces = report.surfaces.filter((surface) => surface.scope === "user");
    expect(userSurfaces.length).toBeGreaterThanOrEqual(3);
    expect(userSurfaces.every((surface) => surface.readPolicy === "metadata-only")).toBe(true);
    expect(userSurfaces.some((surface) => surface.surfaceType === "memory-store" && surface.writePolicy === "never")).toBe(true);
    expect(report.issues.some((issue) => issue.id === "user-private-metadata-only" && issue.severity === "info")).toBe(true);
    expect(report.summary.highPrivacyRisk).toBeGreaterThanOrEqual(2);
  });

  it("reports MCP config parse failures, command conflicts, and remote servers", async () => {
    const invalidRoot = await mkdtemp(path.join(os.tmpdir(), "osk-detect-invalid-mcp-"));
    await initAdaptiveProject({ projectRoot: invalidRoot, projectName: "detect-invalid-mcp", now: new Date("2026-06-26T00:00:00.000Z") });
    await writeText(invalidRoot, ".mcp.json", "{ invalid json");
    const invalidReport = await detectAgentEnvironment(invalidRoot, { now: new Date("2026-06-26T00:03:00.000Z") });
    const invalidMcp = invalidReport.surfaces.find((surface) => surface.relativePath === ".mcp.json");
    expect(invalidMcp?.metadata.mcpConfigValid).toBe(false);
    expect(invalidReport.issues.some((issue) => issue.id === "mcp-config-invalid-json" && issue.severity === "block")).toBe(true);

    const conflictRoot = await mkdtemp(path.join(os.tmpdir(), "osk-detect-conflict-mcp-"));
    await initAdaptiveProject({ projectRoot: conflictRoot, projectName: "detect-conflict-mcp", now: new Date("2026-06-26T00:00:00.000Z") });
    await writeText(conflictRoot, ".openskill-kit/compiled/plugin/plugin.json", "{\"schemaVersion\":\"openskill-kit.agent-plugin.v1\"}\n");
    await writeText(conflictRoot, ".mcp.json", JSON.stringify({
      mcpServers: {
        "openskill-kit": { command: "node", args: ["server.js"] },
        remote: { url: "https://example.invalid/mcp" }
      }
    }, null, 2));
    const conflictReport = await detectAgentEnvironment(conflictRoot, { now: new Date("2026-06-26T00:04:00.000Z") });
    const conflictMcp = conflictReport.surfaces.find((surface) => surface.relativePath === ".mcp.json");
    expect(conflictMcp?.metadata.mcpServerNames).toEqual(["openskill-kit", "remote"]);
    expect(conflictMcp?.metadata.openskillKitAttached).toBe(false);
    expect(conflictMcp?.metadata.openskillKitCommand).toBe("node");
    expect(conflictMcp?.metadata.mcpRemoteServerCount).toBe(1);
    expect(conflictReport.issues.some((issue) => issue.id === "plugin-mcp-command-conflict" && issue.severity === "warn")).toBe(true);
    expect(conflictReport.issues.some((issue) => issue.id === "mcp-remote-server-review" && issue.severity === "warn")).toBe(true);

    const attachedRoot = await mkdtemp(path.join(os.tmpdir(), "osk-detect-attached-mcp-"));
    await initAdaptiveProject({ projectRoot: attachedRoot, projectName: "detect-attached-mcp", now: new Date("2026-06-26T00:00:00.000Z") });
    await writeText(attachedRoot, ".openskill-kit/compiled/plugin/plugin.json", "{\"schemaVersion\":\"openskill-kit.agent-plugin.v1\"}\n");
    await writeText(attachedRoot, ".mcp.json", JSON.stringify({ mcpServers: { "openskill-kit": { command: "openskill-kit-mcp" } } }, null, 2));
    const attachedReport = await detectAgentEnvironment(attachedRoot, { now: new Date("2026-06-26T00:05:00.000Z") });
    const attachedMcp = attachedReport.surfaces.find((surface) => surface.relativePath === ".mcp.json");
    expect(attachedMcp?.metadata.openskillKitAttached).toBe(true);
    expect(attachedReport.issues.some((issue) => issue.id === "plugin-not-attached-to-host-mcp")).toBe(false);
  });
});

async function writeText(root: string, relative: string, content: string): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}
