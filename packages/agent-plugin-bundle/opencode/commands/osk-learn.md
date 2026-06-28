---
description: "Plan and run explicit, review-gated learning from selected sources."
agent: osk-learner
subtask: true
---

# /osk learn

Teach OSK from current session, safe detected sources, or explicit imports.

## First Call

Call MCP tool `osk_plan_learning_sources` first. If MCP unavailable, run `openskill-kit learn` from project root.

## Workflow

1. Detect candidate learning sources.
2. Ask or validate selected source.
3. Preview explicit imports.
4. Append redacted events only after approval.
5. Run lifecycle learning and stage candidates.

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

Sources considered/used, events appended, signals, evidence cards, candidate behavior, privacy statement.
