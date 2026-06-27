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
npx openskill-kit compile --target plugin
npx openskill-kit agent install-manifests --target project --dry-run
npx openskill-kit agent uninstall-manifests --target project --dry-run
npx openskill-kit daemon
npx openskill-kit agent doctor
npx openskill-kit agent install-hooks --target project --yes
npx openskill-kit install --target agents-project --yes
npx openskill-kit status --explain
npx openskill-kit detect
npx openskill-kit doctor --full
npx openskill-kit compact
```

OpenWorld scaffold commands are local-only and not benchmark-proven yet:

```bash
npx openskill-kit openworld init-task --title "Verifier-first skill" --prompt "Build local anchors only."
npx openskill-kit openworld leakage-check --query "docs for parser behavior" --forbidden-identifier <hidden-id>
npx openskill-kit openworld plan --title "Verifier-first skill" --prompt "Build local anchors only."
npx openskill-kit openworld source-plan --task-id <owtask_id> --path docs
npx openskill-kit openworld retrieval-adapters --task-id <owtask_id>
npx openskill-kit openworld execute-source-plan --task-id <owtask_id> --plan-id <owrplan_id> --include-autonomous-web
npx openskill-kit openworld research --task-id <owtask_id> --file docs/architecture.md
npx openskill-kit openworld fetch-source --task-id <owtask_id> --url https://docs.example.com/sdk --content-file docs/sdk-cache.txt
npx openskill-kit openworld sources
npx openskill-kit openworld anchors --task-id <owtask_id> --source-id <source_id>
npx openskill-kit openworld build-verifier --task-id <owtask_id> --anchor-id <anchor_id>
npx openskill-kit openworld candidate-skill --task-id <owtask_id> --anchor-id <anchor_id>
npx openskill-kit openworld repair-candidate --task-id <owtask_id> --candidate-id <owskill_id> --suite-id <suite_id> --sandbox docker --docker-image node:22-alpine
npx openskill-kit openworld verifier-quality --task-id <owtask_id> --suite-id <suite_id>
npx openskill-kit openworld run-verifier --task-id <owtask_id> --suite-id <suite_id> --split visible
npx openskill-kit openworld refine --task-id <owtask_id> --suite-id <suite_id> --candidate-id <owskill_id>
npx openskill-kit openworld eval-report --run-id <owrun_id>
npx openskill-kit openworld hidden-oracle-harness --task-id <owtask_id> --suite-id <suite_id>
npx openskill-kit openworld promote-review --run-id <owrun_id> --dry-run
npx openskill-kit openworld report --task-id <owtask_id>
npx openskill-kit openworld doctor
```

This creates `.openskill-kit/`, records a redacted event, learns candidate
preferences, activates them through Learning Review, compiles a Context Pack and
`project-behavior` skill, then installs that skill into the project agent skill
directory. Manifest install is separate and reviewable because it writes managed
blocks into root agent instruction files.
`compile --target plugin` also writes `.openskill-kit/compiled/plugin/`, an
attachable bundle with `.agent-plugin/plugin.json`, `.mcp.json`, skills, MCP
metadata, behavior artifacts, and explicit privacy gates for existing coding
harnesses.

## How It Works

```text
events -> signals -> Preference Kernel -> Behavior Profile
  -> Active Behavior Layer
  -> Context Pack + Agent Skills + hooks + MCP config + Project Behavior Pack
```

OpenSkillKit stores raw lifecycle events in append-only JSONL only when privacy
settings allow it. Secret-like content is redacted before storage. Signals and
Preference Nodes stay reviewable as normal project files.

The OpenWorld layer now covers task records, leakage audits, local source
discovery plans, source ingestion/cache, explicit web source fetches, Anchor
Cards, named retrieval adapter contracts with allow-web gates, deterministic
package/language docs-repo URL discovery, execution traces, source-plan execution artifacts, visible/holdout virtual verifier
generation, review-only candidate skill artifacts, local-process or opt-in Docker sandbox execution of
generated verifier scripts, verifier quality scoring, bounded verifier
refinement/eval report records, candidate revision artifacts, local-process
sandbox repair probes with optional caller-provided Docker mode, and review-only promotion proposals. It also has a static
hidden-oracle denied-path harness that scans generated artifacts without reading
oracle files. It still does not perform broad search-engine-backed web crawling,
built-in LLM skill generation, managed container runtime/pools, or hidden-oracle
benchmark evaluation yet.

## Core Commands

```bash
openskill-kit init
openskill-kit status
openskill-kit observe --type user-prompt-submit --text "Always prefer focused tests first."
openskill-kit propose --session <session-id> --statement "Prefer parser modules stay dependency-light" --category architecture --evidence-event <event-id>
openskill-kit learn
openskill-kit review --queue
openskill-kit review --tui
openskill-kit review
openskill-kit review --activate <preference-id>
openskill-kit review --reject <preference-id>
openskill-kit review --edit <preference-id> --statement "Prefer focused tests before broad checks."
openskill-kit review --merge-into <target-id> --merge-source <source-id>
openskill-kit review --split <preference-id> --split-statement "Prefer focused tests first." --split-statement "Prefer full smoke before release."
openskill-kit review --promote <preference-id>
openskill-kit review --demote <preference-id>
openskill-kit review --activate-all
openskill-kit review --workflow-activate <workflow-id>
openskill-kit review --workflow-reject <workflow-id>
openskill-kit review --workflow-lock <workflow-id>
openskill-kit review --workflow-demote <workflow-id>
openskill-kit review --workflow-activate-all
openskill-kit compile
openskill-kit compile --target context-pack
openskill-kit compile --include-staged-preview
openskill-kit explain <preference-id>
openskill-kit explain <preference-id> --evidence
openskill-kit calibration
openskill-kit prefs --query "parser test change" --path src/parser/tokenizer.ts
openskill-kit route --query "parser test change" --path src/parser/tokenizer.ts
openskill-kit daemon
openskill-kit agent doctor
openskill-kit agent install-manifests --target project --dry-run
openskill-kit agent install-manifests --target project --yes
openskill-kit agent uninstall-manifests --target project --dry-run
openskill-kit agent uninstall-manifests --target project --yes
openskill-kit agent install-hooks --target project --yes
openskill-kit install --target agents-project --yes
openskill-kit eval
openskill-kit eval --compare-baseline
openskill-kit eval --mode external-agent --dry-run
openskill-kit status --explain
openskill-kit detect
openskill-kit interactions import ./session-export.jsonl
openskill-kit interactions import ./session-export.jsonl --adapter codex --yes
openskill-kit interactions imports
openskill-kit doctor --full
openskill-kit openworld init-task --title "Verifier-first skill" --prompt "Build local anchors only."
openskill-kit openworld leakage-check --query "docs for parser behavior" --forbidden-identifier <hidden-id>
openskill-kit openworld plan --title "Verifier-first skill" --prompt "Build local anchors only."
openskill-kit openworld source-plan --task-id <owtask_id> --path docs
openskill-kit openworld retrieval-adapters --task-id <owtask_id>
openskill-kit openworld execute-source-plan --task-id <owtask_id> --plan-id <owrplan_id> --include-autonomous-web
openskill-kit openworld research --task-id <owtask_id> --file docs/architecture.md
openskill-kit openworld fetch-source --task-id <owtask_id> --url https://docs.example.com/sdk --content-file docs/sdk-cache.txt
openskill-kit openworld sources
openskill-kit openworld anchors --task-id <owtask_id> --source-id <source_id>
openskill-kit openworld build-verifier --task-id <owtask_id> --anchor-id <anchor_id>
openskill-kit openworld candidate-skill --task-id <owtask_id> --anchor-id <anchor_id>
openskill-kit openworld repair-candidate --task-id <owtask_id> --candidate-id <owskill_id> --suite-id <suite_id> --sandbox docker --docker-image node:22-alpine
openskill-kit openworld verifier-quality --task-id <owtask_id> --suite-id <suite_id>
openskill-kit openworld run-verifier --task-id <owtask_id> --suite-id <suite_id> --split visible
openskill-kit openworld refine --task-id <owtask_id> --suite-id <suite_id> --candidate-id <owskill_id>
openskill-kit openworld eval-report --run-id <owrun_id>
openskill-kit openworld hidden-oracle-harness --task-id <owtask_id> --suite-id <suite_id>
openskill-kit openworld promote-review --run-id <owrun_id>
openskill-kit openworld report --task-id <owtask_id>
openskill-kit openworld doctor
openskill-kit compact
openskill-kit pack
openskill-kit sync export --passphrase-file .openskill-kit/sync.pass
openskill-kit sync import .openskill-kit/sync/project-behavior-pack.enc.json --passphrase-file .openskill-kit/sync.pass --review
openskill-kit sign-pack .openskill-kit/compiled/project-behavior-pack
openskill-kit verify-pack .openskill-kit/compiled/project-behavior-pack
openskill-kit inspect-pack .openskill-kit/compiled/project-behavior-pack
openskill-kit diff-pack <old-pack-path> <new-pack-path>
openskill-kit import-pack <pack-path> --review --dry-run
openskill-kit import-pack <pack-path> --review --max-changed-files 5
openskill-kit apply-pack <pack-path> --yes
openskill-kit prune --keep-runs 5
openskill-kit archive
openskill-kit reset --scope runtime
openskill-kit doctor
```

Compatibility commands remain available for manual skill scaffolding:

```bash
openskill-kit draft "repo test workflow" --no-llm
openskill-kit evolve "repo test workflow" --max-rounds 3 --run-repo-checks --no-llm
openskill-kit test .openskill-kit/runs/<run-id>/candidate/<skill>
openskill-kit evaluate .openskill-kit/runs/<run-id>/candidate/<skill>
```

`review --tui` supports `e N` for sanitized evidence cards, `p N` for
compile/privacy preview, `wa/wr/wl/wd N` for workflow candidate decisions, and
`c` for calibration reliability while reviewing a candidate batch.

## Safety And Privacy

- Local-only behavior is default.
- Raw prompts and raw diffs are not stored unless enabled in config.
- Secret-like values are redacted before event storage.
- Interaction imports default to dry-run, write source-hash summaries, and do
  not copy raw session exports into OpenSkillKit artifacts.
- Detection flags possible session/export files as high-risk explicit-import
  surfaces, reports hook/override/MCP risks, and gives safe next actions; it
  does not import them silently.
- Invalid custom redaction regexes are reported by `doctor --full` and skipped
  during event capture.
- Evidence Cards explain learned preferences without storing raw private prompts.
- Memory integrity checks block poisoned auto-apply candidates and report risks
  before compile.
- Generated skills and hooks are scanned before install.
- Managed AGENTS/CLAUDE install preserves user-authored content outside the
  OpenSkillKit block and supports dry-run diffs plus managed uninstall.
- Install writes receipts under `.openskill-kit/installs/`.
- Project Behavior Packs exclude private events, raw signals, interaction import
  runs, review drafts, and run outputs by default.
- Encrypted sync envelopes wrap the already privacy-filtered pack with
  AES-256-GCM and require an explicit passphrase or passphrase file.

## Agent Integration

The stdio MCP server exposes the adaptive runtime:

```bash
openskill-kit-mcp
```

Key tools:

- `osk_bootstrap_session`
- `osk_detect_environment`
- `osk_get_agent_surfaces`
- `osk_import_interaction_source`
- `osk_list_interaction_imports`
- `osk_get_context_pack`
- `osk_get_relevant_preferences`
- `osk_route_behavior`
- `osk_record_event`
- `osk_propose_preference`
- `osk_get_review_queue`
- `osk_apply_review_actions` (preferences plus workflowActivate/workflowReject/workflowLock/workflowDemote)
- `osk_learn_from_session`
- `osk_compile_behavior_layer`
- `osk_explain_preference`
- `osk_get_preference_evidence`
- `osk_get_behavior_manifest`
- `osk_preview_manifest_install`
- `osk_apply_manifest_install`
- `osk_preview_manifest_uninstall`
- `osk_apply_manifest_uninstall`
- `osk_validate_memory_candidate`
- `osk_get_calibration_report`
- `osk_export_behavior_pack`
- `osk_export_encrypted_behavior_pack`
- `osk_sign_behavior_pack`
- `osk_verify_behavior_pack`
- `osk_inspect_behavior_pack`
- `osk_diff_behavior_pack`
- `osk_import_behavior_pack`
- `osk_import_encrypted_behavior_pack`
- `osk_run_behavior_eval`
- `osk_run_agent_ab_eval`
- `osk_run_external_agent_eval`
- `osk_agent_doctor`
- `osk_install_agent_hooks`
- `osk_preview_plugin_attach`
- `osk_apply_plugin_attach`
- `osk_get_plugin_attach_status`
- `osk_run_lifecycle_once`
- `osk_mine_workflows`
- `osk_get_workflow_graph`
- `osk_explain_status`
- `osk_run_full_doctor`
- `osk_openworld_doctor`
- `osk_openworld_source_plan`
- `osk_openworld_ingest_source`
- `osk_openworld_execute_source_plan`
- `osk_openworld_sources`
- `osk_openworld_candidate_skill`
- `osk_openworld_run_verifier`
- `osk_openworld_verifier_quality`
- `osk_openworld_refine`
- `osk_openworld_eval_report`
- `osk_openworld_task_report`
- `osk_openworld_promote_review`
- `osk_compact_state`
- `osk_prune_state`
- `osk_archive_state`
- `osk_reset_state`

Legacy skill drafting, audit, test, evaluation, install, list, and inspect tools
remain available for compatibility.

`osk_bootstrap_session` is the recommended first call for a coding harness. It
returns initialization status plus compiled plugin readiness, attach path,
published skills/capabilities, MCP command, privacy exclusions, approval gates,
and next actions.

## Project Owner Workflow

1. Initialize the project.
2. Let the agent record useful lifecycle events.
3. Review candidates in small batches.
4. Compile and install the Active Behavior Layer.
5. Commit the safe subset of `.openskill-kit/`.
6. Export a Project Behavior Pack for contributors when needed.

See [docs/release-checklist.md](docs/release-checklist.md) for publish checks
and [examples/project-behavior-demo](examples/project-behavior-demo) for a
static before/after behavior fixture.

## Current Boundary

This release implements the production spine: adaptive config, event store,
redaction with config validation, deterministic and proposal-based signal
extraction, Preference Graph, Evidence Cards, memory integrity checks, Learning
Review, extractor registry, v2 preference metadata, calibration from review outcomes,
scope/evidence/eval-aware calibration, progressive task/path-aware retrieval with
budget traces, encrypted privacy-safe sync envelopes,
target-aware context/skill/manifest/hook/MCP/plugin compilation, standalone hook scripts,
managed AGENTS/CLAUDE previews and installer, plugin output, MCP config
generation, host MCP attach preview/apply with detection of invalid/conflicting
MCP configs, env-bound project root, plugin attachment health in status/bootstrap,
project skill install, Project Behavior Pack
export/sign/verify/inspect/diff/review/apply, behavior evals, maintenance
commands, import diff gates, external-agent eval prompt harness, CLI, MCP tools,
tests, and smoke coverage.

Compiled skills include the broad `project-behavior` skill plus scoped dynamic
shards such as `project-testing`, `project-security`, and `project-architecture`
when matching active preferences exist. Agents can load the small shard instead
of the full project behavior when task scope is narrow.

Future depth should focus on larger golden scenario packs, hosted sync, review
UI polish, and real external-agent A/B evals.
