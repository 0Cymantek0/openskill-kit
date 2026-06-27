# OpenSkillKit Command Map

When a user writes an `/osk ...` phrase, treat it as an intent for this plugin. Prefer MCP because it returns structured status and readiness data. If MCP is unavailable, run the CLI fallback from the project root.

Do not enable hooks, write global instructions, import private interactions, or import behavior packs without explicit user approval.
OpenWorld routes are review-only unless an explicit review action later activates behavior; they do not prove hidden-oracle benchmark performance.

## Commands

### /osk init

Initialize or bootstrap project behavior state and report plugin readiness.

- MCP tool: `osk_bootstrap_session`
- CLI fallback: `openskill-kit init && openskill-kit status`
- Read-only: `no`
- Explicit approval required: `no`

### /osk status

Show learned behavior, compiled artifacts, plugin readiness, and next actions.

- MCP tool: `osk_bootstrap_session`
- CLI fallback: `openskill-kit status`
- Read-only: `yes`
- Explicit approval required: `no`

### /osk context

Return route plan, relevant behavior, plugin health, review state, and next actions for the current coding task.

- MCP tool: `osk_get_agent_task_context`
- CLI fallback: `openskill-kit context --query "<task>"`
- Read-only: `no`
- Explicit approval required: `no`

### /osk finish task

Record safe task outcome evidence, run learning, write session summaries, and return review next actions.

- MCP tool: `osk_finish_agent_task`
- CLI fallback: `openskill-kit finish-task --summary "<safe summary>"`
- Read-only: `no`
- Explicit approval required: `no`

### /osk import adapters

List supported cross-agent import adapters, accepted formats, privacy policy, and adapter status.

- MCP tool: `osk_list_interaction_adapters`
- CLI fallback: `openskill-kit interactions adapters`
- Read-only: `yes`
- Explicit approval required: `no`

### /osk import session

Preview or import a cross-agent session/export file as redacted local events; applying requires explicit approval.

- MCP tool: `osk_import_interaction_source`
- CLI fallback: `openskill-kit interactions import <path>`
- Read-only: `no`
- Explicit approval required: `yes`

### /osk import review

Preview or import a local review-comment file as redacted review feedback events; applying requires explicit approval.

- MCP tool: `osk_import_interaction_source`
- CLI fallback: `openskill-kit interactions import-review <path>`
- Read-only: `no`
- Explicit approval required: `yes`

### /osk import terminal

Preview or import an explicit terminal history file as allowlisted command metadata only; applying requires explicit approval.

- MCP tool: `osk_import_interaction_source`
- CLI fallback: `openskill-kit interactions import-terminal <path>`
- Read-only: `no`
- Explicit approval required: `yes`

### /osk session imports

List previous interaction import runs without raw source content.

- MCP tool: `osk_list_interaction_imports`
- CLI fallback: `openskill-kit interactions imports`
- Read-only: `yes`
- Explicit approval required: `no`

### /osk explain import

Explain one interaction import receipt, privacy state, and learning next actions without reading raw source content.

- MCP tool: `osk_explain_interaction_import`
- CLI fallback: `openskill-kit interactions explain <run-id>`
- Read-only: `yes`
- Explicit approval required: `no`

### /osk interaction pool

List normalized cross-agent interaction metadata records without raw source content.

- MCP tool: `osk_get_interaction_pool`
- CLI fallback: `openskill-kit interactions pool`
- Read-only: `yes`
- Explicit approval required: `no`

### /osk git context

Inspect local branch, changed files, aggregate diff stats, and recent commits without raw diffs or file contents.

- MCP tool: `osk_get_git_local_context`
- CLI fallback: `openskill-kit interactions git-context`
- Read-only: `yes`
- Explicit approval required: `no`

### /osk learn from this session

Extract candidate preferences from captured local events after user approval for any import source.

- MCP tool: `osk_learn_from_session`
- CLI fallback: `openskill-kit learn`
- Read-only: `no`
- Explicit approval required: `no`

### /osk explain why you learned this

Explain a learned preference through sanitized evidence cards.

- MCP tool: `osk_explain_preference`
- CLI fallback: `openskill-kit explain <preference-id>`
- Read-only: `yes`
- Explicit approval required: `no`

### /osk review pending behavior

Open the review queue for candidate behavior before activation.

- MCP tool: `osk_get_review_queue`
- CLI fallback: `openskill-kit review`
- Read-only: `no`
- Explicit approval required: `no`

### /osk update skills

Compile project-scoped skills from active behavior.

- MCP tool: `osk_compile_behavior_layer`
- CLI fallback: `openskill-kit compile --target agent-skills`
- Read-only: `no`
- Explicit approval required: `no`

### /osk update AGENTS.md

Preview managed AGENTS/CLAUDE instruction updates.

- MCP tool: `osk_compile_behavior_layer`
- CLI fallback: `openskill-kit compile --target project-rules`
- Read-only: `no`
- Explicit approval required: `no`

### /osk install hooks

Preview or install local hooks; requires explicit user approval before enabling execution.

- MCP tool: `osk_install_agent_hooks`
- CLI fallback: `openskill-kit hooks install --dry-run`
- Read-only: `no`
- Explicit approval required: `yes`

### /osk attach plugin

Preview host MCP config needed to attach this plugin to an existing coding harness; applying requires explicit approval.

- MCP tool: `osk_preview_plugin_attach`
- CLI fallback: `openskill-kit agent attach-plugin --host generic-mcp --dry-run`
- Read-only: `no`
- Explicit approval required: `no`

### /osk plugin health

Show host attachment health for the compiled plugin, including root binding, invalid JSON, and command conflicts.

- MCP tool: `osk_get_plugin_attach_status`
- CLI fallback: `openskill-kit agent plugin-status`
- Read-only: `yes`
- Explicit approval required: `no`

### /osk run behavior eval

Run local behavior replay/evaluation gates and return artifact paths.

- MCP tool: `osk_run_behavior_eval`
- CLI fallback: `openskill-kit eval`
- Read-only: `no`
- Explicit approval required: `no`

### /osk openworld doctor

Show which OpenWorld capabilities are real today and which remain unproven.

- MCP tool: `osk_openworld_doctor`
- CLI fallback: `openskill-kit openworld doctor`
- Read-only: `yes`
- Explicit approval required: `no`

### /osk openworld source plan

Plan leakage-audited local and explicit web source candidates for an OpenWorld task.

- MCP tool: `osk_openworld_source_plan`
- CLI fallback: `openskill-kit openworld source-plan --task-id <task-id>`
- Read-only: `no`
- Explicit approval required: `no`

### /osk openworld build verifier

Build a leakage-audited visible/holdout verifier suite from Anchor Cards, preserving manual-review anchors and traceable local file assertions.

- MCP tool: `osk_openworld_build_verifier`
- CLI fallback: `openskill-kit openworld build-verifier --task-id <task-id> --anchor-id <anchor-id>`
- Read-only: `no`
- Explicit approval required: `no`

### /osk openworld verifier quality

Score a generated OpenWorld verifier suite for traceability, determinism, holdout coverage, source trust, and leakage metadata.

- MCP tool: `osk_openworld_verifier_quality`
- CLI fallback: `openskill-kit openworld verifier-quality --task-id <task-id> --suite-id <suite-id>`
- Read-only: `yes`
- Explicit approval required: `no`

### /osk openworld run verifier

Run a generated OpenWorld verifier split through local-process or opt-in Docker sandbox mode and write execution results.

- MCP tool: `osk_openworld_run_verifier`
- CLI fallback: `openskill-kit openworld run-verifier --task-id <task-id> --suite-id <suite-id> --split visible`
- Read-only: `no`
- Explicit approval required: `no`

### /osk openworld refine

Run bounded visible verifier refinement and final holdout check for a candidate skill.

- MCP tool: `osk_openworld_refine`
- CLI fallback: `openskill-kit openworld refine --task-id <task-id> --suite-id <suite-id> --candidate-id <candidate-id>`
- Read-only: `no`
- Explicit approval required: `no`

### /osk openworld report

Render task evidence, sources, anchors, verifier runs, eval reports, and remaining proof gaps.

- MCP tool: `osk_openworld_task_report`
- CLI fallback: `openskill-kit openworld report --task-id <task-id> --write`
- Read-only: `no`
- Explicit approval required: `no`

### /osk openworld promote review

Create a review-only proposal from a passed OpenWorld run; it never activates behavior directly.

- MCP tool: `osk_openworld_promote_review`
- CLI fallback: `openskill-kit openworld promote-review --run-id <run-id> --dry-run`
- Read-only: `no`
- Explicit approval required: `yes`

### /osk evolve this skill

Draft, verify, and evaluate a reusable skill from local evidence.

- MCP tool: `none; use CLI fallback`
- CLI fallback: `openskill-kit evolve "<topic>" --no-llm`
- Read-only: `no`
- Explicit approval required: `no`

### /osk sync project behavior pack

Export or import behavior packs only through review, verification, and trust gates.

- MCP tool: `osk_export_behavior_pack`
- CLI fallback: `openskill-kit pack export`
- Read-only: `no`
- Explicit approval required: `yes`
