# OpenSkillKit Learn v2 Changed-File Matrix - 2026-07-08

## Scope

Changed-file matrix for the current `codex/raw-local-learning-plane` pass after the completion audit. It covers the files changed in this pass and records the review standard and validation evidence. It does not expose raw prompts, raw diffs, secrets, or local-only evidence payloads.

## Matrix

| File / area | Responsibility | Review standard | Evidence inspected | Risk |
|---|---|---|---|---:|
| `packages/core/src/learn-v2/schemas.ts` | Learn v2 ontology contract | Backward-compatible schema defaults; explicit dormant namespace status and counts. | Typecheck; focused Learn v2 tests. | Low |
| `packages/core/src/learn-v2/skill-ontology.ts` | Runtime namespace generation and operations | Dormant namespaces retained for history/debug; no merge/split/nest/attach operations for dormant namespaces. | `learn-v2.test.ts` dormant lifecycle assertions. | Low |
| `packages/core/src/learn-v2/skill-ontology-memory.ts` | Durable ontology memory | Stale namespaces become dormant when not refreshed; fresh candidates can revive through later runs. | Memory lifecycle regression test; typecheck. | Low |
| `packages/core/src/compiler/dynamic-skill-compiler.ts` | Compiled ontology skill shards | Dormant namespaces must not produce active agent skills. | Dormant compile regression test. | Low |
| `packages/core/src/learn-v2/pipeline.ts` | Empty artifact defaults | New dormant count defaults to zero. | Typecheck; focused Learn v2 tests. | Low |
| `packages/core/src/learn-v2/observability.ts` | Product observability | Dormant namespace count appears in report schema and markdown. | Typecheck. | Low |
| `packages/cli/src/index.ts` | CLI ontology debug renderer | Debug output includes dormant count without leaking local paths. | Typecheck; existing CLI debug coverage retained. | Low |
| `packages/core/src/compiler/package-compiler.ts` | MCP descriptor compiler | Descriptor catalog must match registered MCP tools. | New parity test in `deep-architecture.test.ts`. | Low |
| `packages/agent-plugin-bundle/mcp/*` | Checked-in package descriptor bundle | Static descriptor artifacts must match source compiler and hashes. | Plugin manifest parity test; hash refresh. | Low |
| `packages/agent-plugin-bundle/plugin.json`, `.agent-plugin/plugin.json` | Plugin integrity metadata | Descriptor hash must match refreshed descriptor catalog. | Plugin manifest test. | Low |
| `packages/agent-plugin-bundle/tests/plugin-manifest.test.ts` | Static bundle regression coverage | Assert descriptor/server-config parity and status risk metadata. | Targeted test run passed. | Low |
| `packages/core/tests/deep-architecture.test.ts` | Source MCP descriptor regression coverage | Assert registered tools and compiled descriptors have the same set. | Targeted test run passed. | Low |
| `docs/model-routing.md` | Model-routing user docs | Document all generated Learn v2 roles and distinguish automatic request roles from support/audit roles. | Docs coverage test. | Low |
| `packages/core/tests/docs-coverage.test.ts` | Docs guardrail | Lock behavior-evaluator doc entry and request-entrypoint clarification. | Targeted test run passed. | Low |
| `packages/core/tests/learn-v2.test.ts` | Learn v2 semantic coverage | Prove dormant inactive-only namespaces and stale memory dormancy behavior. | 147 Learn v2 tests passed in focused run. | Low |

## Validation Captured

- `rtk npm test -- packages/core/tests/deep-architecture.test.ts packages/agent-plugin-bundle/tests/plugin-manifest.test.ts packages/core/tests/docs-coverage.test.ts packages/core/tests/learn-v2.test.ts`
- `rtk npm run typecheck`
- `rtk git diff --check`

## Completion Impact

This pass closes the previously missing namespace dormancy, descriptor parity, dead-code/reachability, and changed-file matrix gates for the files touched here. A final full-suite validation is still required before claiming the whole goal complete.
