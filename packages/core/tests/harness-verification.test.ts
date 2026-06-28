import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileBehaviorLayer, initAdaptiveProject, verifyHarnessReadiness, type PreferenceGraph, type PreferenceNode } from "../src/index.js";

describe("harness readiness verification", () => {
  it("passes generated OpenCode commands and public MCP profile budgets", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("verify-harness", "Prefer harness readiness checks before deploy", "workflow")]);
    await compileBehaviorLayer(root, { targets: ["plugin"] });

    const report = await verifyHarnessReadiness(root, new Date("2026-06-28T00:00:00.000Z"));

    expect(report.schemaVersion).toBe("openskill-kit.harness-readiness-verification.v1");
    expect(report.status).toBe("pass");
    expect(report.summary.publicCommandCount).toBe(12);
    expect(report.summary.publicMcpToolCount).toBeLessThanOrEqual(12);
    expect(report.summary.opencodeCommandCount).toBe(12);
    expect(report.summary.opencodeAgentCount).toBe(8);
    expect(report.summary.opencodePluginReady).toBe(true);
    expect(report.findings.some((finding) => finding.id === "public-mcp-tool-count" && finding.severity === "pass")).toBe(true);
    expect(report.findings.some((finding) => finding.id.startsWith("opencode-command-safety:osk-learn.md") && finding.severity === "pass")).toBe(true);
    expect(report.findings.some((finding) => finding.id === "opencode-agent-count" && finding.severity === "pass")).toBe(true);
    expect(report.findings.some((finding) => finding.id === "opencode-agent-present:osk-router.md" && finding.severity === "pass")).toBe(true);
    expect(report.findings.some((finding) => finding.id === "opencode-command-facade:osk-status.md" && finding.severity === "pass")).toBe(true);
    expect(report.findings.some((finding) => finding.id === "opencode-plugin-hook:session-diff" && finding.severity === "pass")).toBe(true);
    expect(report.findings.some((finding) => finding.id === "opencode-plugin-safe-key-whitelist" && finding.severity === "pass")).toBe(true);
  });

  it("fails when generated OpenCode commands collide or public MCP profile bloats", async () => {
    const root = await tempProject();
    await compileBehaviorLayer(root, { targets: ["plugin"] });
    const pluginRoot = path.join(root, ".openskill-kit", "compiled", "plugin");
    await rename(path.join(pluginRoot, "opencode", "commands", "osk-status.md"), path.join(pluginRoot, "opencode", "commands", "help.md"));
    await rename(path.join(pluginRoot, "opencode", "agents", "osk-router.md"), path.join(pluginRoot, "opencode", "agents", "router.md"));
    await writeFile(path.join(pluginRoot, "opencode", "plugins", "openskillkit.ts"), "export default { prompt: true }\n", "utf8");
    const publicDescriptorPath = path.join(pluginRoot, "mcp", "descriptors.public.json");
    const publicDescriptors = JSON.parse(await readFile(publicDescriptorPath, "utf8"));
    publicDescriptors.tools.push({ name: "extra_low_level_tool", category: "debug", writeRisk: "read-only", approvalRequired: false });
    await writeFile(publicDescriptorPath, `${JSON.stringify(publicDescriptors, null, 2)}\n`, "utf8");

    const report = await verifyHarnessReadiness(root);

    expect(report.status).toBe("fail");
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "public-mcp-tool-count", severity: "fail" }),
      expect.objectContaining({ id: "opencode-command-name:help.md", severity: "fail" }),
      expect.objectContaining({ id: "opencode-agent-present:osk-router.md", severity: "fail" }),
      expect.objectContaining({ id: "opencode-plugin-safe-key-whitelist", severity: "fail" })
    ]));
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "osk-harness-verify-"));
  await initAdaptiveProject({ projectRoot: root, projectName: "harness-verify", now: new Date("2026-06-28T00:00:00.000Z") });
  return root;
}

async function writeGraph(root: string, nodes: PreferenceNode[]): Promise<void> {
  const graph: PreferenceGraph = {
    schemaVersion: "openskill-kit.preference-graph.v1",
    projectId: "harness-verify",
    nodes,
    conflicts: [],
    updatedAt: "2026-06-28T00:00:00.000Z"
  };
  await mkdir(path.join(root, ".openskill-kit", "preferences"), { recursive: true });
  await writeFile(path.join(root, ".openskill-kit", "preferences", "graph.json"), `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

function pref(id: string, statement: string, category: PreferenceNode["category"]): PreferenceNode {
  return {
    id,
    schemaVersion: "openskill-kit.preference-node.v2",
    statement,
    category,
    confidence: 0.9,
    status: "active",
    scope: { level: "project", paths: [] },
    evidence: [],
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z"
  };
}
