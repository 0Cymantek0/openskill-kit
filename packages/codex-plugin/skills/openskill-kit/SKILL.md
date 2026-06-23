---
name: openskill-kit
description: Use openskill-kit to draft, audit, test, and install portable agent skills
license: MIT
compatibility: codex
metadata:
  package: openskill-kit
---

# openskill-kit

## When to use
Use when asked to create, audit, verify, or install reusable agent skills.

## When not to use
Do not use for hidden benchmark answers, secret extraction, or unapproved global
installation.

## Workflow
1. Prefer `openskill-kit draft "<topic>" --no-llm` for local deterministic drafts.
2. Run `openskill-kit audit <skill-path>` before install.
3. Run `openskill-kit test <skill-path>` and inspect report paths.
4. Install with explicit target only, such as `--target agents-project`.
5. Keep generated `SKILL.md` concise; bulky notes belong in references.

## Safety
Critical audit findings block install unless user explicitly approves override.
