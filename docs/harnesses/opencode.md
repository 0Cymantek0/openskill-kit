# OpenCode Harness Guide

OpenCode is the primary full-feature OpenSkillKit target. It gets project-local commands, agents, skills, plugin hooks, MCP config, and model routing.

## Install Flow

```bash
npm install
npm run build
npx openskill-kit osk setup --host opencode
npx openskill-kit osk setup --host opencode --yes
```

Manual flow:

```bash
npx openskill-kit init
npx openskill-kit compile --target plugin
npx openskill-kit agent attach-plugin --host opencode --dry-run
npx openskill-kit agent attach-plugin --host opencode --yes
```

Dry-run first is required for normal workflow. Apply only after reviewing planned changes.

## Files Written On Apply

- `opencode.json`: adds local `mcp.openskill-kit` with `OPENSKILLKIT_PROJECT_ROOT` and appends `.opencode/plugins/openskillkit.ts` to `plugin`.
- `.opencode/commands/osk-*.md`: 12 command-family files.
- `.opencode/agents/osk-*.md`: route-specific subagents.
- `.opencode/skills/osk-*/SKILL.md`: narrow OSK operating skills.
- `.opencode/plugins/openskillkit.ts`: metadata-only hook plugin.
- `.opencode/model-routing.json`: OpenCode projection of project model routing.
- `.openskill-kit/installs/plugin-attach-opencode-*.json`: attach receipt.

OpenSkillKit preserves existing `plugin` entries in `opencode.json` and appends `.opencode/plugins/openskillkit.ts` so OpenCode loads metadata-only hooks after restart.

## Daily Workflow

```text
/osk status
/osk task context "<work>"
...do work...
/osk task finish
/osk learn
/osk review
/osk compile
/osk deploy
```

Use `/osk learn --source opencode-ambient --apply` when OpenCode hook metadata has accumulated and the user wants to convert it into reviewable evidence. Ambient metadata is whitelisted event metadata only: no raw prompts, raw diffs, or tool output.

## Verification

```bash
npx openskill-kit status
npx openskill-kit agent plugin-status --json
npx openskill-kit osk learn --source opencode-ambient --apply
npx openskill-kit test
```

Status must show `opencode=attached` after apply. If descriptor drift appears, re-run the dry-run attach command, apply after review, then restart OpenCode so MCP descriptors refresh.

## Privacy

- No raw prompts by default.
- No raw diffs by default.
- OpenCode hooks write only `.openskill-kit/ambient/opencode-events.jsonl` metadata.
- Behavior packs exclude ambient hook metadata.
- Learned behavior remains staged until `/osk review` accepts it.
