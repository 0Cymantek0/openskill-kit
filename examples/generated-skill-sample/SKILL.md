---
name: generated-skill-sample
description: Sample generated repository debugging skill
license: MIT
compatibility: local-agent,agent-plugin
metadata:
  generated_by: openskill-kit
  example: true
---

# generated-skill-sample

## When to use
Use when a TypeScript repository has failing package scripts.

## When not to use
Do not use when failures involve secrets, production credentials, or unrelated infrastructure.

## Workflow
1. Read `package.json`, test config, and the failing output.
2. Reproduce with the smallest focused command.
3. Inspect only the code path tied to the failing assertion.
4. Make a scoped fix and rerun the focused command.
5. Run the broader repo command before install or handoff.

## Verification checklist
- `npm test`
- `npm run typecheck`

## Common mistakes
- Do not hide failing tests behind broad skips.
- Do not read `.env` files.

## References
- [Research notes](references/research.md)
