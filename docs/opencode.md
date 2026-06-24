# OpenCode

OpenCode discovers skills in:

- `.opencode/skills/<name>/SKILL.md`
- `~/.config/opencode/skills/<name>/SKILL.md`
- `.agents/skills/<name>/SKILL.md`
- `~/.agents/skills/<name>/SKILL.md`

Install a generated skill into a project:

```bash
openskill-kit install <skill-path> --target opencode-project --yes
```

The OpenCode adapter package exposes thin tools that call core functions instead
of reimplementing drafting, audit, test, or install logic.

Tool surface includes draft, evolve, audit, test, install, list, and doctor.

For MCP-capable hosts, run `openskill-kit-mcp`. It exposes the same core through
stdio tools with sanitized structured output.
