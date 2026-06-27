# OpenSkillKit Command Map

When a user writes an `/osk ...` phrase, treat it as an intent for this plugin. Prefer MCP because it returns structured status and readiness data. If MCP is unavailable, run the CLI fallback from the project root.

Do not enable hooks, write global instructions, import private interactions, or import behavior packs without explicit user approval.
OpenWorld routes are review-only unless an explicit review action later activates behavior; they do not prove hidden-oracle benchmark performance.

## Commands

### /osk init

Initialize project-local OSK state and preview harness attach.

- MCP tool: `osk_bootstrap_session`
- CLI fallback: `openskill-kit init && openskill-kit status`
- Read-only: `no`
- Explicit approval required: `no`

### /osk status

Show behavior, review, plugin, and harness health.

- MCP tool: `osk_bootstrap_session`
- CLI fallback: `openskill-kit status`
- Read-only: `yes`
- Explicit approval required: `no`

Status output includes the OpenWorld proof boundary and never treats artifact-verifier results as hidden-oracle benchmark proof.

### /osk task

Load task context before work and record safe outcome after work.

- MCP tool: `osk_get_agent_task_context`
- CLI fallback: `openskill-kit context --query "<task>"`
- Read-only: `no`
- Explicit approval required: `no`

### /osk learn

Plan and run explicit, review-gated learning from selected sources.

- MCP tool: `osk_plan_learning_sources`
- CLI fallback: `openskill-kit learn`
- Read-only: `no`
- Explicit approval required: `yes`

### /osk review

Inspect and approve, reject, lock, or demote candidate behavior.

- MCP tool: `osk_review_behavior`
- CLI fallback: `openskill-kit review`
- Read-only: `no`
- Explicit approval required: `yes`

### /osk research

Plan leakage-audited sources and anchors for unfamiliar tasks.

- MCP tool: `osk_run_openworld_workflow`
- CLI fallback: `openskill-kit openworld source-plan --task-id <task-id>`
- Read-only: `no`
- Explicit approval required: `no`

### /osk evolve

Generate review-only candidate skills from anchored OpenWorld evidence.

- MCP tool: `osk_run_openworld_workflow`
- CLI fallback: `openskill-kit openworld refine --task-id <task-id> --suite-id <suite-id> --candidate-id <candidate-id>`
- Read-only: `no`
- Explicit approval required: `no`

### /osk verify

Run integrity, privacy, verifier, and proof-boundary checks.

- MCP tool: `osk_verify_behavior`
- CLI fallback: `openskill-kit openworld verifier-quality --task-id <task-id> --suite-id <suite-id>`
- Read-only: `no`
- Explicit approval required: `no`

### /osk compile

Compile active reviewed behavior into harness artifacts.

- MCP tool: `osk_compile_deploy`
- CLI fallback: `openskill-kit compile --target plugin`
- Read-only: `no`
- Explicit approval required: `no`

### /osk deploy

Preview or apply project-local harness attachment with receipts.

- MCP tool: `osk_compile_deploy`
- CLI fallback: `openskill-kit agent attach-plugin --host opencode --dry-run`
- Read-only: `no`
- Explicit approval required: `yes`

### /osk eval

Measure OSK behavior through replay or external-agent evals.

- MCP tool: `osk_run_behavior_eval`
- CLI fallback: `openskill-kit eval`
- Read-only: `no`
- Explicit approval required: `no`

### /osk pack

Export, verify, diff, sign, or import behavior packs through trust gates.

- MCP tool: `osk_pack_behavior`
- CLI fallback: `openskill-kit pack export`
- Read-only: `no`
- Explicit approval required: `yes`

