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
| `topP` | Number from `0` to `1`. |
| `maxSteps` | Integer from `1` to `200`; projected to OpenCode `steps`. |
| `timeoutMs` | Minimum `1000`; for future harness projections. |
| `permissionsProfile` | Human-readable safety profile label. |
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

OpenCode agent frontmatter receives `model`, `temperature`, `steps`, and
`reasoning` when those fields are set. Permissions still come from the OSK
safety profile in code, not from arbitrary user JSON.

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
and unknown harness override names are treated as errors instead of silently
being ignored.
