---
name: project-behavior
description: "Apply evidence-backed project behavior for openskill-kit."
metadata:
  source: openskill-kit
---

# Project Behavior

## When to use

Use this skill for any coding, review, documentation, testing, or repository maintenance work in this project.

## When not to use

Do not use this skill outside this repository or when user instructions explicitly replace project behavior for current task.

## Operating Rules

- Load `references/active-preferences.md` before making project-specific decisions.
- Load `references/active-workflows.md` when task involves repeated project command or review sequences.
- Prefer category shards such as `project-testing`, `project-security`, or `project-architecture` when task scope is narrow.
- Prefer `project-workflows` when an active Workflow Graph trigger matches task paths or commands.
- Follow active preferences by confidence and scope.
- If active preferences conflict with direct user instruction, follow direct instruction and record new evidence through OpenSkillKit.
- Verify with project commands when available before reporting completion.
- Keep raw private prompts, local event logs, and secret-like evidence out of generated output.

## Current Active Preferences

- No active preferences yet; follow existing repository conventions.

## Current Active Workflows

- No active workflows yet; follow existing repository conventions.
