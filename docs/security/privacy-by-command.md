# Privacy By Command

OpenSkillKit commands are local-first and review-gated. This page records the privacy boundary users should expect from each public command family.

| Command | Reads | Writes | Approval | Privacy Boundary |
|---|---|---|---|---|
| `/osk init` | project metadata | `.openskill-kit/config.json` | no host write by default | no memory/session import |
| `/osk status` | OSK state, attach status, OpenWorld summaries | none | no | read-only |
| `/osk task` | preferences, workflow graph, optional safe finish input | route trace, safe task events | no by default | no raw diff unless config allows |
| `/osk learn` | selected source plan, explicit imports after preview | LearnRun, events, review candidates | yes for explicit imports/apply | no raw prompts, raw diffs, memories, shell history, or hidden answers silently |
| `/osk review` | review queue, evidence cards | review decisions, calibration | yes | activates only selected behavior |
| `/osk research` | local allowed files, explicit URLs | source cards, anchor cards, leakage audit | network/source execution gated | no oracle-private source reads |
| `/osk evolve` | Anchor Cards, verifier suites | candidate skill revisions, EvolutionRun | verifier/sandbox modes gated | review-only promotion |
| `/osk verify` | compiled artifacts, command maps, MCP profiles, reports, verifier metadata | verification reports | sandbox/container when requested | checks command-smell/context bloat and labels `hiddenOracleProof=false` unless real hidden-oracle proof exists |
| `/osk compile` | active reviewed behavior | `.openskill-kit/compiled/*` | no host write | compiled artifacts exclude private event logs |
| `/osk deploy` | compiled plugin, host config | project-local host config, receipts | yes | dry-run first; no global config write by default |
| `/osk eval` | eval fixtures, compiled behavior | eval reports | external execution when requested | eval outputs stay local |
| `/osk pack` | reviewed behavior and pack metadata | packs, signatures, import reviews | yes for import/sign/apply | excludes events, signals, ambient metadata, reviews, eval runs, reports, raw prompts, raw diffs, and secrets |

Global rules:

- Never store raw prompts by default.
- Never store raw diffs by default.
- Never import user/global memories silently.
- Never read shell history unless the user supplies a file.
- Never activate learned behavior without review.
- Never claim hidden-oracle benchmark proof from artifact verifiers.
