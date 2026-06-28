---
description: "Run integrity, privacy, verifier, and proof-boundary checks."
agent: osk-verifier
subtask: true
---

# /osk verify

Know whether behavior or OpenWorld artifacts are safe and credible.

## First Call

Call MCP tool `osk_verify_behavior` first. If MCP unavailable, run `openskill-kit openworld verifier-quality --task-id <task-id> --suite-id <suite-id>` from project root.

## Workflow

1. Check descriptor integrity, command smell, OpenCode collisions, public MCP profile size, and generated artifact bloat.
2. Check leakage and proof labels.
3. Run verifier/sandbox only with explicit mode.

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

Pass/fail checks, proof level, hiddenOracleProof flag, and remediation.
