# Quickstart

```bash
npm install
npm run build
npx openskill-kit init
npx openskill-kit doctor --json
npx openskill-kit draft "handle repo test failures" --no-llm
npx openskill-kit audit .openskill-kit/runs/<run>/candidate/handle-repo-test-failures
npx openskill-kit test .openskill-kit/runs/<run>/candidate/handle-repo-test-failures
npx openskill-kit install .openskill-kit/runs/<run>/candidate/handle-repo-test-failures --target agents-project --dry-run
```
