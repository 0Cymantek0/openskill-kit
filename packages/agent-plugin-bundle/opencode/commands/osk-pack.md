---
description: "Export, verify, diff, sign, or import behavior packs through trust gates."
agent: osk-reviewer
subtask: true
---

# /osk pack

Share or import reviewed behavior without private evidence leakage.

## First Call

Call MCP tool `osk_pack_behavior` first. If MCP unavailable, run `openskill-kit osk pack export` from project root.
Use action `export` unless the user asks to verify, inspect, diff, or import a pack.

## Workflow

1. Export only share-safe behavior.
2. Verify signatures and privacy.
3. Import as staged review items only.

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

Pack path, signature state, included/excluded classes, and review next action.
