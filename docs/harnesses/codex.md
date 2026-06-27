# Codex Harness Guide

Codex is a supported secondary target. OpenSkillKit attaches through project-local `.codex/config.toml`, AGENTS.md-compatible instructions, skills, and MCP.

## Install Flow

```bash
npx openskill-kit init
npx openskill-kit compile --target plugin
npx openskill-kit agent attach-plugin --host codex --dry-run
npx openskill-kit agent attach-plugin --host codex --yes
```

Dry-run first is required. The planner replaces only the `[mcp_servers."openskill-kit"]` section and preserves unrelated Codex settings.

## Files Written On Apply

- `.codex/config.toml`: project-local MCP server entry.
- `.openskill-kit/installs/plugin-attach-codex-*.json`: attach receipt.

Codex user/global memories are never imported silently. Use explicit export files and `/osk learn` import preview before apply.

## Daily Workflow

Use the OSK MCP tools when available, then CLI fallback from the project root:

```bash
npx openskill-kit status
npx openskill-kit context --query "<work>"
npx openskill-kit finish-task --summary "<safe summary>" --outcome accepted
npx openskill-kit osk learn --all-detected
npx openskill-kit review
```

## Privacy

- Project-local config only by default.
- No user/global memory reads without explicit export approval.
- No raw prompts or raw diffs by default.
- Behavior activation remains review-gated.
