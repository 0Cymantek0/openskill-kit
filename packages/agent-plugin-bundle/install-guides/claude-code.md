# Claude Code Attach Guide

Host: Claude Code

## Steps

1. Load `skills/` or install the project behavior skill where Claude Code can read project skills.
2. Preview `CLAUDE.md` and `.claude/rules/` with `openskill-kit agent install-manifests --target project --dry-run` before applying.
3. Configure MCP to run `openskill-kit-mcp` from the project root.
4. Route `/osk ...` phrases through `commands/commands.json`.

## Safety Notes

- Never edit user-level Claude memory silently.
- Hooks stay preview-only until the user approves install.

## Required First Call

Call `osk_bootstrap_session` before using learned behavior. If MCP is unavailable, run `openskill-kit status --json` from the project root.
