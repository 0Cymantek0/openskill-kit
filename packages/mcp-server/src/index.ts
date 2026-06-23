#!/usr/bin/env node

export const serverStatus = {
  name: "openskill-kit-mcp",
  status: "planned",
  reason: "CLI/core spine must remain stable before stdio MCP transport is enabled."
};

if (process.argv[1]?.endsWith("index.js")) {
  console.error(JSON.stringify(serverStatus));
}
