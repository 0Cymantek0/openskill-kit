# Agent Installation Guide: Automated Setup for AI Coding Agents

This guide is designed for LLMs and autonomous coding agents (e.g., Claude Code, Codex, OpenCode subagents, Roo, Cline, etc.) who are requested by a user to install or set up OpenSkillKit in an OpenCode workspace.

If a user pastes the link to this repository and asks you to "set it up," follow the instructions below step-by-step to automate the setup process on their system.

---

## 1. System Requirements Verification

Before executing any install commands, verify the user's workspace environment:

1. **Node.js**: Ensure Node.js is installed (`node -v` >= 18).
2. **Git**: Ensure Git is installed (`git --version`).
3. **OpenCode Project Context**: Verify that `opencode.json`, `opencode.jsonc`, or a `.opencode/` folder is present in the workspace root. If not, prompt the user: *"No OpenCode project found in the current folder. Do you want me to initialize an OpenCode project first?"*

---

## 2. Step-by-Step Installation Algorithm

Execute the following commands sequentially in the workspace root. If any command fails, stop and report the error details to the user.

### Step 2.1: Build OpenSkillKit
If you are running in a cloned copy of the repository:
```bash
npm install
npm run build
```

### Step 2.2: Initialize OSK State
Run the initialization tool to generate `.openskill-kit/` directory and configure project scope:
```bash
npx openskill-kit init
```

### Step 2.3: Compile Plugin Bundle
Compile the active behavior layers, commands schema, agent profiles, and plugin wrappers:
```bash
npx openskill-kit compile --target plugin
```

### Step 2.4: Attach to OpenCode
Run the attach command to merge the compiled plugin into the project's OpenCode workspace:
```bash
npx openskill-kit agent attach-plugin --host opencode --yes
```

### Step 2.5: Install Telemetry Hooks
Ambient hooks monitor file changes and command outcomes for learning. Install them:
```bash
npx openskill-kit agent install-hooks --target project --yes
```

### Step 2.6: Install Instruction Manifests
Mount instruction blocks into root files (e.g. `AGENTS.md` / `CLAUDE.md`) so the host agent knows how to interact with OSK:
```bash
npx openskill-kit agent install-manifests --target project --yes
```

---

## 3. Post-Installation Verification Check

Verify that the installation was successful by running the OSK status tool and checking the file system:

1. Run the status diagnostic tool:
   ```bash
   npx openskill-kit status --explain
   ```
2. Verify the existence of the following files:
   - `opencode.json` (should contain `"openskill-kit"` inside `"mcp"` server block, and `".opencode/plugins/openskillkit.ts"` inside `"plugin"`)
   - `.opencode/commands/osk-*.md` (should contain 12 files: `osk-init.md`, `osk-status.md`, `osk-task.md`, `osk-learn.md`, `osk-review.md`, `osk-research.md`, `osk-evolve.md`, `osk-verify.md`, `osk-compile.md`, `osk-deploy.md`, `osk-eval.md`, `osk-pack.md`)
   - `.opencode/agents/osk-*.md` (should contain 8 files: `osk-router.md`, `osk-learner.md`, `osk-reviewer.md`, `osk-researcher.md`, `osk-evolver.md`, `osk-verifier.md`, `osk-evaluator.md`, `osk-docs.md`)
   - `.opencode/plugins/openskillkit.ts`
3. Prompt the user:
   > "Setup complete! Please restart OpenCode to reload the new configuration. You can verify attachment inside OpenCode by running `/osk status`."

---

## 4. Automated Uninstallation Algorithm

If the user asks to uninstall or remove OpenSkillKit, execute these cleanup steps automatically:

### Step 4.1: Revert Configuration Patches
Remove OSK entries from `opencode.json`:
1. Remove `"openskill-kit"` from the `"mcp"` object.
2. Remove `".opencode/plugins/openskillkit.ts"` from the `"plugin"` array.

### Step 4.2: Delete Generated Files
Execute the following file deletions:
```bash
# Delete command markdown templates
rm .opencode/commands/osk-*.md

# Delete agent description templates
rm .opencode/agents/osk-*.md

# Delete telemetry plugin and skills
rm .opencode/plugins/openskillkit.ts
rm -rf .opencode/skills/osk-*
rm -rf .openskill-kit/compiled/
```

### Step 4.3: Ask to Preserve Behavior Database
Ask the user if they want to preserve their local learning history under `.openskill-kit/`:
- If yes, preserve `.openskill-kit/`.
- If no, run:
  ```bash
  rm -rf .openskill-kit/
  ```
