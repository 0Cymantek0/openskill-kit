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

- Fresh project flow works: `init -> observe -> learn -> review -> compile -> install -> eval -> pack -> sign -> verify -> import-pack --review`.
- `doctor --full` has no unexpected failures.
- `status --explain` gives useful next action text.
- Generated packs do not include private event, signal, review, eval-run, report, raw prompt, raw diff, or secret data.
- Imported hooks stay excluded unless `--trust-hooks` is explicit.
- Docs and examples avoid external product comparisons.
- `git diff --check` is clean.

Publish dry-run:

```bash
npm pack --dry-run
```
