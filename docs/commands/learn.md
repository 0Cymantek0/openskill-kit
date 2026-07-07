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
| Codex/Claude/Cursor/Gemini/Roo/Kilo/Cline/Goose/Zed/manual export file | not selected | explicit import | Preview first, apply only after explicit approval. |
| Review notes file | not selected | explicit import | Converts supplied notes into redacted review-comment events. |
| Terminal history file | not selected | explicit import | Requires explicit file path; command metadata only. |
| Raw local surface file | explicit only | raw local | Reads raw local evidence, stores content-addressed raw blobs under `.openskill-kit/learn-v2/raw-vault/`, writes declassified analysis/review/eval artifacts, keeps legacy deidentified compatibility records under `.openskill-kit/raw-vault/`, and stages reviewable concepts. |
| User/global memory stores | never selected | blocked | Metadata-only detection; import requires an explicit export file. |

## Raw Surface Adapter Detection

| Adapter | Typical filename/content marker | Content kind | Normalize profile | Sensitivity | Notes |
|---|---|---:|---:|---:|---|
| `opencode` | `opencode-*`, `tool.execute`, `provider: opencode` | inferred | `structured-events` | high | Conversation/tool traces may include prompts, paths, commands, and outputs. |
| `codex` | `codex-*` or Codex marker in content prefix | inferred | `structured-events` | high | Transcript source; explicit file selection still required. |
| `claude-code` | `claude-*` or Claude marker in content prefix | inferred | `structured-events` | high | Transcript source; explicit file selection still required. |
| `cursor` | `cursor-*` or Cursor marker in content prefix | inferred | `structured-events` | high | Transcript source; explicit file selection still required. |
| `gemini` | `gemini-*` or Gemini marker in content prefix | inferred | `structured-events` | high | Transcript source; explicit file selection still required. |
| `roo` | `roo-*`, `roo-code-*`, or Roo marker in content prefix | inferred | `structured-events` | high | Transcript source; explicit file selection still required. |
| `kilo` | `kilo-*`, `kilo-code-*`, or Kilo marker in content prefix | inferred | `structured-events` | high | Transcript source; explicit file selection still required. |
| `cline` | `cline-*` or Cline marker in content prefix | inferred | `structured-events` | high | Transcript source; explicit file selection still required. |
| `goose` | `goose-*` or Goose marker in content prefix | inferred | `structured-events` | high | Transcript source; explicit file selection still required. |
| `zed` | `zed-*`, `zed-agent-*`, or Zed marker in content prefix | inferred | `structured-events` | high | Transcript source; explicit file selection still required. |
| `git` | `.diff`, `.patch`, `git-*`, or `diff --git` | diff | `diff` | high | Raw diffs stay local; output artifacts receive summaries. |
| `terminal` | `terminal-*`, `shell-*`, `console-*`, command/history marker | log | `terminal` | high | Shell output can contain local paths or secrets. |
| `ide-diagnostics` | `diagnostics-*`, `problems-*`, `lsp-*`, `eslint-*`, `pyright-*`, `mypy-*`, or diagnostic fields | log | `ide-diagnostics` | medium | IDE/LSP diagnostics can include paths, messages, snippets, and tool output; explicit file selection still required. |
| `issue-local` | `issues-*`, `tickets-*`, `github-issues-*`, `jira-*`, `linear-*`, or issue field prefixes | document | `issue-local` | medium | Issue exports can include user text, labels, ids, and paths; explicit file selection still required. |
| `review-local` | `review-*`, `comments-*`, `pull-request-*`, or explicit `review comment:` prefix | document | `review-local` | medium | Review evidence is declassified before output. |
| `ci-log` | `ci-*`, `junit-*`, `test-results-*`, `surefire-*`, `vitest-*`, `.log`, `.xml`, `PASS`, `FAIL`, `ERROR`, or JUnit XML tags | log/XML | `ci-log` | medium | Logs are compressed; JUnit XML emits bounded testcase evidence with suite/class/test/file metadata. |
| `project-docs` | `README*`, `docs*`, `notes*`, `plan*` filename only | document | `project-docs` | low | Words like `plan` in ordinary transcript content do not force this adapter. |
| `agent-summaries` | `summary*`, `handoff*`, `finish*` filename only | summary | `agent-summaries` | medium | Words like `Summary:` in ordinary transcript content do not force this adapter. |
| `generic-transcript` | fallback when no specific marker matches | inferred | `generic-transcript` | high | Default for explicit raw files with no trusted adapter identity. |

The adapter contract also owns project-local discovery roots and blocked memory
roots. Normal source planning derives hidden export traversal, candidate adapter
selection, and discovery reports from this registry instead of a separate
path-map, so adding a new tool adapter requires one reviewed contract entry.

## Workflow

1. Detect candidate learning sources.
2. Ask or validate selected source.
3. Preview explicit imports.
4. Append redacted events only after approval.
5. Run lifecycle learning and stage candidates.
6. For raw local learning, run the Learn v2 project relevance hard gate, persist the relevance calibration artifact, keep non-accepted sources out of episode/concept extraction, reconstruct task episodes from accepted sources only, compress tool/diff/log evidence from transcripts, terminal output, local CI/JUnit reports, IDE diagnostics, issues, reviews, and docs, extract deterministic behavior atoms, merge concept cards, write a behavior-delta-first review queue, compile preview, and learn-v2 eval report.
7. Raw local source plans include a `rawLocalDiscovery` summary: scanned path count, returned/found candidate counts, truncation status, adapter/sensitivity/detection counts, known safe hidden export directories, blocked hidden memory directories, and the policy boundary. The planner still reads path metadata only; it never opens candidate raw files.
8. For raw local candidates from known project-local export directories, use the suggested command with `--surface-adapter <adapter>` so raw ingestion keeps the detected adapter without trusting absolute parent path names. Project-local hidden exports are recognized for Codex, Claude, Cursor, Gemini, Roo, Kilo, Cline, Goose, Zed, OpenCode, and conservative IDE diagnostic export folders; memory directories remain blocked.
9. For activation, write a deterministic Concept Activation Index and replay originating episodes to check that concepts are retrievable from similar task context.
10. For model-assisted extraction, choose a supported Learn v2 execution policy: `deterministic-only` or `opencode-host-sanitized-only`. Supported today: deterministic extraction, sanitized OpenCode request-artifact generation, and explicit sanitized OpenCode execution. Unsupported today: raw OpenCode dispatch; `opencode-host-raw-allowed` is a reserved future policy, requires `--experimental-raw-model-dispatch` only to acknowledge the boundary, and is still rejected until UX consent, route display, provider clarity, and privacy review exist.
11. For supported sanitized model assistance, write prompt-safe episode bundles, concept scope bundles, request manifests, expected `response.json` paths, content hashes for the prompt/bundle, and specialized prompts under `.openskill-kit/learn-v2/model-requests/`; `--execute-model-requests` can run those manifests through `opencode run` with attached prompt/bundle files and a deny-by-default inline agent permission profile. OSK validates schema, evidence ids, request-file hashes, response path, and leak rules before merging atoms or scope refinements.
12. Raw Learn v2 run JSON, plain CLI output, and observability reports include a `modelExecution` policy block with request-artifact status, request count, sanitized execute/apply commands, explicit-approval requirement, and the raw-to-model rejection reason. Use this block as the handoff checklist before invoking OpenCode model assistance.
13. For repeated OpenCode command/path hashes, create label candidates. Human-readable labels require `/osk review` approval and are never invented from raw telemetry.

## CLI Examples

```bash
openskill-kit osk learn
openskill-kit osk learn --all-detected
openskill-kit osk learn --source opencode-ambient --apply
openskill-kit osk learn --source current-session --source git-local --apply
openskill-kit osk learn --raw --surface-file codex-transcript.jsonl
openskill-kit osk learn --raw --surface-file .codex/sessions/2026-07-05.jsonl --surface-adapter codex
openskill-kit osk learn --raw --surface-file codex-transcript.jsonl --model-mode opencode-host-sanitized-only --apply
openskill-kit osk learn --raw --surface-file codex-transcript.jsonl --learn-v2-goldens learn-v2-goldens.json
openskill-kit osk learn --reconstruct-episodes
openskill-kit osk learn --extract-concepts
openskill-kit osk learn --run-learn-v2-eval --learn-v2-goldens learn-v2-goldens.json
openskill-kit osk learn --run-learn-v2-eval --learn-v2-goldens .openskill-kit/learn-v2/evals/proposals/eval-goldens-20260630000330.json --allow-unreviewed-eval-proposal
openskill-kit osk learn --run-learn-v2-eval --learn-v2-goldens learn-v2-goldens.json --learn-v2-eval-sandbox-probe
openskill-kit osk learn --prepare-behavior-eval-requests --learn-v2-goldens learn-v2-goldens.json
openskill-kit osk learn --execute-model-requests --model-request .openskill-kit/learn-v2/model-requests/behavior-eval-.../request-manifest.json --apply-model-responses
openskill-kit osk learn --behavior-eval-output .openskill-kit/learn-v2/model-requests/behavior-eval-.../request-manifest.json
openskill-kit osk learn --run-learn-v2-eval --learn-v2-goldens learn-v2-goldens.json --learn-v2-agent-eval .openskill-kit/learn-v2/evals/agent/behavior-agent-eval-20260630000333.json
openskill-kit osk learn --prepare-model-requests
openskill-kit osk learn --execute-model-requests --model-request .openskill-kit/learn-v2/model-requests/episode_.../request-manifest.json
openskill-kit osk learn --execute-model-requests --apply-model-responses
openskill-kit osk learn --model-output .openskill-kit/learn-v2/model-requests/episode_.../request-manifest.json
openskill-kit osk learn --prepare-scope-requests --scope-concept concept_...
openskill-kit osk learn --execute-model-requests --model-request .openskill-kit/learn-v2/model-requests/scope_.../request-manifest.json
openskill-kit osk learn --scope-output .openskill-kit/learn-v2/model-requests/scope_.../request-manifest.json
openskill-kit osk learn --prepare-contradiction-requests --contradiction-concept concept_...
openskill-kit osk learn --execute-model-requests --model-request .openskill-kit/learn-v2/model-requests/contradiction_.../request-manifest.json
openskill-kit osk learn --contradiction-output .openskill-kit/learn-v2/model-requests/contradiction_.../request-manifest.json
openskill-kit osk learn --activation-query "parser change" --activation-path packages/core/src/parser.ts --activation-task-type parser-change
openskill-kit osk learn --record-concept-outcome concept_... --concept-outcome helpful --activation-query "parser change"
openskill-kit osk learn --observability
openskill-kit osk learn --debug-dashboard
openskill-kit osk learn --debug-concept concept_...
openskill-kit osk learn --debug-source
openskill-kit osk learn --debug-source source_...
openskill-kit osk learn --debug-episode episode_...
openskill-kit osk learn --debug-learning
openskill-kit osk learn --debug-observation obs_...
openskill-kit osk learn --debug-hypothesis hyp_...
openskill-kit osk learn --debug-ontology
openskill-kit osk learn --debug-ontology namespace_...
openskill-kit osk learn --debug-ontology-operation ontology_op_...
openskill-kit osk learn --debug-grounding
openskill-kit osk learn --debug-grounding ground_...
openskill-kit osk learn --raw-vault-status
openskill-kit osk learn --gc-raw-vault --max-raw-vault-bytes 50000000
openskill-kit osk learn --raw-vault-status --max-raw-vault-bytes 50000000 --max-pinned-raw-vault-bytes 100000000 --max-total-raw-vault-bytes 200000000
openskill-kit osk review --concept-accept concept_...
openskill-kit osk review --concept-reject concept_...
openskill-kit osk review --concept-narrow '{"id":"concept_a","paths":["packages/core/src/parser.ts"],"taskTypes":["parser-change"],"negativeTriggers":["docs-only parser mention"]}'
openskill-kit osk review --concept-merge '{"targetId":"concept_a","sourceIds":["concept_b"]}'
openskill-kit osk review --concept-split '{"sourceId":"concept_a","atomIds":["atom_b"],"taskTypes":["parser-change"]}'
openskill-kit osk review --concept-supersede '{"supersededId":"concept_old","supersededById":"concept_new"}'
openskill-kit osk review --concept-auto-policy
openskill-kit osk review --concept-bulk accept-low-risk
openskill-kit osk review --label-command sha256:... --as "npm test"
openskill-kit osk review --reject-label sha256:... --label-kind path
openskill-kit osk review --write
```

## Activation Query Telemetry

`--activation-query` scores reviewed Learn v2 concepts against a task query and
appends a local hashed activation-run record under
`.openskill-kit/learn-v2/activation-runs/`. Each run stores the schema version,
a `queryHash`, sorted `pathHashes`, sorted `commandHashes`, task types,
match count, suppressed count, and matched concept ids. It never stores or
prints the raw query text, raw paths, or raw commands. `--activation-path`,
`--activation-command`, and `--activation-task-type` feed the same hashed
telemetry boundary.

`--record-concept-outcome` shares that boundary: outcome records store concept
ids plus hashes of query/path/command/task identifiers, never the raw values.
Later activation reads this local telemetry so helpful outcomes can boost
retrieval and harmful or superseded outcomes suppress stale concepts. Both
`activation-runs/` and `outcomes/` are project-local, gitignored, and excluded
from compile/pack/sync/plugin outputs.

## Activation No-Match Output

When `--activation-query` finds no positive match, `/osk learn` prints
terminal-native diagnostics plus a next-step hint. The guidance differs
depending on whether any active/locked concepts exist at all.

No active or locked concepts yet, but reviewable candidates are staged:

```text
$ openskill-kit osk learn --activation-query "refactor task"

Learn v2 activation matches: 0
Suppressed: 0
Index entries: 3 total (0 active, 0 locked, 3 candidate/staged/conflict)
Scored: 0; positive matches before limit: 0; suppressed before limit: 0
Activation index: [PROJECT_ROOT]/.openskill-kit/learn-v2/activation-index.json
Activation telemetry: [PROJECT_ROOT]/.openskill-kit/learn-v2/activation-runs/2026-07.jsonl
No active or locked concepts are available. Review and accept/lock Learn v2 concept cards before relying on activation.
Candidate concepts exist; rerun with --include-candidate-concepts to inspect reviewable matches without activating them.
```

Inspect those reviewable candidates without activating them:

```text
$ openskill-kit osk learn --activation-query "refactor task" --include-candidate-concepts

Learn v2 activation matches: 1
Suppressed: 0
Index entries: 3 total (0 active, 0 locked, 3 candidate/staged/conflict)
Scored: 3; positive matches before limit: 1; suppressed before limit: 0
Activation index: [PROJECT_ROOT]/.openskill-kit/learn-v2/activation-index.json
Activation telemetry: [PROJECT_ROOT]/.openskill-kit/learn-v2/activation-runs/2026-07.jsonl
  [0.420] concept_a1b2c3 Focused regression fixture (candidate; path:packages/core/src/**, task:parser-change)
```

Active/locked concepts exist but none scored above zero for the query — add
path, command, or task-type hints, or narrow the query:

```text
$ openskill-kit osk learn --activation-query "refactor task"

Learn v2 activation matches: 0
Suppressed: 0
Index entries: 5 total (2 active, 0 locked, 3 candidate/staged/conflict)
Scored: 2; positive matches before limit: 0; suppressed before limit: 0
Activation index: [PROJECT_ROOT]/.openskill-kit/learn-v2/activation-index.json
Activation telemetry: [PROJECT_ROOT]/.openskill-kit/learn-v2/activation-runs/2026-07.jsonl
No active concept scored above zero for this query. Add path, command, or task-type hints, or narrow the query.
Candidate concepts exist; rerun with --include-candidate-concepts to inspect reviewable matches without activating them.
```

`--include-candidate-concepts` only reveals candidate/staged/conflict entries
for inspection; it does not activate them. Accepting or locking concepts still
requires `/osk review`. Activation telemetry records only hashed query/path/
command fields and matched concept ids, so the sample output above is
representative and never includes raw query text, raw paths, or raw commands.
Activation matches include only a counterevidence count, never raw
counterevidence reason text. Active or locked concepts with remaining
counterevidence are defensively suppressed until review resolves or removes the
objection; candidate inspection can still show the count for reviewer context.

## Output Contract

- Sources considered and used.
- Events appended.
- Signals extracted.
- Candidate preferences and workflows.
- Learn v2 task episode, concept review, compile preview, and eval artifacts when `--raw` is used.
- Raw local source entries include adapter label, adapter-detection reason/confidence, detected format/content kind, explicit-only raw-local read policy, sensitivity, persistence boundary, and `modelBoundary: "declassified-only"` so raw-run output and CLI/TUI status views can show why a source is safe to inspect without implying raw-to-model dispatch.
- Normal `/osk learn` source planning discovers raw-local candidates through the Learn v2 surface adapter contract using path metadata only. Candidate entries include the predicted adapter id, normalization profile, content kind, sensitivity, detection confidence, score, and suggested `--raw --surface-file ... --surface-adapter ...` command, but remain blocked from normal plan execution until the user supplies the file explicitly. Discovery descends only into known safe project-local hidden export directories such as `.codex-log`, `.codex/sessions`, `.claude/projects`, `.claude/sessions`, `.cursor/chats`, `.cursor/sessions`, `.opencode/sessions`, and `.opencode/traces`; memory-store directories stay blocked.
- Structured session adapters normalize common nested export shapes: role/content message arrays, Claude-style content parts with tool input, Cursor-style context and attachment file references, Codex/OpenCode JSON-string tool arguments, parent conversation/session ids, and trace metadata. Raw source files still remain explicit-only and local.
- Learn v2 raw-learning result includes `learningInputBoundary: "raw-local-in-memory-declassified-artifacts"` so callers can distinguish local raw deterministic extraction from declassified persisted/model-request artifacts and future raw-to-model execution.
- Learn v2 writes a source-gate review artifact for every raw run. Accepted sources may write normalized analysis evidence and enter extraction. Review-needed sources get only a bounded declassified snippet for human source review. Rejected sources are tombstone-only. Non-accepted sources do not write normalized evidence into analysis frames and, when a run has no accepted sources, OSK preserves existing canonical episode stores, model request directories, concept store, activation index, review queue, compile preview, eval report, and lifecycle graph state.
- Raw-learning top-level `concepts` remains the legacy current-run projection. The nested `learnV2.concepts` array is the merged concept set used for review, conflict, compile preview, eval, and observability; `digest.currentRunConceptCards`, `digest.mergedConceptCards`, and `learnV2.conceptCounts` make that scope explicit.
- Learn v2 writes a declassified pipeline observability report with source intake counts, source adapter/detection/normalization-profile/policy/sensitivity/model-boundary counts, episode confidence/stitching counts, tool compression strategies, patch filter reasons, structural parser backend/confidence counts, parser confidence-cap floor, concept status/risk counts, quality gates, artifact pointers, and next actions.
- The observability report also summarizes local concept outcome telemetry as counts only: total outcome records, concepts with outcomes, per-outcome counts, negative outcomes, harmful outcomes, and latest timestamp. It never includes raw activation prompts, paths, commands, hashes, or free-form outcome reasons.
- MCP advanced profile exposes the staged Learn v2 workflow through `osk_plan_learning_sources_v2`, `osk_ingest_raw_evidence`, `osk_reconstruct_episodes`, `osk_extract_concepts`, `osk_get_concept_review_queue`, `osk_review_concepts`, `osk_compile_concepts`, `osk_prepare_learn_v2_model_requests`, `osk_prepare_learn_v2_scope_requests`, `osk_prepare_learn_v2_contradiction_requests`, `osk_prepare_learn_v2_eval_requests`, `osk_execute_learn_v2_model_requests`, `osk_apply_learn_v2_model_outputs`, `osk_apply_learn_v2_scope_outputs`, `osk_apply_learn_v2_contradiction_outputs`, `osk_apply_learn_v2_eval_outputs`, and `osk_run_learn_v2_eval`. `osk_get_concept_review_queue` returns the persisted behavior-delta-first focus queue, not the raw concept store.
- MCP advanced profile exposes the declassified observability report through `osk_get_learn_v2_observability`, using the latest report by default or an explicit report path when supplied.
- Learn v2 writes declassified evidence-quality artifacts that score normalized records for prioritization and model-routing ROI without dropping raw-local learning evidence.
- Learn v2 writes a concept conflict ledger and links it from the review queue so contradictory, superseding, or overlapping concepts stay reviewable instead of hidden in scoring side effects. Conflict entries include declassified diagnostics such as scope overlap, token overlap, kind/polarity checks, confidence delta, supersession pair ids, authority reasons, and protection reasons so reviewers can see why a resolution was suggested. Review queues copy those bounded diagnostics into focused cards so reviewers do not need to open the separate ledger for the common accept/reject/narrow/supersede workflow.
- Learn v2 writes a counterevidence ledger and links it from the review queue so activation-blocking objections are visible by concept, status, risk, and reason bucket before review or bulk activation.
- Learn v2 writes declassified evidence snippets and links them from review cards so reviewers see safe, bounded support text instead of only opaque evidence IDs.
- Learn v2 review queues include declassified drift candidate details, including reason, negative outcome count, activation count, age, and suggestion. This makes stale or harmful concepts visible in review without storing raw activation prompts, paths, or commands.
- Learn v2 review queues include per-card suggested `openskill-kit osk review ...` commands for focused cards, including accept/reject, demote, one-off, narrow, and supersede actions when relevant. When the conflict ledger authorizes `auto-supersede`, the suggested command names the concrete successor concept and includes a deterministic ledger reason instead of a placeholder replacement id. When the conflict ledger authorizes `auto-narrow`, suggested commands include concrete `--concept-narrow` JSON with current paths/task types plus peer-specific negative triggers. Suggestions contain concept ids and declassified rationale only.
- `osk review --write` refreshes and links the Learn v2 concept review queue when concept cards exist, including drift, conflict, counterevidence, and suggested-action context, so the legacy review entry point does not hide Learn v2 work.
- Behavior pack export/verify runs a publish-boundary audit over shareable payload files; raw learning stays permissive, but packs fail if compiled artifacts contain secrets, raw refs, local paths, private Learn v2 artifact references, inactive/stale Learn v2 resources, unsupported concepts, weak evidence counts, overbroad low-support scope, weak source reliability, or unsafe command activation. Pack inspect and import-review output includes bounded Learn v2 concept summaries with id, title, behavior, status, risk, scope, and commands so reviewers can judge imported learned behavior before apply.
- Learn v2 writes a concept drift report from stored concept/outcome telemetry and links stale or negatively reinforced active concepts into the review queue.
- Learn v2 model request generation uses deterministic ROI routing: high-value correction/security/scope/semantic-patch episodes get prompt-safe OpenCode requests, weak/no-signal episodes are skipped with reasons in a routing manifest.
- Learn v2 model proposal JSON supports richer untrusted atom hints: explicit scope paths/task types, applies/does-not-apply conditions, activation phrases/path globs/commands/negative triggers, counterevidence, risk, confidence cap, and one-off hints. OSK validates evidence ids, rejects out-of-episode paths, scans proposal text for secrets, caps confidence deterministically, and keeps final activation/review decisions local.
- Learn v2 scope inference request generation uses reviewed/local concept cards as bounded inputs and routes only concepts with missing conditions, thin activation phrases, broad scope, missing negative triggers, non-low risk, or high-impact reviewed status. Scope-inferencer outputs can only narrow or clarify existing card/atom scope; broader paths, absolute paths, unsafe command hints, invalid counterevidence, and local path/secret leaks are rejected before the concept store is updated. Reviewer-locked scopes can accept conditions-only clarification, but model output cannot change approved paths, task types, negative triggers, activation phrases, path globs, or commands.
- Learn v2 contradiction review request generation uses the deterministic conflict ledger as bounded input and routes unresolved direct, overlapping, supersession, command-policy, or security/convenience conflicts to the `osk-learn-v2-contradiction-reviewer` agent only when there is review ROI. Declassified request bundles include the same bounded conflict diagnostics shown in the ledger and review queue: scope overlap, token overlap, kind/polarity checks, confidence delta, supersession pair ids, authority reasons, and protection reasons. Contradiction-reviewer outputs can add validated card-local counterevidence; supersession and narrowing are applied only when the deterministic ledger already authorizes `auto-supersede` or `auto-narrow`. Human-review findings, broader paths, absolute/local paths, invalid concept/evidence ids, stale request manifests, hash mismatches, and secret/local-path leaks are rejected before concept-store mutation.
- Learn v2 eval-planner request generation uses active, locked, staged, or explicitly selected concept cards as bounded input and routes concepts with review ROI to the `osk-learn-v2-eval-planner` agent. Eval-planner outputs can only write review-required golden proposal files under `.openskill-kit/learn-v2/evals/proposals/`; they do not mutate concept cards, activation indexes, compatibility graphs, or compiled behavior. `--run-learn-v2-eval --learn-v2-goldens <proposal>` rejects unreviewed proposal files by default. Use `--allow-unreviewed-eval-proposal` only for local preview; the proof boundary then states that reviewed eval golden quality was not proven.
- Learn v2 debug commands read persisted declassified artifacts without re-reading raw source files. `--debug-dashboard` summarizes why-learned/why-active counts, conditional links, open-world links, review blockers, and outcome policy links. `--debug-concept <id>` shows one concept's behavior, conditions, admission decisions, factor labels, namespace/grounding links, review signals, outcome policy, and evidence separation. `--debug-source [id]` shows source-gate decisions, adapter policy, relevance reasons, artifact policy, safe matched paths, and matched remote counts without printing raw snippets or remote URLs. `--debug-episode <id>` shows one reconstructed episode's stitching method, confidence risks, evidence ids, safe path cluster, phase hashes, message counts, tool command shapes, patch classes, and token budget without printing raw message text, raw refs, or absolute local paths. `--debug-learning`, `--debug-observation <id>`, and `--debug-hypothesis <id>` show conditional observations, context factors, hypotheses, and memory-admission decisions with observation text represented only as hashes and character counts. `--debug-ontology`, `--debug-ontology <namespaceId>`, and `--debug-ontology-operation <operationId>` show emergent namespace candidates plus create/merge/split/attach operations. `--debug-grounding` and `--debug-grounding <anchorOrConceptId>` show open-world grounding anchors, source authority tiers, precedence, citations, claim counts, and rationale hashes; exact URIs are represented by sanitized citations plus hashes. `--debug-trace-file <path>`, `--debug-ontology-file <path>`, and `--debug-grounding-file <path>` can point at specific local debug JSON artifacts.
- Learn v2 raw learning supported execution policies are `deterministic-only` and `opencode-host-sanitized-only`. `opencode-host-raw-allowed` is reserved and still hard-fails; the CLI requires `--experimental-raw-model-dispatch` to acknowledge the boundary, then blocks execution anyway. Legacy aliases `heuristic-only`, `remote-redacted`, `remote-explicit`, and `local-raw` normalize to canonical policies for compatibility; they are not preferred public names.
- Learn v2 model routing artifacts include host-ready OpenCode subagent markdown under `.openskill-kit/model-routing/opencode-agents/` for evidence summarization, concept extraction, contradiction review, scope inference, declassification review, eval planning, and publish/export auditing. OSK writes schemas, prompts, routes, and permission-scoped agent definitions; `--execute-model-requests` invokes OpenCode only for prepared sanitized manifests and stores validated JSON responses.
- `--execute-model-requests --apply-model-responses` applies written responses by the executed manifest `modelRole`: concept-extractor responses go through the model proposal applier, scope-inferencer responses go through the scope applier, contradiction-reviewer responses go through the contradiction applier, and eval-planner responses go through the eval-planner applier. Eval-planner apply writes a proposed eval-goldens JSON file that must be reviewed into an approved goldens file before gate use, or explicitly previewed with `--allow-unreviewed-eval-proposal`. The JSON result includes `applyByRole` plus a backwards-compatible primary `apply` object for single-role runs.
- Applying OpenCode model proposal outputs refreshes the concept review queue, conflict ledger, declassified snippet index, drift report, and eval report so model-derived atoms remain visible proposal data instead of hidden store mutations.
- Learn v2 eval includes concept-quality gates for activation surface, broad-scope evidence strength, confidence caps, command-policy extraction, active reliability/durability, counterevidence, risky suppression, and privacy boundaries.
- Learn v2 eval reports include an explicit proof boundary. Current built-in eval is deterministic local replay and configured golden checking. Passing `--learn-v2-eval-sandbox-probe` additionally runs a no-shell local-process sandbox verifier over declassified serialized eval cases and marks `sandboxExecuted=true` only when that probe passes. This still does not claim real agent task success or external model judgment quality.
- `/osk review --concept-accept`, `--concept-lock`, and `--concept-bulk accept-low-risk` enforce the same concept-quality gates before writing active or locked concepts, so underspecified, overbroad, overconfident, counterevidenced, or privacy-broken concepts remain candidates instead of compiling into behavior.
- Learn v2 persisted operations can reconstruct episodes from analysis frames, re-extract concepts from the episode store, and rerun eval without re-reading raw source files.
- Learn v2 project relevance uses a two-layer gate: hard accept/review/reject rules first, then the persisted `.openskill-kit/learn-v2/relevance-calibration.json` score for ambiguous sources. Current Git HEAD commit mentions can hard-accept project-local or path/package-anchored CI/test evidence, while SHA-only external command logs still route to review. Unanchored terminal histories become review-needed instead of accepted through weak numeric accumulation; unrelated global memory is hard rejected.
- Learn v2 task episodes include an episode confidence breakdown with trace/session/branch/path/semantic/time/outcome linkage factors and explicit stitching risks. Behavior atom confidence is capped by and multiplied through episode confidence so weak single-record or time-gap stitching cannot become high-confidence durable behavior.
- Compiled lifecycle hooks emit safe Learn v2 trace context from `OSK_SESSION_ID`, `OSK_EPISODE_ID`, and `OSK_TRACE_ID` when present, or deterministic local fallback IDs otherwise. Hook events store only trace IDs and a project-root hash, not the raw project root.
- Learn v2 task episodes include phase labels for goal, context loading, planning, implementation, tool/debugging, validation, review/correction, and finalization. Concept extraction treats goal/review/finalization phases as learnable preference evidence so user corrections and review feedback outrank assistant planning text.
- Learn v2 tool summaries include structured command shape, output compression strategy, omitted byte count, and diagnostic signatures. Terminal and CI logs keep failure diagnostics while dropping progress bars, duplicated lines, install noise, and long raw output.
- Learn v2 structural diff summaries use the TypeScript compiler API for TypeScript/JavaScript declarations/imports and a deterministic `language-structural-scanner` for Python, Go, and Rust. The exported structural parser backend registry records the active language/backends, confidence caps, capabilities, and limitations so future Tree-sitter or language-native parsers can replace fallback scanners without rewriting patch summarization. File summaries expose parser backend, confidence, cap, capabilities, and limitations so downstream scoring can distinguish AST-backed parsing from hunk-context-dependent fallback scanning. The scanner recovers Python classes/functions/decorators/multiline imports, Go receiver methods/import and const/var/type blocks, and Rust constants/statics/macros/trait impl targets with fallback confidence caps. This improves supported-language structure signals without claiming full Tree-sitter-equivalent parsing yet.
- Learn v2 patch summaries preserve generated, lockfile, formatting-only, empty, and rename-only changes for audit context, but mark them `behaviorEligible=false` with filter reasons. These non-semantic patches do not drive task hints, deterministic concept extraction, confidence boosts, or model behavior inference.
- Learn v2 patch summaries compare an assistant/agent proposed patch with a later user final or manual-edit patch when both appear in the same reconstructed episode. The comparison records shared/final-only/proposed-only paths, structural classes, symbols, imports, line deltas, confidence, `evidenceStrength: strong|medium|weak`, and behavior signals such as user-added-tests, narrowed scope, generated/lockfile removal, API-surface correction, or material rework. Unrelated same-class patches with no path, directory, symbol, import, or accepted fallback linkage stay unpaired so deterministic extraction cannot turn coincidence into false user-taste correction evidence.
- Learn v2 concept store and activation index under `.openskill-kit/learn-v2/`; these remain project-local and are excluded from packs.
- Learn v2 concept cards include a deterministic scoring breakdown with support counts, source reliability, confidence/durability, and any penalties. Counterevidence lowers confidence and durability before activation or bulk review decisions, and duplicate `(evidenceId, reason)` objections are de-duplicated so repeated review commands stay idempotent. Counts-only activation outcome telemetry can also recalibrate scores with bounded helpful boosts and ignored/wrong/harmful/superseded penalties. Explicit accept/lock/bulk-accept review decisions add a bounded human-review calibration marker and durability boost without bypassing confidence gates, while auto-policy activation does not claim human review. Review queues render these calibration details without copying raw outcome reasons.
- Learn v2 review supports card merge, split, supersession, narrowing, edits, counterevidence, and status changes under one locked store transaction so activation indexes and graph sync stay consistent. Concept review JSON options are validated at the CLI boundary: ids and optional text fields must be non-empty strings, and id/path/task/activation arrays must contain only non-empty strings. Concept merges are semantically guarded: exact-signature support can merge directly, reviewer-reconciled same-scope merges need explicit canonical behavior, and unrelated cross-scope or review-locked scope drift is rejected before store mutation. Supersession is also guarded: exact duplicates, deterministic contradiction/supersession, or same-scope reviewer-reason supersession can retire a concept, while unrelated successors are rejected before lifecycle mutation. Concept splits partition counterevidence by atom evidence id so selected-atom objections follow the child and remaining or concept-level objections stay on the parent. Reviewer-narrowed scopes are locked: future matching evidence can increase support/evidence counts, but it cannot silently broaden approved paths, task types, negative triggers, or activation triggers until review changes scope again. Safe bulk accept only activates low-risk, high-confidence, narrow path-scoped concepts.
- Learn v2 active-graph sync reconciles legacy compatibility outputs on every review write. Previous Learn v2-generated Preference/Workflow nodes whose concepts are now rejected, one-off, superseded, demoted, or otherwise inactive are removed, and `.openskill-kit/learn-v2/compiled-preview/graph-reconciliation.json` records active concept ids plus pruned preference/workflow node ids.
- `doctor --full` warns through `Learn v2 graph freshness` when older project state still contains Learn v2-generated Preference/Workflow graph nodes for missing or inactive concepts, so stale compatibility behavior is visible even before the next review sync prunes it.
- Learn v2 auto policy is guarded by `.openskill-kit/config.json` learning mode: `auto-stage` stages only safe low-risk narrow concepts, `auto-apply-safe` activates only safe low-risk narrow non-security concepts, and weak assistant-only-like candidates can be superseded by stronger contradictory evidence.
- Active Learn v2 concepts compile into `.openskill-kit/compiled/mcp/resources/learn-v2-concepts.json` as declassified MCP-style resources with behavior, scope, activation, confidence, risk, and evidence counts only. The same Learn v2 artifact boundary scanner checks compiled concept projections, compatibility preference/workflow nodes, policy artifacts, MCP resources, and eval-planner proposal files for raw refs, local paths, raw-vault references, secret-shaped tokens, and private identifiers before those artifacts are accepted.
- Active command and workflow concepts also compile into `.openskill-kit/compiled/behavior/command-policy.md` and `.openskill-kit/compiled/behavior/command-policy.json`; the JSON includes Learn v2 structured rules with command status, path/task/phrase conditions, cost class, failure modes, and evidence concept ids so repeated commands stay scoped instead of becoming global rules.
- Learn v2 raw vault ingestion enforces `learning.rawEvidence.maxRawBytesPerRun` and `learning.rawEvidence.maxRawBytesTotal` before raw blobs are written. Accepted sources that exceed per-source, hot-spool, or total vault budgets are rejected before partial raw-vault writes; when `autoCompactOnBudget` is enabled, OSK first compacts old unpinned hot-spool records into declassified local summaries and retries the budget check. Learn v2 raw vault maintenance reports hot, pinned, compacted, and total bytes against separate budgets. Use `--max-raw-vault-bytes` for hot spool, `--max-pinned-raw-vault-bytes` for concept-retained traceability, and `--max-total-raw-vault-bytes` for the full hot+pinned+compacted local vault. GC compacts expired unpinned blobs into declassified local summaries when possible and tombstones missing raw refs as expired.
- Learn v2 eval goldens can assert expected concept text, atom kinds, task hints, paths, and forbidden leak text. The same golden file can include `behaviorDeltaScenarios` that simulate a future task with and without activated Learn v2 concepts, then require learned plan phrases to appear only when concept context is injected.
- Learn v2 counterfactual trace eval writes declassified `.openskill-kit/learn-v2/evals/*/counterfactual-trace-cases.json` cases and checks expected concept activation plus negative-trigger suppression without running a sandbox agent. The opt-in sandbox probe validates the serialized eval cases through the existing sandbox runner, but remains a verifier-plumbing check rather than an agent A/B run.
- Learn v2 activation replay checks whether replayable concepts can be retrieved from originating episode context. Activation scoring uses deterministic BM25-style lexical evidence plus explainable semantic aliases/fingerprints, subsystem labels for new-file and nearby-module tasks, path, command, task-type, confidence, status, outcome feedback, and negative-trigger features. Runtime activation indexes and eval replay/counterfactual checks share the same activation-entry builder so eval covers the same semantic signals users see in activation diagnostics.
- Learn v2 activation output includes terminal-native diagnostics for active/locked/candidate index counts, scored entries, positive matches, suppressed matches, and no-match next steps. Visible and suppressed matches include the actual learned behavior, applies/does-not-apply conditions, negative triggers, command hints, token cost, counterevidence count, and counts-only outcome feedback, so activation previews are not title-only. Candidate inspection stays opt-in with `--include-candidate-concepts`. Each activation run appends local hashed telemetry under `.openskill-kit/learn-v2/activation-runs/` so drift can distinguish unused concepts from frequently retrieved concepts without storing raw task prompts, paths, or commands.
- Learn v2 concept outcome telemetry stores concept ids plus hashes of query/path/command/task identifiers. It does not store raw task prompts, raw paths, or raw commands. Later activation reads this local telemetry: helpful outcomes can boost retrieval, while harmful or superseded outcomes suppress stale concepts.
- Review `--concept-auto-policy` also reads the same local outcome telemetry: active, non-locked concepts with repeated recent harmful/wrong/superseded outcomes are demoted to `conflict`, receive counterevidence, and have generated compatibility graph nodes pruned. Defaults are two negative outcomes within 30 days and can be tuned in project config at `learning.outcomePolicy.demoteAfterNegativeOutcomes` and `learning.outcomePolicy.recentNegativeOutcomeDays`. Locked concepts remain locked and require explicit human review.
- Learn v2 model request artifacts contain declassified episode bundles, request manifests, expected response paths, prompt/bundle hashes, prompts, and the exact generated OpenCode agent id/file to use. `--execute-model-requests` accepts only OSK-owned manifests under `.openskill-kit/learn-v2/model-requests`, rejects absolute/traversing request paths, copies the declassified prompt/bundle into a request-only temporary execution directory, validates stdout as strict proposal JSON before writing request-local `response.json`, and records only hashes/byte counts for stdout/stderr. Model responses remain untrusted local inputs; `--model-output` accepts either `request-manifest.json` or the expected `response.json` only when it is bound to a sibling request manifest with intact prompt/bundle files whose content hashes still match, then only merges strict JSON with valid evidence ids, in-episode scope paths, bounded activation hints, optional counterevidence, and safe condition text while rejecting malformed files, missing/tampered manifests, wrong response paths, stale manifests, hash mismatches, invalid scope, invalid counterevidence, raw refs, raw local paths, raw-vault paths, email identifiers, or secret-like statements without aborting the whole batch. Approved declassification placeholders such as `[PROJECT_ROOT]` and `[REDACTED:email]` are allowed so safe redacted proposals are not rejected for using the prompt's own placeholders.
- Learn v2 scope request artifacts contain declassified concept scope bundles, request manifests, expected response paths, prompt/bundle hashes, prompts, and the `osk-learn-v2-scope-inferencer` agent id/file. `--scope-output` accepts a sibling `request-manifest.json` or expected `response.json`, verifies manifest/hash/response binding, validates strict scope-inference JSON, then refreshes the concept store, activation index, review queue, conflict ledger, declassified snippets when episode data exists, and concept drift report.
- Learn v2 contradiction request artifacts contain declassified conflict bundles with deterministic diagnostics, request manifests, expected response paths, prompt/bundle hashes, prompts, and the `osk-learn-v2-contradiction-reviewer` agent id/file. `--contradiction-output` accepts a sibling `request-manifest.json` or expected `response.json`, verifies manifest/hash/response binding, validates strict contradiction-review JSON, then refreshes the concept store, activation index, review queue, conflict ledger, declassified snippets when episode data exists, and concept drift report.
- Learn v2 eval-planner request artifacts contain declassified concept/evidence bundles, request manifests, expected response paths, prompt/bundle hashes, prompts, and the `osk-learn-v2-eval-planner` agent id/file. `--eval-output` accepts a sibling `request-manifest.json` or expected `response.json`, verifies manifest/hash/response binding, validates strict eval-plan JSON, scans for raw refs/local paths/secrets, and writes only a review-required eval golden proposal file. Proposal files must be reviewed or explicitly previewed before they can drive eval runs.
- Learn v2 behavior-evaluator request artifacts contain declassified behavior-delta eval cases, baseline plans, learned-behavior plans, request manifests, expected response paths, prompt/bundle hashes, prompts, and the `osk-learn-v2-behavior-evaluator` agent id/file. `--behavior-eval-output` accepts a sibling `request-manifest.json` or expected `response.json`, verifies manifest/hash/response binding, validates strict behavior-eval JSON, rejects stale or unknown scenario ids, scans for raw refs/local paths/secrets, and writes local declassified behavior-agent eval artifacts under `.openskill-kit/learn-v2/evals/agent/`. Passing that artifact to `--run-learn-v2-eval --learn-v2-agent-eval <path>` marks `agentExecuted=true` only when the validated agent judgment covers the current behavior-delta cases and passes.
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
