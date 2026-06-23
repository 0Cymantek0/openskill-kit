# Codex

Codex reads repository skills from `.agents/skills` and can distribute reusable
skills through plugins.

Install a generated skill into the current project for Codex:

```bash
openskill-kit install <skill-path> --target agents-project --yes
```

The local Codex plugin bundle lives in `packages/codex-plugin` and includes an
`openskill-kit` skill describing safe CLI usage.
