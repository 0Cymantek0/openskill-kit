---
description: "Show behavior, review, plugin, and harness health."
agent: osk-router
subtask: true
---

# /osk status

Know whether OSK is ready and what needs attention.

## First Call

Call MCP tool `osk_get_status` first. If MCP unavailable, run `openskill-kit status` from project root.

## Workflow

1. Read adaptive status.
2. Read compiled plugin and attach status.
3. Read OpenWorld artifact proof summary without running verifiers.
4. Return compact next actions.

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

Counts, readiness, descriptor drift, pending review, OpenWorld proof boundary, and next actions.
