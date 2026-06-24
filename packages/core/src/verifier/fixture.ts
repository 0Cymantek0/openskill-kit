import { promises as fs } from "node:fs";
import path from "node:path";
import type { SandboxPolicy } from "../sandbox/policy.js";
import { createLocalSandboxPolicy } from "../sandbox/policy.js";
import { runSandboxCommand, type SandboxCommandResult } from "../sandbox/runner.js";
import type { SkillPackage } from "../skill/schema.js";

export interface FixtureCheckResult {
  id: string;
  status: "pass" | "fail" | "blocked" | "timeout" | "missing";
  command?: SandboxCommandResult;
  message: string;
}

export function renderSkillPackageFixture(): string {
  return `const { readFileSync, existsSync } = require("node:fs")
const { join } = require("node:path")

const root = process.argv[2]
if (!root) throw new Error("skill root argument missing")

const skillPath = join(root, "SKILL.md")
if (!existsSync(skillPath)) throw new Error("SKILL.md missing")

const markdown = readFileSync(skillPath, "utf8")
const required = [
  "---",
  "When to use",
  "When not to use",
  "Verification checklist",
  "Common mistakes",
  "References"
]

for (const needle of required) {
  if (!markdown.includes(needle)) throw new Error(\`missing required text: \${needle}\`)
}

if (!existsSync(join(root, "references", "research.md"))) {
  throw new Error("references/research.md missing")
}

console.log("skill package fixture passed")
`;
}

export async function writeSkillPackageFixture(skillRoot: string): Promise<string> {
  const testDir = path.join(skillRoot, "tests");
  await fs.mkdir(testDir, { recursive: true });
  const fixturePath = path.join(testDir, "skill-package-fixture.cjs");
  await fs.writeFile(fixturePath, renderSkillPackageFixture(), "utf8");
  return fixturePath;
}

export async function runSkillPackageFixture(pkg: SkillPackage, policy?: SandboxPolicy): Promise<FixtureCheckResult> {
  const fixturePath = path.join(pkg.root, "tests", "skill-package-fixture.cjs");
  try {
    await fs.stat(fixturePath);
  } catch {
    return {
      id: "fixture.skill-package",
      status: "missing",
      message: "Generated skill package fixture is missing."
    };
  }
  const sandboxPolicy = policy ?? createLocalSandboxPolicy({ projectRoot: pkg.root });
  const command = await runSandboxCommand(sandboxPolicy, {
    command: process.execPath,
    args: [fixturePath, pkg.root],
    cwd: pkg.root
  });
  return {
    id: "fixture.skill-package",
    status: command.status,
    command,
    message: command.status === "pass" ? "Generated fixture passed." : "Generated fixture did not pass."
  };
}
