# /osk learn

Teach OSK from current session, safe detected sources, or explicit imports.

Raw local learning is available for explicitly supplied files. It reads full
project evidence locally, writes raw evidence only into the project-local
Learn v2 vault on apply, normalizes raw learner text in memory for deterministic
extraction while replacing machine-local path prefixes with typed placeholders,
writes declassified compatibility records and analysis artifacts, reconstructs
task episodes, mines declassified concept cards, then keeps activation
review-gated.

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

## Raw Surface Adapter Detection

| Adapter | Typical filename/content marker | Content kind | Sensitivity | Notes |
|---|---|---:|---:|---|
| `opencode` | `opencode-*`, `tool.execute`, `provider: opencode` | inferred | high | Conversation/tool traces may include prompts, paths, commands, and outputs. |
| `codex` | `codex-*` or Codex marker in content prefix | inferred | high | Transcript source; explicit file selection still required. |
| `claude-code` | `claude-*` or Claude marker in content prefix | inferred | high | Transcript source; explicit file selection still required. |
| `cursor` | `cursor-*` or Cursor marker in content prefix | inferred | high | Transcript source; explicit file selection still required. |
| `git` | `.diff`, `.patch`, `git-*`, or `diff --git` | diff | high | Raw diffs stay local; output artifacts receive summaries. |
| `terminal` | `terminal-*`, `shell-*`, `console-*`, command/history marker | log | high | Shell output can contain local paths or secrets. |
| `review-local` | `review-*`, `comments-*`, `pull-request-*`, or explicit `review comment:` prefix | document | medium | Review evidence is declassified before output. |
| `ci-log` | `ci-*`, `junit-*`, `vitest-*`, `.log`, `PASS`, `FAIL`, `ERROR` | log | medium | Logs are compressed and diagnostics are retained. |
| `project-docs` | `README*`, `docs*`, `notes*`, `plan*` filename only | document | low | Words like `plan` in ordinary transcript content do not force this adapter. |
| `agent-summaries` | `summary*`, `handoff*`, `finish*` filename only | summary | medium | Words like `Summary:` in ordinary transcript content do not force this adapter. |
| `generic-transcript` | fallback when no specific marker matches | inferred | high | Default for explicit raw files with no trusted adapter identity. |

## Workflow

1. Detect candidate learning sources.
2. Ask or validate selected source.
3. Preview explicit imports.
4. Append redacted events only after approval.
5. Run lifecycle learning and stage candidates.
6. For raw local learning, run the Learn v2 project relevance hard gate, persist the relevance calibration artifact, reconstruct task episodes, compress tool/diff/log evidence, extract deterministic behavior atoms, merge concept cards, write a behavior-delta-first review queue, compile preview, and learn-v2 eval report.
7. For activation, write a deterministic Concept Activation Index and replay originating episodes to check that concepts are retrievable from similar task context.
8. For model-assisted extraction, choose a Learn v2 execution policy: `deterministic-only`, `opencode-host-sanitized-only`, or `opencode-host-raw-allowed`. Supported today: deterministic extraction and sanitized OpenCode request-artifact generation. Unsupported today: raw OpenCode dispatch; `opencode-host-raw-allowed` is a reserved future policy and is rejected until implemented.
9. For supported sanitized model assistance, write prompt-safe episode bundles, request manifests, expected `response.json` paths, content hashes for the prompt/bundle, and concept-extraction prompts under `.openskill-kit/learn-v2/model-requests/`; OpenCode-configured agents may fill JSON responses, and OSK validates schema, evidence ids, request-file hashes, and leak rules before merging atoms.
10. For repeated OpenCode command/path hashes, create label candidates. Human-readable labels require `/osk review` approval and are never invented from raw telemetry.

## CLI Examples

```bash
openskill-kit osk learn
openskill-kit osk learn --all-detected
openskill-kit osk learn --source opencode-ambient --apply
openskill-kit osk learn --source current-session --source git-local --apply
openskill-kit osk learn --raw --surface-file codex-transcript.jsonl
openskill-kit osk learn --raw --surface-file codex-transcript.jsonl --model-mode opencode-host-sanitized-only --apply
openskill-kit osk learn --raw --surface-file codex-transcript.jsonl --learn-v2-goldens learn-v2-goldens.json
openskill-kit osk learn --reconstruct-episodes
openskill-kit osk learn --extract-concepts
openskill-kit osk learn --run-learn-v2-eval --learn-v2-goldens learn-v2-goldens.json
openskill-kit osk learn --prepare-model-requests
openskill-kit osk learn --model-output .openskill-kit/learn-v2/model-requests/episode_.../request-manifest.json
openskill-kit osk learn --activation-query "parser change" --activation-path packages/core/src/parser.ts --activation-task-type parser-change
openskill-kit osk learn --record-concept-outcome concept_... --concept-outcome helpful --activation-query "parser change"
openskill-kit osk learn --observability
openskill-kit osk learn --raw-vault-status
openskill-kit osk learn --gc-raw-vault --max-raw-vault-bytes 50000000
openskill-kit osk review --concept-accept concept_...
openskill-kit osk review --concept-reject concept_...
openskill-kit osk review --concept-merge '{"targetId":"concept_a","sourceIds":["concept_b"]}'
openskill-kit osk review --concept-split '{"sourceId":"concept_a","atomIds":["atom_b"],"taskTypes":["parser-change"]}'
openskill-kit osk review --concept-supersede '{"supersededId":"concept_old","supersededById":"concept_new"}'
openskill-kit osk review --concept-auto-policy
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
- Raw local source entries include adapter label, adapter-detection reason/confidence, detected format/content kind, explicit-only raw-local read policy, sensitivity, persistence boundary, and `modelBoundary: "declassified-only"` so raw-run output and CLI/TUI status views can show why a source is safe to inspect without implying raw-to-model dispatch.
- Learn v2 raw-learning result includes `learningInputBoundary: "raw-local-in-memory-declassified-artifacts"` so callers can distinguish local raw deterministic extraction from declassified persisted/model-request artifacts and future raw-to-model execution.
- Raw-learning top-level `concepts` remains the legacy current-run projection. The nested `learnV2.concepts` array is the merged concept set used for review, conflict, compile preview, eval, and observability; `digest.currentRunConceptCards`, `digest.mergedConceptCards`, and `learnV2.conceptCounts` make that scope explicit.
- Learn v2 writes a declassified pipeline observability report with source intake counts, source adapter/detection/policy/sensitivity/model-boundary counts, episode confidence/stitching counts, tool compression strategies, patch filter reasons, concept status/risk counts, quality gates, artifact pointers, and next actions.
- MCP advanced profile exposes the staged Learn v2 workflow through `osk_plan_learning_sources_v2`, `osk_ingest_raw_evidence`, `osk_reconstruct_episodes`, `osk_extract_concepts`, `osk_get_concept_review_queue`, `osk_review_concepts`, `osk_compile_concepts`, and `osk_run_learn_v2_eval`. `osk_get_concept_review_queue` returns the persisted behavior-delta-first focus queue, not the raw concept store.
- MCP advanced profile exposes the declassified observability report through `osk_get_learn_v2_observability`, using the latest report by default or an explicit report path when supplied.
- Learn v2 writes declassified evidence-quality artifacts that score normalized records for prioritization and model-routing ROI without dropping raw-local learning evidence.
- Learn v2 writes a concept conflict ledger and links it from the review queue so contradictory, superseding, or overlapping concepts stay reviewable instead of hidden in scoring side effects.
- Learn v2 writes declassified evidence snippets and links them from review cards so reviewers see safe, bounded support text instead of only opaque evidence IDs.
- Behavior pack export/verify runs a publish-boundary audit over shareable payload files; raw learning stays permissive, but packs fail if compiled artifacts contain secrets, raw refs, local paths, private Learn v2 artifact references, inactive/stale Learn v2 resources, unsupported concepts, weak evidence counts, overbroad low-support scope, weak source reliability, or unsafe command activation.
- Learn v2 writes a concept drift report from stored concept/outcome telemetry and links stale or negatively reinforced active concepts into the review queue.
- Learn v2 model request generation uses deterministic ROI routing: high-value correction/security/scope/semantic-patch episodes get prompt-safe OpenCode requests, weak/no-signal episodes are skipped with reasons in a routing manifest.
- Learn v2 raw learning execution policies are `deterministic-only`, `opencode-host-sanitized-only`, and `opencode-host-raw-allowed`. Legacy aliases `heuristic-only`, `remote-redacted`, `remote-explicit`, and `local-raw` normalize to those policy names for compatibility; they are not preferred public names. Raw-to-model execution still hard-fails until implemented.
- Learn v2 model routing artifacts include host-ready OpenCode subagent markdown under `.openskill-kit/model-routing/opencode-agents/` for evidence summarization, concept extraction, contradiction review, scope inference, declassification review, eval planning, and publish/export auditing. OSK writes schemas, prompts, routes, and permission-scoped agent definitions only; OpenCode remains the model executor.
- Applying OpenCode model proposal outputs refreshes the concept review queue, conflict ledger, declassified snippet index, drift report, and eval report so model-derived atoms remain visible proposal data instead of hidden store mutations.
- Learn v2 eval includes concept-quality gates for activation surface, broad-scope evidence strength, confidence caps, command-policy extraction, active reliability/durability, counterevidence, risky suppression, and privacy boundaries.
- `/osk review --concept-accept`, `--concept-lock`, and `--concept-bulk accept-low-risk` enforce the same concept-quality gates before writing active or locked concepts, so underspecified, overbroad, overconfident, counterevidenced, or privacy-broken concepts remain candidates instead of compiling into behavior.
- Learn v2 persisted operations can reconstruct episodes from analysis frames, re-extract concepts from the episode store, and rerun eval without re-reading raw source files.
- Learn v2 project relevance uses a two-layer gate: hard accept/review/reject rules first, then the persisted `.openskill-kit/learn-v2/relevance-calibration.json` score for ambiguous sources. Unanchored terminal histories become review-needed instead of accepted through weak numeric accumulation; unrelated global memory is hard rejected.
- Learn v2 task episodes include an episode confidence breakdown with trace/session/branch/path/semantic/time/outcome linkage factors and explicit stitching risks. Behavior atom confidence is capped by and multiplied through episode confidence so weak single-record or time-gap stitching cannot become high-confidence durable behavior.
- Learn v2 task episodes include phase labels for goal, context loading, planning, implementation, tool/debugging, validation, review/correction, and finalization. Concept extraction treats goal/review/finalization phases as learnable preference evidence so user corrections and review feedback outrank assistant planning text.
- Learn v2 tool summaries include structured command shape, output compression strategy, omitted byte count, and diagnostic signatures. Terminal and CI logs keep failure diagnostics while dropping progress bars, duplicated lines, install noise, and long raw output.
- Learn v2 patch summaries preserve generated, lockfile, formatting-only, empty, and rename-only changes for audit context, but mark them `behaviorEligible=false` with filter reasons. These non-semantic patches do not drive task hints, deterministic concept extraction, confidence boosts, or model behavior inference.
- Learn v2 concept store and activation index under `.openskill-kit/learn-v2/`; these remain project-local and are excluded from packs.
- Learn v2 concept cards include a deterministic scoring breakdown with support counts, source reliability, confidence/durability, and any penalties. Counterevidence lowers confidence and durability before activation or bulk review decisions.
- Learn v2 review supports card merge, split, supersession, narrowing, edits, counterevidence, and status changes under one locked store transaction so activation indexes and graph sync stay consistent. Safe bulk accept only activates low-risk, high-confidence, narrow path-scoped concepts.
- Learn v2 auto policy is guarded by `.openskill-kit/config.json` learning mode: `auto-stage` stages only safe low-risk narrow concepts, `auto-apply-safe` activates only safe low-risk narrow non-security concepts, and weak assistant-only-like candidates can be superseded by stronger contradictory evidence.
- Active Learn v2 concepts compile into `.openskill-kit/compiled/mcp/resources/learn-v2-concepts.json` as declassified MCP-style resources with behavior, scope, activation, confidence, risk, and evidence counts only.
- Active command and workflow concepts also compile into `.openskill-kit/compiled/behavior/command-policy.md` and `.openskill-kit/compiled/behavior/command-policy.json`; the JSON includes Learn v2 structured rules with command status, path/task/phrase conditions, cost class, failure modes, and evidence concept ids so repeated commands stay scoped instead of becoming global rules.
- Learn v2 raw vault maintenance reports hot/pinned/compacted bytes, compacts expired unpinned blobs into declassified local summaries when possible, and tombstones missing raw refs as expired.
- Learn v2 extraction goldens can assert expected concept text, atom kinds, task hints, paths, and forbidden leak text during raw learning eval.
- Learn v2 counterfactual trace eval writes declassified `.openskill-kit/learn-v2/evals/*/counterfactual-trace-cases.json` cases and checks expected concept activation plus negative-trigger suppression without running a sandbox agent.
- Learn v2 activation replay checks whether replayable concepts can be retrieved from originating episode context. Activation scoring uses deterministic BM25-style lexical evidence plus explainable semantic aliases/fingerprints, path, command, task-type, confidence, status, outcome feedback, and negative-trigger features. Runtime activation indexes and eval replay/counterfactual checks share the same activation-entry builder so eval covers the same semantic signals users see in activation diagnostics.
- Learn v2 activation output includes terminal-native diagnostics for active/locked/candidate index counts, scored entries, positive matches, suppressed matches, and no-match next steps. Candidate inspection stays opt-in with `--include-candidate-concepts`. Each activation run appends local hashed telemetry under `.openskill-kit/learn-v2/activation-runs/` so drift can distinguish unused concepts from frequently retrieved concepts without storing raw task prompts, paths, or commands.
- Learn v2 concept outcome telemetry stores concept ids plus hashes of query/path/command/task identifiers. It does not store raw task prompts, raw paths, or raw commands. Later activation reads this local telemetry: helpful outcomes can boost retrieval, while harmful or superseded outcomes suppress stale concepts.
- Learn v2 model request artifacts contain declassified episode bundles, request manifests, expected response paths, prompt/bundle hashes, prompts, and the exact generated OpenCode agent id/file to use. Model responses are untrusted local inputs; `--model-output` accepts either `request-manifest.json` or the expected `response.json` only when it is bound to a sibling request manifest with intact prompt/bundle files whose content hashes still match, then only merges strict JSON with valid evidence ids and rejects malformed files, missing/tampered manifests, wrong response paths, stale manifests, hash mismatches, or secret-like statements without aborting the whole batch.
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
  Outcome telemetry remains local and hashed.

Learned behavior remains staged until `/osk review` accepts it.
Unapproved or rejected labels do not compile into command policy, review checklist, or behavior packs.
