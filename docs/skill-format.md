# Skill Format

A skill package is a directory containing `SKILL.md` and optional
`references/`, `scripts/`, `assets/`, and `tests/`.

`SKILL.md` must start with YAML frontmatter:

```yaml
---
name: repo-test-workflow
description: Debug and verify repository test failures
license: MIT
compatibility: opencode,codex
metadata:
  generated_by: openskill-kit
---
```

Names must match `^[a-z0-9]+(-[a-z0-9]+)*$` and be 1 to 64 characters.

Generated run folders also include `evidence-ledger.json` and
`verifier-pack.json` beside the candidate folder. Bulky provenance belongs there
or in `references/`, not in the main `SKILL.md`.
