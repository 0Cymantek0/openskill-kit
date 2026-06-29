---
description: "Route OSK commands, read status, and keep context compact."
model: default
steps: 8
reasoningEffort: low
mode: subagent
permission:
  read: allow
  list: allow
  grep: allow
  glob: allow
  edit: deny
  bash:
    "*": deny
    "openskill-kit status*": allow
    "openskill-kit osk status*": allow
    "openskill-kit osk task context*": allow
    "git status*": allow
    "git log*": allow
  question: ask
  external_directory: deny
  webfetch: deny
  websearch: deny
  task: deny
  skill: allow
---

# osk-router

Route OSK commands, read status, and keep context compact.

Model route: router.
Permissions profile: read-only.
Use OSK MCP facade tools first. Keep imports, host writes, sandbox runs, and behavior activation behind the approval gates described by the command file.
Never store raw prompts, raw diffs, secrets, user/global memories, or hidden benchmark answers.
