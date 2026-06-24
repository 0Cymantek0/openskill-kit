# Examples

## Instruction-only Skill

```bash
openskill-kit draft "write release notes from merged pull requests" --no-llm
```

## Repo-specific Debugging Skill

```bash
openskill-kit draft "debug failing Vitest tests in this repo" --no-llm
```

## Skill With Safe Helper Script

Helper scripts are allowed only when the scanner and user review approve them.
Scripts are never executed by default during install.

Generated drafts include a safe fixture under `tests/` that `openskill-kit test`
runs through the local sandbox. This checks package structure without executing
user-authored helper scripts.
