# Generic MCP Attach Guide

Host: Generic MCP client

## Steps

1. Register `openskill-kit-mcp` as a stdio MCP server with working directory set to the project root.
2. Call `osk_bootstrap_session` first.
3. Check `plugin.ready`, `plugin.integrityIssues`, and `plugin.missing` before trusting generated artifacts.
4. Use `commands/commands.json` for `/osk ...` intent mapping.

## Safety Notes

- Compare descriptor hashes before trusting tools.
- Approval-required tools must stay behind explicit user confirmation.

## Required First Call

Call `osk_bootstrap_session` before using learned behavior. If MCP is unavailable, run `openskill-kit status --json` from the project root.
