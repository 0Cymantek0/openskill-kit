# Contributing

## Setup

```bash
npm install
npm test
npm run typecheck
npm run build
npm run smoke
```

## Standards

- Keep core logic in `packages/core`.
- Keep adapters thin.
- Add tests for every scanner rule, installer path, and CLI behavior.
- Do not call real LLM APIs in tests.
- Do not read real user home directories in tests; use temp homes.
- Do not add telemetry or default network access.
