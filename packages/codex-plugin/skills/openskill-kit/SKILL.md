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
1. Prefer `openskill-kit forge "<topic>" --no-llm` when user wants draft plus local verification loop.
2. Use `openskill-kit draft "<topic>" --no-llm` only when a candidate without loop diagnosis is enough.
3. Run `openskill-kit audit <skill-path>` before install.
4. Run `openskill-kit test <skill-path>` and inspect report paths.
5. Install with explicit target only, such as `--target agents-project`.
6. Keep generated `SKILL.md` concise; bulky notes belong in references.

## Safety
Critical audit findings block install unless user explicitly approves override.
