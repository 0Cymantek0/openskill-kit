---
name: openskill-kit
description: Use openskill-kit to draft, audit, test, and install portable agent skills
license: MIT
compatibility: agent-plugin
metadata:
  package: openskill-kit
---

# openskill-kit

## When to use
Use when asked to create, audit, verify, or install reusable agent skills.

## When not to use
Do not use for hidden benchmark answers, secret extraction, or unapproved global
installation.

## Workflow
1. For `/osk ...` requests, read `commands/commands.json` or `commands/osk.md` and route to the mapped MCP tool first.
2. If MCP is unavailable, run the mapped CLI fallback from the project root.
3. Prefer `openskill-kit evolve "<topic>" --no-llm` when user wants draft plus local verification loop.
4. Use `openskill-kit draft "<topic>" --no-llm` only when a candidate without loop diagnosis is enough.
5. Add explicit evidence with `--evidence-file <path>` or opt-in URL evidence with `--evidence-url <url>` when user supplies trusted sources.
6. Run `openskill-kit audit <skill-path>` before install.
7. Run `openskill-kit test <skill-path>` and inspect report paths. Use `--run-repo-checks` when the user wants verifier-pack repo scripts executed.
8. Run `openskill-kit evaluate <skill-path>` for one leakage-aware readiness report before install.
9. Install with explicit target only, such as `--target agents-project`.
10. Keep generated `SKILL.md` concise; bulky notes belong in references.

## Safety
Critical audit findings block install unless user explicitly approves override.
Hidden-test, oracle, and ground-truth evidence inputs are blocked by leakage audit.
The bundled `.mcp.json` can expose the same core through `openskill-kit-mcp`.
Slash command support is harness-owned; this plugin only publishes the command
map and backend operations.
