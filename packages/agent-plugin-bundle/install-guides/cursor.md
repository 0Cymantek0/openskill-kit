# Cursor Attach Guide

Host: Cursor

## Steps

1. Use `.mcp.json` or Cursor MCP config to start `openskill-kit-mcp` from the project root.
2. Treat `.cursor/rules` as preview-only unless the user confirms the desired rule format.
3. Read `commands/commands.json` to map `/osk ...` phrases to MCP tools or CLI fallback.
4. Use `openskill-kit detect --json` before writing any existing Cursor config.

## Safety Notes

- Cursor rule formats can vary by project; do not overwrite existing rules automatically.
- Keep OpenSkillKit generated behavior under the compiled plugin until user approves integration.

## Required First Call

Call `osk_bootstrap_session` before using learned behavior. If MCP is unavailable, run `openskill-kit status --json` from the project root.
