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
  -> draft engine
  -> candidate skill package
  -> safety scanner + verifier
  -> install target + registry
```

The first implementation uses deterministic local drafting. It does not fake
web research or agent-performance evaluation.
