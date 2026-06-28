---
name: osk-operating-manual
description: Route OpenSkillKit command families, MCP calls, and CLI fallbacks safely.
---

# osk-operating-manual

## When to use
Use for any `/osk ...` request, plugin attach decision, command-family routing, or OSK readiness question.

## Workflow
1. Call `osk_get_status` first when MCP is available.
2. Route public requests through `commands/commands.json` and the 12 command families.
3. Use CLI fallbacks only when MCP is unavailable.
4. Keep deploy/apply operations preview-first until the user approves.

## Safety
- Do not read raw prompts, raw diffs, global memories, shell history, transcripts, or hidden oracle files silently.
- Do not activate learned behavior without `/osk review`.
