# Architecture

openskill-kit separates the reusable engine from agent integrations.

```text
packages/core
  skill parser, scanner, verifier, registry, installer, draft engine
packages/cli
  command-line interface over core
packages/opencode-plugin
  thin OpenCode tools over core
packages/codex-plugin
  local Codex plugin bundle and skill instructions
packages/mcp-server
  future stdio MCP bridge over core
```

## Data Flow

```text
topic/task
  -> context collector
  -> local/manual researcher
  -> evidence ledger
  -> draft engine
  -> candidate skill package
  -> verifier pack + safety scanner + verifier
  -> evolution round diagnosis
  -> install target + registry
```

The first implementation uses deterministic local drafting. It does not fake
web research or agent-performance evaluation.

## Run Artifacts

`draft` writes:

- `context.json`: capped local repo context with no raw secret files.
- `evidence-ledger.json`: local sources, hashes, claims, confidence, warnings.
- `verifier-pack.json`: deterministic package-quality assertions.
- `plan.md`: short execution plan.
- `candidate/<skill>/SKILL.md`: portable skill package.
- `candidate/<skill>/tests/skill-package-fixture.cjs`: deterministic generated
  fixture run by the sandbox verifier.
- `evolution.json`: evolve-loop status and round summaries.
- `rounds/round-0.json`: verifier diagnosis for the first local evolution round.

The current verifier pack checks schema, structure, safety, installability,
context efficiency, and portability. It intentionally does not claim that an
agent will solve downstream tasks.

`test` writes two execution artifacts:

- `verifier.json`: full human/machine report, scores, issues, safety findings.
- `verifier-execution.json`: assertion execution split into visible and holdout
  groups.

Holdout assertions are groundwork for the paper's separation principle. At this
stage they are deterministic local package checks, not hidden target tests.

Generated fixture checks currently validate package structure from disk through
the sandbox runner. They are real command executions, but they still validate
skill-package quality rather than downstream agent task success.

## Evolution Loop

`evolve` currently implements the first honest loop: deterministic draft,
verifier execution, diagnosis, and local freeze. It can return
`needs-refinement` or `manual-review`, but autonomous refinement is not enabled
until provider, retrieval, and sandbox boundaries are stronger.

## Sandbox Groundwork

Core includes `local-process` sandbox policy and command runner primitives:

- commands run through `execFile`, not a shell
- working directory must stay inside project root
- command allowlist is explicit
- secret-like env keys are stripped
- timeout and output caps are enforced

This is not a container boundary and does not provide OS-level network blocking.
The policy records `allowNetwork=false` as metadata so later Docker/gVisor
runners can preserve the same interface.
