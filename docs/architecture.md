# Architecture

openskill-kit separates the reusable engine from agent integrations.

```text
packages/core
  skill parser, scanner, verifier, registry, installer, draft engine
packages/cli
  command-line interface over core
packages/opencode-plugin
  thin OpenCode tools over core
packages/codex-plugin
  local Codex plugin bundle and skill instructions
packages/mcp-server
  future stdio MCP bridge over core
```

## Data Flow

```text
topic/task
  -> context collector
  -> local/manual researcher
  -> evidence ledger
  -> draft engine
  -> candidate skill package
  -> verifier pack + safety scanner + verifier
  -> install target + registry
```

The first implementation uses deterministic local drafting. It does not fake
web research or agent-performance evaluation.

## Run Artifacts

`draft` writes:

- `context.json`: capped local repo context with no raw secret files.
- `evidence-ledger.json`: local sources, hashes, claims, confidence, warnings.
- `verifier-pack.json`: deterministic package-quality assertions.
- `plan.md`: short execution plan.
- `candidate/<skill>/SKILL.md`: portable skill package.

The current verifier pack checks schema, structure, safety, installability,
context efficiency, and portability. It intentionally does not claim that an
agent will solve downstream tasks.
