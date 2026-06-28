---
description: "Initialize project-local OSK state and preview harness attach."
agent: osk-router
subtask: true
---

# /osk init

Set up OpenSkillKit in this repository without silently taking over the harness.

## First Call

Call MCP tool `osk_get_status` first. If MCP unavailable, run `openskill-kit init && openskill-kit status` from project root.

## Workflow

1. Initialize local OSK state if missing.
2. Run status and detection.
3. Show plugin readiness and dry-run attach next actions.

## Safety

Approval required: no.
- Never read raw prompts by default.
- Never read raw diffs by default.
- Never read user/global memories without explicit export approval.
- Never read shell history paths without explicit file selection.
- Never read hidden benchmark answers.
- Never write active learned behavior without review.
- Never write global harness config by default.
- Never write raw transcript copies into compiled artifacts.

## Return

Readiness, detected harnesses, privacy gates, and next command.
