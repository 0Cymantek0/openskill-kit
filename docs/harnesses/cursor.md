# Cursor Harness Guide

Cursor support is preview. OpenSkillKit attaches through project-local MCP config and does not assume a stable Cursor rule format.

## Install Flow

```bash
npx openskill-kit init
npx openskill-kit compile --target plugin
npx openskill-kit agent attach-plugin --host cursor --dry-run
npx openskill-kit agent attach-plugin --host cursor --yes
```

Dry-run first is required. Review `.cursor/mcp.json` before apply.

## Files Written On Apply

- `.cursor/mcp.json`: project-local MCP server entry.
- `.openskill-kit/installs/plugin-attach-cursor-*.json`: attach receipt.

## Daily Workflow

Use MCP facade tools if Cursor exposes them. Otherwise run the CLI from the project root:

```bash
npx openskill-kit status
npx openskill-kit context --query "<work>"
npx openskill-kit osk learn --all-detected
npx openskill-kit review
```

## Privacy

- Cursor transcript/session files are explicit-import only.
- No raw prompts or raw diffs by default.
- Preview imports before applying any learning source.
