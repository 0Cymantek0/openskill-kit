# OpenWorld Proof Levels

OpenSkillKit separates verifier evidence from benchmark proof. This matters for
daily harness use because `/osk research`, `/osk evolve`, and `/osk verify`
produce useful artifacts, but they must not be presented as hidden benchmark
success.

## Current Levels

| Level | Meaning | Can Promote Behavior? | Hidden-Oracle Proof? |
|---|---|---:|---:|
| `not-proof` | Missing or failed verifier evidence. | No | No |
| `artifact-verifier` | Source-grounded virtual verifier artifacts passed enough checks for review. | Review-only | No |
| `static-denied-path` | Generated artifacts were scanned for denied oracle path exposure. | No | No |
| `review-proposal` | A passed OpenWorld run was converted into a candidate review proposal. | Only after review accepts it | No |
| `hidden-oracle-proof` | Reserved for a future isolated hidden-oracle runner and safe result import path. | Future only | Yes, when implemented |

Today OpenSkillKit writes `hiddenOracleProof: false` for OpenWorld reports. The
only accepted exception is future work that runs an isolated hidden-oracle
benchmark outside the candidate-generation loop and imports only safe result
metadata.

## Artifact-Verifier Evidence

`artifact-verifier` means OpenSkillKit has local, auditable artifacts such as:

- Source Cards with provenance and trust metadata.
- Anchor Cards linked to source claims.
- Visible and holdout virtual verifier suites.
- Verifier execution results.
- Verifier quality reports.
- EvolutionRun records with pass/fail summaries.
- Eval reports that state limitations.
- Optional static denied-path harness reports.

This can support a review decision. It does not prove the candidate works on a
hidden target task, does not prove cross-agent transfer, and does not bypass
Learning Review.

## Static Denied-Path Harness

`openworld hidden-oracle-harness` scans generated artifacts for forbidden path
or identifier exposure. It intentionally does not read oracle files. In local
process mode it does not enforce operating-system path denial. It is useful
leakage evidence, not benchmark evidence.

## Promotion Boundary

`openworld promote-review` creates a review-only proposal from a passed run. It
does not activate behavior. Activation still requires `/osk review` or an
equivalent explicit review action.

## Harness Copy Rules

Use these phrases in harness UI and docs:

- “Ready for review from artifact verifier evidence.”
- “Hidden-oracle proof: no.”
- “Promotion proposal only; not active behavior.”

Avoid these phrases unless a future isolated benchmark runner exists:

- “Benchmark-proven.”
- “Hidden-oracle passed.”
- “Guaranteed correct.”
- “Automatically learned.”

## Evidence Checklist

Before showing “ready for review,” require:

- at least one visible verifier pass;
- at least one holdout verifier pass;
- an artifact eval report;
- no overfit risk in the latest report;
- proof summary `promotionEligible: true`;
- proof summary `hiddenOracleProof: false`;
- explicit next action that sends the user to review.
