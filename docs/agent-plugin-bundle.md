# Agent Plugin Bundle

Compatible agents read repository skills from `.agents/skills` and can
distribute reusable skills through plugins.

Install a generated skill into the current project:

```bash
openskill-kit install <skill-path> --target agents-project --yes
```

Each successful install writes an audit receipt under
`.openskill-kit/installs/agents-project/`.

The local agent plugin bundle lives in `packages/agent-plugin-bundle` and includes an
`openskill-kit` skill describing safe CLI usage. It also includes `.mcp.json`
with an `openskill-kit-mcp` stdio server entry for local MCP-capable hosts.
