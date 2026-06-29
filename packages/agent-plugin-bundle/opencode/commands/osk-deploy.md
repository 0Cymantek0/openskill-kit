---
description: "Preview or apply project-local harness attachment with receipts."
agent: osk-router
subtask: true
---

# /osk deploy

Make the current harness use OSK artifacts safely.

## First Call

Call MCP tool `osk_compile_deploy` first. If MCP unavailable, run `openskill-kit osk deploy --host opencode` from project root.
Use action `deploy` for this command family.

## Workflow

1. Compile plugin if needed.
2. Preview host config, generated OpenCode files, hooks, and instruction manifests.
3. Apply only with explicit approval.
4. Write receipts.

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

Planned/applied host files, hook config, instruction manifests, receipts, restart instructions.
