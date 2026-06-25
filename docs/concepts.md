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

## Evidence Card

Small JSON proof object under `.openskill-kit/evidence/cards/`. A card records
which signal/event supports a preference, optional redacted quote, file, command,
scope, and privacy metadata. It never includes raw private prompts.

## Memory Integrity

Validation pass that checks preferences before they become active behavior. It
flags missing evidence, prompt-injection markers, hidden-behavior instructions,
unsafe destructive command preferences, global promotions, and conflicts with
locked active behavior.

## Calibration

Review-outcome reliability model. Activating or locking candidates increases
category/extractor reliability; rejecting or demoting lowers it. Future graph
updates use this reliability to downweight weak signal sources.

## Skill Facet

A grouped domain of related preferences such as testing, security, frontend, or
workflow.

## Context Pack

Compact markdown summary of active project behavior for agent sessions.

## Active Behavior Layer

Reviewed preferences currently applied to agent behavior and compiled outputs.

## Learning Review

Manual review step where candidate preferences are activated, rejected, or
locked.

## Project Behavior Pack

Shareable, privacy-preserving bundle containing reviewed behavior artifacts and
compiled agent-facing outputs.
