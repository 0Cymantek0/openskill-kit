# /osk learn

Teach OSK from current session, safe detected sources, or explicit imports.

Raw local learning is available for explicitly supplied files. It reads full
project evidence locally, writes raw evidence only into the project-local
Learn v2 vault on apply, writes declassified compatibility records and analysis
artifacts, reconstructs task episodes, mines concept cards, then keeps
activation review-gated.

## Source Selection

| Source | Default | Policy | Notes |
|---|---|---|---|
| Current session safe summary | selected | safe metadata | Uses OSK task-finish summaries and safe event metadata. |
| Git metadata | selected for all-detected | safe metadata | Branch, changed file names, diff stats, and commit subjects only. No raw diffs. |
| OpenCode ambient metadata | selected when present | safe metadata | Reads `.openskill-kit/ambient/opencode-events.jsonl` written by generated OpenCode hooks. Whitelisted event metadata only; no raw prompts, raw diffs, or tool output. |
| Codex/Claude/Cursor/manual export file | not selected | explicit import | Preview first, apply only after explicit approval. |
| Review notes file | not selected | explicit import | Converts supplied notes into redacted review-comment events. |
| Terminal history file | not selected | explicit import | Requires explicit file path; command metadata only. |
| Raw local surface file | explicit only | raw local | Reads raw local evidence, stores content-addressed raw blobs under `.openskill-kit/learn-v2/raw-vault/`, writes declassified analysis/review/eval artifacts, keeps legacy deidentified compatibility records under `.openskill-kit/raw-vault/`, and stages reviewable concepts. |
| User/global memory stores | never selected | blocked | Metadata-only detection; import requires an explicit export file. |

## Workflow

1. Detect candidate learning sources.
2. Ask or validate selected source.
3. Preview explicit imports.
4. Append redacted events only after approval.
5. Run lifecycle learning and stage candidates.
6. For raw local learning, reconstruct task episodes, compress tool/diff/log evidence, extract deterministic behavior atoms, merge concept cards, write a behavior-delta-first review queue, compile preview, and learn-v2 eval report.
7. For model-assisted extraction, write prompt-safe episode bundles and concept-extraction prompts under `.openskill-kit/learn-v2/model-requests/`; OpenCode-configured agents may fill JSON responses, and OSK validates schema, evidence ids, and leak rules before merging atoms.
8. For repeated OpenCode command/path hashes, create label candidates. Human-readable labels require `/osk review` approval and are never invented from raw telemetry.

## CLI Examples

```bash
openskill-kit osk learn
openskill-kit osk learn --all-detected
openskill-kit osk learn --source opencode-ambient --apply
openskill-kit osk learn --source current-session --source git-local --apply
openskill-kit osk learn --raw --surface-file codex-transcript.jsonl
openskill-kit osk learn --raw --surface-file codex-transcript.jsonl --model-mode remote-redacted --apply
openskill-kit osk learn --raw --surface-file codex-transcript.jsonl --learn-v2-goldens learn-v2-goldens.json
openskill-kit osk learn --prepare-model-requests
openskill-kit osk learn --model-output .openskill-kit/learn-v2/model-requests/episode_.../response.json
openskill-kit osk learn --raw-vault-status
openskill-kit osk learn --gc-raw-vault --max-raw-vault-bytes 50000000
openskill-kit osk review --concept-accept concept_...
openskill-kit osk review --concept-reject concept_...
openskill-kit osk review --concept-bulk accept-low-risk
openskill-kit osk review --label-command sha256:... --as "npm test"
openskill-kit osk review --reject-label sha256:... --label-kind path
openskill-kit osk review --write
```

## Output Contract

- Sources considered and used.
- Events appended.
- Signals extracted.
- Candidate preferences and workflows.
- Learn v2 task episode, concept review, compile preview, and eval artifacts when `--raw` is used.
- Learn v2 concept store and activation index under `.openskill-kit/learn-v2/`; these remain project-local and are excluded from packs.
- Learn v2 raw vault maintenance reports hot/pinned/compacted bytes and can garbage-collect expired unpinned blobs.
- Learn v2 extraction goldens can assert expected concept text, atom kinds, task hints, paths, and forbidden leak text during raw learning eval.
- Learn v2 model request artifacts contain declassified episode bundles and prompts only. Model responses are untrusted local inputs; `--model-output` accepts only strict JSON with valid evidence ids and rejects malformed files or secret-like statements without aborting the whole batch.
- Review-gated command/path label candidates for repeated safe hashes.
- Review queue path.
- Privacy statement confirming no raw prompts, raw diffs, secrets, or hidden benchmark answers were copied.
- OpenCode ambient records with raw-prone keys such as `command`, `path`, `prompt`, `diff`, `content`, `url`, `cwd`, or `env` are skipped even if legacy flags claim the record is safe. Warnings include key names only, never raw values.
- Raw local learning never means raw propagation. The raw blob vault is
  project-local, `.gitignore`d, and excluded from compile/pack/sync/plugin
  outputs. Secret assignments, API keys, user home paths, and project root paths
  are replaced with typed placeholders before analysis frames, staged imports,
  review digests, compile previews, eval reports, compiled behavior, or behavior
  packs.

Learned behavior remains staged until `/osk review` accepts it.
Unapproved or rejected labels do not compile into command policy, review checklist, or behavior packs.
