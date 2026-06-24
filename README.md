# OpenSkillKit

OpenSkillKit is a local-first Adaptive Skill Graph for AI coding agents. It
observes project work, extracts evidence-backed Preference Nodes, keeps an
inspectable Behavior Profile, and compiles the Active Behavior Layer into
Context Packs, Agent Skills, hooks, MCP tools, and shareable Project Behavior
Packs.

It is not model training and it does not need provider keys. The host agent
does the reasoning; OpenSkillKit supplies project-local behavior memory,
evidence, safety gates, and generated artifacts agents already know how to use.

## Quickstart

```bash
npm install
npm run build

npx openskill-kit init
npx openskill-kit observe --type user-prompt-submit --text "Always run npm test before final response."
npx openskill-kit learn
npx openskill-kit review --activate-all
npx openskill-kit compile
npx openskill-kit daemon
npx openskill-kit agent doctor
npx openskill-kit agent install-hooks --target project --yes
npx openskill-kit install --target agents-project --yes
npx openskill-kit status
```

This creates `.openskill-kit/`, records a redacted event, learns candidate
preferences, activates them through Learning Review, compiles a Context Pack and
`project-behavior` skill, then installs that skill into the project agent skill
directory.

## How It Works

```text
events -> signals -> Preference Kernel -> Behavior Profile
  -> Active Behavior Layer
  -> Context Pack + Agent Skills + hooks + MCP config + Project Behavior Pack
```

OpenSkillKit stores raw lifecycle events in append-only JSONL only when privacy
settings allow it. Secret-like content is redacted before storage. Signals and
Preference Nodes stay reviewable as normal project files.

## Core Commands

```bash
openskill-kit init
openskill-kit status
openskill-kit observe --type user-prompt-submit --text "Always prefer focused tests first."
openskill-kit learn
openskill-kit review
openskill-kit review --activate <preference-id>
openskill-kit review --reject <preference-id>
openskill-kit review --activate-all
openskill-kit compile
openskill-kit explain <preference-id>
openskill-kit prefs --query "parser test change" --path src/parser/tokenizer.ts
openskill-kit daemon
openskill-kit agent doctor
openskill-kit agent install-hooks --target project --yes
openskill-kit install --target agents-project --yes
openskill-kit eval
openskill-kit pack
openskill-kit sign-pack .openskill-kit/compiled/project-behavior-pack
openskill-kit verify-pack .openskill-kit/compiled/project-behavior-pack
openskill-kit inspect-pack .openskill-kit/compiled/project-behavior-pack
openskill-kit diff-pack <old-pack-path> <new-pack-path>
openskill-kit import-pack <pack-path> --dry-run
openskill-kit doctor
```

Compatibility commands remain available for manual skill scaffolding:

```bash
openskill-kit draft "repo test workflow" --no-llm
openskill-kit evolve "repo test workflow" --max-rounds 3 --run-repo-checks --no-llm
openskill-kit test .openskill-kit/runs/<run-id>/candidate/<skill>
openskill-kit evaluate .openskill-kit/runs/<run-id>/candidate/<skill>
```

## Safety And Privacy

- Local-only behavior is default.
- Raw prompts and raw diffs are not stored unless enabled in config.
- Secret-like values are redacted before event storage.
- Generated skills and hooks are scanned before install.
- Install writes receipts under `.openskill-kit/installs/`.
- Project Behavior Packs exclude private events, raw signals, review drafts, and
  run outputs by default.

## Agent Integration

The stdio MCP server exposes the adaptive runtime:

```bash
openskill-kit-mcp
```

Key tools:

- `osk_bootstrap_session`
- `osk_get_context_pack`
- `osk_get_relevant_preferences`
- `osk_record_event`
- `osk_learn_from_session`
- `osk_compile_behavior_layer`
- `osk_explain_preference`
- `osk_export_behavior_pack`
- `osk_sign_behavior_pack`
- `osk_verify_behavior_pack`
- `osk_inspect_behavior_pack`
- `osk_diff_behavior_pack`
- `osk_import_behavior_pack`
- `osk_run_behavior_eval`
- `osk_agent_doctor`
- `osk_install_agent_hooks`
- `osk_run_lifecycle_once`

Legacy skill drafting, audit, test, evaluation, install, list, and inspect tools
remain available for compatibility.

## Project Owner Workflow

1. Initialize the project.
2. Let the agent record useful lifecycle events.
3. Review candidates in small batches.
4. Compile and install the Active Behavior Layer.
5. Commit the safe subset of `.openskill-kit/`.
6. Export a Project Behavior Pack for contributors when needed.

## Current Boundary

This release implements the production spine: adaptive config, event store,
redaction, deterministic signal extraction, Preference Graph, Learning Review,
context and skill compilation, standalone hook scripts, plugin output, MCP config
generation, project skill install, Project Behavior Pack export/verify/import,
behavior evals, CLI, MCP tools, tests, and smoke coverage.

Advanced AST extraction, hosted sync, signatures, and benchmark-grade
downstream agent replay are roadmap items. They are not faked.
