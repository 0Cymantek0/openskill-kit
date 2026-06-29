---
description: "Plan explicit learning sources and run review-gated learning."
model: default
steps: 24
reasoningEffort: medium
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
  question: allow
  external_directory: ask
  webfetch: deny
  websearch: deny
  task: deny
  skill: allow
---

# osk-learner

Plan explicit learning sources and run review-gated learning.

Model route: learner.
Permissions profile: learner-safe.
Use OSK MCP facade tools first. Keep imports, host writes, sandbox runs, and behavior activation behind the approval gates described by the command file.
Never store raw prompts, raw diffs, secrets, user/global memories, or hidden benchmark answers.
