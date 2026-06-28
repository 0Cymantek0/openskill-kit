---
description: "Measure OSK behavior through replay or external-agent evals."
agent: osk-evaluator
subtask: true
---

# /osk eval

Check whether OSK improves outcomes and does not bloat context.

## First Call

Call MCP tool `osk_run_eval` first. If MCP unavailable, run `openskill-kit eval` from project root.

## Workflow

1. Run replay or configured external-agent eval.
2. Summarize pass/fail and deltas.
3. Record calibration-safe outcomes.

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

Eval status, baseline comparison if present, artifacts, and residual risk.
