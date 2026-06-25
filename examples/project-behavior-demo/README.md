# Project Behavior Demo

This static fixture shows the intended before and after for a project behavior
pack.

## Scenario

Task: change parser token handling in `src/parser/tokenizer.ts`.

Learned preferences:

- Prefer preserving user-edited patterns in `src/parser/tokenizer.ts`.
- Prefer repeated successful command: `npm test -- parser`.
- Do not repeat rejected agent approach: broad rewrite that ignores parser
  boundaries.

## Before Behavior Layer

Plan:

- Rewrite parser module broadly.
- Run one broad test at the end.
- Ignore prior user edit history.

Result: fails review because it repeats rejected broad-rewrite behavior and does
not use scoped parser evidence.

## After Behavior Layer

Plan:

- Retrieve path-scoped parser preferences before editing.
- Keep existing helper boundaries.
- Make minimal tokenizer change.
- Run `npm test -- parser`.
- Check review checklist for negative preferences before final response.

Result: passes behavior eval because retrieval, plan, command policy, avoidance,
and privacy checks all line up.
