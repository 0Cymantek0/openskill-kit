# MCP Profiles

OpenSkillKit ships two MCP profiles so normal harnesses get a small tool surface while advanced operators can still reach low-level tools.

## Public Profile

The public profile is the default for OpenCode and generic MCP installs. It exposes facade tools only:

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

The advanced profile keeps detailed tools for scripts, debugging, and low-level workflows. It is opt-in and can expose interaction import internals, OpenWorld subcommands, pack internals, maintenance commands, and legacy skill tooling.

## Files

Compiled plugin files:

- `.openskill-kit/compiled/plugin/mcp/profiles.json`
- `.openskill-kit/compiled/plugin/mcp/descriptors.public.json`
- `.openskill-kit/compiled/plugin/mcp/descriptors.json`
- `.openskill-kit/compiled/plugin/mcp/descriptor-hashes.json`

The descriptor hash must match before a harness trusts generated descriptors. If status reports `descriptor-drift`, re-run attach dry-run, apply after review, then restart the harness MCP server.

`osk_get_status` and `openskill-kit agent plugin-status --json` report both any-host MCP readiness and primary OpenCode readiness. `attached=true` means at least one host can use the MCP server. `defaultHostReady=true` means the primary OpenCode harness is attached, root-bound, plugin-registered, and not descriptor-drifted. OpenCode plugin registration failures report `plugin-missing`, not `wrong-command`.

`/osk verify` and `osk_verify_behavior` also run harness readiness checks over the compiled command map, public MCP profile, OpenCode command names, safety text, and generated command/skill size budgets.
