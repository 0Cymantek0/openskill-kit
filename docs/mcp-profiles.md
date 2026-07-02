# MCP Profiles

OpenSkillKit ships two MCP profiles so normal harnesses get a small tool surface while advanced operators can still reach low-level tools.

## Public Profile

The public profile is the runtime default for OpenCode and generic MCP installs. Generated host configs bind `OPENSKILLKIT_MCP_PROFILE=public`, and the server also falls back to public when the variable is absent or invalid. It exposes facade tools only:

| Tool | Purpose |
|---|---|
| `osk_get_status` | Status, readiness, attach state, proof boundary. |
| `osk_get_task_context` | Task-start behavior capsule. |
| `osk_finish_task` | Task-end safe evidence capture. |
| `osk_plan_learning_sources` | `/osk learn` source picker. |
| `osk_run_learning_plan` | Execute selected learning sources. |
| `osk_review_behavior` | Review queue and approval actions. |
| `osk_run_openworld_workflow` | Research/evolve/verify/report facade. |
| `osk_verify_behavior` | Integrity, leakage, proof, and descriptor checks. |
| `osk_compile_deploy` | Compile and attach/deploy workflow. |
| `osk_run_eval` | Replay, behavior, and external-agent evals. |
| `osk_pack_behavior` | Export, verify, sign, diff, or import packs. |
| `osk_get_docs_help` | Generated command help. |

Public profile must stay at 12 tools or fewer.

## Advanced Profile

The advanced profile keeps detailed tools for scripts, debugging, and low-level workflows. It is opt-in with `OPENSKILLKIT_MCP_PROFILE=advanced` and can expose interaction import internals, OpenWorld subcommands, pack internals, maintenance commands, and legacy skill tooling.

Learn v2 advanced tools expose the raw-local pipeline as an explicit staged workflow:

| Tool | Side effect level | Purpose |
|---|---:|---|
| `osk_plan_learning_sources_v2` | local telemetry only | Return safe legacy source plan plus raw-local policy boundary for explicit files. |
| `osk_ingest_raw_evidence` | preview by default, apply writes local vault/events | Ingest explicit raw-local surface files and produce declassified review/eval artifacts. |
| `osk_reconstruct_episodes` | writes regenerated episode/model-request artifacts | Rebuild episodes from persisted declassified analysis frames. |
| `osk_extract_concepts` | writes concept store and activation index | Re-extract deterministic concepts from the persisted episode store. |
| `osk_get_concept_review_queue` | read-only | Return behavior-delta-first Learn v2 focus cards, appendix count, conflict/drift summaries, and declassified snippets. |
| `osk_review_concepts` | writes reviewed concept state | Accept, reject, lock, demote, narrow, edit, merge, split, supersede, or bulk-review concepts. |
| `osk_compile_concepts` | writes compile preview artifacts | Preview active concept compilation into declassified behavior artifacts. |
| `osk_run_learn_v2_eval` | writes eval artifacts | Run Learn v2 replay/golden/activation checks from persisted state. |

## Files

Compiled plugin files:

- `.openskill-kit/compiled/plugin/mcp/profiles.json`
- `.openskill-kit/compiled/plugin/mcp/descriptors.public.json`
- `.openskill-kit/compiled/plugin/mcp/descriptors.json`
- `.openskill-kit/compiled/plugin/mcp/descriptor-hashes.json`

The descriptor hash must match before a harness trusts generated descriptors. If status reports `descriptor-drift`, re-run attach dry-run, apply after review, then restart the harness MCP server.

`osk_get_status` and `openskill-kit agent plugin-status --json` report both any-host MCP readiness and primary OpenCode readiness. `attached=true` means at least one host can use the MCP server. `defaultHostReady=true` means the primary OpenCode harness is attached, root-bound, plugin-registered, and not descriptor-drifted. OpenCode plugin registration failures report `plugin-missing`, not `wrong-command`.

`/osk verify` and `osk_verify_behavior` also run harness readiness checks over the compiled command map, public MCP profile, OpenCode command names, safety text, and generated command/skill size budgets.
