# Quickstart

```bash
npm install
npm run build
npx openskill-kit init
npx openskill-kit observe --type user-prompt-submit --text "Always run npm test before final response."
npx openskill-kit learn
npx openskill-kit review --activate-all
npx openskill-kit compile
npx openskill-kit install --target agents-project --yes
npx openskill-kit eval
npx openskill-kit pack
npx openskill-kit status --json
```

Generated adaptive artifacts:

- `.openskill-kit/events/*.jsonl`: redacted local events.
- `.openskill-kit/signals/normalized.jsonl`: learnable signals.
- `.openskill-kit/preferences/graph.json`: Behavior Profile.
- `.openskill-kit/preferences/active/`: Active Behavior Layer.
- `.openskill-kit/compiled/context-pack.md`: compact agent context.
- `.openskill-kit/compiled/skills/project-behavior/`: installable Agent Skill.
- `.openskill-kit/compiled/hooks/`: generated hook adapter files.
- `.openskill-kit/compiled/mcp/server-config.json`: MCP tool surface metadata.
- `.openskill-kit/compiled/plugin/`: attachable agent plugin bundle.
- `.openskill-kit/compiled/project-behavior-pack/`: shareable reviewed behavior.

Manual skill scaffolding remains available:

```bash
npx openskill-kit draft "handle repo test failures" --no-llm
npx openskill-kit evolve "handle repo test failures" --no-llm
npx openskill-kit test .openskill-kit/runs/<run>/candidate/handle-repo-test-failures
```
