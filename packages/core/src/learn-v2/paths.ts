export const LEARN_V2_GENERATED_DIRS = [
  // Local raw/private state
  ".openskill-kit/events/",
  ".openskill-kit/signals/",
  ".openskill-kit/interactions/",
  ".openskill-kit/evidence/blobs/",
  ".openskill-kit/private-vault/",
  ".openskill-kit/raw-vault/",
  ".openskill-kit/learn-v2/raw-vault/",

  // Local generated analysis
  ".openskill-kit/learning/analysis-frames/",
  ".openskill-kit/learning/staged-imports/",
  ".openskill-kit/learning/digests/",
  ".openskill-kit/learn-v2/analysis/",
  ".openskill-kit/learn-v2/episodes/",

  // Local review/eval/telemetry
  ".openskill-kit/reviews/",
  ".openskill-kit/evals/runs/",
  ".openskill-kit/reports/",
  ".openskill-kit/learn-v2/review/",
  ".openskill-kit/learn-v2/evals/",
  ".openskill-kit/learn-v2/outcomes/",
  // Local hashed activation telemetry (schema version, query hash, sorted path
  // hashes, sorted command hashes, task types, include-candidates flag,
  // negative-signal hashes, index/match/suppressed counts, matched concept
  // ids). Written by `recordLearnV2ConceptActivationRun`; consumed locally by
  // drift detection + activation diagnostics. Raw query text, raw paths, and
  // raw commands are never recorded. Project-local, gitignored, and excluded
  // from compile/pack/sync/plugin outputs by `getCleanedLearnV2Paths`.
  ".openskill-kit/learn-v2/activation-runs/",

  // Generated model request/response artifacts
  ".openskill-kit/learn-v2/model-requests/",
  ".openskill-kit/learn-v2/model-responses/",

  // Declassified but still local learning artifacts
  ".openskill-kit/learn-v2/concepts/",
  ".openskill-kit/learn-v2/declassified-snippets/",
  ".openskill-kit/learn-v2/counterevidence/",
  ".openskill-kit/learn-v2/conflicts/",
  ".openskill-kit/learn-v2/drift/",
  ".openskill-kit/learn-v2/observability/",
  ".openskill-kit/learn-v2/evidence-quality/",
  ".openskill-kit/learn-v2/source-gate/",
  ".openskill-kit/learn-v2/conditional-learning/",
  ".openskill-kit/learn-v2/skill-ontology/",
  ".openskill-kit/learn-v2/open-world-grounding/",
  ".openskill-kit/learn-v2/concept-debug-trace/",
  ".openskill-kit/learn-v2/outcome-policy/",

  // Compiled/preview local output
  ".openskill-kit/learn-v2/compiled-preview/",

  // Generated model routing artifacts
  ".openskill-kit/model-routing/"
];

export const LEARN_V2_GENERATED_FILES = [
  ".openskill-kit/learn-v2/index.json",
  ".openskill-kit/learn-v2/index.md",
  ".openskill-kit/learn-v2/activation-index.json",
  ".openskill-kit/learn-v2/relevance-calibration.json"
];

export interface LearnV2StableArtifactPath {
  key: string;
  label: string;
  relativePath: string;
  kind: "file" | "directory" | "glob";
  lifecycle: "canonical" | "review" | "debug" | "telemetry" | "model-request" | "compiled-preview";
  sharePolicy: "shareable-reviewed" | "local-only" | "local-declassified" | "prompt-safe-request";
  cli: string;
  mcpTool?: string;
  notes: string[];
}

export interface LearnV2ArtifactPathManifest {
  schemaVersion: "openskill-kit.learn-v2.artifact-path-manifest.v1";
  stablePaths: LearnV2StableArtifactPath[];
  teamSharing: {
    reviewedConcepts: string;
    localOnly: string[];
    compileCommand: string;
    exportCommand: string;
  };
  productionInstall: {
    hiddenAssumptions: string[];
    requiredStartup: string[];
  };
  nextActions: string[];
}

export const LEARN_V2_STABLE_ARTIFACT_PATHS: LearnV2StableArtifactPath[] = [
  {
    key: "product-index",
    label: "Learn v2 product index",
    relativePath: ".openskill-kit/learn-v2/index.md",
    kind: "file",
    lifecycle: "debug",
    sharePolicy: "local-declassified",
    cli: "openskill-kit osk learn --raw --surface-file <path>",
    notes: ["Single local product map linking source, evidence, learning, review, activation, eval, debug, model, and privacy artifacts."]
  },
  {
    key: "concept-store",
    label: "Canonical Learn v2 concept store",
    relativePath: ".openskill-kit/learn-v2/concepts/store.json",
    kind: "file",
    lifecycle: "canonical",
    sharePolicy: "local-declassified",
    cli: "openskill-kit osk learn --extract-concepts",
    mcpTool: "osk_get_concept_store",
    notes: ["Holds candidate/reviewed concept cards; raw refs remain local identifiers, not shareable evidence."]
  },
  {
    key: "review-queue",
    label: "Concept review queue",
    relativePath: ".openskill-kit/learn-v2/review/concept-review-queue.md",
    kind: "file",
    lifecycle: "review",
    sharePolicy: "local-declassified",
    cli: "openskill-kit osk review --write",
    mcpTool: "osk_get_concept_review_queue",
    notes: ["Primary developer UX for accepting, rejecting, narrowing, and locking reviewed concepts."]
  },
  {
    key: "compile-preview",
    label: "Compiled concept preview",
    relativePath: ".openskill-kit/learn-v2/compiled-preview/concept-compile-preview.md",
    kind: "file",
    lifecycle: "compiled-preview",
    sharePolicy: "shareable-reviewed",
    cli: "openskill-kit osk learn --extract-concepts && openskill-kit osk review --concept-accept <id>",
    notes: ["Preview of reviewed behavior that can feed skills, command policy, review checklist, and MCP resources."]
  },
  {
    key: "source-gate",
    label: "Source gate review",
    relativePath: ".openskill-kit/learn-v2/source-gate/source-gate-review.md",
    kind: "file",
    lifecycle: "debug",
    sharePolicy: "local-declassified",
    cli: "openskill-kit osk learn --debug-source",
    notes: ["Shows accepted, rejected, and ask-for-review sources without exporting raw source contents. Produced by --raw --surface-file <path>."]
  },
  {
    key: "episode-store",
    label: "Reconstructed task episode store",
    relativePath: ".openskill-kit/learn-v2/episodes/store.json",
    kind: "file",
    lifecycle: "debug",
    sharePolicy: "local-only",
    cli: "openskill-kit osk learn --debug-episode <episodeId>",
    notes: ["Local episode stitching source. Use --debug-episode for declassified summaries; do not pack, compile, or share the raw store."]
  },
  {
    key: "conditional-learning",
    label: "Conditional learning traces",
    relativePath: ".openskill-kit/learn-v2/conditional-learning/conditional-learning-*.md",
    kind: "glob",
    lifecycle: "debug",
    sharePolicy: "local-declassified",
    cli: "openskill-kit osk learn --debug-learning",
    notes: ["Observation, factor, hypothesis, and memory-admission audit trail. Produced by --raw --surface-file <path>."]
  },
  {
    key: "skill-ontology",
    label: "Emergent skill ontology",
    relativePath: ".openskill-kit/learn-v2/skill-ontology/skill-ontology-*.md",
    kind: "glob",
    lifecycle: "debug",
    sharePolicy: "local-declassified",
    cli: "openskill-kit osk learn --debug-ontology",
    notes: ["Dynamic namespace candidates plus create/merge/split/attach operations."]
  },
  {
    key: "open-world-grounding",
    label: "Open-world grounding",
    relativePath: ".openskill-kit/learn-v2/open-world-grounding/open-world-grounding-*.md",
    kind: "glob",
    lifecycle: "debug",
    sharePolicy: "local-declassified",
    cli: "openskill-kit osk learn --debug-grounding",
    notes: ["Local project anchors first, then authority-tiered external resources."]
  },
  {
    key: "concept-debug-trace",
    label: "Concept debug trace",
    relativePath: ".openskill-kit/learn-v2/concept-debug-trace/concept-debug-trace-*.md",
    kind: "glob",
    lifecycle: "debug",
    sharePolicy: "local-declassified",
    cli: "openskill-kit osk learn --raw --surface-file <path>",
    notes: ["Joined why-learned, why-active, ontology, grounding, review, and outcome policy trace."]
  },
  {
    key: "outcome-policy",
    label: "Outcome policy",
    relativePath: ".openskill-kit/learn-v2/outcome-policy/outcome-policy-*.md",
    kind: "glob",
    lifecycle: "debug",
    sharePolicy: "local-declassified",
    cli: "openskill-kit osk learn --record-concept-outcome <id> --concept-outcome wrong",
    notes: ["Suppression and demotion decisions from local outcome telemetry."]
  },
  {
    key: "observability",
    label: "Pipeline observability dashboard",
    relativePath: ".openskill-kit/learn-v2/observability/pipeline-observability-*.json",
    kind: "glob",
    lifecycle: "debug",
    sharePolicy: "local-declassified",
    cli: "openskill-kit osk learn --observability",
    notes: ["Single dashboard entry point for Learn v2 run counts, gates, health, and artifact pointers."]
  },
  {
    key: "behavior-agent-eval",
    label: "Agent-backed behavior eval",
    relativePath: ".openskill-kit/learn-v2/evals/agent/behavior-agent-eval-*.md",
    kind: "glob",
    lifecycle: "debug",
    sharePolicy: "local-declassified",
    cli: "openskill-kit osk learn --prepare-behavior-eval-requests --learn-v2-goldens <goldens.json>",
    notes: [
      "Validated behavior-evaluator results compare baseline and learned-behavior plans for configured behavior-delta goldens.",
      "Use with --learn-v2-agent-eval during --run-learn-v2-eval to mark agent-backed behavior judgment in the proof boundary."
    ]
  },
  {
    key: "model-requests",
    label: "Prompt-safe model request manifests",
    relativePath: ".openskill-kit/learn-v2/model-requests/*/request-manifest.json",
    kind: "glob",
    lifecycle: "model-request",
    sharePolicy: "prompt-safe-request",
    cli: "openskill-kit osk learn --prepare-model-requests",
    notes: ["Sanitized model request boundary; raw evidence is not sent directly."]
  },
  {
    key: "raw-vault",
    label: "Raw evidence vault",
    relativePath: ".openskill-kit/learn-v2/raw-vault/",
    kind: "directory",
    lifecycle: "telemetry",
    sharePolicy: "local-only",
    cli: "openskill-kit osk learn --raw-vault-status",
    notes: ["Project-local raw evidence retention; never pack, compile, or share."]
  }
];

export function getLearnV2ArtifactPathManifest(): LearnV2ArtifactPathManifest {
  return {
    schemaVersion: "openskill-kit.learn-v2.artifact-path-manifest.v1",
    stablePaths: LEARN_V2_STABLE_ARTIFACT_PATHS,
    teamSharing: {
      reviewedConcepts: "Share reviewed behavior through compiled packs, skills, MCP resources, and project behavior exports; do not share raw vault, activation telemetry, model responses, or local debug blobs.",
      localOnly: LEARN_V2_STABLE_ARTIFACT_PATHS
        .filter((item) => item.sharePolicy === "local-only")
        .map((item) => item.relativePath),
      compileCommand: "openskill-kit osk compile --target context-pack --target agent-skills --target mcp-resources --target project-rules",
      exportCommand: "openskill-kit osk pack export"
    },
    productionInstall: {
      hiddenAssumptions: [
        "Run commands from project root or set OPENSKILLKIT_PROJECT_ROOT for MCP.",
        "Use reviewed/compiled artifacts for team sharing; local generated Learn v2 directories stay gitignored.",
        "Use --raw-vault-status/--gc-raw-vault for retention before long-running production use."
      ],
      requiredStartup: [
        "openskill-kit init",
        "openskill-kit osk learn --artifact-paths",
        "openskill-kit agent attach-plugin --host <host> --dry-run",
        "openskill-kit osk compile --target context-pack --target agent-skills --target mcp-resources --target project-rules"
      ]
    },
    nextActions: [
      "Use CLI or MCP artifact-path manifest as the stable integration contract.",
      "Inspect review/debug artifacts locally; compile reviewed concepts before sharing with a team.",
      "Keep raw vault and activation telemetry local-only."
    ]
  };
}

export function getCleanedLearnV2Paths(): { dirs: string[]; files: string[] } {
  return {
    dirs: LEARN_V2_GENERATED_DIRS.map((p) => p.replace(/^\/+/, "").replace(/\/+$/, "")),
    files: LEARN_V2_GENERATED_FILES.map((p) => p.replace(/^\/+/, ""))
  };
}
