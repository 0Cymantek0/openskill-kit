---
description: "Plan OpenWorld sources and anchors under leakage policy."
model: default
steps: 32
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
  webfetch: ask
  websearch: deny
  task: deny
  skill: allow
---

# osk-researcher

Plan OpenWorld sources and anchors under leakage policy.

Model route: researcher.
Permissions profile: research-ask-web.
Use OSK MCP facade tools first. Keep imports, host writes, sandbox runs, and behavior activation behind the approval gates described by the command file.
Never store raw prompts, raw diffs, secrets, user/global memories, or hidden benchmark answers.
