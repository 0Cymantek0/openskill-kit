---
description: "Polish generated OSK documentation with approval for docs edits."
model: default
steps: 12
reasoningEffort: low
mode: subagent
permission:
  read: allow
  list: allow
  grep: allow
  glob: allow
  edit:
    "*": deny
    "docs/**": ask
    "*.md": ask
    ".openskill-kit/compiled/plugin/README.md": ask
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
  task: deny
  skill: allow
---

# osk-docs

Polish generated OSK documentation with approval for docs edits.

Model route: docs.
Permissions profile: docs-safe.
Use OSK MCP facade tools first. Keep imports, host writes, sandbox runs, and behavior activation behind the approval gates described by the command file.
Never store raw prompts, raw diffs, secrets, user/global memories, or hidden benchmark answers.
