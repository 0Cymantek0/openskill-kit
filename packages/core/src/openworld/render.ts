import type { AnchorCard, OpenWorldEvolutionRun, OpenWorldLeakageAudit, OpenWorldTask, SkillPlan, VirtualTestSuite } from "./schema.js";

export function renderOpenWorldTaskReport(input: {
  task: OpenWorldTask;
  anchors?: AnchorCard[];
  suites?: VirtualTestSuite[];
  plans?: SkillPlan[];
  audits?: OpenWorldLeakageAudit[];
  runs?: OpenWorldEvolutionRun[];
}): string {
  const lines = [
    `# OpenWorld Task: ${input.task.title}`,
    "",
    `Task ID: ${input.task.id}`,
    `Status: ${input.task.status}`,
    `Type: ${input.task.taskType}`,
    `Privacy: ${input.task.privacyClass}`,
    `Web allowed: ${input.task.allowWeb ? "yes" : "no"}`,
    "",
    "## Prompt",
    "",
    input.task.prompt,
    "",
    "## Leakage Guard",
    "",
    `Forbidden identifiers: ${input.task.forbiddenIdentifiers.length}`,
    `Forbidden paths: ${input.task.forbiddenPaths.length}`,
    ...section("Anchors", (input.anchors ?? []).map((anchor) => `- ${anchor.id} [${anchor.anchorType}] ${anchor.claim}`)),
    ...section("Virtual Test Suites", (input.suites ?? []).map((suite) => `- ${suite.id}: ${suite.cases.length} case(s)`)),
    ...section("Skill Plans", (input.plans ?? []).map((plan) => `- ${plan.id}: ${plan.status} (${plan.anchorIds.length} anchor(s))`)),
    ...section("Leakage Audits", (input.audits ?? []).map((audit) => `- ${audit.id}: ${audit.status} (${audit.findings.length} finding(s))`)),
    ...section("Evolution Runs", (input.runs ?? []).map((run) => `- ${run.id}: ${run.status} (${run.rounds.length} round(s))`))
  ];
  return `${lines.join("\n")}\n`;
}

function section(title: string, rows: string[]): string[] {
  return ["", `## ${title}`, "", ...(rows.length ? rows : ["None"])];
}
