import { promises as fs } from "node:fs";
import path from "node:path";
import { collectRepoContext, type RepoContext } from "../context/collector.js";
import { slugifySkillName } from "../skill/schema.js";

export interface DraftOptions {
  topic: string;
  projectRoot: string;
  noLlm?: boolean;
  now?: Date;
}

export interface DraftResult {
  runId: string;
  runDir: string;
  skillName: string;
  skillDir: string;
  files: string[];
  warnings: string[];
}

export async function draftSkill(options: DraftOptions): Promise<DraftResult> {
  const now = options.now ?? new Date();
  const context = await collectRepoContext(options.projectRoot);
  const skillName = slugifySkillName(options.topic);
  const runId = `${formatTimestamp(now)}-${skillName}`;
  const runDir = path.join(options.projectRoot, ".openskill-kit", "runs", runId);
  const candidateDir = path.join(runDir, "candidate", skillName);
  const referencesDir = path.join(candidateDir, "references");
  await fs.mkdir(referencesDir, { recursive: true });

  const skillMarkdown = renderSkillMarkdown(skillName, options.topic, context);
  const researchMarkdown = renderResearchMarkdown(options.topic, context);
  const planMarkdown = renderPlanMarkdown(options.topic, context);
  const runJson = {
    runId,
    topic: options.topic,
    mode: options.noLlm ? "deterministic-local" : "deterministic-local",
    createdAt: now.toISOString(),
    skillName,
    artifacts: {
      context: "context.json",
      plan: "plan.md",
      candidate: path.join("candidate", skillName, "SKILL.md").replaceAll("\\", "/")
    }
  };

  await fs.writeFile(path.join(candidateDir, "SKILL.md"), skillMarkdown, "utf8");
  await fs.writeFile(path.join(referencesDir, "research.md"), researchMarkdown, "utf8");
  await fs.writeFile(path.join(runDir, "context.json"), JSON.stringify(context, null, 2), "utf8");
  await fs.writeFile(path.join(runDir, "plan.md"), planMarkdown, "utf8");
  await fs.writeFile(path.join(runDir, "run.json"), JSON.stringify(runJson, null, 2), "utf8");

  return {
    runId,
    runDir,
    skillName,
    skillDir: candidateDir,
    files: [
      path.join(runDir, "run.json"),
      path.join(runDir, "context.json"),
      path.join(runDir, "plan.md"),
      path.join(candidateDir, "SKILL.md"),
      path.join(referencesDir, "research.md")
    ],
    warnings: context.warnings
  };
}

function renderSkillMarkdown(skillName: string, topic: string, context: RepoContext): string {
  const testCommands = Object.entries(context.scripts)
    .filter(([name]) => /test|lint|typecheck|check/.test(name))
    .map(([name, command]) => `- \`${packageRun(context.packageManager, name)}\` (${command})`)
    .join("\n") || "- Inspect package scripts and choose the narrowest real verification command.";
  const frameworks = context.frameworks.length ? context.frameworks.join(", ") : "none detected";
  return `---\nname: ${skillName}\ndescription: Reusable workflow for ${topic.slice(0, 160)}\nlicense: MIT\ncompatibility: opencode,codex\nmetadata:\n  generated_by: openskill-kit\n  mode: deterministic-local\n---\n\n# ${skillName}\n\n## When to use\nUse when task matches: ${topic}\n\n## When not to use\nDo not use for unrelated repos, secret extraction, destructive maintenance, or tasks needing hidden benchmark answers.\n\n## Workflow\n1. Read local repo instructions, README, and relevant config before editing.\n2. Confirm detected stack: ${frameworks}.\n3. Identify smallest code path tied to task and inspect tests before changing behavior.\n4. Make focused edits, then run real verification commands.\n5. If verification fails, diagnose root cause, update workflow notes, and rerun.\n\n## Verification checklist\n${testCommands}\n- Run a focused command first, then broader checks if behavior is shared.\n- Record exact command output and changed files.\n\n## Common mistakes\n- Do not read .env files or print secrets.\n- Do not install global tools unless user approves.\n- Do not treat generated verifier output as hidden benchmark truth.\n- Do not paste bulky research into chat; use references instead.\n\n## References\n- [Research notes](references/research.md)\n`;
}

function renderResearchMarkdown(topic: string, context: RepoContext): string {
  return `# Research Notes\n\nTopic: ${topic}\n\n## Provenance\n\n- Source type: trusted local repository context\n- Root: ${context.root}\n- Package manager: ${context.packageManager}\n- Config files: ${context.configFiles.join(", ") || "none detected"}\n- Existing skill directories: ${context.existingSkillDirs.join(", ") || "none detected"}\n\n## Context Summary\n\nDetected frameworks: ${context.frameworks.join(", ") || "none"}\n\nScripts:\n${Object.entries(context.scripts).map(([name, value]) => `- ${name}: ${value}`).join("\n") || "- none"}\n\n## Incomplete Information\n\nNo external web research or LLM provider was used for this deterministic draft. Treat claims as local-context-only until stronger evidence is added.\n`;
}

function renderPlanMarkdown(topic: string, context: RepoContext): string {
  return `# Draft Plan\n\nTopic: ${topic}\n\n1. Build concise portable SKILL.md.\n2. Keep bulky local context in references.\n3. Include repo verification commands from package scripts.\n4. Audit generated package with scanner.\n5. Install only after validation passes.\n\nDetected package manager: ${context.packageManager}\n`;
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function packageRun(pm: RepoContext["packageManager"], script: string): string {
  if (pm === "pnpm") return `pnpm ${script}`;
  if (pm === "yarn") return `yarn ${script}`;
  if (pm === "bun") return `bun run ${script}`;
  return `npm run ${script}`;
}
