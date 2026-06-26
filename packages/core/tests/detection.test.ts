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
    await writeText(root, ".mcp.json", "{\"mcpServers\":{}}\n");
    await writeText(root, ".cursor/rules/frontend.mdc", "Cursor rule\n");
    await writeText(root, ".agents/skills/review/SKILL.md", "---\nname: review\n---\n");
    await writeText(root, ".agents/hooks/openskill-kit.json", "{}\n");
    await writeText(root, "session-codex.jsonl", "{\"role\":\"user\",\"content\":\"Prefer tests\"}\n");
    await writeText(root, ".codex-log/session-2026.jsonl", "{\"event\":\"user-prompt-submit\"}\n");

    const report = await detectAgentEnvironment(root, { now: new Date("2026-06-26T00:01:00.000Z") });
    expect(report.summary.total).toBeGreaterThanOrEqual(8);
    expect(report.surfaces.some((surface) => surface.relativePath === "AGENTS.md" && surface.writePolicy === "managed-block" && surface.metadata.managedBlockPresent === true)).toBe(true);
    expect(report.surfaces.some((surface) => surface.relativePath === "packages/api/AGENTS.md" && surface.writePolicy === "preview-only")).toBe(true);
    expect(report.surfaces.some((surface) => surface.adapter === "mcp" && surface.surfaceType === "mcp-config")).toBe(true);
    expect(report.surfaces.some((surface) => surface.adapter === "skills" && surface.surfaceType === "skill")).toBe(true);
    const interactionExports = report.surfaces.filter((surface) => surface.surfaceType === "interaction-export");
    expect(interactionExports).toHaveLength(2);
    expect(interactionExports.every((surface) => surface.readPolicy === "explicit-import" && surface.writePolicy === "never" && surface.privacyRisk === "high")).toBe(true);
    expect(report.summary.previewOnly).toBeGreaterThan(0);
    await stat(report.artifacts.surfacesPath!);
    await stat(report.artifacts.lastScanPath!);
    const markdown = await readFile(report.artifacts.reportPath!, "utf8");
    expect(markdown).toContain("OpenSkillKit Agent Environment Detection");
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
    expect(report.summary.highPrivacyRisk).toBeGreaterThanOrEqual(2);
  });
});

async function writeText(root: string, relative: string, content: string): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}
