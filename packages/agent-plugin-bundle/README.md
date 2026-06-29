# OpenSkillKit Agent Plugin

Attachable local-first behavior layer for existing coding harnesses.

## Attach

1. Attach this directory as a local plugin from the project root.
2. Read the matching file under `install-guides/` for OpenCode, Codex, Claude Code, Cursor, or generic MCP hosts.
3. Load `skills/` as repository-scoped skills.
4. Map `/osk ...` requests using `commands/commands.json`; prefer MCP tools and fall back to CLI commands.
5. Start `openskill-kit-mcp` with stdio from the project root when the harness supports MCP.
6. Preview hooks and managed instruction files before applying them.

## Entrypoints

- Skills: `skills`
- Command map: `commands/commands.json`
- Command guide: `commands/osk.md`
- Install guides: `install-guides`
- MCP config: `mcp/server-config.json`
- MCP descriptors: `mcp/descriptors.json`
- MCP public descriptors: `mcp/descriptors.public.json`
- MCP profiles: `mcp/profiles.json`
- MCP descriptor hashes: `mcp/descriptor-hashes.json`
- MCP server: `openskill-kit-mcp` (stdio)
- Hooks: `hooks/hooks.json`
- Behavior artifacts: `behavior`
- Install profile: `openskill-kit.agent-plugin-install-profile.v1`

## Install Profile

- Plugin directory: `.openskill-kit/compiled/plugin`
- First MCP call: `osk_get_status`
- CLI fallback: `openskill-kit status --json`
- MCP server: `openskill-kit` -> `openskill-kit-mcp`
- MCP default profile: `public`
- Required env: `OPENSKILLKIT_PROJECT_ROOT`
- Command routing: `commands/commands.json`
- Attach preview: `openskill-kit agent attach-plugin --host opencode --dry-run`

## Host Attach Matrix

- opencode (supported, opencode-json)
  - Config: `opencode.json`
  - Preview: `openskill-kit agent attach-plugin --host opencode --dry-run`
  - Apply: `openskill-kit agent attach-plugin --host opencode --yes`
  - Status: `openskill-kit agent plugin-status --json`
- codex (supported, codex-toml)
  - Config: `.codex/config.toml`
  - Preview: `openskill-kit agent attach-plugin --host codex --dry-run`
  - Apply: `openskill-kit agent attach-plugin --host codex --yes`
  - Status: `openskill-kit agent plugin-status --json`
- claude-code (supported, mcp-json)
  - Config: `.mcp.json`
  - Preview: `openskill-kit agent attach-plugin --host claude-code --dry-run`
  - Apply: `openskill-kit agent attach-plugin --host claude-code --yes`
  - Status: `openskill-kit agent plugin-status --json`
- cursor (preview, mcp-json)
  - Config: `.cursor/mcp.json`
  - Preview: `openskill-kit agent attach-plugin --host cursor --dry-run`
  - Apply: `openskill-kit agent attach-plugin --host cursor --yes`
  - Status: `openskill-kit agent plugin-status --json`
- generic-mcp (supported, mcp-json)
  - Config: `.mcp.json`
  - Preview: `openskill-kit agent attach-plugin --host generic-mcp --dry-run`
  - Apply: `openskill-kit agent attach-plugin --host generic-mcp --yes`
  - Status: `openskill-kit agent plugin-status --json`

## Commands

Treat `/osk ...` phrases as harness intents. Prefer the mapped MCP tool when available; otherwise run the CLI fallback from the project root.

- `/osk init` -> MCP `osk_get_status`, fallback `openskill-kit init && openskill-kit status`
- `/osk status` -> MCP `osk_get_status`, fallback `openskill-kit status`
- `/osk task` -> MCP `osk_get_task_context`, fallback `openskill-kit osk task context "<task>"`
- `/osk learn` -> MCP `osk_plan_learning_sources`, fallback `openskill-kit osk learn` (approval required)
- `/osk review` -> MCP `osk_review_behavior`, fallback `openskill-kit review` (approval required)
- `/osk research` -> MCP `osk_run_openworld_workflow`, fallback `openskill-kit openworld source-plan --task-id <task-id>`
- `/osk evolve` -> MCP `osk_run_openworld_workflow`, fallback `openskill-kit openworld refine --task-id <task-id> --suite-id <suite-id> --candidate-id <candidate-id>`
- `/osk verify` -> MCP `osk_verify_behavior`, fallback `openskill-kit openworld verifier-quality --task-id <task-id> --suite-id <suite-id>`
- `/osk compile` -> MCP `osk_compile_deploy`, fallback `openskill-kit compile --target plugin`
- `/osk deploy` -> MCP `osk_compile_deploy`, fallback `openskill-kit osk deploy --host opencode` (approval required)
- `/osk eval` -> MCP `osk_run_eval`, fallback `openskill-kit eval`
- `/osk pack` -> MCP `osk_pack_behavior`, fallback `openskill-kit osk pack export` (approval required)

## Host Guides

- OpenCode: `install-guides/opencode.md`
- Codex: `install-guides/codex.md`
- Claude Code: `install-guides/claude-code.md`
- Cursor: `install-guides/cursor.md`
- Generic MCP client: `install-guides/generic-mcp.md`

## Host Compatibility

- opencode (supported)
  - Config: `opencode.json`
  - Instructions: `.opencode/commands, .opencode/skills, .opencode/agents, .opencode/plugins, AGENTS.md`
  - Requires: project `.opencode/commands` support; project `.opencode/plugins` support; project `.opencode/skills` support; stdio MCP client support; agent/subagent config support
- codex (supported)
  - Config: `.codex/config.toml`
  - Instructions: `AGENTS.md`
  - Requires: stdio MCP client support; project-local `.codex/config.toml` support; repository AGENTS.md instruction surface
- claude-code (supported)
  - Config: `.mcp.json`
  - Instructions: `CLAUDE.md and .claude/rules/`
  - Requires: stdio MCP client support; project-local MCP config support; project CLAUDE.md or project skill/rule loading
- cursor (preview)
  - Config: `.cursor/mcp.json`
  - Instructions: `.cursor/rules/`
  - Requires: Cursor MCP server config support; project-local `.cursor/mcp.json` support; manual confirmation for Cursor rule format
- generic-mcp (supported)
  - Config: `.mcp.json`
  - Instructions: `skills/ and commands/commands.json`
  - Requires: stdio MCP client support; working directory or OPENSKILLKIT_PROJECT_ROOT bound to the project root

## Approval Gates

- writing global/user agent instructions
- enabling hooks or command execution
- importing interaction exports or private memories
- installing behavior packs from another project

## Privacy

This bundle excludes private event logs, raw signals, raw prompts, raw diffs, review queues, and private evidence blobs.

Never attach hidden benchmark answers, secrets, user/global memories, or raw interaction exports through this plugin.
