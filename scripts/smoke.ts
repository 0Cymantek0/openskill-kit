import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);
const cli = path.resolve("dist", "index.cjs");
const mcp = path.resolve("dist", "openskill-kit-mcp.cjs");

if (!existsSync(cli)) {
  throw new Error("built CLI not found; run npm run build before smoke");
}
if (!existsSync(mcp)) {
  throw new Error("built MCP server not found; run npm run build before smoke");
}

const root = await mkdtemp(path.join(os.tmpdir(), "openskill-kit-smoke-"));
await writeFile(path.join(root, "package.json"), JSON.stringify({
  scripts: { test: "vitest --run", typecheck: "tsc --noEmit" },
  devDependencies: { vitest: "4.0.0", typescript: "5.9.0" }
}), "utf8");

const doctor = await runJson(["doctor", "--json"]);
if (doctor.status === "fail") throw new Error("doctor failed");

const draft = await runJson(["draft", "smoke test skill", "--no-llm", "--json"]);
if (!draft.skillDir || !draft.evidenceLedgerPath || !draft.verifierPackPath) {
  throw new Error("draft did not return required artifact paths");
}

const audit = await runJson(["audit", draft.skillDir, "--json"]);
if (audit.status !== "pass") throw new Error("audit failed");

const report = await runJson(["test", draft.skillDir, "--json"]);
if (report.status === "fail" || !Array.isArray(report.assertionResults) || report.assertionResults.length === 0 || !report.executionPath) {
  throw new Error("verifier failed");
}
if (report.execution?.sandbox?.mode !== "local-process") {
  throw new Error("verifier sandbox metadata missing");
}
if (report.execution?.fixtureResults?.[0]?.status !== "pass") {
  throw new Error("verifier fixture did not pass");
}
await stat(path.join(root, report.executionPath));

const dryRun = await runJson(["install", draft.skillDir, "--target", "agents-project", "--dry-run", "--json"]);
if (dryRun.status !== "planned") throw new Error("dry-run install failed");
await expectMissing(path.join(root, ".agents", "skills", draft.skillName));

const installed = await runJson(["install", draft.skillDir, "--target", "agents-project", "--yes", "--json"]);
if (installed.status !== "installed") throw new Error("install failed");
await stat(path.join(root, ".agents", "skills", draft.skillName, "SKILL.md"));

const list = await runJson(["list", "--json"]);
if (!list.skills?.some((skill: { name: string }) => skill.name === draft.skillName)) {
  throw new Error("list did not include installed skill");
}

const inspected = await runJson(["inspect", draft.skillName, "--json"]);
if (inspected.manifest?.name !== draft.skillName) throw new Error("inspect failed");

await runJson(["uninstall", draft.skillName, "--target", "agents-project", "--yes", "--json"]);
await expectMissing(path.join(root, ".agents", "skills", draft.skillName));

const evolved = await runJson(["evolve", "smoke evolve skill", "--no-llm", "--json"]);
if (evolved.status !== "frozen" || evolved.rounds?.[0]?.diagnosis?.kind !== "pass") {
  throw new Error("evolve loop did not freeze clean candidate");
}
await stat(path.join(root, evolved.artifacts.evolution));
await stat(path.join(root, evolved.artifacts.roundsDir, "round-0.json"));

const mcpDraft = await runMcpDraft();
if (mcpDraft.skillName !== "smoke-mcp-skill" || String(mcpDraft.skillDir).includes(root)) {
  throw new Error("MCP draft result missing or unsanitized");
}
await stat(path.join(root, ".openskill-kit", "runs", mcpDraft.runId, "candidate", mcpDraft.skillName, "SKILL.md"));

console.log("smoke passed");

async function runJson(args: string[]): Promise<any> {
  const { stdout } = await execFileAsync(process.execPath, [cli, ...args], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

async function expectMissing(target: string): Promise<void> {
  try {
    await stat(target);
    throw new Error("path should not exist");
  } catch (error) {
    if (error instanceof Error && error.message === "path should not exist") throw error;
  }
}

async function runMcpDraft(): Promise<any> {
  const client = new Client({ name: "openskill-kit-smoke", version: "0.1.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcp],
    cwd: root,
    stderr: "pipe"
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    if (!listed.tools.some((tool) => tool.name === "openskill_draft")) {
      throw new Error("MCP tools missing openskill_draft");
    }
    const draftResult = await client.callTool({
      name: "openskill_draft",
      arguments: { topic: "smoke mcp skill", projectRoot: root, noLlm: true }
    });
    const text = draftResult.content.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("MCP draft returned no text content");
    return JSON.parse(text);
  } finally {
    await client.close();
  }
}
