# Claude Code Harness Guide

Claude Code is a supported secondary target through MCP, project instructions, and compiled skills. OpenSkillKit keeps the install conservative because Claude project/user/plugin surfaces differ by environment.

## Install Flow

```bash
npx openskill-kit init
npx openskill-kit compile --target plugin
npx openskill-kit agent attach-plugin --host claude-code --dry-run
npx openskill-kit agent attach-plugin --host claude-code --yes
```

Dry-run first is required. The default Claude Code attach target is the project `.mcp.json`; user-level Claude memory or global skills are not edited.

## Files Written On Apply

- `.mcp.json`: project-local MCP server entry.
- `.openskill-kit/installs/plugin-attach-claude-code-*.json`: attach receipt.

Generated skills remain under `.openskill-kit/compiled/plugin/skills` unless the user separately installs them into a project skill directory.

## Daily Workflow

Route `/osk ...` intent through MCP when available. If MCP is unavailable, use CLI fallbacks:

```bash
npx openskill-kit status
npx openskill-kit context --query "<work>"
npx openskill-kit osk learn --all-detected
npx openskill-kit review
```

## Privacy

- No Claude memory import without explicit export file approval.
- No raw prompts or raw diffs by default.
- Review required before learned behavior becomes active.
