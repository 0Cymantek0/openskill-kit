# Privacy By Command

OpenSkillKit commands are local-first and review-gated. This page records the privacy boundary users should expect from each public command family.

| Command | Reads | Writes | Approval | Privacy Boundary |
|---|---|---|---|---|
| `/osk init` | project metadata | `.openskill-kit/config.json` | no host write by default | no memory/session import |
| `/osk status` | OSK state, attach status, OpenWorld summaries | none | no | read-only |
| `/osk task` | preferences, workflow graph, optional safe finish input | route trace, safe task events | no by default | no raw diff unless config allows |
| `/osk learn` | selected source plan, explicit imports after preview, explicit raw surface files with `--raw`, explicit sanitized Learn v2 model request manifests with `--execute-model-requests`, explicit Learn v2 model output JSON files with `--model-output`, explicit activation/outcome inputs | LearnRun, events, review candidates, Learn v2 raw vault records for accepted sources only, source-gate review artifacts, declassified compatibility records, analysis frames, episode store, model request artifacts, validated model response JSON, model execution hash reports, hashed concept outcome telemetry, concept review queue, compile preview, eval report | yes for explicit imports/apply | no raw prompts, raw diffs, memories, shell history, or hidden answers silently; raw local learning stores accepted raw evidence only in the project-local vault and deidentifies secrets and personal paths before propagation; review-needed raw sources get bounded declassified source-review snippets, rejected raw sources are tombstone-only, and neither can enter extraction; model execution is sanitized-only and raw-to-model dispatch is rejected; model outputs are validated before merge; concept outcome telemetry stores hashes for query/path/command/task identifiers |
| `/osk review` | review queue, evidence cards | review decisions, calibration | yes | activates only selected behavior |
| `/osk research` | local allowed files, explicit URLs | source cards, anchor cards, leakage audit | network/source execution gated | no oracle-private source reads |
| `/osk evolve` | Anchor Cards, verifier suites | candidate skill revisions, EvolutionRun | verifier/sandbox modes gated | review-only promotion |
| `/osk verify` | compiled artifacts, command maps, MCP profiles, reports, verifier metadata | verification reports | sandbox/container when requested | checks command-smell/context bloat and labels `hiddenOracleProof=false` unless real hidden-oracle proof exists |
| `/osk compile` | active reviewed behavior | `.openskill-kit/compiled/*` | no host write | compiled artifacts exclude private event logs |
| `/osk deploy` | compiled plugin, host config, compiled hooks, compiled manifests | project-local host config, generated OpenCode files, project hooks, managed instruction blocks, receipts | yes | dry-run first; no global config write by default |
| `/osk eval` | eval fixtures, compiled behavior | eval reports | external execution when requested | eval outputs stay local |
| `/osk pack` | reviewed behavior and pack metadata | packs, signatures, import reviews | yes for import/sign/apply | excludes events, signals, learn-v2 raw vault, episode store, model request/response, outcome telemetry, analysis/review/eval artifacts, raw learning vault records, analysis frames, ambient metadata, reviews, eval runs, reports, raw prompts, raw diffs, and secrets |

Global rules:

- Never store raw prompts by default.
- Never store raw diffs by default.
- Never store raw local learning evidence unless the user supplies explicit `--raw --surface-file` input and applies it.
- Never let review-needed or rejected raw sources enter Learn v2 episode reconstruction, concept extraction, model request generation, activation, compile preview, or eval inputs.
- Never import user/global memories silently.
- Never read shell history unless the user supplies a file.
- Never propagate raw local learning vault records, raw refs, or raw blob paths into compiled artifacts, plugin output, sync payloads, or behavior packs.
- Never trust Learn v2 model output until strict schema, evidence-id, and leak validation pass.
- Never execute Learn v2 model requests unless the manifest is sanitized-only, `rawRefsIncluded=false`, and prompt/bundle hashes still match.
- Never store raw activation prompts, raw paths, or raw commands in Learn v2 outcome telemetry.
- Never activate learned behavior without review.
- Never claim hidden-oracle benchmark proof from artifact verifiers.
