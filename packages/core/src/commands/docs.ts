import { OSK_PUBLIC_COMMAND_FAMILIES, type OskCommandFamily } from "./families.js";

export function renderOskCommandsMarkdown(families: OskCommandFamily[] = OSK_PUBLIC_COMMAND_FAMILIES): string {
  return [
    "# OpenSkillKit Commands",
    "",
    "OpenSkillKit exposes 12 public `/osk` command families. Low-level commands and MCP tools remain available for advanced workflows, but harnesses should route normal users through these families.",
    "",
    "| Command | Intent | Safe default | Writes | Approval | Key artifact |",
    "|---|---|---|---|---|---|",
    ...families.map((family) => {
      const artifacts = [...new Set([...family.artifactsRead, ...family.artifactsWrite])];
      return [
        `\`${family.publicCommand}\``,
        family.userIntent,
        family.readOnly ? "Read-only" : "Preview or staged write",
        family.artifactsWrite.length ? family.artifactsWrite.map(code).join("<br>") : "No writes",
        family.approvalRequired ? "Required" : "Not by default",
        artifacts.slice(0, 3).map(code).join("<br>")
      ].join(" | ");
    }).map((row) => `| ${row} |`),
    "",
    "## Invariants",
    "",
    "- Never store raw prompts by default.",
    "- Never store raw diffs by default.",
    "- Never import memories, transcripts, shell history, or hidden benchmark answers silently.",
    "- Keep learned behavior staged until `/osk review` accepts it.",
    "- Keep deploy/apply operations dry-run first unless the user explicitly approves.",
    "",
    "## Family Details",
    "",
    ...families.flatMap((family) => [
      `### ${family.publicCommand}`,
      "",
      family.oneLine,
      "",
      `- Why public: ${family.whyPublic}`,
      `- CLI fallback: \`${family.cli}\``,
      `- MCP first call: \`${family.mcpTool ?? "none"}\``,
      `- Skills: ${family.skills.map(code).join(", ") || "none"}`,
      `- Subagents: ${family.subagents.map(code).join(", ") || "none"}`,
      `- Output: ${family.outputSummary}`,
      "",
      "Workflow:",
      "",
      ...family.workflowSteps.map((step, index) => `${index + 1}. ${step}`),
      ""
    ])
  ].join("\n");
}

export function renderOskLearnMarkdown(family: OskCommandFamily = OSK_PUBLIC_COMMAND_FAMILIES.find((item) => item.id === "learn")!): string {
  return [
    "# /osk learn",
    "",
    family.userIntent,
    "",
    "## Source Selection",
    "",
    "| Source | Default | Policy | Notes |",
    "|---|---|---|---|",
    "| Current session safe summary | selected | safe metadata | Uses OSK task-finish summaries and safe event metadata. |",
    "| Git metadata | selected for all-detected | safe metadata | Branch, changed file names, diff stats, and commit subjects only. No raw diffs. |",
    "| Codex/Claude/Cursor/manual export file | not selected | explicit import | Preview first, apply only after explicit approval. |",
    "| Review notes file | not selected | explicit import | Converts supplied notes into redacted review-comment events. |",
    "| Terminal history file | not selected | explicit import | Requires explicit file path; command metadata only. |",
    "| User/global memory stores | never selected | blocked | Metadata-only detection; import requires an explicit export file. |",
    "",
    "## Workflow",
    "",
    ...family.workflowSteps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## CLI Examples",
    "",
    "```bash",
    "openskill-kit osk learn",
    "openskill-kit osk learn --all-detected",
    "openskill-kit osk learn --source current-session --source git-local --apply",
    "openskill-kit osk review --write",
    "```",
    "",
    "## Output Contract",
    "",
    "- Sources considered and used.",
    "- Events appended.",
    "- Signals extracted.",
    "- Candidate preferences and workflows.",
    "- Review queue path.",
    "- Privacy statement confirming no raw prompts, raw diffs, secrets, or hidden benchmark answers were copied.",
    "",
    "Learned behavior remains staged until `/osk review` accepts it.",
    ""
  ].join("\n");
}

function code(value: string): string {
  return `\`${value}\``;
}
