# Agent Plugin Bundle

OpenSkillKit is intended to attach to an existing coding harness, not replace
it. OpenCode is the primary full-feature target for command files, skills,
learner subagent metadata, project plugin hooks, and MCP. Codex, Claude Code,
Cursor, and generic MCP clients stay supported through conservative
preview-first attach paths.

The public harness surface is 12 `/osk` command families: `init`, `status`,
`task`, `learn`, `review`, `research`, `evolve`, `verify`, `compile`,
`deploy`, `eval`, and `pack`. Low-level MCP tools and CLI commands are still
available for advanced automation, but user-facing harness flows should route
through the family map first.

The plugin bundle gives a harness these local entrypoints:

- `skills/` for repository-scoped skill instructions.
- `.mcp.json` for the local `openskill-kit-mcp` stdio backend.
- `commands/` for `/osk ...` intent mapping with MCP-first and CLI fallback
  routes.
- `install-guides/` for host-specific attach notes for Codex, Claude Code,
  Cursor, and generic MCP clients.
- `opencode/plugins/` for OpenCode project plugin hooks copied into
  `.opencode/plugins` and registered without removing existing `plugin` entries.
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
openskill-kit agent attach-plugin --host opencode --dry-run
```

Apply only after review:

```bash
openskill-kit agent attach-plugin --host opencode --yes
```

That directory is attachable from the project root. Its `plugin.json` declares
skills, MCP runtime, hook preview path, behavior artifacts, explicit approval
gates, and privacy exclusions. It does not copy raw events, raw prompts, raw
diffs, interaction imports, private evidence blobs, review queues, or user
memories.

For harness compatibility, generated plugins also include:

- `.agent-plugin/plugin.json`: same host-facing manifest under the conventional
  plugin metadata directory.
- `plugin.json.installProfile`: machine-friendly attach contract for harnesses.
  It names the first MCP call, CLI fallback, MCP server command, required
  project-root env binding, command map, approval-gated tools, read-only
  readiness tools, OpenCode-first attach preview/apply/status commands, and per-host
  config format plus exact preview/apply/status commands under `hostConfig`.
- `plugin.json.hostCompatibility`: structured Codex, Claude Code, Cursor, and
  generic MCP compatibility records with support level, expected config path,
  instruction surface, requirements, and safety notes.
- `.mcp.json`: direct stdio MCP attachment for `openskill-kit-mcp`.
- `model-routing.resolved.json` and `opencode/model-routing.json`: validated
  project-local model-route projections. See `docs/model-routing.md`.
- `mcp/descriptors.json` and `mcp/descriptor-hashes.json`: deterministic MCP
  tool descriptor catalog plus SHA-256 hashes so a harness can detect descriptor
  drift before trusting the tool surface.
- `commands/commands.json` and `commands/osk.md`: slash-command intent map.
  Hosts that do not implement slash commands can still interpret `/osk ...`
  phrases by calling the mapped MCP tool or running the CLI fallback.
- `/osk plugin install profile`: direct read-only route to
  `osk_get_plugin_install_profile` / `openskill-kit agent
  plugin-install-profile`, so harnesses can fetch the machine attach contract
  and current host attachment readiness without parsing broad status output or
  making a second health call.
- `install-guides/codex.md`, `install-guides/claude-code.md`,
  `install-guides/cursor.md`, and `install-guides/generic-mcp.md`: conservative
  host attach notes. They keep existing host config reviewable instead of
  silently writing global settings.
- `openskill-kit agent attach-plugin`: a safe host-config planner that compiles
  the plugin, preserves existing MCP servers/settings, writes only project-local
  config (`.codex/config.toml`, `.mcp.json`, or `.cursor/mcp.json`), and records
  an install receipt on apply.
  Applied config also sets `OPENSKILLKIT_PROJECT_ROOT` so MCP tools still bind
  to the project when a host launches the stdio server from another working
  directory.
  Receipts store the compiled plugin version and MCP descriptor hash used at
  attach time. If the compiled plugin descriptor hash changes later,
  `osk_get_plugin_attach_status` reports `descriptor-drift` until the host
  attachment is previewed and applied again.
  `openskill-kit status --json` and `osk_get_status` report
  `compiled.pluginAttachment` so hosts can show whether the plugin is attached,
  root-bound, missing, invalid JSON, pointed at the wrong command, or stale
  against current descriptors.
  Because OpenCode is the default full harness, attachment status also reports
  `defaultHost`, `defaultHostReady`, and `defaultHostStatus`. `attached=true`
  means at least one host is usable; `defaultHostReady=true` means OpenCode is
  actually ready. Missing OpenCode plugin registration reports
  `plugin-missing`.
  `plugin-install-profile --json` and `osk_get_plugin_install_profile` include
  the same attachment status next to the install contract so bootstrap flows can
  decide whether to preview/apply host config from a single read-only response.

Harness behavior should stay conservative:

- Run `openskill-kit detect` before attaching. It inventories existing project
  harness config such as `.mcp.json`, `.cursor/mcp.json`,
  `.claude/settings.json`, `continue/config.json`, `.codex/config.toml`, and
  `.roo/` so hosts can choose a safe attach target with the real workspace
  footprint in view.
- Load skills and MCP descriptors read-only by default.
- Read `plugin.json.installProfile` before parsing prose guides. It is the
  stable machine contract for first call, MCP command, env binding, command
  routing, approval gates, host config paths, config formats, and host-specific
  attach commands.
- Check `plugin.json.hostCompatibility` for the target host before writing any
  config. Treat preview hosts, currently Cursor rules, as manual-confirmation
  paths even when MCP attachment is supported.
- For Codex, prefer `openskill-kit agent attach-plugin --host codex --dry-run`;
  it updates only the project `.codex/config.toml` `mcp_servers."openskill-kit"`
  section and preserves other Codex settings.
- Compare `plugin.json.integrity.descriptorsHash` with
  `mcp/descriptor-hashes.json` before trusting tool descriptors.
- Treat any `plugin.integrityIssues` returned from `osk_get_status` or
  `openskill-kit status --json` as attach-blocking; regenerate with
  `openskill-kit compile --target plugin`.
- Treat `compiled.pluginAttachment.hosts[*].status == "descriptor-drift"` as
  attach-stale; preview and re-apply host attachment, then restart or refresh
  the harness MCP server.
- Start `openskill-kit-mcp` from the project root with stdio.
- Call `osk_get_status` first; it reports whether the compiled plugin is
  ready, where to attach it, which skills/capabilities are exposed, and which
  approvals remain required.
- Route `/osk ...` requests through `commands/commands.json`; prefer MCP and use
  CLI fallbacks only when the MCP backend is unavailable.
- Keep normal users on the 12 public command families. Treat individual
  low-level commands as implementation details unless an advanced automation
  explicitly needs them.
- For normal coding tasks, route `/osk context` to
  `osk_get_task_context`; it returns the route plan, compact relevant
  preferences, workflow matches, plugin health, plugin install profile status,
  review counts, compact pending review items, action hints, and next actions in
  one harness-friendly response.
  Semantic proposals and OpenWorld review promotions shown there are review
  inputs only; the host must still run learning/update graph and explicit
  review actions before compiling or installing active behavior.
- At task end, route `/osk finish task` to `osk_finish_task` with a short
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
  limitation without parsing Markdown. Use `docs/openworld/proof-levels.md` for
  user-facing proof wording.
- Route `/osk openworld hidden oracle harness` to
  `osk_openworld_hidden_oracle_harness` when a task has denied oracle paths or
  benchmark-readiness metadata. This writes static denied-path exposure proof
  and non-proof benchmark readiness only; it does not read oracle contents or
  claim hidden-oracle benchmark success.
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
  `osk_get_plugin_install_profile` for the machine attach contract,
  `osk_compile_deploy` for public compile/deploy flows, and
  `osk_apply_plugin_attach` only for advanced explicit-approval automation.
- Preview managed instruction files and hooks before applying.
- Require explicit approval for global writes, hook execution, interaction
  imports, and behavior pack imports.
