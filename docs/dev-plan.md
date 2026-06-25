# Development Plan

OpenSkillKit is now a local-first project behavior runtime. Work should keep
the adaptive loop small, reviewable, privacy-preserving, and usable from CLI,
MCP, generated skills, hooks, and packs.

## Current Product Spine

1. Capture redacted lifecycle events.
2. Extract deterministic and structured proposal signals.
3. Update evidence-backed Preference Nodes.
4. Review, edit, merge, split, promote, demote, lock, or reject candidates.
5. Retrieve active preferences by task and path relevance.
6. Compile compact behavior artifacts.
7. Install generated project behavior.
8. Evaluate adherence with realistic scenario checks.
9. Export, sign, inspect, diff, review, and apply Project Behavior Packs.
10. Maintain long-lived state with status, doctor, compact, prune, archive, and reset.

## Engineering Rules

- Core never imports adapter packages.
- Adapters do not duplicate core logic.
- No network, telemetry, or hosted model call by default.
- Raw prompts, raw diffs, secrets, event logs, and signals stay private unless
  config explicitly allows otherwise.
- Generated skills keep `SKILL.md` concise and put detailed context in
  references.
- Tests use temp directories and fake homes only.
- Installer never writes hooks or imported behavior without explicit approval.

## Next Depth

- Expand golden behavior scenario packs by domain.
- Add more scope inference from paths, languages, and task type.
- Add confidence calibration from accepted reviews and eval outcomes.
- Add richer import review summaries for contributor onboarding.
- Keep release checks fast enough to run on every commit.
