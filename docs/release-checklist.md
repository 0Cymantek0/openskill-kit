# Release Checklist

Run before publishing or handing a build to users:

```bash
npm run typecheck
npm test
npm run build
npm run smoke
npm run release-check
```

Manual audit:

- Fresh project flow works: `init -> detect -> observe -> learn -> review -> compile -> install -> eval -> pack -> sign -> verify -> import-pack --review`.
- `doctor --full` has no unexpected failures.
- `interactions import <file>` dry-runs by default, appends only with `--yes`, redacts imported snippets, and blocks duplicate source hashes unless explicitly allowed.
- `status --json` and `doctor --full` expose interaction import counts and blocked import warnings.
- `workflows mine` creates review-safe candidate/staged Workflow Graph nodes from repeated passing command/test event sequences without activating behavior.
- Review queue artifacts, TUI, CLI `review --workflow-activate <id>`, and MCP `osk_apply_review_actions.workflowActivate` can move workflow candidates through review decisions.
- `status` reports workflow candidate and total pending-review counts.
- `route`/MCP routing treats candidate workflows as review-gated project evidence and only active/locked workflows as local-only coverage.
- `compile` includes only active/locked workflows in `project-workflows`, `active-workflows.md`, command policy, review checklist, and path map artifacts.
- `openworld doctor` still clearly labels scaffolded and missing paper-level capabilities.
- OpenWorld source ingestion writes source-index/trust-cache and blocks forbidden identifiers before caching source text.
- OpenWorld `build-verifier` writes manifest, traceability map, visible/holdout executable cases, and blocks leaked verifier artifacts before writing scripts.
- OpenWorld `run-verifier --split visible` executes generated cases through the sandbox runner and writes a result JSON.
- OpenWorld `refine` writes an EvolutionRun, stops early on actionable visible failures, and runs holdout only after visible pass.
- OpenWorld `eval-report` labels proof level as artifact-verifier and says hidden-oracle proof is false.
- OpenWorld `report --write` collects sources, anchors, suites, verifier executions, EvolutionRuns, eval reports, and next actions in one task report.
- OpenWorld `promote-review` creates only a semantic review proposal from passed runs and never activates behavior directly.
- `status --explain` gives useful next action text.
- Generated packs do not include private event, signal, review, eval-run, report, raw prompt, raw diff, or secret data.
- Imported hooks stay excluded unless `--trust-hooks` is explicit.
- Docs and examples avoid external product comparisons.
- `git diff --check` is clean.

Publish dry-run:

```bash
npm pack --dry-run
```
