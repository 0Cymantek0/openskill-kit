# Adaptive Skill Graph

The Adaptive Skill Graph is the default OpenSkillKit workflow.

1. `init` creates project state.
2. `observe` records redacted lifecycle events.
3. `learn` extracts signals and updates the Behavior Profile.
4. `review` activates or rejects candidates.
5. `compile` writes agent-facing artifacts.
6. `install` attaches the compiled project behavior skill.
7. `pack` exports reviewed behavior without private event logs.

The graph is intentionally symbolic in v1. It does not train a model. It gives
the host agent inspectable, scoped, evidence-backed project behavior.
