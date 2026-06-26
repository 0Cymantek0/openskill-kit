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
- `openworld doctor` still clearly labels scaffolded and missing paper-level capabilities.
- OpenWorld source ingestion writes source-index/trust-cache and blocks forbidden identifiers before caching source text.
- OpenWorld `build-verifier` writes manifest, traceability map, visible/holdout executable cases, and blocks leaked verifier artifacts before writing scripts.
- OpenWorld `run-verifier --split visible` executes generated cases through the sandbox runner and writes a result JSON.
- OpenWorld `refine` writes an EvolutionRun, stops early on actionable visible failures, and runs holdout only after visible pass.
- `status --explain` gives useful next action text.
- Generated packs do not include private event, signal, review, eval-run, report, raw prompt, raw diff, or secret data.
- Imported hooks stay excluded unless `--trust-hooks` is explicit.
- Docs and examples avoid external product comparisons.
- `git diff --check` is clean.

Publish dry-run:

```bash
npm pack --dry-run
```
