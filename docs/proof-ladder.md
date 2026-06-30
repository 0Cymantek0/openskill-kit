# OpenSkillKit Proof Ladder

OpenSkillKit uses separate proof labels for separate claims. A higher label in
one area does not upgrade another area.

| Label | Meaning | Current RC1 Use |
|---|---|---|
| `static-artifact` | Generated artifacts exist and pass static integrity, privacy, size, and descriptor checks. | Compiled plugin/profile/command artifacts. |
| `replay-behavior` | Local replay or deterministic behavior eval passed against recorded project evidence. | Adaptive behavior evals. |
| `harness-smoke` | A real harness-facing flow was exercised end to end. | OpenCode setup, ambient learn, review, compile, verify, task context, uninstall golden flow. |
| `external-agent-ab` | Opt-in external-agent A/B run measured behavior improvement. | Future/explicit only. |
| `artifact-verifier` | OpenWorld source, anchor, verifier, run, and eval artifacts passed enough checks for review. | OpenWorld review proposals only. |
| `hidden-oracle-benchmark` | Isolated hidden target benchmark ran outside generation and imported safe result metadata. | Not implemented; must remain false. |

## Status Contract

`/osk status --json` reports `productProof`:

- `adaptiveBehavior`: `not-proof`, `static-artifact`, or `replay-behavior`.
- `openCodeHarness`: `not-proof`, `static-artifact`, or `harness-smoke`.
- `externalAgent`: `not-proof` or `external-agent-ab`.
- `openWorld`: `not-proof` or `artifact-verifier`.
- `hiddenOracleBenchmark`: always `false` until an isolated runner exists.

## Copy Rules

Use precise labels:

- "OpenCode harness-smoke evidence exists."
- "Adaptive behavior has replay-behavior evidence."
- "OpenWorld is artifact-verifier only."
- "Hidden-oracle benchmark proof: false."

Do not say "paper-level OpenSkill proof", "benchmark-proven", or
"hidden-oracle passed" unless `hiddenOracleBenchmark` is true from a real
isolated benchmark runner.
