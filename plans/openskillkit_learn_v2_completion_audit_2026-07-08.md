# OpenSkillKit Learn v2 Completion Audit - 2026-07-08

## Scope

This audit checks the current `codex/raw-local-learning-plane` worktree against:

- `plans/openskillkit_learn_v2_regrounding_review_2026-07-07.md`
- `plans/openskillkit_learn_engine_v2_frontier_plan.md`
- Current code and tests in `packages/core`, `packages/cli`, and `packages/mcp-server`

It does not quote raw prompts, private transcripts, raw evidence blobs, secrets, or local evidence payloads.

## Current Result

Status: not complete.

Most core Learn v2 product gates are implemented and covered by semantic tests. Completion is still not proven because the review explicitly requires a changed-file/every-line audit, a dead-code pass, and full acceptance-gate tracking before claiming production-complete status. One smaller implementation gap remains: ontology namespace dormancy is still not a first-class lifecycle state, even though stale/bad concept suppression exists.

## Gate Matrix

| Gate | Evidence inspected | Status | Notes |
|---|---|---:|---|
| Strategic memory admission | `conditional-learning.ts`; `learn-v2.test.ts` one-off, security/privacy, repeated support, sparse hypothesis tests | Done | One-off corrections become episode notes; explicit durable and repeated support are gated into candidate/review paths. |
| Conditional hidden-factor inference | `conditional-learning.ts`; `eval.ts` conditional factor cases; `learn-v2.test.ts` button/theme/card tests | Done | Observations, factors, hypotheses, support/counter observations, precision/recall/confidence, admission decisions, and compiled conditions exist. Eval now writes `conditional-factor-cases.json`. |
| Refinement under counterexamples | `conditional-learning.ts`; `learn-v2.test.ts` contrastive UI hypotheses and counterexample preservation | Done | Counter observations are preserved; weak hypotheses stay weak until repeated or explicit durable evidence exists. |
| Dynamic/emergent ontology | `skill-ontology.ts`; `learn-v2.test.ts` multi-namespace, split, attach, profile-backed emergent terms, non-profile unknown-domain terms | Mostly done | Namespaces create/nest/merge/split/attach from clusters and terms. Missing explicit dormant namespace lifecycle. |
| Open-world grounding | `resource-grounding.ts`; `eval.ts`; `learn-v2.test.ts` grounding/eval cases | Done | Authority tiers, license risk, user/project precedence, review-only recommendations, and grounding eval sidecars exist. |
| Reviewable reasoning/debug | `review.ts`; `concept-debug-trace.ts`; `episode-debug.ts`; `conditional-learning.ts`; tests for review queue debug trace links | Done | Review queue and debug views expose why-learned, why-active, evidence joins, factors, ontology, grounding, review, and outcome policy. |
| Behavior-visible activation | `activation.ts`; `task-context` integration; `dynamic-skill-compiler.ts`; activation/detail tests | Done | Runtime context and compiled shards include behavior, conditions, negative triggers, activation phrases, and commands. |
| Outcome suppression/demotion | `outcome-policy.ts`; `recordLearnV2ConceptOutcome`; concept debug trace outcome policy tests | Done for concepts | Concepts can be suppressed/demoted from outcome telemetry. Namespace dormancy remains missing. |
| Raw local ingestion UX | `surfaces.ts`; `learn-plan.ts`; CLI renderer; command-family and CLI tests | Done | Discovery is path-metadata-only; candidates are blocked from normal source-plan execution; concrete safe import commands are now shown. |
| Raw vault retention | `vault.ts`; raw-vault status/GC tests; docs | Done | Status and GC paths exist; raw evidence remains local-only. |
| Normalization adapters | `surfaces.ts`; `normalize.ts`; adapter contract/discovery tests | Done | Adapter registry covers coding agents, terminal, CI/JUnit, IDE diagnostics, issues, reviews, docs, summaries, and generic fallback. |
| Episode reconstruction | `episodes.ts`; persisted reconstruction tests | Mostly done | Deterministic stitching exists. Live host trace propagation is partly represented through ambient/OpenCode metadata, but not proven as broadly as import fixtures. |
| Structural diff filtering | `compress.ts`; parser backend tests | Done for intended scope | Parser-backed/structural diff path and generated-file filtering are covered for current implementation scope. |
| Model routing/OpenCode-native execution | `model-routing.ts`; model proposal/eval/behavior-eval request tests; CLI tests | Done for sanitized mode | Sanitized OpenCode request artifacts and execution path exist. Raw OpenCode dispatch remains intentionally rejected. |
| Agent-backed behavior eval | `eval.ts`; behavior evaluator request/apply tests; MCP behavior-eval test | Done | Agent eval artifacts are schema/hash/path/boundary validated and require grounded pass evidence. |
| Product packaging/stable paths | `paths.ts`; artifact index; docs; CLI help tests | Done | Stable artifact manifest, CLI/MCP path references, team-sharing notes, compiled skills/resources, and install assumptions are documented. |
| Docs match behavior | `docs/commands/learn.md`; CLI help tests; raw candidate command tests | Mostly done | Major surfaces match. Needs final docs update after dormant namespace/dead-code audit decisions if those land. |
| Evaluation proof boundary | `eval.ts`; Learn v2 eval tests; CLI eval summary tests | Mostly done | Deterministic replay, conditional cases, open-world cases, sandbox probe, and agent behavior eval are covered. Full real-agent task success remains outside deterministic proof boundary by design. |
| Changed-file/every-line audit | Review addendum K/M requirements | Missing | No committed changed-file matrix or line-level certification exists yet. |
| Dead-code pass | Review addendum K.4 | Missing | No exported-unused/CLI-flag/descriptor/model-role dead-code audit has been completed. |

## Remaining Required Work

1. Add namespace dormancy or explicitly revise the review/plan to remove that requirement.
2. Run and document a dead-code/reachability pass for Learn v2 exports, CLI flags, descriptors, model-routing roles, and compatibility paths.
3. Produce a changed-file matrix for the active branch with review standard per bucket and evidence for each major touched area.
4. Re-run final validation after any remaining implementation changes.

## Completion Decision

Do not mark the goal complete yet.

The implementation is near product-complete for the main Learn v2 intelligence loop, but the explicit audit gates above are still unproven or incomplete.
