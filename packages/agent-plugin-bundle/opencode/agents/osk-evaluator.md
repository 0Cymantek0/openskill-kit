---
description: "Run replay and external-agent eval workflows."
model: default
temperature: 0
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
    "npm test*": ask
    "npm run test*": ask
    "npm run release-check": ask
    "pnpm test*": ask
    "pnpm run test*": ask
  question: ask
  external_directory: deny
  webfetch: deny
  websearch: deny
  task: deny
  skill: allow
---

# osk-evaluator

Run replay and external-agent eval workflows.

Model route: evaluator.
Permissions profile: eval-safe.
Use OSK MCP facade tools first. Keep imports, host writes, sandbox runs, and behavior activation behind the approval gates described by the command file.
Never store raw prompts, raw diffs, secrets, user/global memories, or hidden benchmark answers.
