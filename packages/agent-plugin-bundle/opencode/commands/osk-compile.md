---
description: "Compile active reviewed behavior into harness artifacts."
agent: osk-router
subtask: true
---

# /osk compile

Refresh skills, command maps, MCP descriptors, hooks, and manifests.

## First Call

Call MCP tool `osk_compile_deploy` first. If MCP unavailable, run `openskill-kit compile --target plugin` from project root.
Use action `compile` for this command family.

## Workflow

1. Compile from active reviewed behavior only.
2. Generate command maps and host artifacts.
3. Run integrity hashes.

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

Compiled targets, artifact paths, descriptor hashes, and attach next action.
