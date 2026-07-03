# Learn v2 Cheap-Agent Follow-up Tasks

These are intentionally small, bounded tasks. Do not mix them with deep Learn v2 architecture work. Each task should be done in a separate small commit with focused tests.

## Task 1: CLI Help Text For Activation Telemetry

Context:
- `/osk learn --activation-query ...` now writes hashed activation-run telemetry under `.openskill-kit/learn-v2/activation-runs/`.
- The command option help does not explicitly mention this local telemetry side effect.

Acceptance:
- Update the CLI option description or nearby docs text so users know activation query records local hashed telemetry.
- Do not store or print raw query/path/command values.
- Add or update a CLI facade assertion only if existing help snapshots cover this text.

Suggested files:
- `packages/cli/src/index.ts`
- `docs/commands/learn.md`

Verification:
- `rtk npm run typecheck`
- `rtk npx vitest --run packages/cli/tests/osk-facade.test.ts`

## Task 2: Activation Run JSON Shape Fixture

Context:
- Core tests currently assert activation telemetry exists and omits raw values.
- A tiny fixture-style assertion could make the JSON shape easier to inspect.

Acceptance:
- Parse the activation-run JSONL record in the existing Learn v2 activation test.
- Assert `schemaVersion`, `queryHash`, `pathHashes`, `commandHashes`, `matchCount`, `suppressedCount`, and `matches[].conceptId`.
- Keep the test focused. Do not add new production code unless test exposes a bug.

Suggested files:
- `packages/core/tests/learn-v2.test.ts`

Verification:
- `rtk npx vitest --run packages/core/tests/learn-v2.test.ts`

## Task 3: Docs Example For No-Match Activation Output

Context:
- CLI now prints no-match guidance when no active/locked concept matches.
- Docs explain diagnostics but do not show sample output.

Acceptance:
- Add a short example under `docs/commands/learn.md` showing no active concepts and suggesting `--include-candidate-concepts`.
- Keep sample generic. No local paths, no raw prompts.

Suggested files:
- `docs/commands/learn.md`

Verification:
- Markdown-only. Run `rtk npm run typecheck` only if package docs checks require it.

## Task 4: Hygiene Test Comment For Activation Runs

Context:
- `.openskill-kit/learn-v2/activation-runs/` is now excluded from packs and gitignored.
- The hygiene test includes it in private paths.

Acceptance:
- Add a one-line comment in `packages/core/tests/learn-v2-hygiene.test.ts` explaining activation runs are local telemetry, not shareable artifacts.
- No behavior change.

Verification:
- `rtk npx vitest --run packages/core/tests/learn-v2-hygiene.test.ts`

## Task 5: Release Note Snippet

Context:
- Recent Learn v2 work added activation quality gates, publish-audit hardening, publish/export auditor routing, activation diagnostics, and hashed activation-run telemetry.

Acceptance:
- Add a concise release-note draft in the project’s existing release-note location if one exists.
- If no suitable release-note file exists, do not invent a new release system. Add nothing and report that no file exists.

Verification:
- `rtk rg -n "release|changelog|changeset" .`

## Task 6: Review Report Task Index

Context:
- External review file: `C:/Users/shuvagata/Downloads/openskillkit_learn_v2_deep_code_review.md`.
- Main agent should handle P0 architecture fixes. Cheaper agent can maintain a task index for P1/P2 follow-ups.

Acceptance:
- Create or update a local ignored markdown task index under `plans/` that lists review findings by priority.
- Do not edit production code.
- Include file references from the review report when obvious.
- Mark P0 items as "owner: main agent" and P1/P2 items as "owner: cheaper agent candidate" unless task is architecture-heavy.

Verification:
- Markdown only.

## Task 7: Terminology Audit For Model Modes

Context:
- Review says CLI model mode names and config execution policy names diverge.
- This is partly architecture-heavy, but a cheap agent can inventory every user-facing string before main agent changes behavior.

Acceptance:
- Produce a markdown inventory of every occurrence of `local-raw`, `remote-redacted`, `remote-explicit`, `heuristic-only`, `opencode-host-raw-allowed`, `opencode-host-sanitized-only`, and `deterministic-only`.
- Group by CLI, MCP, config schema, docs, tests.
- Do not change code.

Verification:
- `rtk rg -n "local-raw|remote-redacted|remote-explicit|heuristic-only|opencode-host-raw-allowed|opencode-host-sanitized-only|deterministic-only" packages docs`

## Task 8: Docs Wording For Experimental Status

Context:
- Review recommends not presenting Learn v2 as complete frontier implementation yet.

Acceptance:
- Update docs wording only where it overclaims completion.
- Preferred wording: "Learn v2 deterministic/raw-local scaffold" or "experimental Learn v2 scaffold" until P0s are fixed.
- Do not weaken factual docs for implemented behavior.

Suggested files:
- `docs/commands/learn.md`
- `docs/architecture.md`
- `docs/quickstart.md` if Learn v2 appears there

Verification:
- `rtk rg -n "frontier|complete|production|Learn v2" docs`

## Task 9: Existing Tests Map For P0 Review Findings

Context:
- Before more code, useful to know which P0 findings already have regression coverage after recent fixes.

Acceptance:
- Produce a markdown matrix:
  - P0 id
  - Current regression test file/name if present
  - Missing test if absent
  - Suggested minimal fixture
- Do not edit production code.

Verification:
- `rtk rg -n "preview|auto-apply-safe|command-policy|supersede|customRedactions|declass" packages/core/tests packages/cli/tests`

## Task 10: Docs Example For Canonical Model Modes

Context:
- Main agent unified raw-learning model modes to `deterministic-only`, `opencode-host-sanitized-only`, and `opencode-host-raw-allowed`.
- Legacy aliases still exist in code for compatibility, but docs should teach only canonical names except where explicitly documenting aliases.

Acceptance:
- Scan docs for raw-learning model mode examples.
- Ensure primary examples use canonical names.
- If aliases are mentioned, make clear they are compatibility aliases, not preferred public names.
- Do not edit production code.

Suggested files:
- `docs/commands/learn.md`
- `docs/model-routing.md` if it mentions Learn v2 raw learning modes

Verification:
- `rtk rg -n "heuristic-only|remote-redacted|remote-explicit|local-raw|model-mode" docs`

## Task 11: Preview Artifact Retention Inventory

Context:
- Preview concept stores now write under `.openskill-kit/learn-v2/compiled-preview/`.
- Review noted these timestamped artifacts can accumulate.

Acceptance:
- Inventory all Learn v2 preview/generated timestamped directories and files.
- Produce a markdown proposal for retention policy: keep last N previews, max age, and raw-vault maintenance integration points.
- Do not implement pruning unless explicitly asked later.

Suggested files:
- `packages/core/src/learn-v2/pipeline.ts`
- `packages/core/src/learn-v2/paths.ts`
- `packages/core/src/learn-v2/vault.ts`

Verification:
- `rtk rg -n "compiled-preview|timestampSlug|learn-v2.*preview|raw-vault|maintenance" packages/core/src/learn-v2`

## Task 12: Review Queue Noise UX Audit

Context:
- Main agent fixed artifacts to use merged concept store.
- Review warned full merged cards can make raw-learning review queue noisy.

Acceptance:
- Read `packages/core/src/learn-v2/review.ts` and current review queue tests.
- Produce a markdown UX proposal for `reviewFocusCards`: new/changed concepts plus existing concepts only when conflict/drift/affected.
- Do not change code.

Verification:
- `rtk rg -n "writeLearnV2ReviewQueue|cards:|conflictSummary|driftSummary" packages/core/src/learn-v2 packages/core/tests`

## Task 13: Release Claim Audit After Hardening Commits

Context:
- Four hardening commits landed after follow-up review:
  - command overfit + supersession gates
  - preview existing-state isolation
  - canonical model mode policy
  - explicit learning input boundary
- Docs may still overclaim full frontier raw-local learning.

Acceptance:
- Scan docs and generated command help text for phrases implying Learn v2 is complete, production-ready, or full raw-to-model extraction.
- Propose wording changes only; do not make architecture claims stronger than code.

Verification:
- `rtk rg -n "complete|frontier|production-ready|raw-to-model|raw evidence is the learner input|OpenCode-native" docs packages/cli/src packages/core/src`

## Task 14: Structural Diff Dependency Decision Note

Context:
- Main agent improved hunk-aware structural diff recovery without adding Tree-sitter/native parser dependencies.
- Main agent then added a TypeScript compiler API backend for TS/JS declaration/import extraction.
- Frontier plan still names Tree-sitter or equivalent as mandatory for supported languages.

Acceptance:
 - Write a short decision note comparing current TypeScript compiler API + regex fallback approach against Tree-sitter/native parser integration for TS/JS/Python/Go/Rust.
 - Include operational tradeoffs: install/build friction on Windows, parser fidelity, dependency weight, CI stability, and future adapter boundary.
 - Do not change production code.

Verification:
 - Markdown only.

## Task 15: Patch Comparison Fixture Expansion

Context:
- Main agent added Learn v2 proposed-vs-final patch comparison for user-added-tests, scope changes, generated/lockfile removal, API-surface correction, and material rework.
- Current main regression pins the user-added-tests path end-to-end.

Acceptance:
- Add small focused tests for at least two more comparison signals without changing production code unless a bug appears:
  - `user-narrowed-scope` when final patch drops an unrelated path from proposed patch.
  - `user-removed-generated-or-lockfile` when final patch removes generated or lockfile-only changes.
- Assert comparison role/relation, final/proposed-only paths or classes, and behavior signal.
- Keep tests deterministic and compact; no pipeline-level fixture needed.

Suggested files:
- `packages/core/tests/learn-v2.test.ts`

Verification:
- `rtk npm test -- packages/core/tests/learn-v2.test.ts`

## Task 16: Patch Comparison Docs Example

Context:
- `/osk learn` docs now mention proposed-vs-final patch comparison, but no sample output or review-card phrasing exists.

Acceptance:
- Add a short docs example showing a declassified patch comparison summary:
  - shared path
  - final-only test path
  - behavior signal `user-added-tests`
  - note that raw diffs stay local and final/manual side has higher authority.
- Keep example generic. No local paths, raw prompts, or secrets.

Suggested files:
- `docs/commands/learn.md`

Verification:
- Markdown only.
- Write a short decision note comparing:
  - current TypeScript compiler API backend for TS/JS plus regex fallback,
  - Tree-sitter/native parser stack,
  - language-server based structural diff.
- Focus on whether Python/Go/Rust should remain deterministic regex fallback or move to Tree-sitter/language-server parsing.
- Include install/runtime risk for npm package consumers, package size, and Windows.
- Do not change code.

Suggested output:
- `plans/learn-v2-structural-parser-options.md`

Verification:
- Markdown only.

## Task 15: Review Queue UX Snapshot Fixture

Context:
- Review queue now has focus cards plus full-store appendix.
- Snapshot-like markdown coverage would make UX drift visible.

Acceptance:
- Add or update a focused test fixture that writes a review queue markdown with:
  - one conflicting candidate pair,
  - one stale active concept,
  - one unrelated active concept in appendix.
- Assert headings and one-line appendix format, not full snapshot blob.

Suggested files:
- `packages/core/tests/learn-v2.test.ts`

Verification:
- `rtk npx vitest --run packages/core/tests/learn-v2.test.ts`

## Task 16: Command Policy Docs After Cross-Episode Learning

Context:
- Main agent added command-policy extraction from repeated safe commands across independent episodes.
- Docs still emphasize repeated hashes and may not explain Learn v2 command-policy evidence thresholds.

Acceptance:
- Update docs to explain:
  - one passing command does not create durable policy,
  - repeated safe command in one episode or across multiple episodes can create conditional command-policy candidate,
  - destructive/expensive/deploy/e2e commands are not learned from repetition alone.
- Keep docs concise and factual.

Suggested files:
- `docs/commands/learn.md`

Verification:
- `rtk rg -n "command-policy|one passing command|repeated safe command|destructive" docs/commands/learn.md`

## Task 17: Preview Retention Docs Pass

Context:
- Main agent added preview concept-store inventory/pruning to `osk learn --raw-vault-status` and `--gc-raw-vault`.
- CLI now accepts `--preview-retention-days` and `--keep-preview-runs`.

Acceptance:
- Update docs to show preview retention flags and explain that pruning only targets timestamped preview concept stores under `compiled-preview`.
- State that canonical concept store and activation index are not pruned by this operation.
- Do not change production code.

Suggested files:
- `docs/commands/learn.md`

Verification:
- `rtk rg -n "preview-retention-days|keep-preview-runs|compiled-preview|raw-vault-status" docs/commands/learn.md`

## Task 18: Maintenance Output CLI Fixture

Context:
- Raw vault maintenance output now includes preview store count/bytes/retention/pruned count.

Acceptance:
- Add a narrow CLI fixture test for `osk learn --raw-vault-status` human output that asserts:
  - `Preview stores:`
  - `Preview store bytes:`
  - `Preview retention:`
  - no absolute project root leaks
- Use a temp project and minimal state.

Suggested files:
- `packages/cli/tests/osk-facade.test.ts`

Verification:
- `rtk npx vitest --run packages/cli/tests/osk-facade.test.ts`

## Task 19: Observability Review Focus Docs

Context:
- Observability dashboard now reports focus vs appendix review card counts.

Acceptance:
- Update docs where observability is described to include review focus metrics.
- Keep wording CLI/TUI-focused; do not suggest browser/Next.js UI.

Suggested files:
- `docs/commands/learn.md`

Verification:
- `rtk rg -n "observability|review focus|appendix" docs/commands/learn.md`

## Task 20: Custom Redaction Docs For Learn v2 Snippets

Context:
- Main agent unified Learn v2 declassified snippet generation with project `privacy.customRedactions`.
- Snippets, review cards, raw vault compaction, and events should now share the same project redaction rules.

Acceptance:
- Update docs to mention custom redactions apply to Learn v2 declassified snippets and review cards.
- Include one safe example regex that does not reveal real private data.
- Keep wording clear that invalid regexes are reported by doctor/redaction validation.

Suggested files:
- `docs/configuration.md`
- `docs/commands/learn.md`

Verification:
- `rtk rg -n "customRedactions|declassified snippets|review cards" docs`

## Task 21: Model Policy Config Docs

Context:
- Main agent changed raw learning so omitted `--model-mode` uses `.openskill-kit/config.json` `learning.rawEvidence.extractionExecution`.
- CLI no longer masks config with a deterministic-only default.

Acceptance:
- Document precedence:
  - explicit `--model-mode` wins,
  - otherwise config `learning.rawEvidence.extractionExecution`,
  - otherwise schema default `deterministic-only`.
- State `opencode-host-raw-allowed` currently hard-fails until raw OpenCode dispatch is implemented.

Suggested files:
- `docs/commands/learn.md`
- `docs/configuration.md`

Verification:
- `rtk rg -n "extractionExecution|model-mode|opencode-host-raw-allowed|deterministic-only" docs`

## Task 22: CLI Model Policy Fixture

Context:
- Core tests cover config-driven model policy.
- A cheap CLI test can prove omitted `--model-mode` does not force deterministic-only.

Acceptance:
- Add a CLI test that writes `.openskill-kit/config.json` with `opencode-host-sanitized-only`, runs raw learning without `--model-mode`, and asserts JSON output `modelMode`.
- Use tiny transcript; keep test isolated.

Suggested files:
- `packages/cli/tests/osk-facade.test.ts`

Verification:
- `rtk npx vitest --run packages/cli/tests/osk-facade.test.ts`

## Task 23: Raw-vs-Declassified Wording Audit

Context:
- Follow-up review found docs can still overstate current raw-local implementation.
- Current core protects raw vault locally and declassifies output artifacts, but model extraction is not full raw-to-model dispatch yet.
- Main agent has since moved Learn v2 to `raw-local-in-memory-declassified-artifacts`: deterministic extraction uses raw local learner text in memory, normalizes machine-local path prefixes to placeholders, keeps raw blobs only in the local vault, and persists declassified artifacts.

Acceptance:
- Audit wording for Learn v2 raw learning and tighten any remaining stale claims so docs distinguish:
  - raw vault storage and local-only traceability,
  - in-memory deterministic extraction with machine-local path prefix normalization,
  - declassified artifacts used at output/review boundaries,
  - `opencode-host-raw-allowed` hard-fails until implemented.
- Do not change runtime behavior.

Suggested files:
- `docs/commands/learn.md`
- `docs/architecture.md`

Verification:
- `rtk rg -n "raw-to-model|raw local|declassified|opencode-host-raw-allowed|deterministic-only" docs`

## Task 24: Existing Canonical Preview Isolation Test

Context:
- Existing tests prove preview does not create canonical state in a fresh project.
- Missing edge: preview run over an already-populated canonical concept store and activation index must leave those canonical files byte-for-byte unchanged.

Acceptance:
- Add a narrow regression test that:
  - creates canonical `learn-v2/concepts/store.json` and activation index,
  - records their exact text or hashes,
  - runs raw learning with `previewOnly: true`,
  - asserts canonical files are unchanged while preview artifact is written.
- No production edits.

Suggested files:
- `packages/core/tests/raw-local-learning.test.ts`

Verification:
- `rtk npx vitest --run packages/core/tests/raw-local-learning.test.ts --no-file-parallelism --maxWorkers=1`

## Task 25: Structural Diff Backend Decision Note

Context:
- `packages/core/src/learn-v2/structural-diff.ts` now uses TypeScript compiler API for TS/JS imports/declarations, with regex/hunk fallback for Python/Go/Rust.
- Frontier plan still wants higher-fidelity structural parsing for all supported languages.

Acceptance:
- Write a short decision note comparing Tree-sitter, language servers, and keeping current regex/hunk fallback for Python/Go/Rust.
- Treat TypeScript compiler API as current state, not future option.
- Include install/runtime tradeoffs for a CLI package.
- Do not implement parser backend in this cheap task.

Suggested files:
- `plans/learn-v2-structural-diff-backend-options.md`

Verification:
- `rtk Test-Path plans/learn-v2-structural-diff-backend-options.md`

## Task 26: Release Claim Audit

Context:
- User wants production readiness, but docs must not claim unimplemented raw-to-model or AST backend behavior.

Acceptance:
- Scan docs for overbroad claims like "fully raw-to-model", "AST-backed structural diff", or "production complete".
- Replace with precise current-state claims and known boundaries.
- Do not weaken accurate claims about verified behavior.

Suggested files:
- `docs/commands/learn.md`
- `docs/architecture.md`
- `README.md`

Verification:
- `rtk rg -n "production complete|raw-to-model|AST-backed|tree-sitter|declassified" README.md docs`

## Task 27: Review Queue TUI Noise Audit

Context:
- Review queue now separates focus cards from appendix cards and observability reports focus counts.
- Cheap agent can audit text density without touching core algorithms.

Acceptance:
- Inspect generated markdown/plain CLI review output paths and note where focus vs appendix wording is unclear.
- Make wording-only improvements if safe.
- Keep UI CLI/TUI-oriented; do not propose browser/Next.js surfaces.

Suggested files:
- `packages/core/src/learn-v2/review.ts`
- `docs/commands/learn.md`

Verification:
- `rtk npx vitest --run packages/core/tests/learn-v2.test.ts --no-file-parallelism --maxWorkers=1`

## Task 28: MCP Learn v2 Tool Help Inventory

Context:
- Main agent exposed `osk_get_learn_v2_observability` and the advanced MCP profile already exposes raw ingest, review, compile, reconstruction, extraction, eval, vault, activation, outcome, and model-output tools.
- Cheap agent can improve docs discoverability without changing tool behavior.

Acceptance:
- Add a compact docs table listing advanced Learn v2 MCP tools, their side-effect level, and safe sequence.
- Mark preview/default tools distinctly from write/apply tools.
- Mention observability returns declassified counts/artifact pointers only.
- Do not add browser UI guidance.

Suggested files:
- `docs/commands/learn.md`
- optionally `docs/security/privacy-by-command.md`

Verification:
- `rtk rg -n "osk_get_learn_v2_observability|osk_ingest_raw_evidence|MCP" docs`

## Task 29: Legacy Concepts Field Consumer Audit

Context:
- Raw-learning result now explicitly says top-level `concepts` is a legacy current-run projection and `learnV2.concepts` is the merged artifact set.
- Cheap agent can inventory consumers to avoid future confusion.

Acceptance:
- Search all code/docs/tests for raw-learning `result.concepts` usage.
- Produce a short markdown note listing each consumer and whether it wants current-run or merged concepts.
- Only make wording/test changes if clearly safe; do not change API behavior.

Suggested files:
- `plans/learn-v2-legacy-concepts-consumer-audit.md`
- `docs/commands/learn.md` if wording is unclear

Verification:
- `rtk rg -n "result\\.concepts|\\.concepts\\.length|Candidate concepts" packages docs`

## Task 30: Learn v2 OpenCode Agent Docs Example

Context:
- Main agent made Learn v2 model routing generate host-ready OpenCode subagent markdown and request manifests now name `osk-learn-v2-concept-extractor`.
- Cheap agent can add a small docs example showing how a human/operator uses the generated request directory without changing execution code.

Acceptance:
- Add a short example showing:
  - run `openskill-kit osk learn --prepare-model-requests`;
  - open a request manifest;
  - send `concept-extraction-prompt.md` to the listed OpenCode agent;
  - save `response.json`;
  - run `openskill-kit osk learn --model-output <manifest-or-response>`.
- State raw refs are not included and model output remains untrusted.
- Keep example terminal/CLI-only. No browser UI.

Suggested files:
- `docs/model-routing.md`
- `docs/commands/learn.md`

Verification:
- `rtk rg -n "osk-learn-v2-concept-extractor|prepare-model-requests|model-output" docs`

## Task 31: Learn v2 Generated Agent Install Audit

Context:
- Learn v2 model agents currently live under `.openskill-kit/model-routing/opencode-agents/`, while compiled plugin agents live under `.openskill-kit/compiled/plugin/opencode/agents/`.
- Main implementation deliberately avoids auto-installing raw-learning model agents into `.opencode/agents/`.

Acceptance:
- Produce a markdown note describing whether Learn v2 model agents should remain request-local artifacts, be copied by plugin compile, or be attached by an explicit command.
- Include safety implications for raw/declassified model boundaries.
- Do not change production code.

Suggested files:
- `plans/learn-v2-opencode-agent-install-audit.md`

Verification:
- `rtk rg -n "opencode-agents|compiled/plugin/opencode/agents|attach-plugin" packages docs`

## Task 32: Semantic Activation Vocabulary Audit

Context:
- Main agent added deterministic semantic aliases and keyword fingerprints for Learn v2 activation.
- The current family vocabulary is intentionally small and explainable, not an embedding system.

Acceptance:
- Review `packages/core/src/learn-v2/activation-signals.ts`.
- Propose 5-10 additional low-risk semantic families or term additions based on existing Learn v2 tests/docs.
- Do not add broad generic synonyms that would make unrelated concepts activate.
- If making code changes, add one focused activation test per new family cluster.

Suggested files:
- `packages/core/src/learn-v2/activation-signals.ts`
- `packages/core/tests/learn-v2.test.ts`

Verification:
- `rtk npx vitest --run packages/core/tests/learn-v2.test.ts --no-file-parallelism --maxWorkers=1`

## Task 33: Activation Diagnostics Docs Sample

Context:
- Activation reasons can now include `semantic-alias:` and `semantic-fingerprint:`.
- Cheap agent can add a small CLI output explanation without changing scoring.

Acceptance:
- Add docs wording explaining what `semantic-alias` and `semantic-fingerprint` reasons mean.
- Make clear they are deterministic local signals, not embeddings and not remote model calls.
- Keep docs concise.

Suggested files:
- `docs/commands/learn.md`

Verification:
- `rtk rg -n "semantic-alias|semantic-fingerprint|activation" docs/commands/learn.md`

## Task 34: Learn v2 Command Policy Consumer Audit

Context:
- Main agent wired active Learn v2 command concepts into compiled `command-policy.md` and `command-policy.json`.
- JSON now has `learnV2.rules` with command status, conditions, cost class, failure modes, and evidence concept ids.

Acceptance:
- Inventory all consumers of `.openskill-kit/compiled/behavior/command-policy.json`.
- Note which consumers read only legacy `workflows/preferences` and which should read `learnV2.rules`.
- Do not change behavior unless a tiny docs/test-only fix is obvious.

Suggested files:
- `plans/learn-v2-command-policy-consumer-audit.md`

Verification:
- `rtk rg -n "command-policy\\.json|commandPolicyJson|learnV2\\.rules|schemaVersion.*command-policy" packages docs`

## Task 35: Command Policy Docs Example

Context:
- Compiled command policy now includes structured Learn v2 rules, but docs do not show sample JSON.

Acceptance:
- Add a compact example showing one Learn v2 command rule with `command`, `status`, `appliesWhen`, `scopePaths`, `taskTypes`, `costClass`, and `failureModes`.
- Explain that agents must treat it as conditional, not global.
- Keep docs generic and raw-free.

Suggested files:
- `docs/commands/learn.md`
- optionally `docs/architecture.md`

Verification:
- `rtk rg -n "learnV2|costClass|failureModes|command-policy" docs/commands/learn.md docs/architecture.md`

## Task 36: Activation Eval Fixture Expansion

Context:
- Main agent centralized Learn v2 activation-entry construction so runtime activation index generation and eval replay/counterfactual scoring use the same semantic alias/fingerprint signals.
- Current regression covers parser/test semantic family only.

Acceptance:
- Add 2-3 focused eval replay fixtures for other existing semantic family pairs, such as `security + privacy`, `mcp + opencode`, and `validation + test`.
- Each fixture should prove old thin entries would score zero while `runLearnV2Eval` activation replay retrieves the concept.
- Do not expand semantic vocabulary in this task; only test current behavior.

Suggested files:
- `packages/core/tests/learn-v2.test.ts`

Verification:
- `rtk npm test -- packages/core/tests/learn-v2.test.ts`

## Task 37: Supersession Boundary Fixture Audit

Context:
- Main agent added exact 0.14/0.15 confidence-margin assertions for `newer-supersedes-older`.
- Supersession still depends on reviewer-authoritative rationale and protected older statuses.

Acceptance:
- Add one small markdown note summarizing supersession invariants for future reviewers.
- Include examples: lower-confidence newer concept stays manual; 0.14 margin stays manual; 0.15 margin with authority can supersede; locked/security-sensitive concepts stay protected.
- Do not change production code unless test wording reveals an actual contradiction.

Suggested files:
- `plans/learn-v2-supersession-invariants.md`

Verification:
- `rtk rg -n "newer-supersedes-older|supersession|0\\.15|locked" plans packages/core/tests/learn-v2.test.ts`

## Task 38: Terminal Source Policy Display QA

Context:
- Main agent added structured Learn v2 raw-surface adapter policy metadata to source digests and analysis frames.
- Main agent also added source adapter, content kind, sensitivity, and model-boundary counts to Learn v2 observability plain output and Clack terminal UI.

Acceptance:
- Exercise `osk learn --observability` on a real raw-learning preview run and capture whether the source policy lines are understandable.
- Propose wording improvements only if output is confusing or too wide for a normal terminal.
- Do not expose raw source paths beyond existing safe path handling.
- Keep wording short enough for terminal output.

Suggested files:
- `packages/cli/`
- `packages/core/src/learning/`
- `docs/commands/learn.md`

Verification:
- `rtk rg -n "surfacePolicy|modelBoundary|raw-local-file|source.*adapter" packages docs`
- Run the smallest relevant CLI/core test file if a renderer test exists.

## Task 39: Observability Schema Compatibility Fixture

Context:
- Source policy aggregates were added to `openskill-kit.learn-v2.pipeline-observability.v1` with defaults so older reports still parse.

Acceptance:
- Add or confirm one fixture/test proving an older observability JSON without `adapterCounts`, `contentKindCounts`, `sensitivityCounts`, and `modelBoundaryCounts` still parses and renders.
- Keep fixture raw-free and path-redacted.
- Do not change production schema unless the compatibility test fails.

Suggested files:
- `packages/cli/tests/osk-facade.test.ts`
- `packages/core/src/learn-v2/observability.ts`

Verification:
- `rtk npm test -- packages/cli/tests/osk-facade.test.ts`

## Task 40: Raw Learn Output Width Audit

Context:
- Main agent added source adapter and policy summary lines to direct `osk learn --raw` terminal output.
- Long adapter names or multiple source kinds may make output too wide in common terminals.

Acceptance:
- Run a raw preview with 2-3 different surface files and inspect terminal output width/readability.
- If needed, propose a wrapping or multi-line summary format.
- Keep implementation CLI-only and raw-free; no browser UI.

Suggested files:
- `packages/cli/src/index.ts`
- `packages/cli/tests/osk-facade.test.ts`

Verification:
- `rtk npm test -- packages/cli/tests/osk-facade.test.ts`

## Task 41: Adapter Detection Fixture Matrix

Context:
- Main agent hardened Learn v2 raw-surface adapter detection so matching uses file identity/content prefix instead of arbitrary parent directories.
- Generic fallback now runs after git diff detection, and detection reason/confidence are surfaced in raw outputs and observability.

Acceptance:
- Add a compact fixture matrix for additional adapter filenames/content markers: OpenCode, terminal, CI log, review notes, docs, agent summaries.
- Confirm each fixture gets expected `adapterId`, `adapterDetection.matchedBy`, and `contentKind`.
- Do not broaden regexes with generic terms like `session` unless a test proves no false positives.

Suggested files:
- `packages/core/tests/learn-v2.test.ts`

Verification:
- `rtk npm test -- packages/core/tests/learn-v2.test.ts`

## Task 42: Adapter Detection Docs Table

Context:
- Adapter detection is now explainable through `adapterDetection` in raw-learning source digests and observability.

Acceptance:
- Add a small docs table listing adapter ids, common filename/content markers, sensitivity, and fallback behavior.
- Keep raw-free; no private paths or real transcript snippets.

Suggested files:
- `docs/commands/learn.md`

Verification:
- `rtk rg -n "adapterDetection|matchedBy|generic-transcript|opencode|codex" docs/commands/learn.md`

## Task 43: Model Request Integrity CLI Wording Audit

Context:
- Main agent hardened Learn v2 model proposal ingestion so model outputs must be bound to a sibling `request-manifest.json`, intact prompt file, intact bundle file, and expected `response.json` path.
- Bare response files without request manifests are now rejected.

Acceptance:
- Review CLI help/output for `--model-output` and model request apply summaries.
- Make wording clear that users should pass either `request-manifest.json` or that request directory's `response.json`, not an arbitrary JSON file.
- Keep docs raw-free and avoid implying direct model execution.

Suggested files:
- `packages/cli/src/index.ts`
- `docs/commands/learn.md`

Verification:
- `rtk rg -n "model-output|request-manifest|response\\.json|missing-request-manifest" packages/cli/src/index.ts docs/commands/learn.md`

## Task 44: Model Request Integrity Negative Matrix

Context:
- Main agent added negative coverage for wrong output path, tampered prompt path, missing bundle file, stale episode, malformed JSON, and missing manifest.

Acceptance:
- Add one compact extra negative case for a tampered `bundlePath` outside the request directory while prompt exists.
- Confirm rejection reason stays `unexpected-request-file-path`.
- Do not duplicate large setup; extend existing model proposal test if practical.

Suggested files:
- `packages/core/tests/learn-v2.test.ts`

Verification:
- `rtk npm test -- packages/core/tests/learn-v2.test.ts`

## Task 45: Raw Surface Adapter Docs Example

Context:
- Raw surface adapter detection now avoids broad content-only matches for project docs and agent summaries.
- Ordinary transcripts that contain words like `Summary:` or `plan` should stay `generic-transcript` unless filename identity says otherwise.

Acceptance:
- Add one compact docs example showing `session.md` with `Summary:` falls back to `generic-transcript`, while `handoff.md` uses `agent-summaries`.
- Keep example raw-free and generic.
- Do not change production adapter detection.

Suggested files:
- `docs/commands/learn.md`

Verification:
- `rtk rg -n "generic-transcript|agent-summaries|Summary" docs/commands/learn.md`

## Task 46: Adapter Detection Matrix Expansion

Context:
- Current regression covers parent-path false positives plus docs/summary content collision.
- More low-cost fixtures can lock down specific non-doc adapters without touching production code.

Acceptance:
- Add a compact table-driven test for OpenCode content marker, terminal filename, CI content marker, review filename, and git content marker.
- Assert `adapterId`, `adapterDetection.matchedBy`, `adapterDetection.confidence`, and `contentKind`.
- Do not broaden adapter regexes unless a fixture proves an existing intended marker fails.

Suggested files:
- `packages/core/tests/learn-v2.test.ts`

Verification:
- `rtk npm test -- packages/core/tests/learn-v2.test.ts`

## Task 47: Model Mode CLI Alias Wording Fixture

Context:
- Canonical Learn v2 model modes are `deterministic-only`, `opencode-host-sanitized-only`, and `opencode-host-raw-allowed`; legacy aliases still normalize for compatibility.
- Docs mention this, but CLI JSON/human output fixture can make alias normalization visible.

Acceptance:
- Add or extend a CLI facade test using a legacy alias such as `remote-redacted`.
- Assert output reports canonical `opencode-host-sanitized-only`, not the alias.
- Keep raw-to-model execution rejected for `local-raw` / `opencode-host-raw-allowed`.

Suggested files:
- `packages/cli/tests/osk-facade.test.ts`

Verification:
- `rtk npm test -- packages/cli/tests/osk-facade.test.ts`

## Task 48: Structural Diff Language Coverage Docs

Context:
- Structural diff now uses the TypeScript compiler API for TS/JS and stronger deterministic syntax recovery for Python, Go, and Rust without native parser dependencies.
- It recognizes Python async defs/classes/import aliases, Go methods/generic types/import aliases, and Rust grouped imports/pub(crate)/async functions.

Acceptance:
- Add a concise docs note explaining current structural diff backend coverage and its no-native-parser dependency tradeoff.
- Be honest that this is deterministic syntax recovery, not full Tree-sitter for every supported language.
- Do not change production code.

Suggested files:
- `docs/commands/learn.md`
- `docs/architecture.md` only if it already discusses Learn v2 structural diff.

Verification:
- `rtk rg -n "structural diff|Tree-sitter|Python|Go|Rust" docs`

## Task 49: Model Request Hash Wording Fixture

Context:
- Learn v2 model request manifests now include `promptHash` and `bundleHash`.
- Applying a model output rejects a response if the sibling prompt or episode bundle content changed after request generation.

Acceptance:
- Add a small CLI/docs fixture that confirms operator-facing text mentions prompt/bundle hash binding for `--model-output`.
- Do not change core manifest validation.
- Keep wording clear that hashes protect sanitized request artifacts, not raw model dispatch.

Suggested files:
- `packages/cli/tests/osk-facade.test.ts`
- `docs/commands/learn.md`

Verification:
- `rtk npm test -- packages/cli/tests/osk-facade.test.ts`

## Task 50: Learn v2 MCP Docs Sequence Example

Context:
- Advanced MCP now exposes the plan-required Learn v2 workflow names, including `osk_plan_learning_sources_v2`.
- `osk_get_concept_review_queue` now returns the actual persisted Learn v2 review queue and strips raw evidence refs from MCP output.

Acceptance:
- Add a short docs example of the safe MCP sequence:
  `osk_plan_learning_sources_v2` -> `osk_ingest_raw_evidence` preview -> `osk_get_concept_review_queue` -> `osk_review_concepts` -> `osk_compile_concepts` -> `osk_run_learn_v2_eval`.
- State that the review queue contains declassified snippets and omits raw refs in MCP output.
- Do not change runtime behavior.

Suggested files:
- `docs/mcp-profiles.md`
- `docs/commands/learn.md`

Verification:
- `rtk rg -n "osk_plan_learning_sources_v2|osk_get_concept_review_queue|raw refs" docs`

## Task 51: Source Gate Docs Precision Pass

Context:
- Main agent fixed the P0 source-gate invariant: `review` and `reject` raw sources no longer enter Learn v2 episode reconstruction, atom extraction, model requests, concept store writes, activation index writes, or compile previews.
- Analysis frames and digests may still show declassified metadata for review/reject sources so users can inspect the source decision.

Acceptance:
- Update docs to state this exact boundary.
- Distinguish accepted-source extraction from review/reject source-review metadata.
- Do not imply review/reject raw content is persisted to the v2 raw vault on apply.
- Keep wording CLI/MCP oriented; no browser UI.

Suggested files:
- `docs/commands/learn.md`
- `docs/security/privacy-by-command.md`

Verification:
- `rtk rg -n "review.*reject|source.*gate|raw vault|model requests" docs/commands/learn.md docs/security/privacy-by-command.md`

## Task 52: Raw Vault Budget Docs After Pinning Fix

Context:
- Main agent changed raw-vault ingest so accepted raw records start as `hot-spool`, not `pinned`.
- Raw refs are pinned only when retained concept cards need traceability via concept-store pin sync.
- Manifest budget now tracks hot, pinned, compacted, total, maxHotBytes, maxPinnedBytes, and maxTotalBytes.

Acceptance:
- Update docs to explain hot/pinned/total budget semantics.
- State no-signal accepted raw can be compacted by GC after retention expiry.
- State candidate/staged/conflict/active/locked concept cards can pin raw refs until rejected/one-off/superseded.
- Do not change runtime behavior.

Suggested files:
- `docs/commands/learn.md`
- `docs/security/privacy-by-command.md`

Verification:
- `rtk rg -n "hot-spool|pinned|maxPinnedBytes|maxTotalBytes|raw-vault" docs`

## Task 53: Compatibility Graph Cleanup Docs/Test Inventory

Context:
- Main agent fixed stale Learn v2 generated Preference/Workflow graph nodes after concept reject/demote/supersede by reconciling generated compatibility nodes on every active-concept sync.
- Focused regression now exists in `packages/core/tests/learn-v2.test.ts`.

Acceptance:
- Produce a markdown note mapping the compatibility graph cleanup invariant:
  - active/locked concept -> generated preference/workflow nodes,
  - rejected/one-off/superseded/candidate concept -> generated compatibility nodes removed,
  - unrelated legacy/manual graph nodes preserved.
- Include current regression test name and any remaining missing cases, such as demote and supersede workflow cleanup.
- Do not edit production code.

Suggested output:
- `plans/learn-v2-compat-graph-cleanup-invariant.md`

Verification:
- `rtk rg -n "stale Learn v2 compatibility graph|pref_\\$\\{concept|workflow_\\$\\{concept|syncLearnV2ActiveConcepts" packages/core/tests/learn-v2.test.ts packages/core/src/learn-v2/store.ts`

## Task 54: P0 Review Fix Matrix Update

Context:
- Main agent fixed several P0 review items from `openskillkit_learn_v2_deep_code_review(1).md`:
  - P0-1 source gate enforced before extraction.
  - P0-2 accepted raw no longer pinned at ingest; concept-store pin sync controls traceability.
  - P0-3 relevance calibration preserved.
  - P0-5 stale generated graph nodes removed during sync.
- P0-4 stable concept identity and P0-6 actual OpenCode raw model execution remain architecture-heavy.

Acceptance:
- Update or create a review-fix matrix under `plans/` showing fixed vs remaining P0s.
- Include test names proving fixed items.
- Mark P0-4/P0-6 owner as main agent, not cheap agent implementation.
- No production code changes.

Suggested output:
- `plans/learn-v2-p0-review-fix-matrix.md`

Verification:
- Markdown only.

## Task 55: Concept Semantic Key Docs Note

Context:
- Main agent added stable Learn v2 concept `semanticKey` and moved new ConceptCard ids away from evidence-id hashing.
- Same durable concept across later evidence now accumulates support instead of duplicating cards.
- Existing evidence-bound cards can merge forward by derived semantic signature and overlapping scope.

Acceptance:
- Add a concise docs note explaining that concept identity is semantic and evidence accumulates as support.
- Mention evidence ids/raw refs remain support traceability, not identity.
- Keep wording implementation-accurate and do not claim full semantic/embedding identity.
- No production code changes.

Suggested files:
- `docs/commands/learn.md`
- `docs/architecture.md` if it already mentions Concept Cards

Verification:
- `rtk rg -n "semanticKey|Concept Card|evidence.*identity|support" docs`

## Task 56: Concept Merge Regression Inventory

Context:
- Main agent added tests for stable ids, cross-run accumulation, legacy evidence-bound merge, and reviewer-edit preservation.
- Remaining cheap work: inventory adjacent duplicate paths that may still append concepts before store merge.

Acceptance:
- Produce a markdown note listing all calls to `mergeLearnV2ConceptCards` and `writeLearnV2ConceptStore`.
- For each call, state whether it now benefits from semantic-key merge, preview merge, or needs future review.
- Include model proposal apply and persisted extraction operations.
- Do not edit production code.

Suggested output:
- `plans/learn-v2-concept-merge-callsite-audit.md`

Verification:
- `rtk rg -n "mergeLearnV2ConceptCards|writeLearnV2ConceptStore|mergeLearnV2ConceptStoreCards" packages/core/src packages/core/tests`

## Task 57: Review Queue Stable Identity UX Copy

Context:
- With stable semantic identity, a card may receive new evidence while keeping reviewer-edited title/canonical behavior.
- Review queue should make it understandable that existing cards can gain support without becoming new cards.

Acceptance:
- Inspect `packages/core/src/learn-v2/review.ts` markdown output.
- If safe, add wording-only copy that distinguishes "new candidate" vs "existing card with new support".
- If production logic lacks enough metadata to do this cleanly, write a note under `plans/` instead and do not change code.

Suggested files:
- `packages/core/src/learn-v2/review.ts`
- `plans/learn-v2-review-existing-support-ux.md`

Verification:
- `rtk npm test -- packages/core/tests/learn-v2.test.ts`

## Task 58: Learn v2 Executor CLI Help Snapshot

Context:
- Main agent added explicit sanitized OpenCode execution with `--execute-model-requests`.
- CLI help now mentions request selection, OpenCode command override, attach URL, and timeout.
- Cheap work: verify CLI help text and examples stay understandable after future option churn.

Acceptance:
- Run CLI help and capture the Learn v2 model-request related option lines in a markdown note.
- Confirm help includes `--prepare-model-requests`, `--execute-model-requests`, `--model-request`, `--opencode-command`, `--opencode-attach`, `--model-request-timeout-ms`, and `--model-output`.
- Note any confusing ordering or wording, but do not change production code unless wording-only and obviously safe.

Suggested output:
- `plans/learn-v2-executor-cli-help-audit.md`

Verification:
- `rtk npx tsx packages/cli/src/index.ts osk learn --help`

## Task 59: MCP Learn v2 Executor Tool Docs Pass

Context:
- Main agent added MCP tool `osk_execute_learn_v2_model_requests`.
- Cheap work: ensure docs list this tool wherever advanced Learn v2 MCP tools are enumerated.

Acceptance:
- Search docs for MCP tool lists mentioning `osk_prepare_learn_v2_model_requests` or `osk_apply_learn_v2_model_outputs`.
- Add `osk_execute_learn_v2_model_requests` to those lists if missing.
- Keep wording privacy-accurate: sanitized-only, validates manifest/hash before execution, validates stdout before writing response.
- No code changes.

Suggested files:
- `docs/commands/learn.md`
- Any MCP docs under `docs/` that already list Learn v2 tools

Verification:
- `rtk rg -n "osk_execute_learn_v2_model_requests|osk_prepare_learn_v2_model_requests|osk_apply_learn_v2_model_outputs" docs`

## Task 60: Executor Failure Matrix Docs

Context:
- Executor rejects invalid manifests, tampered prompt/bundle files, unsafe raw boundaries, nonzero OpenCode exits, and malformed stdout before writing model responses.
- Cheap work: create a failure matrix for operators/debugging.

Acceptance:
- Write a markdown table with failure reason, likely cause, whether OpenCode was invoked, whether `response.json` was written, and operator fix.
- Include reasons from code: `read-failed`, `invalid-request-manifest`, `request-file-hash-mismatch`, `unexpected-request-file-path`, `missing-request-file`, `routing-artifact-read-failed`, `opencode-invocation-failed`, `opencode-nonzero-exit`, `invalid-json-or-schema`.
- Do not expose or request raw stdout/stderr. Mention execution report stores only byte counts and hashes.

Suggested output:
- `plans/learn-v2-model-executor-failure-matrix.md`

Verification:
- `rtk rg -n "reason:|request-file-hash-mismatch|opencode-nonzero-exit|invalid-json-or-schema" packages/core/src/learn-v2/model-proposals.ts`

## Task 61: Rich Model Proposal Fixture Inventory

Context:
- Main agent expanded Learn v2 LLM proposal atoms with optional scope, applies/does-not-apply conditions, activation hints, counterevidence, risk, confidence caps, and one-off hints.
- Cheap work: enumerate useful golden fixtures that should exercise those fields without adding heavy implementation.

Acceptance:
- Create a markdown inventory of 8-12 proposed rich model-output fixtures.
- Include at least: invalid out-of-episode path, valid command activation, one-off hint, docs-only negative trigger, counterevidence lowering score, security high-risk proposal, malformed condition secret, stale evidence id.
- For each fixture, list expected accepted/rejected outcome and why.
- No production code changes.

Suggested output:
- `plans/learn-v2-rich-model-proposal-fixtures.md`

Verification:
- Markdown only.

## Task 62: Review Queue Conditions Copy Audit

Context:
- Review queue now prints `Applies when`, `Does not apply when`, and `Negative triggers` when present on concept cards.
- Cheap work: verify markdown output remains readable and does not duplicate conditions too noisily.

Acceptance:
- Inspect `packages/core/src/learn-v2/review.ts`.
- Run focused Learn v2 test if changing wording.
- If no code change is needed, write a note with suggested future UX copy improvements.

Suggested output:
- `plans/learn-v2-review-conditions-copy-audit.md`

Verification:
- `rtk npm test -- packages/core/tests/learn-v2.test.ts` only if code changed.

## Task 63: Command Policy Conditions Regression Note

Context:
- Command policy now uses explicit concept conditions before derived scope phrases.
- Cheap work: audit generated command-policy markdown/JSON expectations and note any missing direct test coverage.

Acceptance:
- Search command-policy tests and Learn v2 tests for `appliesWhen` and `doesNotApplyWhen`.
- If a small assertion can be added safely, add it. Otherwise write a markdown note with exact test gap.
- Do not refactor command-policy logic.

Suggested files:
- `packages/core/tests/learn-v2.test.ts`
- `plans/learn-v2-command-policy-conditions-test-gap.md`

Verification:
- `rtk rg -n "appliesWhen|doesNotApplyWhen|Command Policy" packages/core/tests packages/core/src/learn-v2`

## Task 64: Behavior Delta Golden Fixture Examples

Context:
- Learn v2 eval now supports `behaviorDeltaScenarios` in the same JSON file as extraction goldens.
- Main regression covers parser verification plan deltas only.

Acceptance:
- Add a markdown fixture cookbook with 4-6 behavior-delta examples:
  - parser test behavior
  - security/secret logging avoidance
  - dependency-light fix
  - broad refactor avoidance
  - command-policy scoped verification
- Include expected `task`, `expectedConceptText`, `expectedKinds`, `expectedPlanIncludes`, and `expectedPlanExcludes`.
- Do not edit production code.

Suggested output:
- `plans/learn-v2-behavior-delta-golden-examples.md`

Verification:
- Markdown only.

## Task 65: CLI/MCP Help Snapshot Audit For Eval Goldens

Context:
- CLI/MCP wording changed from extraction-only goldens to extraction plus behavior-delta goldens.

Acceptance:
- Search CLI/MCP facade tests for help text snapshots or option descriptions involving `--learn-v2-goldens` or `osk_run_learn_v2_eval`.
- If snapshots exist, update them.
- If no snapshots exist, write a short note saying no snapshot coverage exists and list exact searched files.

Suggested files:
- `packages/cli/tests/osk-facade.test.ts`
- `packages/mcp-server/tests/mcp-server.test.ts`
- `plans/learn-v2-eval-goldens-help-coverage.md`

Verification:
- `rtk rg -n "learn-v2-goldens|osk_run_learn_v2_eval|goldensPath" packages/cli/tests packages/mcp-server/tests`

## Task 66: Behavior Delta Failure Fixture

Context:
- Main regression proves behavior-delta eval passes when activated concept injects expected plan phrase.
- Cheap work can add a focused failing fixture to prove diagnostics fail when expected phrase is missing.

Acceptance:
- Add a compact test that creates a behavior-delta scenario whose `expectedPlanIncludes` cannot be satisfied by activated concepts.
- Assert report status `fail`, result id `behavior-delta:<id>`, and failed check `with-concept-plan-includes-expected-deltas`.
- Keep test local to `packages/core/tests/learn-v2.test.ts`.

Verification:
- `rtk npm test -- packages/core/tests/learn-v2.test.ts`

## Task 67: Surface Adapter Contract Docs Snapshot

Context:
- Learn v2 raw surface adapters now expose a validated contract with `normalizationProfile`, explicit-only policy, and discover/fetch/relevance/normalize capabilities.
- `/osk learn` docs table includes profile names, but no standalone contract inventory exists.

Acceptance:
- Generate a markdown inventory from source by reading `packages/core/src/learn-v2/surfaces.ts`.
- List each adapter id, label, content kind, normalization profile, sensitivity, and notes.
- Do not change production code.

Suggested output:
- `plans/learn-v2-surface-adapter-contract-inventory.md`

Verification:
- `rtk rg -n "normalizationProfile|learnV2SurfaceAdapterContracts|validateLearnV2SurfaceAdapterContracts" packages/core/src/learn-v2 packages/core/tests`

## Task 68: Additional Surface Adapter Fixture Coverage

Context:
- Main regression validates contract shape and key profiles.
- Cheap work can add more fixture coverage for adapter detection edge cases without changing architecture.

Acceptance:
- Add focused assertions for:
  - explicit adapter override sets `adapterDetection.matchedBy = explicit`.
  - `ci-log` filename detection uses `ci-log` profile.
  - `review-local` content marker detection uses `review-local` profile.
- Keep in `packages/core/tests/learn-v2.test.ts`.

Verification:
- `rtk npm test -- packages/core/tests/learn-v2.test.ts`

## Task 69: Observability TUI Profile Label Audit

Context:
- Pipeline observability JSON/markdown now includes `normalizationProfileCounts`.
- Cheap work: inspect terminal/TUI rendering to ensure profile counts are visible and not too noisy.

Acceptance:
- Read `packages/cli/src/index.ts` and any Learn v2 observability TUI renderer.
- If profile counts are already visible through generic JSON/markdown path, write a note.
- If TUI omits them, add a minimal display line if safe.

Suggested files:
- `packages/cli/src/index.ts`
- `plans/learn-v2-observability-profile-label-audit.md`

Verification:
- `rtk rg -n "normalizationProfileCounts|renderLearnV2Observability" packages/cli/src packages/core/src`

## Task 70: Trace Context Docs Patch

Context:
- OpenCode ambient safe records now include deterministic `traceContext` with OSK session, episode, trace, and hashed OpenCode session anchors.
- Docs may still describe ambient telemetry as derived command/path metadata only.

Acceptance:
- Update the Learn/OpenCode/privacy docs to mention safe trace anchors and explicitly say raw project roots are not stored.
- Confirm docs do not imply raw commands, paths, prompts, diffs, outputs, or env values are retained.
- Keep wording short and user-facing.

Suggested files:
- `docs/commands/learn.md`
- `docs/security/privacy-by-command.md`
- `docs/model-routing.md`

Verification:
- `rtk rg -n "traceContext|OSK_TRACE_ID|opencode ambient|raw project root" docs packages/core/src`

## Task 71: Ambient Trace Fixture Matrix

Context:
- Main tests cover generated plugin trace and importer propagation.
- Cheap work can add handcrafted ambient fixtures for env-supplied IDs and invalid trace values.

Acceptance:
- Add a focused test where ambient JSONL contains valid `traceContext` and assert applied events share one OSK session id.
- Add a focused test where invalid trace ids contain spaces/slashes and assert importer drops those ids while still importing safe metadata.
- Keep tests in `packages/core/tests/command-family.test.ts` or `packages/core/tests/opencode-ambient-privacy.test.ts`.

Verification:
- `rtk npm test -- packages/core/tests/command-family.test.ts packages/core/tests/opencode-ambient-privacy.test.ts`

## Task 72: Trace Observability Label Audit

Context:
- Trace anchors improve episode stitching but users need visibility that records are trace-linked.
- Current pipeline observability may not show counts for trace-linked OpenCode records.

Acceptance:
- Inspect Learn v2 observability JSON/markdown output.
- If trace-linked count is missing, add a small count such as `traceLinkedEvidenceCount` or `traceLinkedEpisodeCount`.
- Do not build a browser UI. Keep CLI/TUI/markdown only.

Suggested files:
- `packages/core/src/learn-v2/observability.ts`
- `packages/cli/src/index.ts`
- `plans/learn-v2-trace-observability-audit.md`

Verification:
- `rtk rg -n "traceLinked|oskTraceId|episodeId|observability" packages/core/src/learn-v2 packages/cli/src`

## Task 73: Model Execution Docs Refresh

Context:
- Learn v2 sanitized OpenCode execution now accepts wrapped/fenced JSON, validates output evidence before writing `response.json`, and supports `--apply-model-responses` after execution.

Acceptance:
- Update user docs for `/osk learn --execute-model-requests --apply-model-responses`.
- Mention response files are only written after schema plus episode-evidence validation.
- Mention stdout/stderr are hashed in reports, not stored verbatim.

Suggested files:
- `docs/commands/learn.md`
- `docs/model-routing.md`

Verification:
- `rtk rg -n "apply-model-responses|execute-model-requests|response.json|stdoutHash" docs packages/cli/src packages/core/src`

## Task 74: MCP Execute-And-Apply Follow-Up

Context:
- CLI can execute model requests and immediately apply valid responses.
- MCP currently exposes execute and apply as separate calls.

Acceptance:
- Inspect `packages/mcp-server/src/index.ts`.
- Either add a boolean option like `applyResponses` to `osk_execute_learn_v2_model_requests`, or write a short design note if the MCP API should remain split for safety.
- If adding the option, include tests proving written response paths are passed into `applyLearnV2ModelProposalOutputs`.

Verification:
- `rtk rg -n "osk_execute_learn_v2_model_requests|applyLearnV2ModelProposalOutputs|executeLearnV2ModelRequests" packages/mcp-server/src packages/mcp-server/tests`

## Task 75: Windows OpenCode Shim Smoke

Context:
- Executor now handles Node script shims and has explicit `.cmd/.bat` routing logic, but full Windows `.cmd` smoke with real OpenCode remains useful.

Acceptance:
- Add or update a skipped-if-missing smoke test that runs a real OpenCode Windows shim if present.
- Keep it non-blocking when OpenCode binary is absent.
- Assert no raw stdout/stderr content is persisted in the execution report.

Suggested files:
- `packages/cli/tests/opencode-cli-smoke.test.ts`
- `plans/learn-v2-windows-opencode-shim-smoke.md`

Verification:
- `rtk npm test -- packages/cli/tests/opencode-cli-smoke.test.ts`

## Task 76: Scope Inference CLI Help Snapshot

Context:
- Learn v2 now has `--prepare-scope-requests`, `--scope-concept`, and `--scope-output`.
- Main implementation covers core behavior and docs, but CLI help/snapshot coverage may not assert these flags.

Acceptance:
- Inspect CLI facade/help tests for `osk learn`.
- Add low-risk assertions that scope-inference flags appear in help output.
- Do not change Learn v2 behavior.

Suggested files:
- `packages/cli/tests/osk-facade.test.ts`

Verification:
- `rtk npm test -- packages/cli/tests/osk-facade.test.ts`

## Task 77: MCP Scope Inference Surface Design

Context:
- CLI can prepare and apply scope-inferencer responses.
- MCP now exposes scope-specific prepare/apply tools. Remaining cheap work is descriptor/help polish if generated descriptors lag.

Acceptance:
- Inspect generated MCP descriptor docs/tests for `osk_prepare_learn_v2_scope_requests` and `osk_apply_learn_v2_scope_outputs`.
- If descriptor snapshots or generated docs omit them, refresh those artifacts through existing repo commands.
- Do not alter core Learn v2 behavior.

Suggested files:
- `packages/mcp-server/src/index.ts`
- `packages/mcp-server/tests/*`
- `plans/learn-v2-mcp-scope-inference.md`

Verification:
- `rtk rg -n "scope-inference|prepare-scope|scope-output|osk_.*learn_v2" packages/mcp-server/src packages/mcp-server/tests`

## Task 81: MCP Scope Tool Help Copy Audit

Context:
- Advanced MCP now exposes `osk_prepare_learn_v2_scope_requests` and `osk_apply_learn_v2_scope_outputs`.
- Cheap work can improve wording and descriptor visibility without touching core behavior.

Acceptance:
- Inspect `docs/mcp-profiles.md`, generated MCP descriptors, and any docs export for the two scope tools.
- Ensure descriptions mention sanitized concept scope bundles, strict JSON validation, and no raw evidence dispatch.
- Keep wording concise.

Suggested files:
- `docs/mcp-profiles.md`
- `.openskill-kit/compiled/plugin/mcp/descriptors.json`
- `.openskill-kit/compiled/plugin/mcp/profiles.json`

Verification:
- `rtk rg -n "scope_requests|scope_outputs|scope-inference|scope inference" docs .openskill-kit/compiled/plugin/mcp packages/mcp-server/src`

## Task 78: Scope Inference Review Queue Copy Audit

Context:
- Scope inference refreshes review queue after applying conditions, activation phrases, and negative triggers.
- Cheap work can make sure markdown review cards make those additions easy to see.

Acceptance:
- Inspect `packages/core/src/learn-v2/review.ts`.
- Confirm `appliesWhen`, `doesNotApplyWhen`, activation phrases, path globs, commands, and negative triggers are visible in review markdown.
- If any field is hidden, add concise terminal/markdown lines without making browser UI.

Suggested files:
- `packages/core/src/learn-v2/review.ts`

Verification:
- `rtk npm test -- packages/core/tests/learn-v2.test.ts`

## Task 79: Graph Reconciliation CLI Copy Audit

Context:
- Learn v2 review now writes `.openskill-kit/learn-v2/compiled-preview/graph-reconciliation.json` when active concepts sync into legacy Preference/Workflow graphs.
- Review result messages include pruned counts, but CLI rendering may not explicitly show the reconciliation artifact path.

Acceptance:
- Inspect `/osk review` rendering in `packages/cli/src/index.ts`.
- If review result output omits `graphReconciliationPath`, add a concise line.
- Keep output terminal-native only.

Suggested files:
- `packages/cli/src/index.ts`

Verification:
- `rtk rg -n "graphReconciliationPath|render.*Review|concept.*review" packages/cli/src/index.ts packages/cli/tests`

## Task 80: Graph Reconciliation Doctor Check

Context:
- Stale Learn v2 graph nodes are pruned during review sync, but `doctor --full` may not detect older projects with stale nodes until next review action.

Acceptance:
- Inspect doctor/full doctor implementation.
- Add a warning when Preference/Workflow graph contains Learn v2-generated nodes whose `concept_*` card is rejected, superseded, one-off, or missing from the Learn v2 concept store.
- Do not mutate project state from doctor.

Suggested files:
- `packages/core/src/doctor/*`
- `packages/core/tests/*doctor*`

Verification:
- `rtk rg -n "learn-v2|PreferenceGraph|WorkflowGraph|doctor" packages/core/src/doctor packages/core/tests`
