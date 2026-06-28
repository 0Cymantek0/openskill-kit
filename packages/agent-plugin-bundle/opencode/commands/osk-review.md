---
description: "Inspect and approve, reject, lock, or demote candidate behavior."
agent: osk-reviewer
subtask: true
---

# /osk review

Decide what learned behavior becomes active.

## First Call

Call MCP tool `osk_review_behavior` first. If MCP unavailable, run `openskill-kit review` from project root.
Use action `queue` unless the user explicitly asks to apply review decisions.

## Workflow

1. Show pending behavior with evidence.
2. Explain risk and compile impact.
3. Apply selected review action only when requested.

## Safety

Approval required: yes.
- Never read raw prompts by default.
- Never read raw diffs by default.
- Never read user/global memories without explicit export approval.
- Never read shell history paths without explicit file selection.
- Never read hidden benchmark answers.
- Never write active learned behavior without review.
- Never write global harness config by default.
- Never write raw transcript copies into compiled artifacts.

## Return

Pending items, evidence summaries, actions taken, and compile next action.
