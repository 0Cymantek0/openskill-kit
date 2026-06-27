# OpenSkillKit Command Map

When a user writes an `/osk ...` phrase, treat it as an intent for this plugin.
Prefer MCP because it returns structured status and readiness data. If MCP is
unavailable, run the CLI fallback from the project root.

Do not enable hooks, write global instructions, import private interactions, or
import behavior packs without explicit user approval.

## Commands

### /osk init

- MCP tool: `osk_bootstrap_session`
- CLI fallback: `openskill-kit init && openskill-kit status`

### /osk status

- MCP tool: `osk_bootstrap_session`
- CLI fallback: `openskill-kit status`

### /osk learn from this session

- MCP tool: `osk_learn_from_session`
- CLI fallback: `openskill-kit learn`

### /osk explain why you learned this

- MCP tool: `osk_explain_preference`
- CLI fallback: `openskill-kit explain <preference-id>`

### /osk review pending behavior

- MCP tool: `osk_get_review_queue`
- CLI fallback: `openskill-kit review`

### /osk update skills

- MCP tool: `osk_compile_behavior_layer`
- CLI fallback: `openskill-kit compile --target agent-skills`

### /osk update AGENTS.md

- MCP tool: `osk_compile_behavior_layer`
- CLI fallback: `openskill-kit compile --target project-rules`

### /osk install hooks

- MCP tool: `osk_install_agent_hooks`
- CLI fallback: `openskill-kit hooks install --dry-run`
- Explicit approval required: `yes`

### /osk run behavior eval

- MCP tool: `osk_run_behavior_eval`
- CLI fallback: `openskill-kit eval`

### /osk evolve this skill

- MCP tool: `none; use CLI fallback`
- CLI fallback: `openskill-kit evolve "<topic>" --no-llm`

### /osk sync project behavior pack

- MCP tool: `osk_export_behavior_pack`
- CLI fallback: `openskill-kit pack export`
- Explicit approval required: `yes`
