# OpenSkillKit Model Routing

Model routing is project-local policy for choosing which harness model should
run each OpenSkillKit workflow. It is optional but created by `openskill-kit
init` so teams can review and edit it before compiling harness artifacts.

Path:

```text
.openskill-kit/model-routing.json
```

Compiled projections:

```text
.openskill-kit/compiled/plugin/model-routing.resolved.json
.openskill-kit/compiled/plugin/opencode/model-routing.json
.openskill-kit/compiled/plugin/opencode/agents/osk-*.md
```

## Safety

- Project-local only. User/global routing is future opt-in work.
- Invalid JSON, unknown route keys, unknown harness override keys, and schema
  violations are reported by `doctor --full` and block plugin compilation.
- Private-source learning keeps `allowNetworkModelsForPrivateSources` false by
  default.
- Harnesses should treat unknown model IDs as user-review items when
  `requireUserApprovalForModelNotInHost` is true.

## Schema

```json
{
  "schemaVersion": "openskill-kit.model-routing.v1",
  "defaultHarness": "opencode",
  "defaultModel": "default",
  "routes": {
    "router": {},
    "learner": {
      "model": "opencode/gpt-5",
      "fallbackModels": ["default"],
      "reasoningEffort": "medium",
      "temperature": 0.1,
      "maxSteps": 24,
      "permissionsProfile": "learner-safe"
    },
    "reviewer": {},
    "researcher": {},
    "evolver": {},
    "verifier": {},
    "evaluator": {},
    "docs": {}
  },
  "harnessOverrides": {
    "claude-code": {
      "learner": {
        "model": "inherit"
      }
    }
  },
  "safety": {
    "requireUserApprovalForModelNotInHost": true,
    "allowNetworkModelsForPrivateSources": false,
    "redactModelIdsInPublicArtifacts": false
  }
}
```

Route keys are `router`, `learner`, `reviewer`, `researcher`, `evolver`,
`verifier`, `evaluator`, and `docs`.

Supported route fields:

| Field | Purpose |
|---|---|
| `model` | Harness model id for the route. Missing means `defaultModel`. |
| `fallbackModels` | Ordered fallback model ids for harnesses that support fallback. |
| `reasoningEffort` | `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. |
| `temperature` | Number from `0` to `2`. |
| `topP` | Number from `0` to `1`; projected to OpenCode `top_p`. |
| `maxSteps` | Integer from `1` to `200`; projected to OpenCode `steps`. |
| `timeoutMs` | Minimum `1000`; for future harness projections. |
| `permissionsProfile` | Validated safety profile projected into generated OpenCode agent permissions. |
| `notes` | Local notes for maintainers. |

## OpenCode Projection

When compiling the plugin, OpenSkillKit resolves the project file for OpenCode
and writes:

- `.openskill-kit/compiled/plugin/model-routing.resolved.json`
- `.openskill-kit/compiled/plugin/opencode/model-routing.json`
- `.openskill-kit/compiled/plugin/opencode/agents/osk-router.md`
- `.openskill-kit/compiled/plugin/opencode/agents/osk-learner.md`
- `.openskill-kit/compiled/plugin/opencode/agents/osk-reviewer.md`
- `.openskill-kit/compiled/plugin/opencode/agents/osk-researcher.md`
- `.openskill-kit/compiled/plugin/opencode/agents/osk-evolver.md`
- `.openskill-kit/compiled/plugin/opencode/agents/osk-verifier.md`
- `.openskill-kit/compiled/plugin/opencode/agents/osk-evaluator.md`
- `.openskill-kit/compiled/plugin/opencode/agents/osk-docs.md`

OpenCode agent frontmatter receives `model`, `temperature`, `top_p`, `steps`,
`reasoningEffort`, and `permission` when those fields are set. `permissionsProfile`
must be one of these built-in profiles:

| Profile | Permission intent |
|---|---|
| `read-only` | Read/list/grep/glob allowed; edits, network, task, and general shell denied. |
| `learner-safe` | Read allowed, questions allowed, external directories ask, OSK CLI shell patterns ask, edits/network denied. |
| `review-gate` | Read and questions allowed, OSK CLI shell patterns ask, edits/network denied. |
| `research-ask-web` | Read allowed, OSK CLI shell patterns ask, `webfetch` ask, `websearch` denied by default. |
| `evolution-safe` | Read allowed, OSK CLI shell patterns ask, task ask, direct edits/network denied. |
| `sandboxed-verifier` | Read allowed, OSK/test shell patterns ask, edits/network denied. |
| `eval-safe` | Read allowed, OSK/test shell patterns ask, edits/network denied. |
| `docs-safe` | Read allowed, docs markdown edits ask, OSK CLI shell patterns ask, network denied. |

OpenCode agents use singular `permission:` frontmatter. Shell permissions are
generated as pattern maps where supported, so "ask OSK only" remains explicit
instead of becoming broad shell access. OpenCode applies the last matching
permission pattern, so generated catch-all denies appear before specific
`openskill-kit`, `git`, test, or docs patterns.

## Learn v2 Model Agents

Raw-local learning also writes Learn v2-specific OpenCode subagent definitions
under `.openskill-kit/model-routing/opencode-agents/`:

- `osk-learn-v2-evidence-summarizer.md`
- `osk-learn-v2-concept-extractor.md`
- `osk-learn-v2-contradiction-reviewer.md`
- `osk-learn-v2-scope-inferencer.md`
- `osk-learn-v2-declassification-reviewer.md`
- `osk-learn-v2-eval-planner.md`
- `osk-learn-v2-publish-export-auditor.md`

These files use the same OpenCode frontmatter contract as compiled plugin
agents: `mode: subagent`, selected model route fields, and singular
`permission:` maps from the configured permission profile. Learn v2 request
manifests reference the exact agent id/file. The execution boundary remains
sanitized: request bundles and prompts are declassified, `rawRefsIncluded` is
false, and OSK treats model output as untrusted proposal JSON until schema,
evidence-id, path, and leak checks pass.

`openskill-kit osk learn --prepare-model-requests` writes concept-extractor
episode requests. `openskill-kit osk learn --prepare-scope-requests` writes
scope-inferencer concept requests for cards that need clearer conditions,
activation phrases, negative triggers, or narrower scope. `openskill-kit osk
learn --prepare-contradiction-requests` writes contradiction-reviewer conflict
requests for unresolved concept conflicts that have deterministic review ROI.
`openskill-kit osk learn --execute-model-requests` runs prepared sanitized manifests through
`opencode run` with the configured agent id and isolated copies of the
declassified prompt/bundle files in a request-only temporary execution
directory. OSK rejects manifests outside `.openskill-kit/learn-v2/model-requests`,
rejects absolute or traversing request paths, validates prompt/bundle hashes
before execution, validates stdout as strict Learn v2 proposal JSON before
writing request-local `response.json`, and records only byte counts and hashes
for stdout/stderr in the execution report. The inline permission profile denies
shell/edit/write/network/task access; model filesystem reads are limited to the
request-only execution directory rather than the project root. When paired with
`--apply-model-responses`, OSK routes each written response by the executed
manifest `modelRole` so mixed batches can apply concept-extractor,
scope-inferencer, and contradiction-reviewer outputs through their matching
validators in one pass.

Concept-extractor responses merge through `--model-output`. Scope-inferencer
responses merge through `--scope-output`, and can only add validated
applies/does-not-apply conditions, narrow paths, task types, activation hints,
negative triggers, safe command hints, and card-local counterevidence. Broader
paths, absolute/local paths, unsafe command strings, invalid evidence ids,
tampered prompt/bundle hashes, wrong response paths, malformed JSON, and
secret-like content are rejected before concept store mutation.
Contradiction-reviewer responses merge through `--contradiction-output`. They
can add validated counterevidence immediately, but supersession and narrowing
only apply when the deterministic conflict ledger already grants
`auto-supersede` or `auto-narrow` authority; broader scopes, protected concepts,
invalid concept/evidence ids, human-review findings, and unsafe content are
rejected. Raw-to-model execution remains rejected; `opencode-host-raw-allowed`
is reserved for a future policy.

## Validation

Run `doctor --full` before setup or compile when editing this file by hand:

```bash
npx openskill-kit doctor --full
```

Compilation also validates routing and stops before writing plugin artifacts:

```bash
npx openskill-kit compile --target plugin
npx openskill-kit osk compile
```

Compilation reads `.openskill-kit/model-routing.json`, validates schema and
bounds, and fails before writing a plugin if the file is invalid. Unknown route
keys such as `learn` instead of `learner`, misspelled fields such as `maxStep`,
unknown `permissionsProfile` labels such as `learner-sfae`, and unknown
harness override names are treated as errors instead of silently being ignored.
