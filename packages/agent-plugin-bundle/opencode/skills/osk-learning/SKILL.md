---
name: osk-learning
description: Plan and run preview-first OpenSkillKit learning from explicit safe sources.
---

# osk-learning

## When to use
Use for `/osk learn`, interaction import previews, current-session learning, review-note learning, terminal-history files, or git metadata learning.

## Workflow
1. List candidate learning sources and their privacy risk.
2. Ask the user which source to use unless the command already selected one.
3. Preview imports before apply.
4. Return a digest with events, signals, candidate preferences, and review next actions.

## Safety
- Explicit imports require approval before events are appended.
- Learning produces candidate or staged behavior only; review decides activation.
