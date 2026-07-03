# Changelog

## Unreleased

Experimental Learn v2 deterministic/raw-local scaffold:

- Activation quality gates now consider concept status, evidence, and outcome
  feedback before surfacing matches, and suppress matches tied to harmful or
  superseded outcomes.
- Publish-audit hardening: behavior packs and compiled plugin outputs are
  scanned for raw refs, raw-vault paths, absolute user paths, and project
  custom-redaction matches before writes are allowed.
- Publish/export auditor routing: plugin compiler, pack exporter, and model
  artifact emitter route Learn v2 leak diagnostics through the shared
  declassification boundary.
- Activation diagnostics: `osk learn --activation-query` prints no-match
  guidance and surfaces suppressed-match counts without emitting raw query
  text, paths, or commands.
- Hashed activation-run telemetry: activation runs are recorded under
  `.openskill-kit/learn-v2/activation-runs/` as query/path/command hashes
  plus matched concept ids and counts. Raw queries, paths, and commands are
  never stored; the directory is gitignored and excluded from packs.

## 0.1.0

- Adaptive project behavior runtime: local events, redaction, signals,
  Preference Graph, review, retrieval, compiler, hooks, MCP tools, evals, packs,
  maintenance commands, and release checks.
- Legacy deterministic skill drafting and verification remain available as
  compatibility commands.
