---
description: "Plan leakage-audited sources and anchors for unfamiliar tasks."
agent: osk-researcher
subtask: true
---

# /osk research

Find grounded knowledge and verifier anchors without leaking target answers.

## First Call

Call MCP tool `osk_run_openworld_workflow` first. If MCP unavailable, run `openskill-kit openworld source-plan --task-id <task-id>` from project root.
Use action `research` for this command family.

## Workflow

1. Check leakage barrier.
2. Plan local and explicit web sources.
3. Draft anchor candidates with provenance.

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

Source plan, blocked candidates, proof level, and next evolve/verify command.
