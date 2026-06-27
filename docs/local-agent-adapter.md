# Local Agent Adapter

Local adapters discover skills in:

- `.local-agent/skills/<name>/SKILL.md`
- `~/.config/local-agent/skills/<name>/SKILL.md`
- `.agents/skills/<name>/SKILL.md`
- `~/.agents/skills/<name>/SKILL.md`

Install a generated skill into a project:

```bash
openskill-kit install <skill-path> --target local-project --yes
```

Each successful install writes an audit receipt under
`.openskill-kit/installs/local-project/`.

The local adapter package exposes thin tools that call core functions instead
of reimplementing drafting, audit, test, or install logic.

Tool surface includes bootstrap, status, compile, draft, evolve, audit, test,
evaluate, install, list, and doctor. `bootstrap` returns the same plugin
readiness contract as MCP: attach path, MCP command, published skills,
capabilities, privacy exclusions, approval gates, and next actions. `compile`
defaults to the `plugin` target so a harness can create the attachable bundle in
one call.

For MCP-capable hosts, run `openskill-kit-mcp`. It exposes the same core through
stdio tools with sanitized structured output.
