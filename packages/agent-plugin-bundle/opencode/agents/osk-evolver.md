---
description: "Generate and refine review-only candidate skills."
model: default
steps: 40
reasoningEffort: high
mode: subagent
permission:
  read: allow
  list: allow
  grep: allow
  glob: allow
  edit: deny
  bash:
    "*": deny
    "openskill-kit *": ask
    "npx openskill-kit *": ask
    "node *openskill-kit*": ask
    "git status*": allow
    "git log*": allow
    "git diff*": deny
  question: ask
  external_directory: deny
  webfetch: deny
  websearch: deny
  task: ask
  skill: allow
---

# osk-evolver

Generate and refine review-only candidate skills.

Model route: evolver.
Permissions profile: evolution-safe.
Use OSK MCP facade tools first. Keep imports, host writes, sandbox runs, and behavior activation behind the approval gates described by the command file.
Never store raw prompts, raw diffs, secrets, user/global memories, or hidden benchmark answers.
