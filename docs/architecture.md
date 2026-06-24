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
  stdio MCP bridge over core
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
  -> evaluation report
  -> evolution round diagnosis
  -> install target + registry
```

The first implementation uses deterministic local drafting. It does not fake
web research or agent-performance evaluation.

## Run Artifacts

`draft` writes:

- `context.json`: capped local repo context with no raw secret files.
- `evidence-ledger.json`: local sources, hashes, claims, confidence, warnings.
- `leakage-audit.json`: benchmark/no-supervision leakage findings for explicit
  evidence file or URL inputs; blocked inputs are not added to the ledger.
- `verifier-pack.json`: deterministic package-quality assertions.
- repository command checks discovered from scripts such as `test`, `lint`,
  `typecheck`, `check`, or `verify`; these are recorded in the verifier pack and
  executed only when `--run-repo-checks` is passed.
- `run-report.md`: human-readable run summary for agent handoff, including
  evidence counts, leakage status, verifier commands, warnings, and limitations.
- `plan.md`: short execution plan.
- `candidate/<skill>/SKILL.md`: portable skill package.
- `candidate/<skill>/tests/skill-package-fixture.cjs`: deterministic generated
  fixture run by the sandbox verifier.
- `evolution.json`: evolve-loop status and round summaries.
- `rounds/round-0.json`: verifier diagnosis for the first local evolution round.

The current verifier pack checks schema, structure, safety, installability,
context efficiency, portability, and opt-in repository command execution. It
intentionally does not claim that an agent will solve downstream tasks.

`test` writes two execution artifacts:

- `verifier.json`: full human/machine report, scores, issues, safety findings.
- `verifier-execution.json`: assertion execution split into visible and holdout
  groups, package fixture results, mutation results, plus any repository command
  results when enabled.

`evaluate` writes two readiness artifacts:

- `evaluation.json`: machine-readable gates for verifier status, leakage audit,
  repository commands, and mutation checks.
- `evaluation.md`: concise human report with metrics, artifact links, and
  limitations.

Holdout assertions are groundwork for the paper's separation principle. At this
stage they are deterministic local package checks, not hidden target tests.

Generated fixture checks currently validate package structure from disk through
the sandbox runner. They are real command executions, but they still validate
skill-package quality rather than downstream agent task success.

Verifier execution also runs a local mutation check against generated skill
packages: it removes the verification section from a copied package and expects
the package fixture to fail. A surviving mutant fails the report because the
verifier did not catch a known-bad package.

## Evolution Loop

`evolve` currently implements a capped deterministic loop: draft, verifier
execution, diagnosis, package-level repair, rerun, and local freeze. It can
repair missing generated sections required by the verifier fixture. It can still
return `needs-refinement` or `manual-review`; LLM-based refinement is not enabled
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

Core also includes a Docker policy/runner path. It preserves the same command
allowlist and cwd checks, mounts the project into `/workspace`, and maps
`allowNetwork=false` to Docker `--network none`. Docker remains optional because
developer machines and CI may not have a running daemon.

## MCP Bridge

`openskill-kit-mcp` exposes core through stdio tools for local coding agents:

- `openskill_doctor`
- `openskill_draft`
- `openskill_evolve`
- `openskill_audit`
- `openskill_test`
- `openskill_evaluate`
- `openskill_install`
- `openskill_list`
- `openskill_inspect`

Tool outputs include structured JSON and sanitized text. Project and home paths
are redacted from responses, and install defaults stay dry-run unless caller
explicitly asks to write.

## Install Receipts

Successful installs write `.openskill-kit/installs/<target>/<skill>.json`.
Receipts record the adapter target, source package, destination directory,
verifier status, and safety score. Uninstall removes the matching receipt.
