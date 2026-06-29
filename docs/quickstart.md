# Quickstart

OpenSkillKit is meant to be used from a coding harness first. OpenCode is the
primary full-feature target because it supports project commands, agents,
skills, plugin hooks, MCP config, and model routing.

## Install For OpenCode

```bash
npm install
npm run build

# Preview every project-local write first.
npx openskill-kit osk setup --host opencode

# Apply only after reviewing the preview.
npx openskill-kit osk setup --host opencode --yes
```

Restart OpenCode after setup so it reloads `opencode.json`/`opencode.jsonc`,
`.opencode/plugins/openskillkit.ts`, generated `/osk` commands, agents, and
skills.

## Daily Harness Loop

Run these inside OpenCode after setup:

```text
/osk status
/osk task context "<work>"
...do work and verify...
/osk task finish
/osk learn
/osk review
/osk compile
/osk deploy
```

Expected routing:

- `osk_get_status` is the first MCP call.
- `/osk learn` uses a source picker unless a source is already selected.
- OpenCode ambient learning reads only
  `.openskill-kit/ambient/opencode-events.jsonl` safe metadata.
- Learned behavior remains staged until `/osk review` accepts it.
- `/osk deploy` previews harness writes before applying them.

## CLI Fallbacks

Use CLI fallbacks when MCP is unavailable:

```bash
npx openskill-kit osk status --json
npx openskill-kit osk learn
npx openskill-kit osk learn --source opencode-ambient --apply
npx openskill-kit osk review --write
npx openskill-kit osk compile
npx openskill-kit osk deploy --host opencode
npx openskill-kit osk deploy --host opencode --yes
```

Generic MCP fallback for non-OpenCode harnesses:

```bash
npx openskill-kit compile --target plugin
npx openskill-kit agent attach-plugin --host generic-mcp --dry-run
```

## Uninstall

```bash
# Preview removals.
npx openskill-kit osk uninstall --host opencode

# Remove generated OpenCode files, hook config, and managed instruction blocks.
npx openskill-kit osk uninstall --host opencode --yes
```

Local `.openskill-kit` state is preserved unless `--delete-state --yes` is
provided.

## Generated Artifacts

- `.openskill-kit/events/*.jsonl`: redacted local events.
- `.openskill-kit/signals/normalized.jsonl`: learnable signals.
- `.openskill-kit/evidence/cards/`: sanitized evidence cards.
- `.openskill-kit/preferences/graph.json`: Behavior Profile.
- `.openskill-kit/preferences/calibration.json`: review-outcome reliability.
- `.openskill-kit/preferences/integrity-report.json`: memory integrity checks.
- `.openskill-kit/detection/`: metadata-only scan results for harness surfaces.
- `.openskill-kit/preferences/active/`: reviewed Active Behavior Layer.
- `.openskill-kit/compiled/context-pack.md`: compact agent context.
- `.openskill-kit/compiled/plugin/`: attachable plugin bundle.
- `.openskill-kit/compiled/plugin/opencode/commands/osk-*.md`: OpenCode commands.
- `.openskill-kit/compiled/plugin/opencode/agents/osk-*.md`: OpenCode agents.
- `.openskill-kit/compiled/plugin/opencode/skills/osk-*/SKILL.md`: OSK skills.
- `.openskill-kit/compiled/plugin/opencode/plugins/openskillkit.ts`: metadata-only OpenCode hook plugin.
- `.openskill-kit/compiled/project-behavior-pack/`: shareable reviewed behavior.
- `.openskill-kit/ambient/opencode-events.jsonl`: privacy-safe OpenCode hook metadata.
- `.openskill-kit/evals/traces/opencode-events.raw.jsonl`: opt-in eval/debug trace file, never imported as normal learning.
- `.openskill-kit/installs/`: setup, deploy, hook, manifest, and uninstall receipts.
- `.agents/hooks/openskill-kit.json`: installed project-local lifecycle hook config.
- `AGENTS.md`, `CLAUDE.md`, `.claude/rules/`: optional managed project manifests.

Manual skill scaffolding remains available for advanced compatibility:

```bash
npx openskill-kit draft "handle repo test failures" --no-llm
npx openskill-kit evolve "handle repo test failures" --no-llm
npx openskill-kit test .openskill-kit/runs/<run>/candidate/handle-repo-test-failures
```
