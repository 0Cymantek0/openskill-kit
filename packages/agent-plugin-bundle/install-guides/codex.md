# Codex Attach Guide

Host: Codex

## Steps

1. Attach this directory as a local plugin when the harness supports plugin directories.
2. Keep `AGENTS.md` behavior managed through `openskill-kit agent install-manifests --target project --dry-run` before applying.
3. Use `openskill-kit agent attach-plugin --host codex --dry-run` to preview the project `.codex/config.toml` MCP section.
4. Route `/osk ...` phrases through `commands/commands.json`.

## Safety Notes

- Do not import Codex memories or user-level instructions unless the user explicitly asks.
- Project `AGENTS.md` remains the safest shared instruction surface.

## Required First Call

Call `osk_bootstrap_session` before using learned behavior. If MCP is unavailable, run `openskill-kit status --json` from the project root.
