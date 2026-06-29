// One-off helper: regenerate the privacy-safe OpenCode plugin text from the
// real compiler, then sync it into the checked-in static bundle and the golden
// fixture so both stay byte-identical to renderOpenCodePlugin().
// Run with: npx tsx scripts/sync-static-plugin.mjs
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileBehaviorLayer, initAdaptiveProject } from "../packages/core/src/index.js";

const root = await mkdtemp(path.join(os.tmpdir(), "osk-sync-plugin-"));
await initAdaptiveProject({ projectRoot: root, projectName: "plugin-sync", now: new Date("2026-06-28T00:00:00.000Z") });
await mkdir(path.join(root, ".openskill-kit", "preferences"), { recursive: true });
await writeFile(path.join(root, ".openskill-kit", "preferences", "graph.json"), `${JSON.stringify({
  schemaVersion: "openskill-kit.preference-graph.v1",
  projectId: "plugin-sync",
  nodes: [],
  conflicts: [],
  updatedAt: "2026-06-28T00:00:00.000Z"
}, null, 2)}\n`, "utf8");
await compileBehaviorLayer(root, { targets: ["plugin"] });

const generated = await readFile(path.join(root, ".openskill-kit", "compiled", "plugin", "opencode", "plugins", "openskillkit.ts"), "utf8");
const repoRoot = path.resolve(import.meta.dirname, "..");
const bundlePath = path.join(repoRoot, "packages", "agent-plugin-bundle", "opencode", "plugins", "openskillkit.ts");
await writeFile(bundlePath, generated, "utf8");

const fixturePath = path.join(repoRoot, "packages", "core", "tests", "fixtures", "opencode-golden.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
fixture.files["opencode/plugins/openskillkit.ts"] = generated;
await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

await rm(root, { recursive: true, force: true });
console.log(`synced privacy-safe plugin to bundle + golden fixture (${generated.length} bytes)`);
