# OpenCode Attach Guide

Host: OpenCode

## Steps

1. Compile the plugin with `openskill-kit compile --target plugin`.
2. Review generated `.opencode/commands`, `.opencode/skills`, `.opencode/agents`, and `.opencode/plugins` under the compiled plugin.
3. Use `openskill-kit agent attach-plugin --host opencode --dry-run` to preview `opencode.json` and `.opencode/*` project writes.
4. Apply with `--yes` only after reviewing the diff, then restart OpenCode.
5. Run `/osk status` before relying on learned behavior.

## Safety Notes

- OpenCode is the primary full-feature target for command files, skills, learner subagent, plugin metadata hooks, and MCP.
- Generated hooks store metadata only by default and never raw prompts or raw diffs.

## Required First Call

Call `osk_bootstrap_session` before using learned behavior. If MCP is unavailable, run `openskill-kit status --json` from the project root.
