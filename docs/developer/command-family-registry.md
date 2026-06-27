# Command Family Registry

The command-family registry is the source of truth for the 12 public `/osk` workflows.

Source:

```text
packages/core/src/commands/families.ts
```

Generated or projected artifacts:

- `docs/commands.md`
- `docs/commands/learn.md`
- `.openskill-kit/compiled/plugin/commands/commands.json`
- `.openskill-kit/compiled/plugin/commands/families.json`
- `.openskill-kit/compiled/plugin/commands/osk.md`
- `.openskill-kit/compiled/plugin/opencode/commands/osk-*.md`
- `.openskill-kit/compiled/plugin/README.md`
- `packages/agent-plugin-bundle/commands/commands.json`

## Requirements

Every public family must define:

- user intent;
- why it is public;
- read/write and approval class;
- MCP first tool;
- CLI fallback;
- skills and subagents;
- workflow steps;
- artifacts read/written;
- never-read and never-write rules;
- output summary;
- tests.

## Invariants

- Exactly 12 public command families.
- No duplicate command files.
- Generated OpenCode commands must not collide with common OpenCode built-ins.
- Approval-required operations must not hide behind read-only aliases.
- Generated prompts must include privacy boundaries: no raw prompts, raw diffs, secrets, hidden answers, or memory imports by default.

## Verification

```bash
npm test -- packages/core/tests/command-family.test.ts
npm test -- packages/core/tests/deep-architecture.test.ts
```
