import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  attachAgentPlugin,
  explainAdaptiveStatus,
  getAgentPluginAttachStatus,
  initAdaptiveProject,
  type PreferenceGraph,
  type PreferenceNode
} from "../src/index.js";

describe("agent plugin attach planner", () => {
  it("previews host MCP config without writing by default", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("attach", "Prefer plugin-first harness attachment", "workflow")]);

    const planned = await attachAgentPlugin(root, { host: "generic-mcp", dryRun: true });

    expect(planned.status).toBe("planned");
    expect(planned.dryRun).toBe(true);
    expect(planned.plugin.ready).toBe(true);
    expect(planned.files[0]?.action).toBe("create");
    expect(planned.files[0]?.destination).toBe(path.join(root, ".mcp.json"));
    expect(planned.files[0]?.preview).toEqual({ mcpServers: { "openskill-kit": { command: "openskill-kit-mcp", env: { OPENSKILLKIT_PROJECT_ROOT: root } } } });
    await expect(stat(path.join(root, ".mcp.json"))).rejects.toThrow();
  });

  it("applies explicit attach while preserving existing MCP servers", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("attach", "Prefer explicit host config writes", "workflow")]);
    await writeFile(path.join(root, ".mcp.json"), `${JSON.stringify({ mcpServers: { existing: { command: "existing-mcp" } }, keep: true }, null, 2)}\n`, "utf8");

    const attached = await attachAgentPlugin(root, { host: "codex", dryRun: false, yes: true });

    expect(attached.status).toBe("attached");
    expect(attached.dryRun).toBe(false);
    expect(attached.files[0]?.action).toBe("update");
    await expect(stat(attached.receiptPath!)).resolves.toBeTruthy();
    const mcp = JSON.parse(await readFile(path.join(root, ".mcp.json"), "utf8"));
    expect(mcp.keep).toBe(true);
    expect(mcp.mcpServers.existing.command).toBe("existing-mcp");
    expect(mcp.mcpServers["openskill-kit"].command).toBe("openskill-kit-mcp");
    expect(mcp.mcpServers["openskill-kit"].env.OPENSKILLKIT_PROJECT_ROOT).toBe(root);
    const status = await getAgentPluginAttachStatus(root);
    expect(status.attached).toBe(true);
    expect(status.receiptCount).toBe(1);
    expect(status.hosts.find((host) => host.host === "generic-mcp")?.status).toBe("attached");
    expect(status.hosts.find((host) => host.host === "generic-mcp")?.projectRootBound).toBe(true);
  });

  it("blocks invalid host config JSON without overwriting it", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("attach", "Prefer safe attach planning", "security")]);
    await writeFile(path.join(root, ".mcp.json"), "{ invalid json", "utf8");

    const blocked = await attachAgentPlugin(root, { host: "generic-mcp", dryRun: false, yes: true });

    expect(blocked.status).toBe("blocked");
    expect(blocked.files[0]?.action).toBe("blocked");
    expect(blocked.files[0]?.issue).toContain("not valid JSON");
    expect(await readFile(path.join(root, ".mcp.json"), "utf8")).toBe("{ invalid json");
    const status = await getAgentPluginAttachStatus(root);
    expect(status.attached).toBe(false);
    expect(status.hosts.find((host) => host.host === "generic-mcp")?.status).toBe("invalid-json");
  });

  it("reports wrong command and missing project-root binding", async () => {
    const root = await tempProject();
    await writeFile(path.join(root, ".mcp.json"), `${JSON.stringify({ mcpServers: { "openskill-kit": { command: "openskill-kit-mcp" } } }, null, 2)}\n`, "utf8");
    let status = await getAgentPluginAttachStatus(root);
    expect(status.attached).toBe(false);
    expect(status.hosts.find((host) => host.host === "generic-mcp")?.status).toBe("needs-root-binding");

    await writeFile(path.join(root, ".mcp.json"), `${JSON.stringify({ mcpServers: { "openskill-kit": { command: "node" } } }, null, 2)}\n`, "utf8");
    status = await getAgentPluginAttachStatus(root);
    expect(status.attached).toBe(false);
    expect(status.hosts.find((host) => host.host === "generic-mcp")?.status).toBe("wrong-command");
  });

  it("marks host attachment stale when compiled descriptor hash drifts after attach", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("drift", "Prefer descriptor drift checks before trusting MCP tools", "security")]);
    const attached = await attachAgentPlugin(root, { host: "generic-mcp", dryRun: false, yes: true });
    const receipt = JSON.parse(await readFile(attached.receiptPath!, "utf8"));
    receipt.pluginDescriptorsHash = "sha256:old-descriptor-hash";
    await writeFile(attached.receiptPath!, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

    const status = await getAgentPluginAttachStatus(root);

    const generic = status.hosts.find((host) => host.host === "generic-mcp");
    expect(status.attached).toBe(false);
    expect(generic?.status).toBe("descriptor-drift");
    expect(generic?.attachedDescriptorHash).toBe("sha256:old-descriptor-hash");
    expect(generic?.currentDescriptorHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(status.nextActions.join(" ")).toContain("descriptors changed");
  });

  it("targets Cursor project MCP config when requested", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("cursor", "Prefer Cursor MCP attach previews", "workflow")]);

    const planned = await attachAgentPlugin(root, { host: "cursor", dryRun: true });

    expect(planned.status).toBe("planned");
    expect(planned.files[0]?.destination).toBe(path.join(root, ".cursor", "mcp.json"));
  });

  it("surfaces host attach readiness in status explain", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("status", "Prefer visible plugin readiness", "workflow")]);
    await attachAgentPlugin(root, { host: "generic-mcp", dryRun: true });

    const beforeAttach = await explainAdaptiveStatus(root);
    expect(beforeAttach.nextActions.some((action) => action.includes("agent attach-plugin"))).toBe(true);
    expect(beforeAttach.status.compiled.pluginAttachment.attached).toBe(false);

    await attachAgentPlugin(root, { host: "generic-mcp", dryRun: false, yes: true });
    const afterAttach = await explainAdaptiveStatus(root);
    expect(afterAttach.nextActions.some((action) => action.includes("agent attach-plugin"))).toBe(false);
    expect(afterAttach.status.compiled.pluginAttachment.attached).toBe(true);
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "osk-plugin-attach-"));
  await initAdaptiveProject({ projectRoot: root, projectName: "plugin-attach", now: new Date("2026-06-25T00:00:00.000Z") });
  return root;
}

async function writeGraph(root: string, nodes: PreferenceNode[]): Promise<void> {
  const graph: PreferenceGraph = {
    schemaVersion: "openskill-kit.preference-graph.v1",
    projectId: "plugin-attach",
    nodes,
    conflicts: [],
    updatedAt: "2026-06-25T00:00:00.000Z"
  };
  const file = path.join(root, ".openskill-kit", "preferences", "graph.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

function pref(id: string, statement: string, category: PreferenceNode["category"]): PreferenceNode {
  return {
    schemaVersion: "openskill-kit.preference-node.v1",
    id: `pref_${id}`,
    title: id,
    statement,
    category,
    scope: { level: "project", paths: [] },
    confidence: 0.82,
    status: "active",
    polarity: "positive",
    evidence: [{ signalId: `sig_${id}`, eventIds: [`evt_${id}`], weight: 0.8 }],
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z"
  };
}
