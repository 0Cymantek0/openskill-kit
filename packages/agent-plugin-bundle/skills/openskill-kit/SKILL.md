---
name: openskill-kit
description: Use OpenSkillKit command families to load, learn, review, verify, compile, and deploy project behavior safely
license: MIT
compatibility: agent-plugin
metadata:
  package: openskill-kit
---

# openskill-kit

## When to use
Use when a harness or agent needs project-local behavior memory, `/osk ...`
command routing, review-gated learning, OpenWorld research/evolution, verifier
reports, compiled skills, MCP profiles, or behavior packs.

## When not to use
Do not use for hidden benchmark answers, secret extraction, or unapproved global
installation. Do not silently import raw memories, shell history, transcripts,
raw prompts, raw diffs, private evidence, or hidden oracle files.

## Workflow
1. Call `osk_get_status` first when MCP is available. If MCP is not
   available, run `openskill-kit status --json` from the project root.
2. For `/osk ...` requests, read `commands/commands.json`, `commands/osk.md`,
   or `commands/families.json`; route to the mapped MCP tool before using the
   CLI fallback.
3. Keep normal users on the 12 command families: `/osk init`, `/osk status`,
   `/osk task`, `/osk learn`, `/osk review`, `/osk research`, `/osk evolve`,
   `/osk verify`, `/osk compile`, `/osk deploy`, `/osk eval`, and `/osk pack`.
4. Use `/osk task context` before coding when project behavior might matter.
   Use `/osk task finish` after verification with only a safe summary, touched
   file names, command names, command statuses, and outcome.
5. Use `/osk learn` only with an explicit source plan. Preview imports first;
   apply only after approval. Learned behavior remains staged until
   `/osk review` accepts it.
6. Use `/osk review` for all activation, rejection, edit, lock, demotion, and
   workflow decisions. Never activate candidate behavior by compile alone.
7. Use `/osk research`, `/osk evolve`, and `/osk verify` for unfamiliar-domain
   work. Treat OpenWorld artifact-verifier results as artifact evidence only;
   do not claim hidden-oracle benchmark proof unless a real hidden oracle was
   run outside OSK and reported separately.
8. Use `/osk compile` to refresh skills, context packs, MCP descriptors,
   command maps, hooks, and plugin artifacts after reviewed behavior changes.
9. Use `/osk deploy` or `openskill-kit agent attach-plugin --host <host>
   --dry-run` before writing host config. OpenCode is the primary full-feature
   target; Codex, Claude Code, Cursor, and generic MCP remain supported or
   preview paths according to their install guide.
10. Use `/osk eval` before relying on major behavior changes and `/osk pack`
    for share/import flows. Pack import and apply stay review-gated.
11. Compatibility `draft`, `audit`, `test`, `evaluate`, and `install` commands
    remain available for manual skill scaffolding, but they are not the primary
    daily harness workflow.

## Safety
Critical audit findings block install unless the user explicitly approves an
override. Hidden-test, oracle, and ground-truth evidence inputs are blocked by
leakage audit. The bundled `.mcp.json` exposes the same core through
`openskill-kit-mcp`.

Slash command support is harness-owned. This plugin publishes the command map,
MCP descriptors, profiles, CLI fallbacks, safety gates, and install guides. A
harness must still enforce approvals for imports, deploy/apply actions, and
review-gated learning.
