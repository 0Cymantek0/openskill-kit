import { mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { draftSkill, installSkill, readRegistry, runDoctor, scanSkillPath, uninstallSkill, verifySkill } from "@openskill-kit/core";

const root = await mkdtemp(path.join(os.tmpdir(), "openskill-kit-smoke-"));
await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest --run" }, devDependencies: { vitest: "4.0.0" } }), "utf8");

const doctor = await runDoctor(root, path.join(root, "home"));
if (doctor.status === "fail") throw new Error("doctor failed");

const draft = await draftSkill({ topic: "smoke test skill", projectRoot: root, noLlm: true });
const audit = await scanSkillPath(draft.skillDir);
if (audit.status !== "pass") throw new Error("audit failed");

const report = await verifySkill(draft.skillDir);
if (report.status === "fail") throw new Error("verify failed");

const dryRun = await installSkill({ skillPath: draft.skillDir, target: "opencode-project", projectRoot: root, dryRun: true });
if (dryRun.status !== "planned") throw new Error("dry-run failed");

await installSkill({ skillPath: draft.skillDir, target: "opencode-project", projectRoot: root });
await stat(path.join(root, ".opencode", "skills", draft.skillName, "SKILL.md"));

const registry = await readRegistry(root);
if (!registry.skills.some((skill) => skill.name === draft.skillName)) throw new Error("registry missing skill");

await uninstallSkill({ skillName: draft.skillName, target: "opencode-project", projectRoot: root });

console.log("smoke passed");
