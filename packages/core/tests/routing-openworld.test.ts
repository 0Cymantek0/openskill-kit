import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  initAdaptiveProject,
  routeBehavior,
  runOpenWorldDoctor,
  type PreferenceGraph,
  type PreferenceNode
} from "../src/index.js";

describe("behavior routing and OpenWorld capability truth", () => {
  it("routes well-covered tasks to local behavior and novel risky tasks to OpenWorld research", async () => {
    const root = await tempProject();
    await writeJson(path.join(root, ".openskill-kit", "preferences", "graph.json"), graph([
      pref("tests", "active", "Prefer focused parser tests before broad checks", "testing", ["src/parser"]),
      pref("docs", "active", "Prefer update API docs after endpoint schema changes", "api", ["src/routes"])
    ]));

    const local = await routeBehavior({
      projectRoot: root,
      query: "parser tests",
      paths: ["src/parser/tokenizer.ts"],
      now: new Date("2026-06-26T00:00:00.000Z")
    });
    expect(local.decision).toBe("local-only");
    expect(local.tracePath).toBeTruthy();
    await stat(local.tracePath!);

    const novel = await routeBehavior({
      projectRoot: root,
      query: "rotate production oauth encryption secret",
      paths: ["infra/secrets.ts"],
      commands: ["drop table sessions"],
      now: new Date("2026-06-26T00:01:00.000Z")
    });
    expect(novel.decision).toBe("openworld-research");
    expect(novel.gates).toEqual(expect.arrayContaining(["leakage", "sandbox", "review"]));
    expect(novel.openWorld.requireVerifier).toBe(true);
  });

  it("reports OpenWorld scaffold boundaries without overclaiming paper-level capability", async () => {
    const root = await tempProject();
    const report = await runOpenWorldDoctor(root);
    expect(report.status).toBe("warn");
    expect(report.capabilities.some((capability) => capability.name === "Local source ingestion" && capability.status === "available")).toBe(true);
    expect(report.capabilities.some((capability) => capability.name === "Hidden-oracle benchmark proof" && capability.status === "missing")).toBe(true);
    expect(report.nextActions.join(" ")).toContain("Do not claim paper-level OpenSkill behavior");
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "osk-route-"));
  await initAdaptiveProject({ projectRoot: root, projectName: "route", now: new Date("2026-06-26T00:00:00.000Z") });
  return root;
}

function graph(nodes: PreferenceNode[]): PreferenceGraph {
  return {
    schemaVersion: "openskill-kit.preference-graph.v1",
    projectId: "route",
    nodes,
    conflicts: [],
    updatedAt: "2026-06-26T00:00:00.000Z"
  };
}

function pref(id: string, status: PreferenceNode["status"], statement: string, category: PreferenceNode["category"], paths: string[]): PreferenceNode {
  return {
    schemaVersion: "openskill-kit.preference-node.v2",
    id: `pref_${id}`,
    title: id,
    statement,
    category,
    scope: { level: "path", paths },
    confidence: 0.9,
    status,
    polarity: "positive",
    evidence: [{ signalId: `sig_${id}`, eventIds: [`evt_${id}`], weight: 0.9 }],
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z"
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
