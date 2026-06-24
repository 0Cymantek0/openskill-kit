# Security Model

Threats:

- prompt injection inside generated skills
- instructions to hide behavior or override higher-priority instructions
- credential access or exfiltration
- destructive shell commands
- unsafe global install behavior
- obfuscated script execution

Generated skills are untrusted until audited. Critical findings block install
unless explicitly overridden.

The scanner is a first-pass filter, not a proof of safety. Users must review
generated skills before trusting them.

Evidence ledgers and verifier packs are auditable artifacts. They record local
source provenance and deterministic assertions, but they are not hidden benchmark
truth and do not prove downstream agent performance.

Each draft also writes `leakage-audit.json`. Explicit `--evidence-file` and
`--evidence-url` inputs are checked for hidden-test, oracle, ground-truth, and
reference-solution markers before they can enter the ledger or generated
references. Existing public repository tests remain allowed observable context.
URL evidence is opt-in, capped, timed out, text-only, and recorded as
unverified external evidence.

Repository command checks are recorded in verifier packs but only executed when
the caller passes `--run-repo-checks` or equivalent adapter input. They run
through the local sandbox runner: no shell, constrained cwd, stripped secret
environment variables, timeout, and output cap.

Sandbox policies now support `local-process` and `docker` modes. Docker mode
uses `docker run --rm`, mounts the project at `/workspace`, preserves the command
allowlist, and maps `allowNetwork=false` to `--network none`. Docker execution is
optional because local Docker daemons may be unavailable.

Verifier execution reports split visible and holdout assertions. In the current
implementation both groups are local deterministic package checks; future
sandboxed evolution can use the split without changing report consumers.

Evaluation reports aggregate verifier, leakage, repository-command, and mutation
gates. They are readiness reports for the generated skill package, not private
benchmark results or proof of downstream agent task success.

The current sandbox runner is `local-process`: no shell, cwd containment,
allowlisted commands, redacted env, timeout, and output caps. It is not an
OS-enforced container. Treat untrusted scripts as unsafe until a container runner
is enabled and reviewed.

Generated fixture checks are authored by OpenSkill-Kit and run by the verifier.
Skill helper scripts from users or third parties are not executed by install and
must be separately reviewed.
