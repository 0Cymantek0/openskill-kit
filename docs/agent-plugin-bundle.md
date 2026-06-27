# Agent Plugin Bundle

OpenSkillKit is intended to attach to an existing coding harness, not replace
it. The plugin bundle gives that harness four local entrypoints:

- `skills/` for repository-scoped skill instructions.
- `.mcp.json` for the local `openskill-kit-mcp` stdio backend.
- `commands/` for `/osk ...` intent mapping with MCP-first and CLI fallback
  routes.
- `install-guides/` for host-specific attach notes for Codex, Claude Code,
  Cursor, and generic MCP clients.
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

Preview the host MCP config before writing anything:

```bash
openskill-kit agent attach-plugin --host generic-mcp --dry-run
```

Apply only after review:

```bash
openskill-kit agent attach-plugin --host generic-mcp --yes
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
- `mcp/descriptors.json` and `mcp/descriptor-hashes.json`: deterministic MCP
  tool descriptor catalog plus SHA-256 hashes so a harness can detect descriptor
  drift before trusting the tool surface.
- `commands/commands.json` and `commands/osk.md`: slash-command intent map.
  Hosts that do not implement slash commands can still interpret `/osk ...`
  phrases by calling the mapped MCP tool or running the CLI fallback.
- `install-guides/codex.md`, `install-guides/claude-code.md`,
  `install-guides/cursor.md`, and `install-guides/generic-mcp.md`: conservative
  host attach notes. They keep existing host config reviewable instead of
  silently writing global settings.
- `openskill-kit agent attach-plugin`: a safe host-config planner that compiles
  the plugin, preserves existing MCP servers, writes only project-local config
  (`.mcp.json` or `.cursor/mcp.json`), and records an install receipt on apply.
  Applied config also sets `OPENSKILLKIT_PROJECT_ROOT` so MCP tools still bind
  to the project when a host launches the stdio server from another working
  directory.
  Receipts store the compiled plugin version and MCP descriptor hash used at
  attach time. If the compiled plugin descriptor hash changes later,
  `osk_get_plugin_attach_status` reports `descriptor-drift` until the host
  attachment is previewed and applied again.
  `openskill-kit status --json` and `osk_bootstrap_session` report
  `compiled.pluginAttachment` so hosts can show whether the plugin is attached,
  root-bound, missing, invalid JSON, pointed at the wrong command, or stale
  against current descriptors.

Harness behavior should stay conservative:

- Load skills and MCP descriptors read-only by default.
- Compare `plugin.json.integrity.descriptorsHash` with
  `mcp/descriptor-hashes.json` before trusting tool descriptors.
- Treat any `plugin.integrityIssues` returned from `osk_bootstrap_session` or
  `openskill-kit status --json` as attach-blocking; regenerate with
  `openskill-kit compile --target plugin`.
- Treat `compiled.pluginAttachment.hosts[*].status == "descriptor-drift"` as
  attach-stale; preview and re-apply host attachment, then restart or refresh
  the harness MCP server.
- Start `openskill-kit-mcp` from the project root with stdio.
- Call `osk_bootstrap_session` first; it reports whether the compiled plugin is
  ready, where to attach it, which skills/capabilities are exposed, and which
  approvals remain required.
- Route `/osk ...` requests through `commands/commands.json`; prefer MCP and use
  CLI fallbacks only when the MCP backend is unavailable.
- For normal coding tasks, route `/osk context` to
  `osk_get_agent_task_context`; it returns the route plan, compact relevant
  preferences, workflow matches, plugin health, review counts, compact pending
  review items, action hints, and next actions in one harness-friendly response.
  Semantic proposals and OpenWorld review promotions shown there are review
  inputs only; the host must still run learning/update graph and explicit
  review actions before compiling or installing active behavior.
- At task end, route `/osk finish task` to `osk_finish_agent_task` with a short
  safe summary, touched files, verification commands, command status, and
  outcome. It records redacted local evidence, writes session summaries, runs
  learning, and returns review next actions. Do not pass raw prompts, raw diffs,
  secrets, or hidden benchmark answers.
- For unfamiliar-domain work, route `/osk openworld doctor`,
  `/osk openworld source plan`, `/osk openworld refine`, and
  `/osk openworld report` through the mapped OpenWorld MCP tools so the harness
  can keep research, anchors, verifier runs, and proof limits in one local
  artifact tree. The task report includes `proofSummary` so hosts can show
  artifact-verifier readiness, missing evidence, and the hidden-oracle
  limitation without parsing Markdown.
- Route `/osk openworld promote review` to `osk_openworld_promote_review` only
  after explicit approval. Promotion creates a review-only proposal from a
  passed run; it does not activate behavior and does not claim hidden-oracle
  benchmark proof.
- Route `/osk import session` to `osk_import_interaction_source` when the user
  explicitly wants to ingest a Codex, Claude, Cursor, or manual session export.
  Keep the first run as a preview/dry-run unless the user approves applying the
  import; the command exists so harness users do not have to discover raw CLI
  import names. Codex, Claude Code, and Cursor imports flatten common nested
  transcript containers, tool-use command blocks, and IDE file references, but
  they remain explicit-import-only and never copy raw transcript text into
  plugin artifacts.
- Route `/osk import review` to `osk_import_interaction_source` with adapter
  `review-local` when the user supplies PR review exports or local review notes.
  Keep it approval-gated; previewed review comments become normal
  `review-comment` evidence only after explicit import.
- Route `/osk import terminal` to `osk_import_interaction_source` with adapter
  `terminal-history` only when the user supplies a terminal-history file. It
  imports allowlisted commands, ignores raw output, and requires approval before
  appending metadata.
- Route `/osk git context` to `osk_get_git_local_context` when the harness needs
  branch, changed-file, aggregate diff, or recent-commit metadata. It is
  read-only and must not be treated as permission to read raw diffs.
- Route `/osk import adapters` to `osk_list_interaction_adapters` before import
  when the harness needs the supported adapter list, accepted formats, adapter
  status, and explicit-import-only privacy policy.
- Route `/osk session imports` to `osk_list_interaction_imports` for import
  history. It is read-only and reports receipts without exposing raw source
  content.
- Read the matching `install-guides/` file before applying any host-specific
  config.
- Use `osk_get_plugin_attach_status` for readiness checks,
  `osk_preview_plugin_attach` for MCP-based attach previews, and
  `osk_apply_plugin_attach` only after explicit approval.
- Preview managed instruction files and hooks before applying.
- Require explicit approval for global writes, hook execution, interaction
  imports, and behavior pack imports.
