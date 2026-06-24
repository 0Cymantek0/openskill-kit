# Configuration

Default project config path: `.openskill-kit/config.json`.

Current safe defaults:

- no telemetry
- no external LLM calls
- no web crawling
- capped local context collection
- `.env` files excluded
- generated skills audited before install

Future provider config will be optional and explicit.

## MCP

Local MCP hosts can spawn the stdio server:

```json
{
  "mcpServers": {
    "openskill-kit": {
      "command": "openskill-kit-mcp"
    }
  }
}
```

Server tools default to deterministic local mode. Installation calls default to
dry-run; pass `dryRun: false` and `yes: true` only after explicit approval.
