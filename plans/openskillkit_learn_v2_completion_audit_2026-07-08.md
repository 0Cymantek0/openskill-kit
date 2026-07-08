# OpenSkillKit Learn v2 Completion Audit - 2026-07-08

## Scope

This audit checks the current `codex/raw-local-learning-plane` worktree against:

- `plans/openskillkit_learn_v2_regrounding_review_2026-07-07.md`
- `plans/openskillkit_learn_engine_v2_frontier_plan.md`
- Current code and tests in `packages/core`, `packages/cli`, `packages/mcp-server`, and the checked-in plugin bundle

It does not quote raw prompts, private transcripts, raw evidence blobs, secrets, or local evidence payloads.

## Current Result

Status: complete for the reviewed Learn v2 release-candidate scope.

The remaining explicit gates from the previous audit were closed in this pass:

- Namespace dormancy is now a first-class ontology lifecycle state.
- Dead-code/reachability audit is documented in `plans/openskillkit_learn_v2_dead_code_reachability_audit_2026-07-08.md`.
- Changed-file matrix is documented in `plans/openskillkit_learn_v2_changed_file_matrix_2026-07-08.md`.
- MCP descriptor and checked-in plugin bundle drift were fixed and locked with parity tests.
- Learn v2 model-routing docs now include behavior-evaluator and explain support/audit roles that are generated but not automatic request entrypoints.

## Gate Matrix

| Gate | Status | Evidence |
|---|---:|---|
| Strategic memory admission | Done | `conditional-learning.ts`; one-off, security/privacy, repeated support, sparse hypothesis tests. |
| Conditional hidden-factor inference | Done | Observation/factor/hypothesis/admission code and tests; conditional eval sidecars. |
| Refinement under counterexamples | Done | Counter-observation preservation and scoped hypothesis tests. |
| Dynamic/emergent ontology | Done | Multi-namespace, split, attach, unknown-domain, and dormant lifecycle tests. |
| Open-world grounding | Done | Authority tier, license risk, precedence, review-only recommendation, and grounding eval tests. |
| Reviewable reasoning/debug | Done | Review queue, concept trace, episode debug, ontology, grounding, review, and outcome links. |
| Behavior-visible activation | Done | Task context and compiled shards include behavior, conditions, negative triggers, activation phrases, and commands. |
| Outcome suppression/demotion | Done | Concept outcome policy plus dormant namespace lifecycle for stale/inactive clusters. |
| Raw local ingestion UX | Done | Explicit raw source import commands, blocked normal plan execution for raw candidates, safe previews. |
| Raw vault retention | Done | Vault status and GC coverage; raw evidence remains local-only. |
| Normalization adapters | Done | Adapter contracts for coding agents, terminal, CI/JUnit, IDE diagnostics, issues, reviews, docs, summaries, fallback. |
| Episode reconstruction | Done for deterministic/reviewed scope | Deterministic stitching, persisted reconstruction, and ambient/OpenCode metadata coverage. |
| Structural diff filtering | Done | Parser-backed/structural diff and generated-file filtering coverage. |
| Model routing/OpenCode-native execution | Done for sanitized mode | Sanitized OpenCode request execution; raw dispatch intentionally rejected. |
| Agent-backed behavior eval | Done | Behavior-evaluator request/apply path and schema/hash/path/boundary validation. |
| Product packaging/stable paths | Done | Artifact manifest, CLI/MCP paths, compiled resources, team-sharing notes, plugin bundle descriptors. |
| Docs match behavior | Done | Model-routing and Learn v2 docs updated; docs coverage tests passed. |
| Evaluation proof boundary | Done | Deterministic replay, conditional cases, open-world cases, sandbox probe, and behavior-eval proof boundary covered. |
| Changed-file/every-line audit | Done for this pass | Changed-file matrix artifact committed. |
| Dead-code/reachability pass | Done | Reachability audit artifact committed; descriptor/model-role findings fixed or documented. |

## Final Validation

- `rtk npm test`: 39 passed, 1 skipped test file; 374 passed, 1 skipped tests.
- `rtk npm run typecheck`: passed.
- `rtk git diff --check`: passed.
- `rtk npm run release-check`: passed build, full tests, typecheck, smoke, static OpenCode plugin check, quickstart check, package manifest check, npm package dry-run, and Python tests.

## Completion Decision

Mark the Learn v2 regrounding goal complete.
