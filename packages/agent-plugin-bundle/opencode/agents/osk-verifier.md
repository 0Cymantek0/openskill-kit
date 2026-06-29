---
description: "Run integrity, privacy, verifier, and proof-boundary checks."
model: default
temperature: 0
steps: 24
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

# osk-verifier

Run integrity, privacy, verifier, and proof-boundary checks.

Model route: verifier.
Permissions profile: sandboxed-verifier.
Use OSK MCP facade tools first. Keep imports, host writes, sandbox runs, and behavior activation behind the approval gates described by the command file.
Never store raw prompts, raw diffs, secrets, user/global memories, or hidden benchmark answers.
