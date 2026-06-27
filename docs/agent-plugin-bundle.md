# Agent Plugin Bundle

OpenSkillKit is intended to attach to an existing coding harness, not replace
it. The plugin bundle gives that harness three local entrypoints:

- `skills/` for repository-scoped skill instructions.
- `.mcp.json` for the local `openskill-kit-mcp` stdio backend.
- `.agent-plugin/plugin.json` for the host-facing capability and privacy
  contract.

Install a generated skill into the current project:

```bash
openskill-kit install <skill-path> --target agents-project --yes
```

Each successful install writes an audit receipt under
`.openskill-kit/installs/agents-project/`.

The local agent plugin bundle lives in `packages/agent-plugin-bundle` and includes an
`openskill-kit` skill describing safe CLI usage. It also includes `.mcp.json`
with an `openskill-kit-mcp` stdio server entry for local MCP-capable hosts.

Generated project plugins live under `.openskill-kit/compiled/plugin/` after:

```bash
openskill-kit compile --target plugin
```

That directory is attachable from the project root. Its `plugin.json` declares
skills, MCP runtime, hook preview path, behavior artifacts, explicit approval
gates, and privacy exclusions. It does not copy raw events, raw prompts, raw
diffs, interaction imports, private evidence blobs, review queues, or user
memories.

For harness compatibility, generated plugins also include:

- `.agent-plugin/plugin.json`: same host-facing manifest under the conventional
  plugin metadata directory.
- `.mcp.json`: direct stdio MCP attachment for `openskill-kit-mcp`.

Harness behavior should stay conservative:

- Load skills and MCP descriptors read-only by default.
- Start `openskill-kit-mcp` from the project root with stdio.
- Call `osk_bootstrap_session` first; it reports whether the compiled plugin is
  ready, where to attach it, which skills/capabilities are exposed, and which
  approvals remain required.
- Preview managed instruction files and hooks before applying.
- Require explicit approval for global writes, hook execution, interaction
  imports, and behavior pack imports.
