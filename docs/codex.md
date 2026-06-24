# Codex

Codex reads repository skills from `.agents/skills` and can distribute reusable
skills through plugins.

Install a generated skill into the current project for Codex:

```bash
openskill-kit install <skill-path> --target agents-project --yes
```

Each successful install writes an audit receipt under
`.openskill-kit/installs/agents-project/`.

The local Codex plugin bundle lives in `packages/codex-plugin` and includes an
`openskill-kit` skill describing safe CLI usage. It also includes `.mcp.json`
with an `openskill-kit-mcp` stdio server entry for local MCP-capable hosts.
