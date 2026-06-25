import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  compileBehaviorLayer,
  initAdaptiveProject,
  retrieveRelevantPreferences,
  runBehaviorCompareEval,
  runBehaviorEval,
  runExternalAgentEval,
  type PreferenceGraph,
  type PreferenceNode
} from "../src/index.js";

describe("preference retrieval and policy artifacts", () => {
  it("ranks active preferences by query and path with reasons", async () => {
    const root = await tempProject();
    await writeGraph(root, [
      pref("parser-tests", "Prefer run parser focused tests before final response", "testing", ["src/parser"]),
      pref("api-docs", "Prefer update API docs after route changes", "api", ["src/routes"]),
      pref("general-review", "Prefer concise final summaries", "workflow", [])
    ]);
    const bundle = await retrieveRelevantPreferences({
      projectRoot: root,
      query: "parser test change",
      paths: ["src/parser/tokenizer.ts"],
      limit: 2,
      now: new Date("2026-06-25T00:00:00.000Z")
    });
    expect(bundle.items[0]?.node.id).toBe("pref_parser-tests");
    expect(bundle.items[0]?.reasons.join(" ")).toContain("path:src/parser");
    expect(bundle.items[0]?.reasons.join(" ")).toContain("task:testing");
    expect(bundle.items[0]?.level).toBe("critical");
    expect(bundle.levels.critical.map((item) => item.node.id)).toContain("pref_parser-tests");
    expect(bundle.trace.inferred.languages).toContain("typescript");
    expect(bundle.trace.includedIds).toContain("pref_parser-tests");
    expect(bundle.trace.omitted.some((item) => item.reason === "over-limit")).toBe(true);
    expect(bundle.compactMarkdown).toContain("parser focused tests");
    expect(bundle.compactMarkdown).toContain("## Critical");

    const packed = await retrieveRelevantPreferences({
      projectRoot: root,
      query: "parser test change with api docs",
      paths: ["src/parser/tokenizer.ts", "src/routes/users.ts"],
      limit: 3,
      tokenBudgetLines: 2,
      now: new Date("2026-06-25T00:00:00.000Z")
    });
    expect(packed.budget.requestedLines).toBe(2);
    expect(packed.budget.usedLines).toBeLessThanOrEqual(2);
    expect(packed.trace.omitted.some((item) => item.reason === "over-budget")).toBe(true);
  });

  it("compiles path map, command policy, and review checklist artifacts", async () => {
    const root = await tempProject();
    await writeGraph(root, [
      pref("command", "Prefer run npm test before final response", "testing", []),
      pref("path-style", "Prefer parser modules stay dependency-light", "architecture", ["src/parser"]),
      pref("security", "Do not expose secrets in logs", "security", [])
    ]);
    const compiled = await compileBehaviorLayer(root);
    const [pathMapPath, commandPolicyPath, reviewChecklistPath] = compiled.policyArtifactPaths;
    await expect(stat(pathMapPath!)).resolves.toBeTruthy();
    await expect(stat(commandPolicyPath!)).resolves.toBeTruthy();
    await expect(stat(reviewChecklistPath!)).resolves.toBeTruthy();
    expect(await readFile(commandPolicyPath!, "utf8")).toContain("run npm test");
    expect(await readFile(reviewChecklistPath!, "utf8")).toContain("Do not expose secrets");
    expect(compiled.skillPaths.some((skillPath) => skillPath.endsWith(`${path.sep}project-testing`))).toBe(true);
    expect(compiled.skillPaths.some((skillPath) => skillPath.endsWith(`${path.sep}project-architecture`))).toBe(true);
    await expect(stat(path.join(root, ".openskill-kit", "compiled", "skills", "project-testing", "SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(root, ".openskill-kit", "compiled", "plugin", "skills", "project-testing", "SKILL.md"))).resolves.toBeTruthy();
    const pluginManifest = JSON.parse(await readFile(path.join(root, ".openskill-kit", "compiled", "plugin", "plugin.json"), "utf8"));
    expect(pluginManifest.skills).toEqual(expect.arrayContaining(["skills/project-behavior", "skills/project-testing"]));
    const pathMap = JSON.parse(await readFile(pathMapPath!, "utf8"));
    expect(pathMap.paths["src/parser"][0].id).toBe("pref_path-style");

    const evalReport = await runBehaviorEval({ projectRoot: root, now: new Date("2026-06-25T00:00:00.000Z") });
    expect(evalReport.status).toBe("pass");
    expect(evalReport.retrievalPrecision).toBe(1);
    expect(evalReport.results[0]?.checks.map((check) => check.name)).toEqual(expect.arrayContaining(["retrieval", "plan", "command-policy", "avoidance", "privacy"]));
    const compare = await runBehaviorCompareEval({ projectRoot: root, now: new Date("2026-06-25T00:00:01.000Z") });
    expect(compare.openskillKit.adherence).toBeGreaterThanOrEqual(compare.baseline.adherence);
    expect(compare.artifacts.markdown).toContain("behavior-compare.md");
    const external = await runExternalAgentEval({ projectRoot: root, now: new Date("2026-06-25T00:00:02.000Z"), dryRun: true });
    expect(external.status).toBe("planned");
    expect(external.results[0]?.promptPath).toContain("external-agent");
    await expect(stat(external.artifacts.markdown)).resolves.toBeTruthy();
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "osk-retrieval-"));
  await initAdaptiveProject({ projectRoot: root, projectName: "retrieval", now: new Date("2026-06-25T00:00:00.000Z") });
  return root;
}

async function writeGraph(root: string, nodes: PreferenceNode[]): Promise<void> {
  const graph: PreferenceGraph = {
    schemaVersion: "openskill-kit.preference-graph.v1",
    projectId: "retrieval",
    nodes,
    conflicts: [],
    updatedAt: "2026-06-25T00:00:00.000Z"
  };
  const file = path.join(root, ".openskill-kit", "preferences", "graph.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

function pref(id: string, statement: string, category: PreferenceNode["category"], paths: string[]): PreferenceNode {
  return {
    schemaVersion: "openskill-kit.preference-node.v1",
    id: `pref_${id}`,
    title: id,
    statement,
    category,
    scope: { level: paths.length ? "path" : "project", paths },
    confidence: 0.82,
    status: "active",
    polarity: statement.startsWith("Do not") ? "negative" : "positive",
    evidence: [{ signalId: `sig_${id}`, eventIds: [`evt_${id}`], weight: 0.8 }],
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z"
  };
}
