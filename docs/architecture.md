# Architecture

OpenSkillKit separates the adaptive project behavior engine from agent-facing
adapters.

```text
packages/core
  config, event store, redaction, signals, Preference Graph, compiler,
  safety scanner, verifier, registry, installer, legacy scaffold engine
packages/cli
  command-line interface over core
packages/mcp-server
  stdio MCP bridge over core
packages/local-adapter-plugin
  compatibility adapter package
packages/agent-plugin-bundle
  compatibility plugin bundle
```

## Adaptive Data Flow

```text
init
  -> .openskill-kit/config.json
  -> observe lifecycle events
  -> redact and append JSONL
  -> extract normalized signals
  -> update Preference Graph
  -> Learning Review
  -> compile Active Behavior Layer
  -> install skill / expose MCP / export Project Behavior Pack
```

## Project State

```text
.openskill-kit/
  config.json
  project.json
  events/
  sessions/
  runtime/
  signals/
  preferences/
  compiled/
  installs/
  evals/
  compact/
  archive/
  reports/
```

Private data defaults to ignored files. Shareable behavior lives in active
preferences, compiled context, compiled skills, and reviewed pack output.

## Event Store

Events are append-only JSONL. Redaction runs before storage. Raw prompts and raw
diffs are omitted unless config opts in. The index records counts per monthly
file so status does not need to scan every event.

## Preference Kernel

Signals become Preference Nodes. Confidence is deterministic and explainable,
using weighted evidence with time decay. Conflicts are detected when opposing
statements overlap in same category. Learning Review can activate, reject, or
lock nodes.

Host agents can submit semantic proposals through a strict JSON schema with
statement, category, scope, evidence, counterevidence, confidence, risk, and
suggested compile targets. Proposals are redacted, stored as review artifacts,
and converted into proposal signals for the same Preference Graph pipeline.

## Compiler

The compiler writes:

- `compiled/context-pack.md`
- `compiled/skills/project-behavior/SKILL.md`
- `compiled/skills/project-behavior/references/active-preferences.md`
- `compiled/hooks/hooks.json`
- `compiled/hooks/scripts/*.cjs`
- `compiled/mcp/server-config.json`
- `compiled/plugin/plugin.json`
- `compiled/behavior/path-map.json`
- `compiled/behavior/command-policy.md`
- `compiled/behavior/review-checklist.md`
- `preferences/graph.md`
- `preferences/active/*.md`
- `sessions/summaries/*.json`
- `runtime/last-run.json`
- `compact/summary.json`

Output is deterministic: stable headings, stable sorting, and no timestamp in
generated skill text.

## MCP Runtime

`openskill-kit-mcp` exposes adaptive tools:

- `osk_bootstrap_session`
- `osk_get_context_pack`
- `osk_get_relevant_preferences`
- `osk_record_event`
- `osk_propose_preference`
- `osk_get_review_queue`
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
- `osk_explain_status`
- `osk_run_full_doctor`
- `osk_compact_state`
- `osk_prune_state`
- `osk_archive_state`
- `osk_reset_state`

Legacy drafting, audit, test, evaluation, install, list, and inspect tools
remain available for compatibility.

## Behavior Evals

`openskill-kit eval` builds scenarios from active preferences or a scenario file,
retrieves relevant preferences for each task, simulates a behavior-aware plan,
checks command policy and forbidden behavior, and reports adherence, retrieval
precision, and privacy leak rate.

## Maintenance

`openskill-kit status --explain` reports what adaptive state exists, whether
compiled artifacts are stale, and what to run next. `doctor --full` checks base
environment plus adaptive config, compiled hooks, MCP config, registry, and pack
health.

`compact` writes a small project summary from event and graph state. `prune`
plans or removes old eval runs. `archive` plans or moves private event, signal,
review, and runtime state under `.openskill-kit/archive/`. `reset` plans or
removes selected adaptive state scopes and requires `--yes` before writing.

## Legacy Scaffold Path

`draft`, topic-based `learn`, and `evolve` remain deterministic local
scaffolding commands. They still write run reports, evidence ledgers, leakage
audits, verifier packs, candidate skill packages, and evaluation artifacts. This
path is useful for manual skill creation but is no longer the main product loop.

## Safety Gates

Generated or imported skills are untrusted until scanned and verified. Install
blocks verifier errors, fixture failures, and high or critical safety findings
unless caller explicitly allows risk. Receipts record target, source,
destination, verifier status, and safety score.
