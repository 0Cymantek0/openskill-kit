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
npx openskill-kit forge "repo test workflow" --no-llm
npx openskill-kit draft "repo test workflow" --no-llm
```

Drafted skills are written under `.openskill-kit/runs/<run-id>/candidate/`.
Each run also writes `evidence-ledger.json` and `verifier-pack.json` so claims
and checks stay inspectable.
`openskill-kit test <skill>` writes `verifier.json` and
`verifier-execution.json` under `.openskill-kit/reports/`.
Generated drafts include `tests/skill-package-fixture.cjs`; `test` runs it
through the local sandbox runner.

## Core Commands

```bash
openskill-kit init
openskill-kit doctor
openskill-kit forge "topic" --no-llm
openskill-kit draft "topic" --no-llm
openskill-kit learn "topic" --no-llm
openskill-kit audit <skill-path>
openskill-kit test <skill-path>
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
local evidence ledger, package-level verifier pack, schema validation, scanner,
verifier report, local sandbox policy metadata, registry, installer, CLI,
OpenCode adapter shell, and Codex plugin bundle. Full open-world retrieval,
container sandboxing, skill evolution, and benchmark leakage audits are planned
next and are not faked.

`forge` currently runs one deterministic round: draft, verify, diagnose, and
freeze only when the verifier passes. It writes `evolution.json` and
`rounds/round-0.json`; it does not fake LLM refinement.
