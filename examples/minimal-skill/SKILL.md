---
name: minimal-skill
description: Minimal instruction-only skill example
license: MIT
compatibility: opencode,codex
metadata:
  example: true
---

# minimal-skill

## When to use
Use for tiny repeatable workflows that need no helper script.

## When not to use
Do not use for repo-specific tasks or unsafe automation.

## Workflow
1. Read the task and nearby project instructions.
2. Make the smallest useful change.
3. Run the narrowest verification command.

## Verification checklist
- Run the command named by the current repo or user.

## Common mistakes
- Do not add broad rules for unrelated tasks.

## References
- Keep bulky notes outside the main skill.
