# OpenSkillKit

OpenSkillKit is a local-first Adaptive Skill Graph for AI coding agents. It
helps an existing harness learn how a repository wants work done without
silently uploading prompts, importing memories, or taking over the editor. It
turns safe workflow signals, reviewed interaction imports, explicit evidence,
and OpenWorld research artifacts into an inspectable Behavior Profile. Reviewed
behavior then compiles into Context Packs, skills, hooks, MCP descriptors,
slash-command maps, host attach metadata, and shareable Project Behavior Packs.

OpenSkillKit is not model training and it does not need provider keys. The host
agent still does the reasoning. OpenSkillKit supplies project-local behavior
memory, evidence cards, review gates, verifier artifacts, and harness surfaces
that agents already know how to use.

The public user surface is 12 `/osk` command families: `init`, `status`,
`task`, `learn`, `review`, `research`, `evolve`, `verify`, `compile`,
`deploy`, `eval`, and `pack`. Low-level CLI commands and MCP tools remain
available for automation, but daily harness workflows should start with these
families.

## Quickstart

For a coding harness, OpenCode is the primary full-feature target. Generic MCP,
Codex, Claude Code, and Cursor attach paths are available with conservative
preview-first behavior.

```bash
npm install
npm run build

# Preview setup, then re-run with --yes when the plan is acceptable
npx openskill-kit osk setup --host opencode
npx openskill-kit osk setup --host opencode --yes

# Preview uninstall, then apply. Local .openskill-kit state is preserved unless --delete-state is used.
npx openskill-kit osk uninstall --host opencode
npx openskill-kit osk uninstall --host opencode --yes
```

When attached through MCP, the harness should call `osk_bootstrap_session`
first, route `/osk ...` requests through the compiled command map, and fall back
to the matching CLI command only when MCP is unavailable. Learned behavior stays
inactive until review accepts it. Deploy/apply flows are preview-first and
approval-gated.

Generic MCP fallback:

```bash
npx openskill-kit compile --target plugin
npx openskill-kit agent attach-plugin --host generic-mcp --dry-run
```

Launch docs:

- [OpenCode harness guide](docs/harnesses/opencode.md)
- [Codex harness guide](docs/harnesses/codex.md)
- [Claude Code harness guide](docs/harnesses/claude-code.md)
- [Cursor harness guide](docs/harnesses/cursor.md)
- [MCP profiles](docs/mcp-profiles.md)
- [Privacy by command](docs/security/privacy-by-command.md)

This creates `.openskill-kit/`, records only explicitly supplied safe metadata,
stages candidate behavior for Learning Review, compiles a Context Pack and
project behavior skill, and writes an attachable plugin under
`.openskill-kit/compiled/plugin/`. The plugin includes `.agent-plugin`,
`.mcp.json`, command maps, MCP profiles, skills, install guides, behavior
artifacts, and privacy gates. It does not copy raw prompts, raw diffs, hidden
benchmark answers, raw interaction imports, private evidence blobs, review
queues, or user memories into compiled artifacts.

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
generation with traceable `file-exists`/`file-contains` checks, review-only candidate skill artifacts, local-process or opt-in Docker sandbox execution of
generated verifier scripts, verifier quality scoring, bounded verifier
refinement/eval report records, candidate revision artifacts, local-process
sandbox repair probes with optional caller-provided Docker mode, and review-only promotion proposals. It also has a static
hidden-oracle denied-path harness that scans generated artifacts without reading
oracle files. It still does not perform broad search-engine-backed web crawling,
built-in LLM skill generation, managed container runtime/pools, or hidden-oracle
benchmark evaluation yet.

## Core Commands

| Family | Use it for | First route |
|---|---|---|
| `/osk init` | Set up local state and preview attach. | `osk_bootstrap_session` |
| `/osk status` | Show readiness, review counts, plugin state, OpenWorld proof boundary, and next actions. | `osk_bootstrap_session` |
| `/osk task` | Load behavior before work and record a safe finish summary after work. | `osk_get_agent_task_context` |
| `/osk learn` | Plan and run review-gated learning from selected safe sources. | `osk_plan_learning_sources` |
| `/osk review` | Approve, reject, edit, lock, or demote candidate behavior. | `osk_review_behavior` |
| `/osk research` | Build leakage-audited OpenWorld source and anchor plans. | `osk_run_openworld_workflow` |
| `/osk evolve` | Refine source-grounded candidate skills through verifier artifacts. | `osk_run_openworld_workflow` |
| `/osk verify` | Check descriptors, compiled artifacts, verifier suites, and proof limits. | `osk_verify_behavior` |
| `/osk compile` | Refresh context packs, skills, command maps, descriptors, hooks, and plugin files. | `osk_compile_deploy` |
| `/osk deploy` | Preview or apply harness attach and project-local install steps. | `osk_compile_deploy` |
| `/osk eval` | Measure behavior quality, calibration, and context overhead. | `osk_run_behavior_eval` |
| `/osk pack` | Export, sign, verify, import, or apply reviewed behavior packs. | `osk_pack_behavior` |

See [`docs/commands.md`](docs/commands.md) for the full generated command map.
The lower-level CLI remains stable for scripts and advanced users:

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

Public-profile facade tools:

- `osk_bootstrap_session`
- `osk_explain_status`
- `osk_get_agent_task_context`
- `osk_finish_agent_task`
- `osk_plan_learning_sources`
- `osk_run_learning_plan`
- `osk_review_behavior`
- `osk_run_openworld_workflow`
- `osk_verify_behavior`
- `osk_compile_deploy`
- `osk_run_behavior_eval`
- `osk_pack_behavior`

Advanced-profile tools remain available for scripts and lower-level automation,
including interaction imports, manifest install/uninstall, hook install,
OpenWorld source/verifier primitives, encrypted packs, signing, and maintenance.

Legacy skill drafting, audit, test, evaluation, install, list, and inspect tools
remain available for compatibility.

`osk_bootstrap_session` is the recommended first call for a coding harness. It
returns initialization status plus compiled plugin readiness, attach path,
published skills/capabilities, MCP command, privacy exclusions, approval gates,
and next actions.

For normal coding work, call `osk_get_agent_task_context` before editing and
`osk_finish_agent_task` after verification. The finish call records a safe
task summary, commands, touched files, and outcome, then runs the same learning
and review queue path as the CLI. Do not send raw prompts, raw diffs, secrets,
or hidden benchmark answers as the summary.

For cross-agent session learning, route `/osk import session` to
`osk_import_interaction_source` and keep the first pass as a preview unless the
user approves applying it. Route `/osk session imports` to
`osk_list_interaction_imports` for read-only import receipts. Route
`/osk explain import` to `osk_explain_interaction_import` before learning from
an imported source when a harness needs privacy state and learning next actions. Route
`/osk interaction pool` to `osk_get_interaction_pool` for normalized import
metadata that never includes raw transcript content. Route
`/osk import adapters` to `osk_list_interaction_adapters` before import when a
harness needs accepted formats, adapter status, and the explicit-import-only
privacy policy.

For unfamiliar-domain skill work, route `/osk openworld doctor`,
`/osk openworld source plan`, `/osk openworld refine`, and
`/osk openworld report` to the OpenWorld MCP tools. Route
`/osk openworld promote review` to `osk_openworld_promote_review` only after
explicit approval; it creates a review-only proposal and never activates
behavior or claims hidden-oracle benchmark proof. Proof wording lives in
[`docs/openworld/proof-levels.md`](docs/openworld/proof-levels.md).

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
MCP configs, Codex project `.codex/config.toml` attach support, env-bound project root, plugin attachment health in status/bootstrap,
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

