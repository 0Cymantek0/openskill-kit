# Troubleshooting

## `doctor` reports unwritable target

Run from a directory you own or choose a project-local target.

## Install blocked by critical risk

Inspect the audit report. Do not override unless you understand the finding.

## Skill not visible in Codex or OpenCode

Restart the agent and confirm the skill folder contains `SKILL.md` with valid
frontmatter.

## Sandbox command blocked

Check cwd stays inside the project root, command is allowlisted, and arguments
do not contain shell metacharacters.
