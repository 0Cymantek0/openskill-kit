# OpenSkillKit Commands

OpenSkillKit exposes 12 public `/osk` command families. Low-level commands and MCP tools remain available for advanced workflows, but harnesses should route normal users through these families.

| Command | Intent | Safe default | Writes | Approval | Key artifact |
|---|---|---|---|---|---|
| `/osk init` | Set up OpenSkillKit in this repository without silently taking over the harness. | Preview or staged write | `.openskill-kit/config.json`<br>`.openskill-kit/detection/*` | Not by default | `project harness metadata`<br>`.openskill-kit/config.json`<br>`.openskill-kit/detection/*` |
| `/osk status` | Know whether OSK is ready and what needs attention. | Read-only | No writes | Not by default | `.openskill-kit status artifacts`<br>`compiled plugin status`<br>`OpenWorld proof summary` |
| `/osk task` | Use the right project behavior now, then teach OSK from the completed task. | Preview or staged write | `route trace`<br>`safe task events when finishing` | Not by default | `preferences`<br>`workflows`<br>`review queue` |
| `/osk learn` | Teach OSK from current session, safe detected sources, or explicit imports. | Preview or staged write | `LearnSourcePlan`<br>`LearnRun`<br>`Evidence Cards`<br>`review queue` | Required | `detected surfaces`<br>`interaction import receipts`<br>`event metadata` |
| `/osk review` | Decide what learned behavior becomes active. | Preview or staged write | `review decisions`<br>`calibration report` | Required | `review queue`<br>`Evidence Cards`<br>`Preference Graph` |
| `/osk research` | Find grounded knowledge and verifier anchors without leaking target answers. | Preview or staged write | `Source Cards`<br>`Anchor Cards`<br>`leakage audit` | Not by default | `OpenWorld task`<br>`allowed local files`<br>`explicit URLs` |
| `/osk evolve` | Create a new source-grounded skill when local memory is not enough. | Preview or staged write | `candidate skill revisions`<br>`EvolutionRun` | Not by default | `Anchor Cards`<br>`candidate skills`<br>`verifier suites` |
| `/osk verify` | Know whether behavior or OpenWorld artifacts are safe and credible. | Preview or staged write | `verification reports` | Not by default | `compiled artifacts`<br>`verifier suites`<br>`OpenWorld reports` |
| `/osk compile` | Refresh skills, command maps, MCP descriptors, hooks, and manifests. | Preview or staged write | `.openskill-kit/compiled/*` | Not by default | `active preferences`<br>`active workflows`<br>`config` |
| `/osk deploy` | Make the current harness use OSK artifacts safely. | Preview or staged write | `project-local host config`<br>`.opencode/*`<br>`attach receipts` | Required | `compiled plugin`<br>`host config`<br>`project-local host config` |
| `/osk eval` | Check whether OSK improves outcomes and does not bloat context. | Preview or staged write | `eval reports`<br>`calibration events` | Not by default | `eval fixtures`<br>`compiled behavior`<br>`review outcomes` |
| `/osk pack` | Share or import reviewed behavior without private evidence leakage. | Preview or staged write | `behavior packs`<br>`pack import reviews` | Required | `active behavior`<br>`pack metadata`<br>`signatures` |

## Invariants

- Never store raw prompts by default.
- Never store raw diffs by default.
- Never import memories, transcripts, shell history, or hidden benchmark answers silently.
- Keep learned behavior staged until `/osk review` accepts it.
- Keep deploy/apply operations dry-run first unless the user explicitly approves.

## Family Details

### /osk init

Initialize project-local OSK state and preview harness attach.

- Why public: Bootstrap is a common first-run workflow that must discover surfaces, compile artifacts, and show safe next actions.
- CLI fallback: `openskill-kit init && openskill-kit status`
- MCP first call: `osk_bootstrap_session`
- Skills: `osk-operating-manual`
- Subagents: `osk-router`
- Output: Readiness, detected harnesses, privacy gates, and next command.

Workflow:

1. Initialize local OSK state if missing.
2. Run status and detection.
3. Show plugin readiness and dry-run attach next actions.

### /osk status

Show behavior, review, plugin, and harness health.

- Why public: Status is the low-risk first call for any harness and the fallback when commands fail.
- CLI fallback: `openskill-kit status`
- MCP first call: `osk_bootstrap_session`
- Skills: `osk-operating-manual`
- Subagents: `osk-router`
- Output: Counts, readiness, descriptor drift, pending review, OpenWorld proof boundary, and next actions.

Workflow:

1. Read adaptive status.
2. Read compiled plugin and attach status.
3. Read OpenWorld artifact proof summary without running verifiers.
4. Return compact next actions.

### /osk task

Load task context before work and record safe outcome after work.

- Why public: Task start/finish is the daily workflow loop for harness users.
- CLI fallback: `openskill-kit context --query "<task>"`
- MCP first call: `osk_get_agent_task_context`
- Skills: `project-behavior`, `project-workflows`
- Subagents: `osk-router`
- Output: Compact context or finish digest with review next actions.

Workflow:

1. For context, call task-context facade first.
2. For finish, call finish-task with safe summary, files, commands, and outcome.
3. Stage learned behavior for review.

### /osk learn

Plan and run explicit, review-gated learning from selected sources.

- Why public: Learning touches private evidence, so it needs a visible source picker and approval boundary.
- CLI fallback: `openskill-kit learn`
- MCP first call: `osk_plan_learning_sources`
- Skills: `osk-learning`, `osk-review-gate`
- Subagents: `osk-learner`
- Output: Sources considered/used, events appended, signals, evidence cards, candidate behavior, privacy statement.

Workflow:

1. Detect candidate learning sources.
2. Ask or validate selected source.
3. Preview explicit imports.
4. Append redacted events only after approval.
5. Run lifecycle learning and stage candidates.

### /osk review

Inspect and approve, reject, lock, or demote candidate behavior.

- Why public: Human review is the core safety boundary before activation.
- CLI fallback: `openskill-kit review`
- MCP first call: `osk_review_behavior`
- Skills: `osk-review-gate`
- Subagents: `osk-reviewer`
- Output: Pending items, evidence summaries, actions taken, and compile next action.

Workflow:

1. Show pending behavior with evidence.
2. Explain risk and compile impact.
3. Apply selected review action only when requested.

### /osk research

Plan leakage-audited sources and anchors for unfamiliar tasks.

- Why public: OpenWorld research is the first visible paper-style workflow stage.
- CLI fallback: `openskill-kit openworld source-plan --task-id <task-id>`
- MCP first call: `osk_run_openworld_workflow`
- Skills: `osk-openworld`
- Subagents: `osk-researcher`
- Output: Source plan, blocked candidates, proof level, and next evolve/verify command.

Workflow:

1. Check leakage barrier.
2. Plan local and explicit web sources.
3. Draft anchor candidates with provenance.

### /osk evolve

Generate review-only candidate skills from anchored OpenWorld evidence.

- Why public: Evolution is a high-value product workflow distinct from local learning.
- CLI fallback: `openskill-kit openworld refine --task-id <task-id> --suite-id <suite-id> --candidate-id <candidate-id>`
- MCP first call: `osk_run_openworld_workflow`
- Skills: `osk-openworld`
- Subagents: `osk-evolver`, `osk-verifier`
- Output: Candidate, verifier results, proof level, limitations, and review next action.

Workflow:

1. Generate or select candidate skill.
2. Run visible verifier refinement.
3. Run holdout check.
4. Keep promotion review-only.

### /osk verify

Run integrity, privacy, verifier, and proof-boundary checks.

- Why public: Verification is the trust surface before deploy, pack, or promotion.
- CLI fallback: `openskill-kit openworld verifier-quality --task-id <task-id> --suite-id <suite-id>`
- MCP first call: `osk_verify_behavior`
- Skills: `osk-review-gate`, `osk-openworld`
- Subagents: `osk-verifier`
- Output: Pass/fail checks, proof level, hiddenOracleProof flag, and remediation.

Workflow:

1. Check descriptor integrity and command bloat.
2. Check leakage and proof labels.
3. Run verifier/sandbox only with explicit mode.

### /osk compile

Compile active reviewed behavior into harness artifacts.

- Why public: Compile is the visible boundary between reviewed behavior and generated artifacts.
- CLI fallback: `openskill-kit compile --target plugin`
- MCP first call: `osk_compile_deploy`
- Skills: `osk-operating-manual`
- Subagents: none
- Output: Compiled targets, artifact paths, descriptor hashes, and attach next action.

Workflow:

1. Compile from active reviewed behavior only.
2. Generate command maps and host artifacts.
3. Run integrity hashes.

### /osk deploy

Preview or apply project-local harness attachment with receipts.

- Why public: Deploy writes host config and must be dry-run first.
- CLI fallback: `openskill-kit agent attach-plugin --host opencode --dry-run`
- MCP first call: `osk_compile_deploy`
- Skills: `osk-operating-manual`
- Subagents: `osk-router`
- Output: Planned/applied files, diff summary, receipt, restart instructions.

Workflow:

1. Compile plugin if needed.
2. Preview exact host config changes.
3. Apply only with explicit approval.
4. Write receipt.

### /osk eval

Measure OSK behavior through replay or external-agent evals.

- Why public: Evaluation proves the behavior layer works in real workflows.
- CLI fallback: `openskill-kit eval`
- MCP first call: `osk_run_behavior_eval`
- Skills: `osk-operating-manual`
- Subagents: `osk-evaluator`
- Output: Eval status, baseline comparison if present, artifacts, and residual risk.

Workflow:

1. Run replay or configured external-agent eval.
2. Summarize pass/fail and deltas.
3. Record calibration-safe outcomes.

### /osk pack

Export, verify, diff, sign, or import behavior packs through trust gates.

- Why public: Pack operations cross project boundaries and need explicit provenance.
- CLI fallback: `openskill-kit pack export`
- MCP first call: `osk_pack_behavior`
- Skills: `osk-review-gate`
- Subagents: `osk-reviewer`
- Output: Pack path, signature state, included/excluded classes, and review next action.

Workflow:

1. Export only share-safe behavior.
2. Verify signatures and privacy.
3. Import as staged review items only.

