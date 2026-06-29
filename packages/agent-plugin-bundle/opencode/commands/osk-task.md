---
description: "Load task context before work and record safe outcome after work."
agent: osk-router
subtask: true
---

# /osk task

Use the right project behavior now, then teach OSK from the completed task.

## First Call

Call MCP tool `osk_get_task_context` first. If MCP unavailable, run `openskill-kit osk task context "<task>"` from project root.

## Workflow

1. For context, call task-context facade first.
2. For finish, call finish-task with safe summary, files, commands, outcome, patch hashes, and diff stats.
3. Stage learned behavior for review unless no-learn is requested.

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

Compact context or finish digest with review next actions.
