# Concepts

## Adaptive Skill Graph

Project-local behavior knowledge learned from agent work, user feedback,
repository conventions, commands, tests, and reviews.

## Behavior Profile

Persisted preference model for a project or user. In v1 it is
`.openskill-kit/preferences/graph.json`.

## Preference Kernel

Deterministic engine that turns signals into confidence-scored Preference Nodes,
detects conflicts, and supports review decisions.

## Preference Node

One learned rule, habit, or workflow. Each node has confidence, scope, status,
category, and evidence. Evidence links to sanitized Evidence Cards rather than
raw prompts or raw diffs.

New nodes carry v2 metadata: strength (`must`, `should`, `may`, `must-not`),
exceptions, privacy class, compile target rationale, and lifecycle state. Older
v1 nodes migrate on read so existing graphs keep working.

## Evidence Card

Small JSON proof object under `.openskill-kit/evidence/cards/`. A card records
which signal/event supports a preference, optional redacted quote, file, command,
scope, source event IDs, evidence kind, privacy class, hash, and redaction
metadata. It never includes raw private prompts.

## Memory Integrity

Validation pass that checks preferences before they become active behavior. It
flags missing evidence, prompt-injection markers, hidden-behavior instructions,
unsafe destructive command preferences, global promotions, and conflicts with
locked active behavior.

## Calibration

Review-outcome reliability model. Activating or locking candidates increases
category, extractor, scope, evidence kind, and privacy-class reliability;
rejecting or demoting lowers those dimensions. Behavior eval runs also record
pass/fail and pass-rate outcomes. Future graph updates use the populated
dimensions to downweight weak signal sources without inventing reliability for
dimensions that have no history yet.

## Extractor Registry

Signal extraction runs through named extractors, including explicit preference,
rejection/correction, accepted output, edit delta, review comment, command
habit, test outcome, repo pattern, semantic proposal, and contradiction
extractors. Named extractors let calibration identify which source is reliable.

## Retrieval Trace

Every preference retrieval includes inferred languages, task types, considered
preference count, included IDs, omitted reasons, and budget usage. Results are
progressively grouped as critical, focused, supporting, or background, then
packed into the requested line budget with over-budget omissions recorded in the
trace. This keeps dynamic behavior injection explainable and helps tune context
budget without guessing.

## Baseline Compare Eval

Deterministic replay that compares a baseline prompt-only plan with the current
OpenSkillKit-enabled retrieval and compiled command policy. It is not a live
external-agent benchmark, but it gives a local scorecard for preference
adherence before adding heavier A/B infrastructure.

## Skill Facet

A grouped domain of related preferences such as testing, security, frontend, or
workflow.

## Dynamic Skill Shard

Generated category-specific skill such as `project-testing` or
`project-architecture`. Shards let agents load only the behavior needed for a
task instead of the broad project behavior skill.

## Context Pack

Compact markdown summary of active project behavior for agent sessions.

## Active Behavior Layer

Reviewed preferences currently applied to agent behavior and compiled outputs.

## Learning Review

Manual review step where candidate preferences are activated, rejected, or
locked.

`openskill-kit review --tui` opens a terminal queue for small batches. Use
`a N`, `r N`, `l N`, or `d N` to activate, reject, lock, or demote a numbered
candidate. Use `e N` to inspect sanitized evidence cards, `p N` to preview
compile/privacy metadata, and `c` to inspect calibration reliability before
deciding.

## Project Behavior Pack

Shareable, privacy-preserving bundle containing reviewed behavior artifacts and
compiled agent-facing outputs.
