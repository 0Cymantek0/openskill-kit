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
  ".openskill-kit/learn-v2/activation-runs/",

  // Generated model request/response artifacts
  ".openskill-kit/learn-v2/model-requests/",
  ".openskill-kit/learn-v2/model-responses/",

  // Declassified but still local learning artifacts
  ".openskill-kit/learn-v2/concepts/",
  ".openskill-kit/learn-v2/declassified-snippets/",
  ".openskill-kit/learn-v2/conflicts/",
  ".openskill-kit/learn-v2/drift/",
  ".openskill-kit/learn-v2/observability/",
  ".openskill-kit/learn-v2/evidence-quality/",
  ".openskill-kit/learn-v2/source-gate/",

  // Compiled/preview local output
  ".openskill-kit/learn-v2/compiled-preview/",

  // Generated model routing artifacts
  ".openskill-kit/model-routing/"
];

export const LEARN_V2_GENERATED_FILES = [
  ".openskill-kit/learn-v2/activation-index.json",
  ".openskill-kit/learn-v2/relevance-calibration.json"
];

export function getCleanedLearnV2Paths(): { dirs: string[]; files: string[] } {
  return {
    dirs: LEARN_V2_GENERATED_DIRS.map((p) => p.replace(/^\/+/, "").replace(/\/+$/, "")),
    files: LEARN_V2_GENERATED_FILES.map((p) => p.replace(/^\/+/, ""))
  };
}
