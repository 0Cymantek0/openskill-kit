# OpenSkillKit Learn v2 Dead-Code And Reachability Audit - 2026-07-08

## Scope

Read-only audit plus follow-up fixes for Learn v2 exports, CLI flags, MCP descriptors, model-routing roles, generated plugin bundle descriptors, and compatibility paths. This audit does not include raw private prompts, raw evidence blobs, secrets, or local-only evidence payloads.

## Methods

- Compared MCP `registerTool(...)` names against compiler `descriptor(...)` names.
- Compared checked-in `packages/agent-plugin-bundle/mcp/descriptors.json` and `server-config.json` against compiler descriptors.
- Checked Learn v2 model-routing roles against request-generation and apply paths.
- Checked CLI Learn v2 flags and core root exports with targeted `rg`/source reads.
- Ran focused validation after fixes:
  - `rtk npm test -- packages/core/tests/deep-architecture.test.ts packages/agent-plugin-bundle/tests/plugin-manifest.test.ts packages/core/tests/docs-coverage.test.ts packages/core/tests/learn-v2.test.ts`
  - `rtk npm run typecheck`
  - `rtk git diff --check`

## Findings And Resolution

| Area | Result | Evidence | Resolution |
|---|---:|---|---|
| Core root exports | Pass | `packages/core/src/index.ts` exports resolved to existing source files. | No code change needed. |
| CLI Learn v2 flags | Pass | `packages/cli/src/index.ts` exposes raw ingest, artifact paths, debug dashboards, model request prep/apply, activation, and outcome telemetry. | No reachability gap found. |
| MCP descriptor parity | Fixed | `packages/mcp-server/src/index.ts`; `packages/core/src/compiler/package-compiler.ts`; `packages/core/tests/deep-architecture.test.ts`. | Added missing descriptors for Learn v2 artifact/store tools, OpenWorld retrieval/build/repair tools, and legacy compatibility tools. Added parity test. |
| Generated plugin bundle descriptors | Fixed | `packages/agent-plugin-bundle/mcp/descriptors.json`; `server-config.json`; `descriptor-hashes.json`; `plugin.json`; `.agent-plugin/plugin.json`; `packages/agent-plugin-bundle/tests/plugin-manifest.test.ts`. | Updated checked-in bundle descriptors/hashes and added parity assertions against compiler descriptors. |
| Learn v2 model-routing roles | Documented | `packages/core/src/learn-v2/model-routing.ts`; `docs/model-routing.md`; `packages/core/tests/docs-coverage.test.ts`. | Added missing behavior-evaluator doc entry. Clarified that evidence-summarizer, declassification-reviewer, and publish-export-auditor are generated support/audit roles, not current automatic request entrypoints. |
| Namespace dormancy reachability | Fixed | `packages/core/src/learn-v2/skill-ontology.ts`; `skill-ontology-memory.ts`; `dynamic-skill-compiler.ts`; `packages/core/tests/learn-v2.test.ts`. | Dormant namespaces are retained in debug/memory, counted in reports, and excluded from compiled skill shards. |

## Residual Risk

No obvious dead Learn v2 export, CLI flag, descriptor, or compatibility path remains after this pass. Full release confidence still depends on the final full-suite validation because this audit used targeted tests plus typecheck, not a full release-check run.
