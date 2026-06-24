# openskill-kit

Independent OpenSkill-inspired engine for drafting, auditing, testing, and
installing portable agent skills.

This is a clean-room implementation inspired by the OpenSkill paper. It is not
the official OpenLAIR/OpenSkill implementation.

## Quickstart

```bash
npm install
npm run build
npx openskill-kit doctor --json
npx openskill-kit evolve "repo test workflow" --no-llm
npx openskill-kit draft "repo test workflow" --no-llm
npx openskill-kit draft "repo test workflow" --evidence-file research.md --no-llm
npx openskill-kit draft "repo test workflow" --evidence-url https://example.com/docs --no-llm
npx openskill-kit evaluate .openskill-kit/runs/<run-id>/candidate/<skill> --run-repo-checks
```

Drafted skills are written under `.openskill-kit/runs/<run-id>/candidate/`.
Each run also writes `run-report.md`, `evidence-ledger.json`,
`leakage-audit.json`, and `verifier-pack.json` so claims, no-supervision
checks, verifier checks, warnings, and limitations stay inspectable.
`openskill-kit test <skill>` writes `verifier.json` and
`verifier-execution.json` under `.openskill-kit/reports/`, including fixture,
mutation, and optional repository command results.
`openskill-kit evaluate <skill>` writes `evaluation.json` and `evaluation.md`
under `.openskill-kit/evaluations/`, combining verifier, leakage, repository
command, and mutation gates into one readiness report.
Generated drafts include `tests/skill-package-fixture.cjs`; `test` runs it
through the local sandbox runner. Coding agents can also attach through the
stdio MCP server:

```bash
openskill-kit-mcp
```

## Core Commands

```bash
openskill-kit init
openskill-kit doctor
openskill-kit evolve "topic" --no-llm
openskill-kit evolve "topic" --max-rounds 3 --run-repo-checks --no-llm
openskill-kit draft "topic" --no-llm
openskill-kit draft "topic" --evidence-file docs/architecture.md --no-llm
openskill-kit draft "topic" --evidence-url https://example.com/docs --no-llm
openskill-kit learn "topic" --no-llm
openskill-kit audit <skill-path>
openskill-kit test <skill-path>
openskill-kit test <skill-path> --run-repo-checks
openskill-kit evaluate <skill-path>
openskill-kit evaluate <skill-path> --run-repo-checks
openskill-kit install <skill-path> --target opencode-project --dry-run
openskill-kit install <skill-path> --target agents-project --yes
openskill-kit list
openskill-kit inspect <skill-name-or-path>
openskill-kit uninstall <skill-name> --target agents-project --yes
openskill-kit version
```

## Safety Model

Generated or imported skills are untrusted until audited. openskill-kit scans
`SKILL.md`, references, scripts, and package files for prompt-injection phrases,
credential access, suspicious network execution, destructive commands, privilege
escalation, and obfuscated execution. Critical findings block install unless
`--allow-critical-risk` is passed.

## Limitations

The current implementation is the first local spine: deterministic drafting,
local evidence ledger, explicit evidence-file and evidence-url ingestion,
leakage audit for manual/external evidence inputs, package-level verifier pack,
schema validation, scanner, opt-in repository command verifier execution,
mutation check for generated package verifiers, verifier report, local sandbox
policy with optional Docker runner, leakage-aware evaluation report, registry, installer, CLI,
stdio MCP server, OpenCode adapter shell, and Codex plugin bundle. Full
open-world retrieval and benchmark-grade downstream agent evaluation are planned
next and are not faked.

Installs also write `.openskill-kit/installs/<target>/<skill>.json` receipts
with adapter, source, destination, verifier status, and safety score so coding
agents can audit what was installed without inferring from copied folders.

`evolve` currently runs capped deterministic rounds: draft, verify, diagnose,
repair package-level issues when possible, and freeze only when the verifier
passes. It writes `evolution.json` plus `rounds/round-*.json`; it does not fake
LLM refinement.
