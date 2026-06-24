# ADR 0001: Adaptive Skill Graph

## Status

Accepted.

## Context

Manual topic-driven skill scaffolding is useful but does not solve repeated
agent drift in real projects. Agents need project-specific behavior that is
learned from work, reviewable like code, and exposed through existing agent
surfaces.

## Decision

OpenSkillKit uses a local-first Adaptive Skill Graph as the primary product
loop. Events become signals. Signals update a confidence-scored Behavior
Profile. Reviewed preferences become the Active Behavior Layer and compile into
Context Packs, Agent Skills, hooks, MCP resources, and Project Behavior Packs.

## Consequences

- Raw private data stays local and ignored by default.
- Every learned behavior must have evidence.
- The compiler must keep outputs deterministic and reviewable.
- Legacy topic-based scaffolding remains available as compatibility, not the
  main workflow.
