# Quickstart

```bash
npm install
npm run build
npx openskill-kit init
npx openskill-kit detect
npx openskill-kit observe --type user-prompt-submit --text "Always run npm test before final response."
npx openskill-kit learn
npx openskill-kit review --activate-all
npx openskill-kit review --tui
npx openskill-kit compile
npx openskill-kit compile --include-staged-preview
npx openskill-kit agent install-manifests --target project --dry-run
npx openskill-kit agent install-manifests --target project --yes
npx openskill-kit agent uninstall-manifests --target project --dry-run
npx openskill-kit daemon
npx openskill-kit agent doctor
npx openskill-kit agent install-hooks --target project --yes
npx openskill-kit install --target agents-project --yes
npx openskill-kit eval
npx openskill-kit eval --compare-baseline
npx openskill-kit explain <preference-id> --evidence
npx openskill-kit route --query "parser test change" --path src/parser/tokenizer.ts
npx openskill-kit calibration
npx openskill-kit pack
npx openskill-kit status --json
```

Generated adaptive artifacts:

- `.openskill-kit/events/*.jsonl`: redacted local events.
- `.openskill-kit/signals/normalized.jsonl`: learnable signals.
- `.openskill-kit/evidence/cards/`: sanitized evidence cards behind learned preferences.
- `.openskill-kit/preferences/graph.json`: Behavior Profile.
- `.openskill-kit/preferences/calibration.json`: review-outcome reliability by category and extractor.
- `.openskill-kit/preferences/integrity-report.json`: memory integrity checks for compiled behavior.
- `.openskill-kit/detection/`: metadata-only scan results for agent instruction, rule, skill, hook, and MCP surfaces.
- `.openskill-kit/preferences/active/`: Active Behavior Layer.
- `.openskill-kit/compiled/context-pack.md`: compact agent context.
- `.openskill-kit/compiled/previews/staged-context-pack.md`: review-only staged
  behavior preview when requested.
- `.openskill-kit/compiled/skills/project-behavior/`: installable Agent Skill.
- `.openskill-kit/compiled/skills/project-*/`: scoped dynamic skill shards for active categories.
- `.openskill-kit/compiled/manifests/`: managed AGENTS.md, CLAUDE.md, and path rule previews.
- `.openskill-kit/compiled/behavior/path-map.json`: path-specific behavior map.
- `.openskill-kit/compiled/behavior/command-policy.md`: command policy.
- `.openskill-kit/compiled/behavior/review-checklist.md`: review checklist.
- `.openskill-kit/compiled/hooks/`: generated hook adapter files.
- `.openskill-kit/compiled/mcp/server-config.json`: MCP tool surface metadata.
- `.openskill-kit/compiled/plugin/`: attachable agent plugin bundle.
- `.openskill-kit/compiled/project-behavior-pack/`: shareable reviewed behavior.
- `.openskill-kit/sessions/summaries/`: session-level learning summaries.
- `.openskill-kit/evals/runs/*/behavior-compare.md`: baseline vs OpenSkillKit replay scorecard.
- `.openskill-kit/retrieval/route-plans/`: behavior routing traces for local/project/OpenWorld decisions.
- `.openskill-kit/openworld/source-index.json`: leakage-audited OpenWorld source registry.
- `.openskill-kit/openworld/trust-cache.json`: trust metadata for project-local and explicit web sources.
- `.agents/hooks/openskill-kit.json`: installed local hook adapter config.
- `AGENTS.md`, `CLAUDE.md`, `.claude/rules/`: optional managed project manifests after `agent install-manifests --yes`.

Manual skill scaffolding remains available:

```bash
npx openskill-kit draft "handle repo test failures" --no-llm
npx openskill-kit evolve "handle repo test failures" --no-llm
npx openskill-kit test .openskill-kit/runs/<run>/candidate/handle-repo-test-failures
```
