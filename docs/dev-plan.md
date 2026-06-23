# openskill-kit Development Plan

openskill-kit is an independent clean-room implementation inspired by the paper
"OpenSkill: Open-World Self-Evolution for LLM Agents." It is not the official
OpenLAIR/OpenSkill implementation.

## Evidence Read

- `prompt.md`: requires `openskill-kit` as the public package/CLI name, TypeScript,
  Node 20+, local-first defaults, skill validation, scanner, installer, CLI,
  OpenCode adapter, Codex plugin, tests, docs, and small commits.
- `research.md`: broadens the system into an evidence-backed skill-and-verifier
  compiler with explicit evidence ledgers, leakage barriers, verifier packs,
  sandbox/evolution loops, and adapter exports.
- `openskill.pdf`: defines open-world self-evolution as building both skills and
  verification signals from open-world resources without target-task supervision.
  It emphasizes three stages: open-world knowledge acquisition, leakage-free
  skill evolution with self-built virtual tasks, and zero-shot target evaluation.
- Official OpenLAIR/OpenSkill repository currently hosts overview/roadmap only;
  code is not published. This repo must stay clean-room and independent.
- OpenCode and Codex official docs both support `SKILL.md` directories with
  progressive disclosure. OpenCode loads `.opencode/skills`, `.agents/skills`,
  and compatible global paths. Codex reads `.agents/skills` and plugin bundles.

## Product Shape

Phase 1 builds the narrow but real spine:

1. Core package with skill parser, validator, scanner, context collector,
   deterministic draft engine, verifier, registry, and safe installer.
2. CLI package exposing `openskill-kit` commands with JSON output where useful.
3. Thin OpenCode adapter package that calls core only.
4. Codex plugin package containing a local skill that teaches Codex how to use
   the CLI safely.
5. Smoke test proving draft, audit, test, dry-run install, actual install, list,
   inspect, and uninstall against temp directories.

Next phases add deeper OpenSkill paper fidelity:

1. Evidence ledger and claim extraction.
2. Verifier pack separation with visible/holdout/mutation checks.
3. Sandboxed skill evolution loop with capped retries.
4. Optional MCP server tools.
5. Adapter installers for real OpenCode/Codex config.
6. Benchmark-grade leakage audits and real-repo evaluation reports.

## Architecture Rules

- Core never imports adapter packages.
- Adapters do not duplicate core logic.
- No network, telemetry, or external LLM call by default.
- Generated skills keep `SKILL.md` concise and put bulky context in references.
- Tests use temp directories and fake homes only.
- Installer never overwrites without backup unless dry-run.
