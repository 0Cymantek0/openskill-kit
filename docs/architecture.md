# Architecture

OpenSkillKit has two layers:

- **Adaptive Behavior Plane**: local-first project memory, review, retrieval, and agent-facing compilation.
- **Open-World Evolution Plane**: planned scaffold for anchor-based skill evolution, virtual verification, leakage barriers, and benchmark reporting.

The Adaptive Behavior Plane is production-facing today. The Open-World Evolution Plane is an MVP scaffold target until hidden-oracle benchmarks prove real agent improvement.

```text
packages/core
  config, events, redaction, signals, evidence cards, Preference Graph,
  integrity, calibration, retrieval, compilers, sync, evals, maintenance,
  OpenWorld schemas/control-plane helpers
packages/cli
  command-line interface over core
packages/mcp-server
  stdio MCP bridge over core
packages/local-adapter-plugin
  compatibility adapter package
packages/agent-plugin-bundle
  compatibility plugin bundle
python/openskillkit_evolution
  OpenWorld evolution engine skeleton and future sandbox/retrieval/verifier code
```

## Adaptive Data Flow

```text
init
  -> .openskill-kit/config.json
  -> observe lifecycle events
  -> redact and append JSONL
  -> extract normalized signals through extractor registry
  -> write Evidence Cards
  -> update Preference Graph
  -> validate memory integrity
  -> calibrate from review/eval outcomes
  -> retrieve relevant active behavior with budget traces
  -> compile Active Behavior Layer
  -> install manifests/skills/hooks or expose MCP/pack/sync artifacts
```

## Project State

```text
.openskill-kit/
  config.json
  project.json
  events/
  sessions/
  runtime/
  signals/
  evidence/
  preferences/
  reviews/
  compiled/
  installs/
  evals/
  compact/
  archive/
  reports/
  packs/
  sync/
  openworld/
  evolution/
```

Private data defaults to ignored files. Shareable behavior must pass review, integrity, privacy filtering, and pack verification before export.

## Event Store

Events are append-only JSONL. Redaction runs before storage. Raw prompts and raw diffs are omitted unless config opts in. The event index records counts per monthly file so status does not need to scan all events.

## Signal Extraction

`packages/core/src/signals/extract.ts` is the orchestration layer. Event-specific extraction lives in `signals/extractors/`, and each emitted signal can carry `extractorId` metadata. Calibration keys prefer `extractorId` when present, then fall back to signal kind for legacy signals.

Signals may come from:

- event extractors
- repeated successful command detection
- semantic preference proposals
- repository pattern collection

## Evidence Cards

Evidence Cards are sanitized proof objects for learned behavior. They contain the source event IDs, kind, category, scope, statement, redacted quote or command evidence, privacy class, hash, and redaction metadata. Raw private event data is not copied into cards by default.

Evidence Cards answer: "Why did this preference exist?"

OpenWorld Anchor Cards will answer: "What external or project-local fact can independently support a skill or verifier?"

## Preference Kernel

Signals become Preference Nodes. Confidence is deterministic and explainable, using weighted evidence, time decay, conflict state, and calibration. Conflicts are detected when opposing statements overlap in the same category. Review can activate, reject, lock, demote, edit, merge, split, or promote nodes.

Memory Integrity blocks unsafe learned behavior before activation or compilation. It checks missing evidence, missing sources, secret-like content, prompt-injection markers, hidden-behavior instructions, destructive command preferences, risky global promotions, and conflicts with locked active behavior.

## Calibration

Calibration records reliability buckets from review outcomes and eval outcomes:

- category
- extractor
- scope
- evidence kind
- privacy class
- eval outcome

This keeps future confidence and retrieval decisions grounded in what reviewers and evals accepted or rejected.

## Retrieval

Progressive retrieval ranks active preferences for the current task and path context. It emits scored items, reasons, retrieval level, inferred languages/task types/path roots, budget usage, and omitted-item traces. This prevents the agent context from becoming a flat dump of all memory.

The route planner writes `.openskill-kit/retrieval/route-plans/*.json` and
chooses among `local-only`, `project-evidence`, `review-needed`, and
`openworld-research`. Decisions include risk, novelty, local coverage, gates,
conflicts, and whether OpenWorld must build leakage-audited verifier evidence.
It also reads the Workflow Graph: active/locked workflow matches can support a
`local-only` route, while candidate/staged workflow matches count only as
review-gated `project-evidence`.

## Workflow Graph

`openskill-kit workflows mine` reads redacted local events and mines repeated
passing command/test sequences across sessions into `.openskill-kit/workflows/graph.json`.
Nodes remain `candidate` by default, or `staged` only under `auto-stage` when
confidence is high enough. `workflows list` and MCP `osk_get_workflow_graph`
render the current graph so reviewers can inspect the repeatable sequence before
any future compiler turns it into skills, command policy, or review checklists.
The current compiler already consumes only `active` and `locked` workflows:
`project-behavior` gets an `active-workflows.md` reference, `project-workflows`
is emitted as a focused skill shard, and command policy/review checklist/path
map artifacts include active workflow sequences.
The Learning Review Queue now includes workflow candidates beside preference
candidates, and the terminal review screen shows workflow candidates as
read-only previews until workflow-specific review actions are added.

## Compiler

The compiler writes deterministic artifacts:

- `compiled/context-pack.md`
- `compiled/skills/project-behavior/SKILL.md`
- `compiled/skills/project-behavior/references/active-preferences.md`
- category-specific dynamic skill shards
- `compiled/hooks/hooks.json`
- `compiled/hooks/scripts/*.cjs`
- `compiled/mcp/server-config.json`
- `compiled/plugin/plugin.json`
- `compiled/manifests/AGENTS.md`
- `compiled/manifests/CLAUDE.md`
- `.claude/rules/*`
- `compiled/behavior/path-map.json`
- `compiled/behavior/command-policy.md`
- `compiled/behavior/review-checklist.md`
- `preferences/graph.md`
- `preferences/active/*.md`
- `sessions/summaries/*.json`
- `runtime/last-run.json`
- `compact/summary.json`

Managed `AGENTS.md` / `CLAUDE.md` installation preserves content outside the
OpenSkillKit block and supports dry-run install/uninstall. Managed blocks carry
a body SHA-256 metadata line; install blocks if an existing managed block has
corrupt markers or a mismatched hash.

## Agent Environment Detection

`openskill-kit detect` writes `.openskill-kit/detection/surfaces.json`,
`.openskill-kit/detection/last-scan.json`, and
`.openskill-kit/detection/reports/environment.md`. The detector reports project
instruction files, Claude/Cursor rules, MCP configs, skills, hooks, and
OpenSkillKit compiled artifacts with read/write policy, privacy risk, managed
block metadata, and confidence. User/global surfaces are opt-in through
`--include-user-surfaces` and remain metadata-only by default. Raw session logs
and agent memories are never imported silently.

## MCP Runtime

`openskill-kit-mcp` exposes adaptive tools for bootstrap, status, context packs, preference retrieval, event recording, proposal submission, review actions, learning, compilation, preference explanation, behavior packs, encrypted sync, evals, doctor checks, lifecycle runs, and maintenance operations.

MCP results are sanitized before output so project and home paths do not leak unnecessarily.

## Behavior Packs And Sync

Project Behavior Packs include project identity, schema compatibility, source metadata, generated artifact inventory, trust metadata, privacy statement, file hashes, and optional signing metadata. Import can write review artifacts before apply, block broad diffs, and exclude hooks unless `trustHooks` is explicit.

Encrypted sync wraps privacy-filtered behavior packs. Raw event logs and private runtime state stay local by default.

## Behavior Evals

Current eval tracks are useful but not paper-level proof:

- replay behavior eval
- baseline compare eval
- external-agent prompt/command harness

They measure adherence, retrieval precision, command policy behavior, forbidden behavior, privacy leak rate, and baseline deltas. They do not yet prove hidden-oracle benchmark improvement.

## Open-World Evolution Plane

The OpenWorld plane is added beside the TypeScript control plane. It must stay local-only and scaffold/MVP until real benchmarks exist.

`openskill-kit openworld doctor` reports what is real today: task records,
leakage checks, local source ingestion, and Anchor Cards are available; web
retrieval is available only for explicit URLs on tasks created with
`--allow-web`; autonomous query planning/search, built-in LLM skill generation,
sandboxed refinement, and hidden-oracle benchmark proof remain missing.

OpenWorld source ingestion now updates `.openskill-kit/openworld/source-index.json`
and `.openskill-kit/openworld/trust-cache.json`. Source text is cached under the
task's `sources/cache/` directory after leakage audit. Trust scores are
explainable metadata, not proof of correctness.

Virtual verifier generation creates executable Node verifier files under each
task's `verifiers/<suite-id>/visible` and `verifiers/<suite-id>/holdout`
directories, plus `manifest.json` and `traceability-map.json`. The generated
cases check anchor/source linkage, source-cache presence, recorded content hash,
quote traceability, and generic oracle-marker absence. Artifact text is leakage
audited before any verifier script is written. `openworld run-verifier` executes
ready Node cases through the local `execFile` sandbox with no shell expansion,
network disabled in policy metadata, stripped environment, output caps, and a
JSON execution record under `verifiers/<suite-id>/results/`.

`openworld refine` is the first bounded refinement controller. It runs visible
verifiers up to three rounds by default, retries sandbox failures once, stops
early on pass or actionable non-transient failure, and runs holdout only after a
visible pass. It writes an OpenWorld `EvolutionRun` with failure taxonomy,
verifier result links, pass/fail summaries, source/anchor/suite references, and
cost metadata. This is verifier-driven control flow, not full candidate-skill
generation or automatic skill repair yet.

`openworld eval-report` turns an `EvolutionRun` into JSON and Markdown metrics:
visible/holdout pass rates, overfit risk, leakage audit count, run/result
references, wall-clock cost, and explicit limitations. The proof level is
`artifact-verifier` unless a future hidden-oracle harness supplies independent
benchmark evidence.

`openworld report --write` collects the task, source registry entries, Anchor
Cards, verifier suites, verifier executions, skill plans, leakage audits,
EvolutionRuns, eval reports, and inferred next actions into
`openworld/tasks/<task-id>/reports/task-report.md`. This gives operators and
host agents one auditable status surface instead of requiring manual directory
inspection. It still reports artifact-verifier evidence only and never promotes
behavior.

`openworld promote-review` is intentionally not promotion to active behavior. It
requires a passed `EvolutionRun`, re-audits the proposed statement and anchors,
records a local evidence event, and writes a semantic proposal into the normal
Learning Review Queue. Review, integrity, calibration, and explicit activation
still control any compiled behavior.

Target flow:

```text
task prompt
  -> leakage barrier and forbidden identifiers
  -> source retrieval/cache
  -> Anchor Cards
  -> Skill Plan
  -> VirtualTestSuite
  -> candidate skill generation
  -> sandboxed verifier runs
  -> bounded refinement
  -> LeakageAudit
  -> EvolutionRun report
  -> reviewed promotion into Adaptive Behavior Plane
```

Required guarantees:

- no network by default
- no hidden oracle strings in queries, sources, anchors, skills, reports, or logs
- all artifacts under `.openskill-kit/openworld` or `.openskill-kit/evolution`
- visible and holdout virtual tests separated
- hidden oracle files never mounted into generation contexts
- benchmark claims blocked until reproducible hidden-oracle runs exist

Python is the right first engine for retrieval, pytest/Vitest orchestration, sandbox adapters, and report generation. TypeScript remains the stable product/control plane.

## Safety Gates

Generated or imported skills are untrusted until scanned and verified. Install blocks verifier errors, fixture failures, and high or critical safety findings unless the caller explicitly allows risk.

OpenWorld artifacts add more gates:

- forbidden identifier and path scanner
- query sanitizer
- source/cache audit
- anchor leakage audit
- verifier leakage audit
- final report leakage audit

`oracle-private` data must never be serialized into skills, sources, anchors, or logs.

## Legacy Scaffold Path

`draft`, topic-based `learn`, and `evolve` remain deterministic local scaffolding commands. They write run reports, evidence ledgers, leakage audits, verifier packs, candidate skill packages, and evaluation artifacts. This path is useful for manual skill creation but is not the OpenWorld paper-style evolution loop.
