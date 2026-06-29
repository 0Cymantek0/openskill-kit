import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  attachAgentPlugin,
  explainAdaptiveStatus,
  getAgentPluginInstallProfile,
  getAgentPluginAttachStatus,
  initAdaptiveProject,
  type PreferenceGraph,
  type PreferenceNode
} from "../src/index.js";

describe("agent plugin attach planner", () => {
  it("defaults omitted host attachment to OpenCode generated harness files", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("opencode-default-attach", "Prefer OpenCode when attach host is omitted", "workflow")]);

    const planned = await attachAgentPlugin(root, { dryRun: true });

    expect(planned.status).toBe("planned");
    expect(planned.host).toBe("opencode");
    expect(planned.files.some((file) => file.destination === path.join(root, "opencode.json"))).toBe(true);
    expect(planned.files.some((file) => file.destination === path.join(root, ".opencode", "commands", "osk-learn.md"))).toBe(true);
    expect(planned.files.some((file) => file.destination === path.join(root, ".mcp.json"))).toBe(false);
    await expect(stat(path.join(root, "opencode.json"))).rejects.toThrow();
  });

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

    const attached = await attachAgentPlugin(root, { host: "generic-mcp", dryRun: false, yes: true });

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

  it("attaches Codex through project config.toml while preserving other settings", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("codex", "Prefer Codex project-local MCP config", "workflow")]);
    await mkdir(path.join(root, ".codex"), { recursive: true });
    await writeFile(path.join(root, ".codex", "config.toml"), "model = \"gpt-5\"\n\n[mcp_servers.\"openskill-kit\"]\ncommand = \"node\"\n\n[mcp_servers.\"openskill-kit\".env]\nOLD_ROOT = \"stale\"\n\n[profiles.default]\napproval_policy = \"never\"\n", "utf8");

    const planned = await attachAgentPlugin(root, { host: "codex", dryRun: true });
    expect(planned.status).toBe("planned");
    expect(planned.files[0]?.destination).toBe(path.join(root, ".codex", "config.toml"));
    expect(String(planned.files[0]?.preview)).toContain("[mcp_servers.\"openskill-kit\"]");
    expect(String(planned.files[0]?.preview)).toContain("model = \"gpt-5\"");
    expect(String(planned.files[0]?.preview)).not.toContain("OLD_ROOT");
    expect(await readFile(path.join(root, ".codex", "config.toml"), "utf8")).not.toContain("openskill-kit-mcp");

    const attached = await attachAgentPlugin(root, { host: "codex", dryRun: false, yes: true });
    expect(attached.status).toBe("attached");
    const codexConfig = await readFile(path.join(root, ".codex", "config.toml"), "utf8");
    expect(codexConfig).toContain("model = \"gpt-5\"");
    expect(codexConfig).toContain("[mcp_servers.\"openskill-kit\"]");
    expect(codexConfig).toContain("command = \"openskill-kit-mcp\"");
    expect(codexConfig).toContain(`OPENSKILLKIT_PROJECT_ROOT = ${JSON.stringify(root)}`);
    expect(codexConfig).toContain("[profiles.default]");
    expect(codexConfig).not.toContain("OLD_ROOT");
    const status = await getAgentPluginAttachStatus(root);
    expect(status.attached).toBe(true);
    expect(status.hosts.find((host) => host.host === "codex")?.status).toBe("attached");
    expect(status.hosts.find((host) => host.host === "generic-mcp")?.status).toBe("missing");
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

  it("previews and applies OpenCode config plus generated command artifacts", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("opencode", "Prefer OpenCode command files for OSK workflows", "workflow")]);
    await writeFile(path.join(root, "opencode.json"), `${JSON.stringify({ plugin: ["./custom.ts"], keep: true }, null, 2)}\n`, "utf8");

    const planned = await attachAgentPlugin(root, { host: "opencode", dryRun: true });

    expect(planned.status).toBe("planned");
    expect(planned.files.some((file) => file.destination === path.join(root, "opencode.json") && file.action === "update")).toBe(true);
    expect(planned.files.some((file) => file.destination === path.join(root, ".opencode", "commands", "osk-learn.md"))).toBe(true);
    expect(planned.files.some((file) => file.destination === path.join(root, ".opencode", "agents", "osk-learner.md"))).toBe(true);
    expect(planned.files.some((file) => file.destination === path.join(root, ".opencode", "skills", "osk-learning", "SKILL.md"))).toBe(true);
    expect(planned.files.some((file) => file.destination === path.join(root, ".opencode", "plugins", "openskillkit.ts"))).toBe(true);
    await expect(stat(path.join(root, ".opencode", "commands", "osk-learn.md"))).rejects.toThrow();

    const attached = await attachAgentPlugin(root, { host: "opencode", dryRun: false, yes: true });
    expect(attached.status).toBe("attached");
    const config = JSON.parse(await readFile(path.join(root, "opencode.json"), "utf8"));
    expect(config.keep).toBe(true);
    expect(config.plugin).toEqual(["./custom.ts", ".opencode/plugins/openskillkit.ts"]);
    expect(config.mcp["openskill-kit"].command).toEqual(["openskill-kit-mcp"]);
    expect(config.mcp["openskill-kit"].environment.OPENSKILLKIT_PROJECT_ROOT).toBe(root);
    expect(await readFile(path.join(root, ".opencode", "commands", "osk-learn.md"), "utf8")).toContain("osk_plan_learning_sources");
    expect(await readFile(path.join(root, ".opencode", "agents", "osk-learner.md"), "utf8")).toContain("question: allow");
    expect(await readFile(path.join(root, ".opencode", "skills", "osk-learning", "SKILL.md"), "utf8")).toContain("Preview imports before apply.");
    const status = await getAgentPluginAttachStatus(root);
    expect(status.hosts.find((host) => host.host === "opencode")?.status).toBe("attached");
    expect(status.defaultHost).toBe("opencode");
    expect(status.defaultHostReady).toBe(true);
    expect(status.defaultHostStatus.status).toBe("attached");
  });

  it("targets existing OpenCode JSONC config without creating duplicate opencode.json", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("opencode-jsonc", "Prefer existing OpenCode JSONC config patching", "workflow")]);
    await writeFile(path.join(root, "opencode.jsonc"), [
      "{",
      "  // user comment must survive attach",
      "  \"plugin\": [\"./custom.ts\",],",
      "  \"keep\": true,",
      "}",
      ""
    ].join("\n"), "utf8");

    const planned = await attachAgentPlugin(root, { host: "opencode", dryRun: true });
    expect(planned.status).toBe("planned");
    expect(planned.files.some((file) => file.destination === path.join(root, "opencode.jsonc") && file.action === "update")).toBe(true);
    expect(planned.files.some((file) => file.destination === path.join(root, "opencode.json"))).toBe(false);
    expect(String(planned.files.find((file) => file.destination === path.join(root, "opencode.jsonc"))?.preview)).toContain("// user comment must survive attach");

    const attached = await attachAgentPlugin(root, { host: "opencode", dryRun: false, yes: true });
    expect(attached.status).toBe("attached");
    await expect(stat(path.join(root, "opencode.json"))).rejects.toThrow();
    const text = await readFile(path.join(root, "opencode.jsonc"), "utf8");
    expect(text).toContain("// user comment must survive attach");
    expect(text).toContain("\"keep\": true");
    expect(text).toContain("\".opencode/plugins/openskillkit.ts\"");
    expect(text).toContain("\"openskill-kit\"");
    const status = await getAgentPluginAttachStatus(root);
    expect(status.defaultHostStatus.destination).toBe(path.join(root, "opencode.jsonc"));
    expect(status.defaultHostStatus.status).toBe("attached");
    expect(status.defaultHostReady).toBe(true);
  });

  it("reports OpenCode attachment incomplete when the generated plugin is not registered", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("opencode-plugin", "Prefer loaded OpenCode plugin hooks", "workflow")]);
    await attachAgentPlugin(root, { host: "opencode", dryRun: false, yes: true });
    const configPath = path.join(root, "opencode.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.plugin = config.plugin.filter((item: string) => item !== ".opencode/plugins/openskillkit.ts");
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const status = await getAgentPluginAttachStatus(root);

    const opencode = status.hosts.find((host) => host.host === "opencode");
    expect(opencode?.status).toBe("plugin-missing");
    expect(opencode?.issue).toContain("plugin list missing");
    expect(status.defaultHostReady).toBe(false);
    expect(status.nextActions.join(" ")).toContain("--host opencode --dry-run");
  });

  it("reports existing OpenCode config without OSK MCP as missing, not wrong-command", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("opencode-empty", "Prefer clear OpenCode missing attach diagnostics", "workflow")]);
    await attachAgentPlugin(root, { host: "opencode", dryRun: true });
    await writeFile(path.join(root, "opencode.json"), `${JSON.stringify({ plugin: ["./custom.ts"] }, null, 2)}\n`, "utf8");

    const status = await getAgentPluginAttachStatus(root);

    const opencode = status.hosts.find((host) => host.host === "opencode");
    expect(opencode?.status).toBe("missing");
    expect(opencode?.issue).toContain("MCP server entry missing");
    expect(status.defaultHostReady).toBe(false);
  });

  it("keeps non-default MCP readiness separate from primary OpenCode readiness", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("generic-first", "Prefer generic MCP smoke before OpenCode attach", "workflow")]);
    await attachAgentPlugin(root, { host: "generic-mcp", dryRun: false, yes: true });

    const status = await getAgentPluginAttachStatus(root);

    expect(status.attached).toBe(true);
    expect(status.hosts.find((host) => host.host === "generic-mcp")?.status).toBe("attached");
    expect(status.defaultHost).toBe("opencode");
    expect(status.defaultHostReady).toBe(false);
    expect(status.defaultHostStatus.status).toBe("missing");
    expect(status.nextActions.join(" ")).toContain("non-default host is attached");
    expect(status.nextActions.join(" ")).toContain("--host opencode --dry-run");
  });

  it("uses OpenCode-first guidance when compiled plugin is not attached", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("opencode-default", "Prefer OpenCode as primary harness attach target", "workflow")]);
    await attachAgentPlugin(root, { host: "opencode", dryRun: true });

    const status = await getAgentPluginAttachStatus(root);

    expect(status.attached).toBe(false);
    expect(status.nextActions.join(" ")).toContain("--host opencode --dry-run");
    expect(status.nextActions.join(" ")).not.toContain("--host generic-mcp --dry-run");
  });

  it("reports Codex config root binding and command conflicts", async () => {
    const root = await tempProject();
    await mkdir(path.join(root, ".codex"), { recursive: true });
    await writeFile(path.join(root, ".codex", "config.toml"), "[mcp_servers.\"openskill-kit\"]\ncommand = \"openskill-kit-mcp\"\n", "utf8");
    let status = await getAgentPluginAttachStatus(root);
    expect(status.hosts.find((host) => host.host === "codex")?.status).toBe("needs-root-binding");

    await writeFile(path.join(root, ".codex", "config.toml"), `[mcp_servers."openskill-kit"]\ncommand = "node"\nenv = { OPENSKILLKIT_PROJECT_ROOT = ${JSON.stringify(root)} }\n`, "utf8");
    status = await getAgentPluginAttachStatus(root);
    expect(status.hosts.find((host) => host.host === "codex")?.status).toBe("wrong-command");
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
    expect(afterAttach.status.compiled.pluginAttachment.attached).toBe(true);
    expect(afterAttach.status.compiled.pluginAttachment.defaultHostReady).toBe(false);
    expect(afterAttach.nextActions.some((action) => action.includes("--host opencode --dry-run"))).toBe(true);
  });

  it("returns a read-only install profile for harness bootstrap", async () => {
    const root = await tempProject();
    await writeGraph(root, [pref("profile", "Prefer machine-readable plugin install profiles", "workflow")]);

    let profile = await getAgentPluginInstallProfile(root);
    expect(profile.ready).toBe(false);
    expect(profile.attachment.attached).toBe(false);
    expect(profile.nextActions.join(" ")).toContain("compile --target plugin");

    await attachAgentPlugin(root, { host: "generic-mcp", dryRun: true });
    profile = await getAgentPluginInstallProfile(root);

    expect(profile.ready).toBe(true);
    expect(profile.attachment.attached).toBe(false);
    expect(profile.attachment.hosts.some((host) => host.host === "generic-mcp" && host.status === "missing")).toBe(true);
    expect(profile.profile?.firstCall.mcpTool).toBe("osk_get_status");
    expect(profile.profile?.mcp.command).toBe("openskill-kit-mcp");
    expect(profile.profile?.mcp.requiredEnv.OPENSKILLKIT_PROJECT_ROOT).toBe("<absolute project root>");
    expect(profile.profile?.commandRouting.map).toBe("commands/commands.json");
    expect(profile.profile?.readOnlyFirstTools).toEqual(expect.arrayContaining(["osk_get_plugin_install_profile"]));
    expect(profile.nextActions).toContain("Preview and apply a hostConfig entry before relying on MCP in this harness.");

    await attachAgentPlugin(root, { host: "generic-mcp", dryRun: false, yes: true });
    profile = await getAgentPluginInstallProfile(root);
    expect(profile.ready).toBe(true);
    expect(profile.attachment.attached).toBe(true);
    expect(profile.attachment.hosts.some((host) => host.host === "generic-mcp" && host.status === "attached")).toBe(true);
    expect(profile.nextActions).toContain("Host attachment is ready; existing coding harnesses can call MCP tools through the configured server.");
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
