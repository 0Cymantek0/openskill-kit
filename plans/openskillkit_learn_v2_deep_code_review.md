# OpenSkillKit Learn Engine v2 Deep Code Review

**Repository:** `0Cymantek0/openskill-kit`  
**Branch reviewed:** `codex/raw-local-learning-plane`  
**Baseline used for branch posture:** `master`  
**Uploaded plan reviewed:** `openskillkit_learn_engine_v2_frontier_plan.md`  
**Review date:** 2026-07-04  
**Output:** Deep code/architecture/plan/product review for the raw-local Learn Engine v2 direction.

## Codex implementation progress

### 2026-07-05 eval visibility and artifact privacy slice

- Done: Learn v2 eval reports now expose structured summary metrics for result rows, activation replay retrieval, counterfactual trace activation, and behavior-delta scenarios.
- Done: persisted eval command results include summary, leak-check, and token-budget data so CLI/MCP consumers do not need to scrape report markdown to understand whether learned behavior changed task plans.
- Done: plain CLI output for `osk learn --run-learn-v2-eval` now shows behavior-delta, activation-replay, counterfactual-trace, leak-check, compression, and failure summary lines with project-local report paths.
- Done: Learn v2 pipeline observability now carries eval proof metrics and warns when behavior-delta eval goldens are missing, making proof gaps visible in JSON, Markdown, and CLI dashboard output.
- Done: counterfactual trace eval artifacts are declassified with the same scrubber as behavior-delta artifacts; task prompts, paths, commands, task types, expected behavior, and negative signals are redacted before artifact write.
- Done: eval leak check now inspects concept scope, conditions, activation, counterevidence, and project-root/user-home path shapes, so unsafe concept metadata fails the eval instead of only being scrubbed in artifacts.
- Done: tests cover structured eval summary JSON, markdown summary sections, CLI plain output, and counterfactual artifact redaction for project roots and user-home paths.
- Verified: focused Learn v2 eval/observability tests, focused CLI eval/observability tests, full `rtk npm test`, and `rtk npm run typecheck`.

### 2026-07-05 raw surface adapter coverage slice

- Done: Learn v2 raw surface registry now has explicit high-sensitivity adapters for Gemini, Roo Code, Kilo Code, Cline, Goose, and Zed agent transcripts.
- Done: raw local candidate scoring recognizes those adapter filename families, so discovery surfaces them above generic fallback while still keeping them blocked/explicit-only in normal source plans.
- Done: `/osk learn` docs list the expanded adapter matrix and keep the privacy rule: transcript exports are never default-selected and require explicit file choice.
- Verified: focused raw-surface adapter tests and `rtk npm run typecheck`.

### 2026-07-05 MCP descriptor coverage slice

- Done: generated advanced MCP descriptors now expose the Learn v2 raw-ingest, review, concept compilation, sanitized model request, activation, observability, reconstruction, extraction, and eval tools.
- Done: descriptor hash metadata now marks raw evidence ingest, concept review, OpenCode model execution, and model-output application tools as approval-required, while the public MCP profile still excludes raw ingest.
- Done: the packaged agent-plugin bundle now carries the regenerated advanced descriptor set, descriptor hashes, server config tool list, and empty Learn v2 concept resource catalog.
- Done: tests guard both compiler-generated descriptors and the static package bundle so future MCP descriptor drift fails fast.
- Verified: focused plugin manifest test, focused deep architecture plugin compile test, full `rtk npm test` (40 files, 293 tests), and `rtk npm run typecheck`.

### 2026-07-05 model-policy visibility slice

- Done: raw Learn v2 runs now return a structured `modelExecution` policy report covering deterministic extraction, request-artifact status, request count, sanitized OpenCode execute/apply commands, approval requirement, and raw-to-model rejection rationale.
- Done: pipeline observability JSON and Markdown now include the same model-policy report with local paths redacted to `[PROJECT_ROOT]`, and old observability reports without the field still parse with a conservative default.
- Done: plain CLI raw-learn output and observability output now show the sanitized model handoff commands directly, reducing the chance that users confuse `--model-mode` with raw model dispatch.
- Decision: keep `opencode-host-raw-allowed` rejected for now. The safe production path is prompt-safe request artifacts plus explicit sanitized OpenCode execution; raw-to-model needs a separate boundary design before implementation.
- Verified: focused Learn v2 model-policy/observability tests, focused CLI raw JSON/observability/model execution tests, and `rtk npm run typecheck`.

### 2026-07-05 patch-pair evidence strength slice

- Done: proposed-vs-final patch comparisons now carry `evidenceStrength: strong|medium|weak`, derived from shared path, directory, symbol, import, structural-class, or fallback-only evidence.
- Done: comparison confidence now respects evidence strength caps, so weak pairings cannot inflate into high-confidence correction signals even when structural classes overlap.
- Done: unrelated same-class patches with real but different paths now stay unpaired unless they share stronger path/directory/symbol/import evidence, reducing false user-taste inference from coincidental episode ordering.
- Verified: focused Learn v2 patch comparison tests and `rtk npm run typecheck`.

### 2026-07-05 structural parser coverage visibility slice

- Done: Learn v2 observability now reports structural parser backend counts, structural confidence counts, and minimum parser confidence cap across patch file summaries.
- Done: CLI and Markdown observability surfaces show whether a run relied on the TypeScript compiler parser, heuristic fallback, or no structural parser, making the remaining Tree-sitter/equivalent gap visible instead of hidden in patch summaries.
- Verified: focused Learn v2 observability tests, focused CLI observability tests, and `rtk npm run typecheck`.

### 2026-07-04 trace context slice

- Done: OpenCode plugin source bundle now emits `traceContext` on safe ambient records, matching the generated compiler template.
- Done: OpenCode session IDs are no longer copied as raw safe primitives. They are projected into `sessionIDHash`, and `opencodeSessionId` is derived from the hash.
- Done: OpenCode plugin keeps the current hashed session ID after `session.created`, so later hook events without session metadata still stitch to the same OpenCode episode.
- Done: `opencode-ambient` learning allow-list now accepts `sessionIDHash` and no longer treats raw `sessionID` as safe metadata.
- Done: tests cover the source bundle plugin, generated plugin golden fixture, CLI setup golden flow, privacy-safe trace emission, and trace ID stability without raw project root/commands/paths/session IDs.
- Verified: `rtk npx vitest --run packages/core/tests/opencode-ambient-privacy.test.ts`, focused generated OpenCode golden tests, focused CLI golden flow, and `rtk npm run typecheck`.

### 2026-07-04 prior slices

- Done: normal task context now surfaces Learn v2 activation through `learnedConcepts.shown` with negative-signal suppression.
- Done: active/locked concepts are hard-gated before compatibility graph sync, concept store write, and activation index write when declassification fails.
- Done: structural diff summaries now report parser backend/confidence metadata and cap confidence for heuristic fallbacks.

---

## 0. Executive verdict

The branch is **not a shallow scaffold**. It implements a significant Learn v2 vertical slice: raw-local ingestion, a project relevance gate, raw-vault persistence and GC, declassified analysis artifacts, deterministic episode reconstruction, deterministic atom extraction, ConceptCard-like merging/review, compatibility compilation into legacy preference/workflow graphs, activation index scoring, outcome telemetry, sanitized OpenCode model-request artifacts, CLI entry points, docs, and a non-trivial test suite.

It is also **not yet the frontier Learn Engine described by the plan**. The branch is best understood as a **solid PR-A-to-PR-F prototype** with partial PR-G/PR-H, not the final research-grade system. The implementation proves that the architectural direction is viable, but several gaps block “frontier” claims:

1. **Learn v2 activation is not yet in the normal agent task-context path.** `getAgentTaskContext` still retrieves legacy active preferences via `retrieveRelevantPreferences` and `routeBehavior`, not the Learn v2 activation index. So Learn v2 can learn concepts and expose a CLI activation query, but normal task context will not automatically get the new activation semantics. fileciteturn71file0

2. **Declassification failure is detected but not hard-gated before compatibility graph sync.** `compileLearnV2ConceptPreview` computes a declassification report, but `syncLearnV2ActiveConcepts` immediately merges `preview.preferenceNodes` and `preview.workflowNodes` without checking `preview.declassificationReport.status`. This violates the plan’s output-boundary contract unless a downstream compiler later blocks the leak. fileciteturn75file0 fileciteturn74file0

3. **Model-assisted extraction is deliberately sanitized-only today.** The plan requires OpenCode-native routing, and the branch does that for sanitized request artifacts. But `opencode-host-raw-allowed` is explicitly rejected as not implemented; docs also say raw-to-model dispatch is reserved future work. That is the correct safe default, but it means the “raw local evidence may be model-assisted input under configured policy” target is incomplete. fileciteturn17file0 fileciteturn68file0

4. **Structural diff support is not equivalent to the plan’s Tree-sitter/equivalent requirement for TS/JS/Python/Go/Rust.** The branch uses TypeScript compiler APIs for TS/JS and regex/block heuristics for Python/Go/Rust. That is useful, dependency-light, and tested, but it is not robust AST-aware structural parsing across the promised languages. fileciteturn31file0 fileciteturn64file0

5. **The adapter layer is explicit-file and project-local, not a true multi-tool surface registry yet.** The branch has a static adapter contract and classifier for OpenCode/Codex/Claude/Cursor/git/terminal/review/CI/docs/summaries/generic files, but it does not yet implement the full discovery/fetch/normalize adapter modules described in the plan for tool-specific stores, CI systems, IDE diagnostics, issues, Gemini/Roo/Kilo/Cline/Goose/Zed, or cross-tool sources. fileciteturn23file0 fileciteturn24file0

6. **Scoring, conflicts, and concept merge are still heuristic.** This is acceptable for an MVP, but not yet the plan’s calibrated, contradiction-aware, outcome-updated confidence system. The branch has helpful caps and gates, but it does not yet calibrate weights from goldens, human review, or actual downstream success/failure. fileciteturn37file0

7. **Evaluation is a good local regression harness, not yet a research-grade behavior proof.** The branch includes extraction goldens, activation replay, behavior-delta cases, counterfactual trace cases, leak checks, and token budget metrics, but the “counterfactual” implementation is mostly deterministic retrieval/plan text simulation, not an OpenCode-routed A/B planner or real sandbox agent evaluation. fileciteturn72file0 fileciteturn73file0

The most important positive reality check: **the core architecture is proceeding in the right direction.** It aligns with the uploaded plan’s central thesis: raw project evidence can be used as local learning input, while compiled/exported/shared artifacts must pass a declassification boundary. fileciteturn7file16 The branch already implements several of the plan’s hardening points: raw-vault retention, OpenCode-native sanitized routing, episode confidence, generated/lockfile/formatting filters, activation index, review fatigue controls, drift/outcome telemetry, and pack/export privacy tests. fileciteturn59file0 fileciteturn60file0 fileciteturn57file0

The most important negative reality check: **do not call this the next-generation Learn Engine yet.** It should be merged or continued as a **review-gated experimental Learn v2 substrate**, then hardened through targeted PRs before it becomes the default learning loop.

---

## 1. Methodology and limitations

### 1.1 What I inspected

I reviewed the uploaded Learn Engine v2 plan, the target GitHub branch, major new Learn v2 modules, CLI surfaces, docs, config, tests, and relevant existing runtime integration points.

I inspected the plan through the uploaded file context. The plan’s acceptance criteria require, among other things, raw evidence content hashes, raw exclusion from compiled artifacts and packs, normalized evidence pointing to raw refs, evidence/counterevidence on concept cards, compatibility with existing `/osk learn`, `/osk review`, `/osk compile`, `/osk eval`, and `/osk pack`, retention hardening, OpenCode-native model routing, trace IDs, activation index retrieval, review fatigue controls, counterfactual trace eval, and outcome telemetry. fileciteturn7file2

I inspected branch files through the GitHub connector. I also searched recent commits. The branch has many privacy-oriented commits in the history: for example, one commit records public facade command telemetry only as command-family/MCP-surface/success/failure/duration/timestamp and explicitly avoids raw args/prompts/paths/source IDs/diffs/shell commands/hidden benchmark data; another replaces raw ambient command/path telemetry with derived tokens, hashes, buckets, and safe primitives. fileciteturn3file3 fileciteturn3file7

### 1.2 What I could not do

I could not run the repository test suite locally. A direct shell clone failed because the execution environment could not resolve `github.com`. Therefore:

- I do **not** claim that `pnpm test`, `npm test`, `tsc`, or the full CI suite passes.
- I do **not** claim there are no TypeScript build errors.
- I do **not** claim runtime OpenCode execution works in a real OpenCode installation.
- I reviewed implementation correctness from source inspection, tests as written, and code paths.

This limitation matters because the branch is large, crosses many files, and includes new CLI/runtime behavior. The next Codex goal should include a real local build/test pass.

---

## 2. What the project is really trying to achieve

The user intent is not “store memories.” The target is more ambitious:

> Build a project-local, review-gated, reproducible learning engine that watches coding-agent work, raw evidence, corrections, diffs, commands, tests, and outcomes, then compiles durable project behavior into skills, context, MCP resources, command policy, hooks, review checklists, and activation indexes without leaking raw private evidence.

The plan correctly identifies the core architectural shift:

> Move privacy guardrails from “do not read raw local evidence” to “do not declassify raw local evidence into compiled/exported/shared artifacts.” fileciteturn7file16

That is the right product bet. Safe-metadata learning can learn “the user often runs npm test”; raw-local evidence plus corrections and final patches can learn “when touching parser tokenization, first add a focused parser regression test and avoid broad rewrites.” The plan’s gap table correctly distinguishes the current shallow event/signal/preference model from the desired raw record → normalized evidence → task episode → behavior atom → concept card architecture. fileciteturn7file7

The competitive thesis should be framed carefully:

- Not “we have memory.”
- Not “we have skills.”
- Not “we use LLMs to summarize traces.”
- The differentiator is **local-first raw evidence + project relevance gate + output declassification + reviewable ConceptCards + multi-surface compilation + activation + eval/outcome telemetry**.

That differentiator is plausible and strong, but it only matters if activation reaches the agent at task time and if eval proves that the learned behavior changes decisions without bloating context or leaking data.

---

## 3. Plan review

### 3.1 Plan strengths

The plan is strong because it does not merely say “learn from transcripts.” It decomposes the hard problem into the right boundaries:

- Raw input boundary vs declassified output boundary.
- Raw Evidence Vault with retention tiers and GC.
- Project relevance gate to prevent cross-repo poisoning.
- TaskEpisode reconstruction rather than event-level mining.
- Deterministic plus model-assisted extraction.
- Patch comparison between agent proposals and final human edits.
- Counterevidence, contradiction, supersession, and scope confidence.
- ConceptCard review, merge, split, scope, exceptions, and compile preview.
- Active concepts compiled into existing artifacts instead of replacing the compiler.
- Retrieval/activation index rather than eager context stuffing.
- Eval paths: extraction goldens, replay, counterfactual trace eval, sandbox A/B, leak checks, token metrics.
- OpenCode-native model routing instead of OSK-owned provider keys.

The plan’s critique hardening is especially important. It explicitly turns vault bloat, OpenCode routing, trace IDs, activation, review fatigue, AST-aware filtering, and non-default sandbox A/B into design requirements, not optional polish. fileciteturn7file16

### 3.2 Plan weaknesses and risks

The plan is still too broad for one branch. It reads like an architecture spec plus multi-quarter roadmap. That is useful for direction but dangerous for Codex execution because it encourages a huge vertical slice where every module exists but only partially.

The plan’s “frontier” language should be tied to measurable claims. Recent continual-learning work shows that memory systems can overfit immediate observations or fail to reuse knowledge, and CL-Bench reports headroom even for dedicated memory systems. citeturn152189academia1 SWE-Skills-Bench also warns that skill injection often has limited average benefit and can add large token overhead when guidance is mismatched. citeturn156843academia1 Those results do not invalidate OSK; they sharpen the requirement that OSK must measure behavior delta, token overhead, stale concept harm, and context compatibility.

The plan should be amended in three ways:

1. **Make runtime activation an acceptance criterion for every feature slice.** A concept that never reaches the agent’s normal task context is not learned behavior; it is a review artifact.

2. **Define “hard fail” semantics explicitly.** If declassification fails, what functions throw, what files are refused, and what graphs are not written? The plan implies this, but the branch shows how easy it is to return a failed report without aborting.

3. **Separate “deterministic MVP” from “model-assisted frontier.”** The MVP should be deterministic-only, safe, and behavior-changing. Model assistance should be a later layer that cannot change confidence/activation without deterministic validation.

---

## 4. Branch inventory and architectural posture

The branch adds or changes:

- Config defaults and migrations for `learning.rawEvidence`.
- `.gitignore` protection for `.openskill-kit`.
- A broad `packages/core/src/learn-v2` namespace.
- CLI flags for raw learning, vault status/GC, observability, persisted episode reconstruction, concept extraction, eval, model request preparation/execution/application, activation query, concept outcome telemetry, and concept review actions.
- Documentation for `/osk learn`.
- Tests for raw local learning, Learn v2 substrate, and hygiene/export boundaries.

The branch’s Learn v2 namespace is mostly flat-file, not the nested module hierarchy in the plan. That is not automatically bad; it reduces file-count overhead early. But some files are large and carry too many responsibilities:

- `pipeline.ts` is ingestion, preview/apply orchestration, artifact writing, compatibility output, eval, observability, and privacy messaging.
- `store.ts` is concept persistence, review actions, activation index writing, graph sync, graph pruning, auto policies, merge/split/supersession, and raw pinning.
- `model-proposals.ts` is manifest writing, prompt/bundle generation, OpenCode execution, output parsing, validation, path validation, and role-specific apply logic.

This is acceptable for a prototype but should be refactored before adding more surfaces. The plan’s proposed submodules (`vault/`, `surfaces/`, `episodes/`, `extract/`, `concepts/`, `review/`, `compile/`, `eval/`, `opencode-orchestration/`, `retrieval/`, etc.) are a better long-term shape.

---

## 5. Implementation review by module

### 5.1 Config and privacy defaults

The branch adds `learning.rawEvidence` config with `enabled: false`, `defaultScope: "project"`, `extractionExecution: "deterministic-only"`, `retainRawDays: 14`, `maxRawBytesPerRun: 5_000_000`, `maxRawBytesTotal: 250_000_000`, `autoCompactOnBudget: true`, and `pinAcceptableRelevance: true`. Legacy `storeRawPrompts` and `storeRawDiffs` remain false. fileciteturn15file0

This is correct. It preserves the old privacy contract while adding a separate raw-evidence learning mode. That matches the plan’s requirement to add `learning.rawEvidence` rather than changing global raw prompt/diff semantics. fileciteturn7file18

Risk: `learning.rawEvidence.enabled` is present, but raw CLI execution can still be invoked explicitly with `--raw`. That is probably acceptable if explicit command selection is treated as consent, but the docs should state exactly whether config can disable even explicit raw runs.

### 5.2 Raw Evidence Vault

The vault implementation is one of the strongest parts of the branch.

`storeLearnV2RawEvidence` writes a declassified record and a content-hashed raw blob under `.openskill-kit/learn-v2/raw-vault/blobs/<sha>.txt`, with record metadata including content hash, raw byte count, relevance, privacy, retention tier, expiration, trace context, and source information. fileciteturn11file0

Budget enforcement happens before writes, with support for auto-compaction and total vault budgeting. Maintenance can compact old hot-spool records, remove blobs, and produce manifest/budget state. fileciteturn12file0 fileciteturn13file0

Tests cover preview isolation, raw blob retention of true raw content, declassified artifact boundaries, GC compaction, per-run budget rejection, total budget rejection, auto-compaction, and pack exclusion. fileciteturn59file0 fileciteturn60file0

This is materially aligned with the plan’s retention hardening acceptance criteria. fileciteturn7file2

Concerns:

- The plan discusses external OS cache options for bulky blobs; the branch does not appear to implement external cache placement yet.
- The record ID includes source path and content hash, which is okay for import receipts but means the record identity is not purely content-addressed even though the blob is.
- `.openskill-kit/` is globally ignored. This protects private raw state, but it also means reviewed/declassified project concepts will not be committed unless the project deliberately opt-ins. That is safe, but the product should document how teams share only reviewed, declassified concepts. fileciteturn14file0

### 5.3 Project relevance gate

The branch implements the plan’s two-layer relevance gate: hard rejects for global memory without anchors and foreign repo paths, hard review for unanchored test/command logs, hard accept for explicit project-local sources with strong anchors, and a calibrated default heuristic score for ambiguous cases. fileciteturn21file0

Tests cover unrelated global memory rejection, unanchored terminal history review, and explicit project-local source acceptance. fileciteturn61file0

This is good. It is conservative, auditable, and correctly avoids the numeric-magic trap.

Remaining gaps:

- No strong evidence yet of git remote hash, current commit reachability, diff-apply validation, issue/PR linkage, package namespace/import matching, or CI commit SHA linkage.
- Historical imports with same branch/path/time but weak project identity will still be challenging.
- Calibration metadata is mostly static; it is not trained from human review outcomes yet.

### 5.4 Surface registry and adapters

The branch defines a surface adapter contract and static descriptors for `opencode`, `codex`, `claude-code`, `cursor`, `git`, `terminal`, `review-local`, `ci-log`, `project-docs`, `agent-summaries`, and `generic-transcript`. The policy is explicit-only, raw-local-file, declassified-only model boundary, and non-exportable raw refs. fileciteturn23file0

Project-local discovery recursively scans safe file extensions while skipping `.openskill-kit`, generated/vendor/build dirs, and lock/config files. fileciteturn24file0

This is enough for MVP raw files. It is not the full plan’s surface registry. The plan calls for per-surface adapters with discovery, relevance, fetch, normalize, deterministic extraction, LLM bundle creation, fixtures, and future adapter support across many agent tools. fileciteturn7file16

Specific gap: the branch can detect `claude-code` and `codex` file identity, but it does not yet crawl actual tool session stores or implement tool-specific schema drift handling beyond generic structured-object parsing.

### 5.5 Normalization

The normalizer supports JSON/JSONL/Markdown/plain transcript surfaces, role/content extraction, path extraction, commands, trace context, and adapter-specific actor/kind handling. Tests cover JSONL, Markdown, plain text, OpenCode trace context, and adapter-specific normalizations. fileciteturn25file0 fileciteturn61file0

This is a good deterministic substrate.

Risk: The legacy importer had a richer generic transcript flattening list in the plan’s codebase observations, including fields like `response` and `responseItems`. The v2 structured parser should be checked against all legacy importer shapes before replacing importer behavior. fileciteturn7file14

### 5.6 Episode reconstruction

The branch reconstructs episodes by priority: explicit episode ID, trace ID, session ID, branch/path/time bucket, then raw ref. It computes outcome, phases, task hints, confidence breakdown, and risks. fileciteturn27file0 fileciteturn28file0

Tests confirm trace context from OpenCode-like JSONL surfaces is lifted into normalized evidence and episode stitching. fileciteturn61file0

This matches the plan’s trace-ID-assisted reconstruction direction. The remaining missing piece is **emission and propagation**: the branch reads trace context if present, but I did not see the OpenCode plugin actually creating `OSK_EPISODE_ID` / `OSK_TRACE_ID` across session/tool/diff/message events. The plan explicitly requires propagation from OpenCode plugin events. fileciteturn7file2

### 5.7 Compression and patch comparison

The branch summarizes tool calls and patches, filters generated/lockfile/formatting/rename/noise patches, compares agent-proposed vs user-final patches, and emits behavior signals such as `user-added-tests` and `user-narrowed-scope`. fileciteturn29file0 fileciteturn30file0

Tests cover generated-only, lockfile-only, formatting-only, rename-only filters, audit-only patch exclusion from model inference, proposed/final patch comparison, and correction atom extraction. fileciteturn63file0

This is one of the clearest wins in the branch. It directly upgrades beyond “metadata-only” learning.

Risks:

- Proposed/final patch pairing is still heuristic. If an episode is stitched incorrectly, patch comparison can become false user-taste inference.
- The implementation should distinguish strong/medium/weak/no comparison as the plan describes, with confidence caps by comparison type.
- The branch should include fixtures for concurrent human edits unrelated to agent output.

### 5.8 Structural diff

The branch implements structural diff analysis with TypeScript compiler APIs for TS/JS and regex/block heuristics for Python/Go/Rust. It detects languages, changed imports, changed symbols, generated/lockfile/formatting/rename filters, and broad/narrow source summaries. fileciteturn31file0

Tests explicitly assert Python/Go/Rust structural symbol detection “without new parser dependencies.” fileciteturn64file0

This is useful, but it is not the plan’s AST/Tree-sitter-equivalent requirement. The plan says AST/structure-aware diff filtering is mandatory for TS/JS/Python/Go/Rust in early phases. fileciteturn7file16 Regex structural extraction can work for many simple cases, but it will fail or overreport on nested scopes, decorators/attributes, multiline signatures, macros, generated code markers, and large hunks.

Recommendation: keep the dependency-light implementation as fallback, but add a parser abstraction so Python/Go/Rust can move to Tree-sitter or language-native parsers without rewriting extraction.

### 5.9 Deterministic atom extraction

The branch extracts:

- explicit preference/correction language,
- broad-refactor rejection,
- parser/testing hints,
- secret/credential logging safety rules,
- patch-derived correction atoms,
- repeated command policies,
- safe-vs-risky command filtering,
- LLM proposal validation.

The extractor multiplies confidence by episode confidence and adds caps. fileciteturn33file0 fileciteturn34file0 fileciteturn35file0

This is a good pragmatic start. The branch’s raw-local tests show a realistic transcript producing concepts like focused parser fixtures and broad rewrite avoidance while keeping secrets out of artifacts. fileciteturn59file0

Risks:

- A simple secret mention can create a security concept even if the context is not actually a project convention. Security defaults are okay, but scope/evidence language must remain careful.
- Explicit preference atoms default to workflow-like categories in some paths. This may be fine for compatibility, but it can make review/compile categories less semantically precise.
- Repeated command extraction is now safer than legacy mining, but command strings extracted from natural-language text can still include trailing prose.

### 5.10 LLM/model-assisted extraction

The branch implements a safe sanitized model-request workflow:

- It writes prompt-safe episode bundles and request manifests.
- It generates model-routing artifacts and OpenCode agent configs.
- It executes requests through `opencode run`.
- It validates request hashes, output paths, schema, evidence IDs, raw-ref absence, and output boundary constraints before merging proposals.
- It rejects raw-to-model execution today.

fileciteturn49file0 fileciteturn51file0 fileciteturn52file0 fileciteturn53file0

This aligns with the plan’s “OpenCode-native, no OSK-owned model provider” direction. The OpenCode docs confirm that OpenCode supports specialized agents, agent-level model config, permissions, primary/subagent/all modes, hidden subagents, and project config precedence. citeturn743378view0 citeturn927430view0 citeturn927430view2 citeturn927430view3

Important nuance: the branch uses sanitized model assistance, not raw model assistance. That is safer and should remain the default. But the plan’s final architecture includes explicit `opencode-host-raw-allowed` semantics, and that is not done. fileciteturn17file0

Potential model-boundary issue: `validateLearnV2ModelOutputBoundary` flags placeholder patterns in model output as unsafe. That may reject safe outputs that use placeholders like `[PROJECT_ROOT]`. For model proposals, forbidding raw paths is right; forbidding declassified placeholders may be too strict if the prompt asks for deidentified statements. fileciteturn55file0

### 5.11 Concept cards, merging, scoring, conflicts

The branch merges atoms into concept cards by kind, polarity, behavior signature, and scope fingerprint. It adds activation phrases, semantic aliases, path globs, confidence, evidence, raw refs, counterevidence, and review status. fileciteturn36file0

Scoring uses max atom confidence plus support boost, source reliability, counterevidence penalty, and quality gates. fileciteturn37file0

Review supports accept/reject/lock/demote/one-off/merge/split/supersede/counterevidence/bulk/auto policy, and store writing updates activation indexes and pins raw refs. fileciteturn38file0 fileciteturn39file0 fileciteturn40file0 fileciteturn41file0

This is solid for the first implementation.

Remaining gaps:

- Conflict detection is token-overlap polarity logic, not true semantic contradiction analysis.
- Scoring is not calibrated from goldens/review outcomes.
- A concept’s confidence can still be too coupled to raw evidence count and atom support volume.
- Merge keys may still split semantically equivalent concepts or merge superficially similar but operationally different concepts.
- Counterevidence is present, but not yet a rich “counterevidence ledger” with source reliability and scope-specific conflict explanations.

### 5.12 Review UX

The branch implements behavior-delta-first review cards, focus cards, conflict summaries, drift summaries, evidence snippet summaries, and safe bulk review operations. Tests cover review focus cards and conflict-ledger rendering. fileciteturn10file0 fileciteturn63file0

This is a good product direction. Review fatigue is treated as a real failure mode, as the plan demanded.

The UX risk is that the branch writes many local artifacts for every raw run. That is useful for auditability, but it can overwhelm users unless `/osk learn --observability` and `/osk review` summarize the decision path clearly.

### 5.13 Compatibility compilation and declassification

The branch compiles active/locked Learn v2 concepts into legacy `PreferenceNode` and `WorkflowNode` compatibility outputs. Candidate/staged/conflict cards are counted but excluded from preference/workflow compilation. fileciteturn75file0

The output-boundary scanner catches raw-ref-like tokens, user paths, raw-vault paths, emails, secret-like tokens, project root paths, and private generated directories. fileciteturn55file0

Tests cover pack exclusion, pack verification rejecting smuggled Learn v2 paths, lock files, activation runs, and compile-preview leak detection. fileciteturn57file0

This is strong, but the hard-gate issue is serious:

- `compileLearnV2ConceptPreview` returns a declassification report. fileciteturn75file0
- `syncLearnV2ActiveConcepts` calls `compileLearnV2ConceptPreview`, then merges `preview.preferenceNodes` and `preview.workflowNodes` without checking whether the declassification report failed. fileciteturn74file0

This means the branch detects leaks but does not obviously abort graph sync. For a project whose central thesis is “raw local input, declassified output,” this should be fixed before production use.

### 5.14 Activation and retrieval

The branch implements a deterministic Concept Activation Index with activation phrases, semantic aliases, lexical fingerprints, path globs, command hints, task types, negative triggers, BM25-ish scoring, path/task/command scoring, negative suppression, and outcome feedback. fileciteturn44file0 fileciteturn45file0 fileciteturn46file0 fileciteturn47file0

This is better than exact category/path matching and directly aligns with the plan’s activation-index requirement. fileciteturn7file2

However, runtime integration is incomplete. The normal task-context API uses `routeBehavior`, `retrieveRelevantPreferences`, `getAdaptiveStatus`, plugin status, install profile, and legacy review queue. It does not call `activateLearnV2Concepts` or score the Learn v2 activation index. fileciteturn71file0

This is a high-priority product gap. A user should not have to manually run `/osk learn --activation-query` to make learned concepts affect coding-agent behavior. The activation index must feed the MCP task context, plugin command map, or `getAgentTaskContext` output.

### 5.15 Evaluation and observability

The branch implements:

- extraction golden schema,
- behavior-delta golden schema,
- leak checks,
- concept quality gates,
- activation replay,
- generated counterfactual trace cases,
- behavior-delta plan simulation,
- token budget reporting,
- declassified eval artifacts.

fileciteturn72file0 fileciteturn73file0

This is a strong local regression harness. It is not yet proof that learned behavior improves real coding outcomes. The counterfactual trace evaluator checks whether activation retrieves expected concepts and whether simulated `withConceptPlan` includes expected phrases. It does not run a real agent twice, does not execute code, and does not compare final patches.

This is acceptable for the plan’s “daily default” eval path, but the branch should not claim frontier performance without sandbox A/B or real task success deltas.

---

## 6. Major findings table

| Severity | Finding | Reality check | Recommendation |
|---|---|---|---|
| **P0** | Declassification report is not a hard gate before graph sync. | Leak checks exist, but `syncLearnV2ActiveConcepts` merges preference/workflow nodes regardless of report status. fileciteturn75file0 fileciteturn74file0 | Throw or refuse graph sync when report fails. Add tests proving active bad concept does not enter preference/workflow graph. |
| **P1** | Learn v2 activation is not wired into normal agent task context. | CLI activation exists, but `getAgentTaskContext` uses legacy preference retrieval only. fileciteturn71file0 | Add Learn v2 activation results to task context and MCP resources. De-duplicate with legacy prefs. |
| **P1** | Raw-to-model policy is documented but not implemented. | `opencode-host-raw-allowed` is rejected. fileciteturn17file0 | Keep rejected until explicit UX, OpenCode route display, and privacy review exist. Do not silently implement. |
| **P1** | Structural diff is not fully AST-aware for Python/Go/Rust. | Regex/block heuristics are tested but not Tree-sitter/equivalent. fileciteturn31file0 fileciteturn64file0 | Add parser abstraction and robust parser backend for promised languages; keep regex fallback. |
| **P1** | Adapter layer is explicit-file only, not true multi-tool ingestion. | Static adapters and project-local file discovery exist. fileciteturn23file0 | Implement real OpenCode/Codex/Claude/Cursor session discovery and fixtures before broad expansion. |
| **P1** | Eval is deterministic retrieval/plan simulation, not behavior proof. | Eval cases check activation/phrase deltas. fileciteturn72file0 | Add OpenCode-routed counterfactual planner and small sandbox A/B fixtures. |
| **P2** | Concept scoring is not calibrated. | Scoring is deterministic and heuristic. fileciteturn37file0 | Store calibration fixtures and update weights from review/eval outcomes. |
| **P2** | Conflict detection is shallow. | Concept merge/conflict uses token/scope overlap. fileciteturn36file0 | Add contradiction-review bundle and deterministic conflict categories with stronger evidence roles. |
| **P2** | Model output boundary may reject safe placeholders. | Placeholder regex is treated as unsafe in model output validation. fileciteturn55file0 | Distinguish raw leakage from approved placeholders; fail on unresolved raw values, not typed placeholders. |
| **P2** | `.openskill-kit` global ignore protects privacy but complicates team sharing. | `.openskill-kit/` is ignored. fileciteturn14file0 | Add docs/command for exporting only reviewed/declassified concepts for team sharing. |
| **P3** | Flat large modules will become hard to maintain. | `pipeline.ts`, `store.ts`, `model-proposals.ts` own many concerns. | Refactor into plan’s nested module shape before adding more adapters. |

---

## 7. What is correctly done

### 7.1 The branch preserves the core privacy contract

The branch does not casually dump raw prompts/diffs into existing events. It creates a separate Learn v2 raw vault and declassified analysis artifacts. Tests verify raw blobs may contain the original root path and secret while review/eval/model-request artifacts do not. fileciteturn59file0

This is exactly the distinction the plan demands: raw local evidence is allowed as learner input; output artifacts must be declassified. fileciteturn7file16

### 7.2 Retention and bloat are treated as first-class concerns

The branch has retention tiers, max raw bytes per run, total raw vault budget, GC, compaction, and tests that reject oversize evidence before writing raw blobs. fileciteturn12file0 fileciteturn60file0

This is a major improvement over a naive transcript-store approach.

### 7.3 Review remains the trust boundary

Candidate concepts do not compile directly into active preferences/workflows; active/locked status is required. Review actions support accept/reject/lock/demote/one-off/merge/split/supersede and safe bulk controls. fileciteturn39file0 fileciteturn41file0

That aligns with the plan’s review-gated trust model.

### 7.4 Sanitized OpenCode model routing is product-aligned

The branch avoids direct provider SDKs and direct OSK-owned model calls. It generates OpenCode routing artifacts and executes sanitized request manifests through `opencode run` with denied write/shell/web/task permissions. fileciteturn49file0 fileciteturn52file0 fileciteturn54file0

This is aligned with OpenCode’s agent/permission model. OpenCode supports per-agent models and permissions, and its config precedence allows inline runtime config overrides. citeturn743378view0 citeturn927430view3

### 7.5 The tests are meaningful

The tests are not just snapshots. They assert privacy boundaries, relevance decisions, raw-vault budgets, adapter detection, patch filters, proposed/final patch comparison, concept conflict behavior, review focus rendering, command policy safety, supersession thresholds, declassified snippets, outcome drift reports, and pack hygiene. fileciteturn57file0 fileciteturn59file0 fileciteturn60file0 fileciteturn61file0 fileciteturn63file0 fileciteturn64file0

This gives the branch a serious regression base.

---

## 8. What is partially done

### 8.1 ConceptCard architecture

Concept cards exist and are useful, but they do not yet fully match the plan’s durable concept model. Evidence/counterevidence exists, but source reliability, contradiction class, confidence calibration, scope uncertainty, review explanations, and lifecycle supersession need more depth.

### 8.2 OpenCode-native extraction

Sanitized OpenCode request generation and execution exists. Raw allowed model execution does not, and that is okay for now. The branch should not add raw-to-hosted-model processing until consent, route display, provider clarity, and user review are exceptional.

### 8.3 Activation

The index and CLI scoring are strong. The runtime integration is missing. Until `getAgentTaskContext`, MCP resources, plugin attach, or command routing consume the activation index, the concept layer does not automatically affect real agent work.

### 8.4 Evaluation

The eval layer is useful but not sufficient. It validates retrieval and text deltas; it does not yet validate that an actual coding agent produces better patches, runs better commands, avoids bad refactors, or reduces user corrections.

### 8.5 Structural diff

Useful filters exist. They are not the full AST/Tree-sitter/equivalent pipeline promised by the plan.

---

## 9. What is wrongly done or risky

### 9.1 The output-boundary scanner is not enforced at the right choke point

This is the most important correctness issue.

The plan’s core shift depends on output artifacts being declassified. A scanner that returns `"fail"` is not enough. The code must refuse to write or sync unsafe compiled behavior. Right now the active graph sync path does not check the failure before merging preference/workflow nodes. fileciteturn74file0

This should be fixed before continuing feature expansion.

### 9.2 The main task context bypasses Learn v2 activation

The normal agent task context still shows “Relevant Preferences” from legacy retrieval. fileciteturn71file0 This makes Learn v2 feel like a sidecar instead of the project’s adaptive behavior engine.

### 9.3 Docs and CLI expose future model modes too early

The CLI accepts `opencode-host-raw-allowed` as a public mode but rejects it. The docs say it is reserved future policy, which is honest. fileciteturn67file0 fileciteturn68file0 Still, public flags for unimplemented privacy-sensitive features can confuse users. Consider hiding it or requiring `--experimental-raw-model-dispatch` until implemented.

### 9.4 The plan’s AST requirement was softened in implementation

The test name “without new parser dependencies” indicates a conscious tradeoff. That is fine if the milestone is “dependency-light fallback,” but not if the milestone claims plan completion. fileciteturn64file0

### 9.5 Overfitting risk remains

Regex/heuristic concept extraction can turn textual statements into durable project rules too quickly. The branch has caps and review gates, but the real cure is downstream activation outcome telemetry plus strict review UX and eval.

---

## 10. What remains to be done

### 10.1 Must do before defaulting Learn v2

1. Enforce declassification hard-fail before graph sync, compile, pack, MCP resource exposure, and plugin output.
2. Wire Learn v2 activation into `getAgentTaskContext` and MCP resources.
3. Ensure active/locked Learn v2 concepts are retrieved by normal task context with top-k budget and de-duplication from legacy preferences.
4. Add OpenCode trace ID emission and propagation, not just ingestion.
5. Add real adapter fixtures for OpenCode/Codex/Claude/Cursor exports and at least one CI/test log format.
6. Add parser abstraction and robust structural parsing for languages promised by the plan.
7. Add real behavior-delta eval with OpenCode-routed planner or sandbox fixtures.
8. Run full local test/build suite and fix all type/runtime issues.

### 10.2 Should do before calling this frontier

1. Calibrate relevance/confidence/scoring from goldens and human review outcomes.
2. Add scope uncertainty UI and conflict-resolution explanations.
3. Add eval metrics for token overhead, correction-rate delta, stale concept harm, and false activation.
4. Add team-sharing/export flow for reviewed/declassified concepts.
5. Add red-team fixtures for raw transcript prompt injection, malicious review comments, path leakage, customer IDs, and branch names containing sensitive data.
6. Add golden fixtures for all nine scenarios in the plan.
7. Add longitudinal outcome telemetry loops that can demote harmful active concepts.

---

## 11. Modularity and coupling review

### 11.1 Good coupling

The branch wisely bridges active ConceptCards into existing PreferenceNode and WorkflowNode graphs rather than replacing the compiler. That preserves the existing downstream compile/MCP/pack spine. The plan explicitly recommends this bridge. fileciteturn7file18

The raw vault is separated from legacy events, which prevents raw evidence from infecting the old event store.

The model-proposal path is separated from deterministic extraction and uses validated request manifests, which is good.

### 11.2 Bad or risky coupling

`pipeline.ts` is too wide. It knows about source reading, relevance, raw vault storage, legacy raw vault deidentified compatibility records, normalization, episodes, evidence quality, snippets, model requests, concepts, review queue, compile preview, eval, observability, and lifecycle events.

`store.ts` is too wide. It knows about persistence, review actions, activation index writing, graph sync, graph pruning, raw pinning, auto policies, merge/split/supersede, and graph reconciliation.

`model-proposals.ts` is too wide. It writes artifacts, builds prompts, executes OpenCode, validates files, validates schemas, applies outputs, and routes roles.

This is not a reason to throw the work away. It is a reason to refactor before adding adapters. The next phase should split these into stable interfaces:

```text
learn-v2/
  vault/
  relevance/
  surfaces/
  normalize/
  episodes/
  compress/
  extract/
  concepts/
  review/
  compile/
  retrieval/
  opencode-orchestration/
  eval/
  telemetry/
```

### 11.3 Dependency posture

Adding `typescript` to core dependencies enables TS/JS structural parsing. fileciteturn69file0 That is reasonable. Avoid adding heavy parser dependencies until the parser abstraction is designed, but do not pretend regex is equivalent to AST parsing for Python/Go/Rust.

---

## 12. Product workflow review

### 12.1 Current user workflow

The current branch workflow is:

1. User runs `/osk learn --raw --surface-file ...`.
2. Preview writes local artifacts but does not write canonical state.
3. Apply writes raw evidence to Learn v2 vault, declassified analysis frames, episodes, concepts, review queue, compile preview, eval, observability.
4. User reviews concept cards through `/osk review`.
5. Active concepts sync into legacy preference/workflow graphs.
6. User can manually query activation via `/osk learn --activation-query`.
7. User can prepare/execute/apply sanitized model request outputs.
8. User can record concept outcomes.

The docs explain this reasonably well and clearly state raw OpenCode dispatch is unsupported today. fileciteturn68file0

### 12.2 Seamlessness gap

The workflow is not yet seamless because the learned concepts are not automatically used through the normal task context activation path. The best product experience should be:

```text
User/agent starts task
  -> OSK gets query + changed files + commands + task type
  -> Learn v2 activation index returns top-k reviewed concepts
  -> legacy prefs/workflows are de-duplicated
  -> agent gets compact task-specific context
  -> outcome telemetry is recorded after task
```

Today, the activation query path exists, but task context does not use it. fileciteturn71file0

---

## 13. Competitive and research comparison

### 13.1 Against generic memory systems

SWE-Bench-CL frames coding agents as a chronological continual-learning problem and includes a FAISS-backed semantic memory module plus metrics for accuracy, forgetting, forward/backward transfer, tool-use efficiency, and composite continual-learning scores. citeturn152189academia0 OSK’s differentiator is not semantic memory alone; it is local raw evidence, declassification, review-gated concepts, multi-artifact compilation, and project-scoped activation.

### 13.2 Against skill injection alone

SWE-Skills-Bench reports that many software-engineering skills provide little or no pass-rate improvement, that average gain was small, and that token overhead can be large or even harmful when guidance is mismatched. citeturn156843academia1 This strongly supports OSK’s activation-index design: do not blindly inject all learned skills; retrieve scoped concepts under token budgets and track outcomes.

### 13.3 Against MCP-only context systems

MCP defines tools, resources, and prompts. Official docs describe resources as application-driven context data exposed by URI, while tools are model-invoked actions and prompts are user-controlled templates. citeturn251306view0 citeturn251306view1 OSK’s concept resources are aligned with MCP resources, but OSK must keep raw vault content out of MCP resources and expose only reviewed/declassified active concepts.

MCP sampling lets servers request model generations through clients while clients control model access, selection, and permissions and no server API keys are needed. It also recommends human review controls for sampling requests. citeturn507592view0 This supports the plan’s “OpenCode/MCP client controls model execution” direction.

### 13.4 Against OpenCode-native workflows

OpenCode already supports specialized agents, project config, agent-level models, permissions, primary/subagent/all modes, and hidden subagents. citeturn743378view0 citeturn927430view0 citeturn927430view2 OSK should not compete with OpenCode as a model provider or task runner. It should become the learning/activation/declassification layer that feeds OpenCode safe project behavior.

The branch mostly follows this. It does not add direct provider keys; it routes sanitized model proposals through OpenCode. fileciteturn49file0

---

## 14. Recommended next Codex goal

Use this as the next Codex goal, not “finish everything”:

```text
Goal: Harden Learn v2 from a raw-local prototype into an end-to-end, output-safe, task-activating MVP.

Scope:
1. Make Learn v2 declassification failures hard-block active concept graph sync and compiled artifact writes.
2. Integrate active Learn v2 activation into getAgentTaskContext and MCP task context, with top-k budget, negative-trigger suppression, and legacy preference de-duplication.
3. Add OpenCode trace ID emission/propagation in the plugin/hook path, not just normalization support.
4. Add parser abstraction and replace Python/Go/Rust regex-only structural extraction with a real parser backend or explicitly mark regex as fallback with confidence caps.
5. Add full regression tests proving:
   - unsafe active concept cannot enter preference/workflow graph,
   - normal task context retrieves active Learn v2 concepts,
   - candidate concepts are not retrieved unless explicitly requested,
   - raw evidence remains excluded from packs/MCP resources,
   - trace IDs produce higher episode confidence than heuristic stitching,
   - Python/Go/Rust fallback confidence is capped when parser backend is unavailable.
6. Run full build/test/typecheck and fix failures.

Non-goals:
- Do not implement raw hosted-model extraction yet.
- Do not add more tool adapters until the activation and declassification gates are hardened.
- Do not claim frontier performance; only claim review-gated raw-local Learn v2 MVP.
```

---

## 15. Concrete code-change checklist

### 15.1 Declassification hard gate

Add:

```ts
const preview = await compileLearnV2ConceptPreview(root, config, cards, now);
if (preview.declassificationReport.status !== "pass") {
  throw new Error(`Learn v2 compile blocked by declassification report: ${preview.declassificationReport.issues.join(", ")}`);
}
```

inside `syncLearnV2ActiveConcepts` before `mergePreferenceNodes` and `mergeWorkflowNodes`.

Also add a `compileLearnV2ActiveConceptsOrThrow` helper so all compile/sync paths share the same gate.

Tests:

- Active card with raw ref in behavior does not enter preference graph.
- Active card with home path in scope does not enter workflow graph.
- Candidate bad card does not block active-safe sync if candidates are not compiled, or if you choose conservative all-card scanning, the error message must clearly say “candidate card must be rejected/edited before active sync.” Pick one product behavior; do not leave it ambiguous.

### 15.2 Runtime activation integration

Modify `getAgentTaskContext` to call `activateLearnV2Concepts` or a lower-level scorer:

```ts
const learnV2Activation = await activateLearnV2Concepts(root, {
  query,
  paths: [...paths, ...changedFiles],
  commands,
  taskTypes: inferTaskTypes(query, paths, changedFiles, commands),
  includeCandidates: false,
  recordTelemetry: false // or safe hashed telemetry only
});
```

Render:

```markdown
### Relevant Learned Concepts
- [must/should] <behavior> (why matched, scope, confidence)
```

De-duplicate with legacy preferences by `conceptId`, generated preference node ID, and canonical behavior key.

Tests:

- Active concept appears in `getAgentTaskContext(...query/path...)`.
- Candidate concept does not appear.
- Negative trigger suppresses concept.
- Legacy preference generated from same concept is not duplicated.

### 15.3 Parser abstraction

Add:

```ts
interface StructuralParser {
  language: string;
  parseChangedSymbols(diff: ParsedDiffFile): StructuralSummary;
  confidence: "parser" | "fallback";
}
```

Then implement:

- TS/JS: existing TypeScript backend.
- Python/Go/Rust: Tree-sitter or language-specific parser backend.
- Fallback: current regex/block extraction with confidence cap and explicit reason.

### 15.4 OpenCode trace emission

The normalizer already reads trace context. Add actual emission in OpenCode hook/plugin surfaces:

- session created → `OSK_EPISODE_ID`, `OSK_TRACE_ID`.
- tool execution before/after → trace context.
- diff/file edited → trace context.
- message updated/session summary → trace context.
- optional shell env injection only when safe.

Tests:

- OpenCode ambient event fixture with no trace gets heuristic confidence.
- Same fixture with trace gets explicit-id stitching and higher confidence.
- Trace IDs are hashed or declassified where needed.

### 15.5 Eval upgrade

Add an OpenCode-routed eval planner that produces plans A/B from identical prompts with and without concepts. Keep deterministic text checks, but clearly label them as planner deltas, not patch success.

Add two tiny sandbox fixtures:

- parser regression fixture,
- broad refactor rejection fixture.

Run actual agent or scripted surrogate only in opt-in eval, but make the deterministic daily eval honest.

---

## 16. Final reality check

The branch is valuable. It should not be thrown away. It shows serious engineering toward the right architecture:

- raw evidence is isolated,
- declassification is visible,
- retention exists,
- review remains the trust boundary,
- model assistance is OpenCode-native and sanitized,
- activation is more than exact path matching,
- tests pin many privacy and learning boundaries.

But the branch is still **a Learn v2 substrate**, not yet the fully realized frontier engine. The biggest conceptual gap is not extraction; it is **closing the loop**:

```text
raw evidence -> reviewed concept -> activation at task time -> changed agent behavior -> outcome telemetry -> concept health update
```

The branch implements most of the first half. The next work must harden the output gate and connect activation to normal task context. After that, deeper adapters, model-assisted extraction, robust structural parsing, and research-grade eval will matter much more.

Until then, the honest status is:

> OpenSkillKit is proceeding in the right direction. The branch is a strong, safety-conscious raw-local Learn v2 prototype. It is not yet a default-ready frontier learning engine, mainly because declassification is not enforced as a hard compile gate and Learn v2 activation is not yet part of the normal agent task context.

---

## 17. Evidence appendix

### Uploaded plan anchors

- Core thesis and critique hardening: raw local evidence as learner input; declassification at output boundaries; vault bloat; OpenCode-native routing; trace IDs; activation; review fatigue; AST filtering; counterfactual eval. fileciteturn7file16
- Target architecture gap table: source coverage, raw→episode→atom→concept, LLM-assisted extraction, patch comparison, conditional command policy, review cards, activation/eval. fileciteturn7file7
- Acceptance criteria: raw vault, raw exclusion from packs, evidence/counterevidence, compatibility, retention, model routing, trace, retrieval, review, eval. fileciteturn7file2
- Keep legacy learn and bridge active concepts to PreferenceNode/WorkflowNode. fileciteturn7file18

### Repo anchors

- Learn v2 schemas: raw evidence, manifest/budget, normalized evidence, tool summaries, patch comparisons, episodes, atoms, concepts, review/eval/trace. fileciteturn8file0 fileciteturn9file0 fileciteturn10file0
- Raw vault store/GC: content-hashed blob, declassified record, budget, compaction. fileciteturn11file0 fileciteturn12file0 fileciteturn13file0
- Config: raw evidence defaults and old raw prompt/diff privacy defaults. fileciteturn15file0
- Pipeline: raw mode, sanitized-only model boundary, raw-to-model rejection, accepted-source extraction, artifact writing. fileciteturn17file0 fileciteturn18file0
- Relevance gate. fileciteturn21file0
- Surface adapters. fileciteturn23file0
- Episodes and confidence. fileciteturn27file0 fileciteturn28file0
- Compression/patch comparison. fileciteturn29file0 fileciteturn30file0
- Structural diff. fileciteturn31file0
- Extractors. fileciteturn33file0 fileciteturn34file0 fileciteturn35file0
- Concepts/scoring. fileciteturn36file0 fileciteturn37file0
- Store/review/sync/activation. fileciteturn38file0 fileciteturn39file0 fileciteturn40file0 fileciteturn41file0 fileciteturn74file0
- Compile/declassification. fileciteturn75file0 fileciteturn76file0
- Activation scoring/outcomes. fileciteturn44file0 fileciteturn45file0 fileciteturn46file0
- Task context integration gap. fileciteturn71file0
- Eval. fileciteturn72file0 fileciteturn73file0
- Tests. fileciteturn57file0 fileciteturn59file0 fileciteturn60file0 fileciteturn61file0 fileciteturn63file0 fileciteturn64file0
- CLI and docs. fileciteturn67file0 fileciteturn68file0

### External comparison anchors

- OpenCode agent/model/permission/config docs. citeturn743378view0 citeturn927430view0 citeturn927430view2 citeturn927430view3
- MCP resources and sampling docs. citeturn251306view0 citeturn251306view1 citeturn507592view0
- SWE-Bench-CL continual learning benchmark. citeturn152189academia0
- SWE-Skills-Bench skill utility benchmark. citeturn156843academia1
- CL-Bench continual learning benchmark. citeturn152189academia1

---

## 18. Implementation progress update - 2026-07-04

### Slice 1 completed locally: output gate + task activation

Verified the review's two highest-priority claims against the local branch and implemented the hardening slice.

Done:

- Added a shared active-concept compile gate through `compileLearnV2ActiveConceptsOrThrow`.
- Changed `syncLearnV2ActiveConcepts` so active/locked Learn v2 concepts must pass the declassification boundary before preference/workflow graph sync writes.
- Added the same active-concept declassification gate before concept store writes and activation-index writes, so unsafe active concepts cannot remain retrievable if graph sync fails.
- Kept unsafe candidate concepts from blocking safe active concept graph sync. Candidate concepts remain review artifacts and do not enter compatibility outputs.
- Added Learn v2 activation to normal `getAgentTaskContext`, including active/locked-only retrieval, task-type hints, dedupe against generated legacy preference nodes, and a compact "Relevant Learned Concepts" section.
- Added optional `negativeSignals` to task context so explicit suppression signals can prevent concept activation.
- Wired `negativeSignals` through CLI and MCP task-context entrypoints.
- Added regression tests proving unsafe active sync/store write is blocked, unsafe candidates do not block safe active sync, active Learn v2 concepts appear in task context, candidates do not appear, and explicit negative triggers suppress activation.

Verification run:

```text
rtk npx vitest --run packages/core/tests/learn-v2.test.ts
rtk npx vitest --run packages/core/tests/learn-v2.test.ts packages/core/tests/deep-architecture.test.ts packages/core/tests/mcp-server.test.ts
rtk npm run typecheck
rtk npx vitest --run packages/core/tests/learn-v2.test.ts packages/core/tests/deep-architecture.test.ts packages/mcp-server/tests/mcp-server.test.ts packages/cli/tests/osk-facade.test.ts
rtk npm test
```

Final verification passed: full Vitest suite reported 40 files and 287 tests passing.

Remaining highest-value next slices:

1. Add OpenCode trace emission/propagation in plugin/hook paths, not only ingestion.
2. Upgrade eval labels so deterministic replay is not confused with real sandbox/agent behavior proof.
3. Add de-duplication contract tests where a generated `pref_<conceptId>` and a Learn v2 activation match both exist.
4. Add team-sharing/export flow for reviewed/declassified concepts.
5. Replace Python/Go/Rust heuristic fallbacks with real parser backends only if dependency/runtime tradeoffs are acceptable.

### Slice 2 completed locally: public task-context contract

Done:

- Documented that `preferences.items` and `learnedConcepts.shown` are the actionable task-context behavior surfaces.
- Documented that `learnV2Activation.matches` is diagnostic because it can include concepts already represented by generated legacy preference nodes.
- Added CLI task-context regression coverage proving `--negative-signal` suppresses a reviewed Learn v2 concept.
- Added MCP task-context regression coverage proving `negativeSignals` suppresses a reviewed Learn v2 concept through the public MCP tool.

Verification run:

```text
rtk npx vitest --run packages/cli/tests/osk-facade.test.ts packages/mcp-server/tests/mcp-server.test.ts packages/core/tests/docs-coverage.test.ts
rtk npm run typecheck
```

### Slice 3 completed locally: structural parser contract and fallback caps

Done:

- Added explicit structural parser metadata on Learn v2 patch file summaries: `parserBackend`, `structuralConfidence`, and `confidenceCap`.
- Routed TypeScript/JavaScript structural extraction through a named `typescript-compiler` parser backend with parser confidence.
- Routed Python/Go/Rust structural extraction through an explicit `heuristic-fallback` backend with fallback confidence and a 0.68 cap.
- Kept unknown/unsupported languages on `none` backend with low structural confidence.
- Applied structural confidence caps to agent-patch versus final/manual patch comparison confidence so fallback-only patch pairings cannot be overrepresented as parser-grade evidence.
- Added regression tests for TS/JS parser backend metadata, Python/Go/Rust fallback metadata, and fallback-capped patch-pair confidence.

Verification run:

```text
rtk npx vitest --run packages/core/tests/learn-v2.test.ts
rtk npm run typecheck
rtk npm test
```

Final verification passed: full Vitest suite reported 40 files and 290 tests passing.

### Slice 4 completed locally: counterevidence ledger visibility

Done locally:

- Added a first-class Learn v2 counterevidence ledger artifact under `.openskill-kit/learn-v2/counterevidence/`.
- Linked the ledger from raw-learning artifacts, CLI raw output, observability artifact paths, and the concept review queue.
- Added review-queue summary counts for total counterevidence, affected concepts, activation-blocking items, and reason buckets.
- Redacted project/home absolute path prefixes from ledger reason text before writing review-facing artifacts.
- Added raw-learning regression coverage for markdown visibility, JSON schema, activation-blocking counts, and local path redaction.

Verification run:

```text
rtk npx vitest --run packages/core/tests/learn-v2.test.ts -t "raw-learning review artifacts"
rtk npx vitest --run packages/core/tests/learn-v2.test.ts -t "raw-learning review artifacts|counterevidence ledger"
rtk npx vitest --run packages/core/tests/learn-v2.test.ts
rtk npx vitest --run packages/core/tests/learn-v2-hygiene.test.ts
rtk npm run typecheck
rtk npm test
```

Final verification passed: full Vitest suite reported 40 files and 295 tests passing.

Next review target:

1. Reassess whether counterevidence should also feed activation explainability output, not only review artifacts.
2. Re-run full Learn v2 quality gates after typecheck/test completion.

### Slice 5 completed locally: activation counterevidence explainability

Done locally:

- Added `counterevidenceCount` to generated Learn v2 activation-index entries and activation matches.
- Kept the activation result privacy boundary count-only; raw counterevidence reasons are not emitted in activation output or telemetry.
- Added a defensive activation suppression path for active or locked concepts that still carry counterevidence, matching the review quality gate's intent for older/stale stores.
- Updated CLI activation rendering to show `counterevidence=N` for matched or suppressed concepts.
- Documented the activation output contract and added scoring regression coverage for active suppression plus candidate inspection.

Verification run:

```text
rtk npx vitest --run packages/core/tests/learn-v2.test.ts -t "counterevidence in activation"
rtk npm run typecheck
rtk npx vitest --run packages/core/tests/learn-v2.test.ts
rtk npx vitest --run packages/cli/tests/osk-facade.test.ts -t "sanitizes raw Learn v2 JSON paths"
rtk npm test
```

Note: one full-suite run timed out in the CLI raw JSON sanitization test under suite load; the same test passed directly, and the final full-suite retry passed with 40 files and 296 tests.

### Slice 6 completed locally: compiled hook trace propagation

Finding:

- The OpenCode plugin already emits safe `traceContext`, but compiled generic lifecycle hooks still wrote safe events without Learn v2 trace anchors. That meant hook-originated task events relied on weaker session/time/path stitching unless a later OpenCode ambient event carried trace ids.

Done locally:

- Added standalone CJS trace-context generation to compiled hook scripts.
- Hook scripts now recover `OSK_SESSION_ID`, `OSK_EPISODE_ID`, `OSK_TRACE_ID`, and `OPENCODE_SESSION_ID` from environment when present.
- Hook scripts also accept safe payload `traceContext` ids and otherwise generate deterministic fallback OSK trace ids from project/session seed.
- Hook events store `normalized.traceContext` with trace ids plus `projectRootHash`; they do not store raw project root in the trace context.
- Added adaptive end-to-end hook regression coverage for env trace propagation and raw-root exclusion.

Verification run:

```text
rtk npx vitest --run packages/core/tests/adaptive.test.ts -t "initializes, observes, learns, reviews, compiles, installs, and exports safely"
rtk npm run typecheck
rtk npx vitest --run packages/core/tests/adaptive.test.ts packages/core/tests/deep-architecture.test.ts packages/core/tests/opencode-ambient-privacy.test.ts
rtk npm test
```

Final verification passed: full Vitest suite reported 40 files and 296 tests passing.

### Slice 7 completed locally: eval proof-boundary labeling

Finding:

- Eval output already used deterministic replay, activation scoring, and configured goldens, but JSON/CLI/Markdown did not expose a single proof-boundary field. A passing counterfactual trace could be misread as sandbox or real-agent proof by downstream automation or humans skimming CLI output.

Done locally:

- Added `proofBoundary` to Learn v2 eval reports.
- Persisted eval command results now return the same boundary.
- CLI eval output prints `deterministic-local-replay (sandbox=false, agent=false)`.
- CLI eval output also injects the boundary when an older core package result lacks it, so JSON/text output remains explicit across source/dist skew during local development.
- Markdown eval reports include a `Proof Boundary` section with what the eval proves and does not prove.
- Added core and CLI regression assertions for JSON/text proof-boundary output.

Verification run:

```text
rtk npx vitest --run packages/core/tests/learn-v2.test.ts -t "eval report"
rtk npx vitest --run packages/cli/tests/osk-facade.test.ts -t "prints persisted Learn v2 eval summary metrics"
rtk npm run build
rtk npx vitest --run packages/cli/tests/osk-facade.test.ts -t "prints persisted Learn v2 eval summary metrics"
rtk npm run typecheck
rtk npm test
```

Final verification passed after CLI compatibility fallback: full Vitest suite reported 40 files and 296 tests passing.
