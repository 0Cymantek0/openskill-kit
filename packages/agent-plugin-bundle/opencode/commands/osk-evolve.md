---
description: "Generate review-only candidate skills from anchored OpenWorld evidence."
agent: osk-evolver
subtask: true
---

# /osk evolve

Create a new source-grounded skill when local memory is not enough.

## First Call

Call MCP tool `osk_run_openworld_workflow` first. If MCP unavailable, run `openskill-kit openworld refine --task-id <task-id> --suite-id <suite-id> --candidate-id <candidate-id>` from project root.
Use action `evolve` for this command family.

## Workflow

1. Generate or select candidate skill.
2. Run visible verifier refinement.
3. Run holdout check.
4. Keep promotion review-only.

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

Candidate, verifier results, proof level, limitations, and review next action.
