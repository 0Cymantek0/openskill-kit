import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { writeJsonAtomic } from "../storage/atomic.js";
import {
  learnV2EscapeRegExp,
  learnV2IsInside,
  learnV2ReadGitHeadCommit,
  learnV2ReadGitRemotes,
  learnV2ReadPackageName
} from "./utils.js";

export const LearnV2ProjectFingerprintSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.project-fingerprint.v1"),
  rootName: z.string().min(1),
  packageName: z.string().optional(),
  remotes: z.array(z.string()).default([]),
  headCommit: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  markerFiles: z.array(z.string()).default([]),
  topLevelDirs: z.array(z.string()).default([])
});
export type LearnV2ProjectFingerprint = z.infer<typeof LearnV2ProjectFingerprintSchema>;

export const LearnV2ProjectRelevanceSchema = z.object({
  score: z.number().min(0).max(1),
  decision: z.enum(["accept", "review", "reject"]),
  gate: z.enum(["hard-accept", "hard-review", "hard-reject", "calibrated-score"]).default("calibrated-score"),
  calibrationVersion: z.string().optional(),
  featureValues: z.record(z.string(), z.number()).default({}),
  reasons: z.array(z.string()).default([]),
  matchedPaths: z.array(z.string()).default([]),
  matchedRemotes: z.array(z.string()).default([]),
  matchedCommits: z.array(z.string()).default([])
});
export type LearnV2ProjectRelevance = z.infer<typeof LearnV2ProjectRelevanceSchema>;

export const LearnV2ProjectRelevanceCalibrationSchema = z.object({
  schemaVersion: z.literal("openskill-kit.project-relevance-calibration.v1"),
  policyVersion: z.string().min(1),
  features: z.array(z.string().min(1)),
  weights: z.record(z.string(), z.number()),
  thresholds: z.object({
    accept: z.number().min(0).max(1),
    review: z.number().min(0).max(1),
    reject: z.number().min(0).max(1)
  }),
  trainedFrom: z.array(z.enum(["golden-fixture", "human-review", "manual-selection", "rejected-source"])).default([]),
  updatedAt: z.string().datetime(),
  notes: z.array(z.string()).default([])
});
export type LearnV2ProjectRelevanceCalibration = z.infer<typeof LearnV2ProjectRelevanceCalibrationSchema>;

export interface LearnV2ProjectRelevanceOptions {
  calibration?: LearnV2ProjectRelevanceCalibration;
  explicitlySelected?: boolean;
  now?: Date;
}

export async function buildLearnV2ProjectFingerprint(root: string): Promise<LearnV2ProjectFingerprint> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const markerNames = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "AGENTS.md", "README.md"];
  return LearnV2ProjectFingerprintSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.project-fingerprint.v1",
    rootName: path.basename(root),
    packageName: await learnV2ReadPackageName(root),
    remotes: await learnV2ReadGitRemotes(root),
    headCommit: await learnV2ReadGitHeadCommit(root),
    markerFiles: markerNames.filter((name) => entries.some((entry) => entry.name === name && entry.isFile())),
    topLevelDirs: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).filter((name) => !name.startsWith(".")).sort().slice(0, 20)
  });
}

export async function scoreLearnV2ProjectRelevance(
  root: string,
  sourcePath: string,
  text: string,
  fingerprint?: LearnV2ProjectFingerprint,
  options: LearnV2ProjectRelevanceOptions = {}
): Promise<LearnV2ProjectRelevance> {
  fingerprint ??= await buildLearnV2ProjectFingerprint(root);
  const calibration = options.calibration ?? buildDefaultLearnV2ProjectRelevanceCalibration(options.now ?? new Date(0));
  const featureValues: Record<string, number> = {};
  const reasons = new Set<string>();
  const matchedPaths = new Set<string>();
  const matchedRemotes = new Set<string>();
  const matchedCommits = new Set<string>();
  const normalizedRoot = root.replace(/\\/g, "/");
  const escapedWindowsRoot = root.replace(/\\/g, "\\\\");
  const sourceFileInsideProject = learnV2IsInside(root, sourcePath);
  if (sourceFileInsideProject) {
    featureValues.sourceFileInsideProject = 1;
    reasons.add("source-file-inside-project");
    matchedPaths.add(path.relative(root, sourcePath).replace(/\\/g, "/"));
  }
  if (text.includes(root) || text.includes(normalizedRoot) || text.includes(escapedWindowsRoot)) {
    featureValues.projectRootMentioned = 1;
    reasons.add("project-root-mentioned");
    matchedPaths.add("[PROJECT_ROOT]");
  }
  if (fingerprint.packageName && new RegExp(`\\b${learnV2EscapeRegExp(fingerprint.packageName)}\\b`, "i").test(text)) {
    featureValues.packageNameMentioned = 1;
    reasons.add("package-name-mentioned");
  }
  if (fingerprint.rootName && new RegExp(`\\b${learnV2EscapeRegExp(fingerprint.rootName)}\\b`, "i").test(text)) {
    featureValues.rootNameMentioned = 1;
    reasons.add("root-name-mentioned");
  }
  for (const remote of fingerprint.remotes) {
    if (!remote || !text.includes(remote)) continue;
    featureValues.gitRemoteMentioned = 1;
    reasons.add("git-remote-mentioned");
    matchedRemotes.add(remote);
  }
  if (fingerprint.headCommit) {
    const currentCommitPattern = new RegExp(`\\b(?:${learnV2EscapeRegExp(fingerprint.headCommit)}|${learnV2EscapeRegExp(fingerprint.headCommit.slice(0, 12))}|${learnV2EscapeRegExp(fingerprint.headCommit.slice(0, 8))})\\b`, "i");
    if (currentCommitPattern.test(text)) {
      featureValues.currentHeadCommitMentioned = 1;
      reasons.add("current-head-commit-mentioned");
      matchedCommits.add(fingerprint.headCommit.slice(0, 12));
    }
  }
  const dirPattern = fingerprint.topLevelDirs.length
    ? `(?:${fingerprint.topLevelDirs.map(learnV2EscapeRegExp).join("|")})`
    : "(?:packages|src|docs|tests|python|examples)";
  const relativeMentions = [...text.matchAll(new RegExp(`\\b${dirPattern}/[A-Za-z0-9_./-]+\\b`, "g"))]
    .map((match) => match[0])
    .slice(0, 20);
  if (relativeMentions.length) {
    featureValues.repoRelativePathMentioned = Math.min(1, relativeMentions.length / 6);
    reasons.add("repo-relative-path-mentioned");
    for (const mention of relativeMentions) matchedPaths.add(mention);
  }
  const globalMemoryRisk = /(?:global memory|user memory|personal memory|all projects|across repos)/i.test(text);
  if (globalMemoryRisk) {
    featureValues.globalMemoryRisk = 1;
    reasons.add("global-memory-risk");
  }
  if (hasUnanchoredTestOrCommandLog(text, featureValues)) {
    featureValues.unanchoredTestOrCommandLog = 1;
    reasons.add("unanchored-test-or-command-log");
  }
  if (mentionsForeignAbsolutePath(root, text)) {
    featureValues.foreignAbsolutePathMentioned = 1;
    reasons.add("foreign-absolute-path-mentioned");
  }
  if (isSafeOpenCodeAmbientTelemetry(text)) {
    featureValues.safeOpenCodeAmbientTelemetry = 1;
    reasons.add("safe-opencode-ambient-telemetry");
  }

  const hardGate = decideHardGate(featureValues, sourceFileInsideProject, options.explicitlySelected === true);
  const calibratedScore = scoreFromCalibration(featureValues, calibration);
  const score = hardGate
    ? hardGateScore(hardGate, calibratedScore, calibration)
    : calibratedScore;
  const decision = hardGate?.decision ?? decisionFromScore(score, calibration);
  if (hardGate) reasons.add(`${hardGate.gate}:${hardGate.reason}`);
  return LearnV2ProjectRelevanceSchema.parse({
    score,
    decision,
    gate: hardGate?.gate ?? "calibrated-score",
    calibrationVersion: calibration.policyVersion,
    featureValues: orderedFeatureValues(featureValues, calibration.features),
    reasons: [...reasons].sort(),
    matchedPaths: [...matchedPaths].sort(),
    matchedRemotes: [...matchedRemotes].sort(),
    matchedCommits: [...matchedCommits].sort()
  });
}

export async function ensureLearnV2ProjectRelevanceCalibration(rootInput: string, now = new Date()): Promise<{ path: string; calibration: LearnV2ProjectRelevanceCalibration }> {
  const root = path.resolve(rootInput);
  const file = learnV2ProjectRelevanceCalibrationPath(root);
  const existing = await fs.readFile(file, "utf8")
    .then((text) => LearnV2ProjectRelevanceCalibrationSchema.parse(JSON.parse(text)))
    .catch(() => undefined);
  if (existing) return { path: file, calibration: existing };
  const calibration = buildDefaultLearnV2ProjectRelevanceCalibration(now);
  await writeJsonAtomic(file, calibration);
  return { path: file, calibration };
}

export function learnV2ProjectRelevanceCalibrationPath(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "relevance-calibration.json");
}

export function buildDefaultLearnV2ProjectRelevanceCalibration(now = new Date()): LearnV2ProjectRelevanceCalibration {
  return LearnV2ProjectRelevanceCalibrationSchema.parse({
    schemaVersion: "openskill-kit.project-relevance-calibration.v1",
    policyVersion: "default-hard-gate-calibration-v1",
    features: [
      "sourceFileInsideProject",
      "projectRootMentioned",
      "packageNameMentioned",
      "rootNameMentioned",
      "gitRemoteMentioned",
      "currentHeadCommitMentioned",
      "repoRelativePathMentioned",
      "safeOpenCodeAmbientTelemetry",
      "globalMemoryRisk",
      "foreignAbsolutePathMentioned",
      "unanchoredTestOrCommandLog"
    ],
    weights: {
      sourceFileInsideProject: 0.48,
      projectRootMentioned: 0.3,
      packageNameMentioned: 0.18,
      rootNameMentioned: 0.08,
      gitRemoteMentioned: 0.28,
      currentHeadCommitMentioned: 0.22,
      repoRelativePathMentioned: 0.25,
      safeOpenCodeAmbientTelemetry: 0.2,
      globalMemoryRisk: -0.36,
      foreignAbsolutePathMentioned: -0.18,
      unanchoredTestOrCommandLog: 0
    },
    thresholds: {
      accept: 0.6,
      review: 0.4,
      reject: 0
    },
    trainedFrom: [],
    updatedAt: now.toISOString(),
    notes: [
      "Layer A hard gates run before this score.",
      "This default is deterministic and untrained; ambiguous cases stay review-needed until calibrated from goldens or human review outcomes."
    ]
  });
}

function decideHardGate(
  features: Record<string, number>,
  sourceFileInsideProject: boolean,
  explicitlySelected: boolean
): { gate: LearnV2ProjectRelevance["gate"]; decision: LearnV2ProjectRelevance["decision"]; reason: string } | undefined {
  const strongAnchor = Boolean(
    features.projectRootMentioned ||
      features.gitRemoteMentioned ||
      (features.currentHeadCommitMentioned && (features.repoRelativePathMentioned || features.packageNameMentioned || sourceFileInsideProject)) ||
      (features.packageNameMentioned && features.repoRelativePathMentioned) ||
      (sourceFileInsideProject && features.repoRelativePathMentioned)
  );
  if (features.globalMemoryRisk && !strongAnchor) {
    return { gate: "hard-reject", decision: "reject", reason: "global-memory-without-project-anchor" };
  }
  if (features.foreignAbsolutePathMentioned && !strongAnchor && !sourceFileInsideProject) {
    return { gate: "hard-reject", decision: "reject", reason: "foreign-absolute-path-without-project-anchor" };
  }
  if (features.unanchoredTestOrCommandLog && !strongAnchor) {
    return { gate: "hard-review", decision: "review", reason: "unanchored-test-or-command-log" };
  }
  if (explicitlySelected && sourceFileInsideProject && strongAnchor && !features.globalMemoryRisk) {
    return { gate: "hard-accept", decision: "accept", reason: "explicit-project-local-source-with-anchor" };
  }
  if (features.projectRootMentioned && features.repoRelativePathMentioned) {
    return { gate: "hard-accept", decision: "accept", reason: "project-root-and-relative-path" };
  }
  if (features.gitRemoteMentioned && (features.repoRelativePathMentioned || features.packageNameMentioned)) {
    return { gate: "hard-accept", decision: "accept", reason: "git-remote-plus-project-anchor" };
  }
  if (features.currentHeadCommitMentioned && (sourceFileInsideProject || features.repoRelativePathMentioned || features.packageNameMentioned || features.projectRootMentioned)) {
    return { gate: "hard-accept", decision: "accept", reason: "current-head-commit-plus-project-anchor" };
  }
  return undefined;
}

function scoreFromCalibration(features: Record<string, number>, calibration: LearnV2ProjectRelevanceCalibration): number {
  let score = 0;
  for (const [feature, value] of Object.entries(features)) score += value * (calibration.weights[feature] ?? 0);
  return round(Math.min(1, Math.max(0, score)));
}

function decisionFromScore(score: number, calibration: LearnV2ProjectRelevanceCalibration): LearnV2ProjectRelevance["decision"] {
  if (score >= calibration.thresholds.accept) return "accept";
  if (score >= calibration.thresholds.review) return "review";
  return "reject";
}

function hardGateScore(
  gate: { gate: LearnV2ProjectRelevance["gate"]; decision: LearnV2ProjectRelevance["decision"] },
  calibratedScore: number,
  calibration: LearnV2ProjectRelevanceCalibration
): number {
  if (gate.decision === "accept") return round(Math.max(calibratedScore, calibration.thresholds.accept));
  if (gate.decision === "review") return round(Math.max(calibratedScore, calibration.thresholds.review));
  return round(Math.min(calibratedScore, Math.max(0, calibration.thresholds.review - 0.01)));
}

function orderedFeatureValues(features: Record<string, number>, featureOrder: string[]): Record<string, number> {
  const ordered: Record<string, number> = {};
  for (const feature of featureOrder) {
    if (features[feature] !== undefined) ordered[feature] = features[feature];
  }
  for (const feature of Object.keys(features).sort()) {
    if (ordered[feature] === undefined) ordered[feature] = features[feature]!;
  }
  return ordered;
}

function hasUnanchoredTestOrCommandLog(text: string, features: Record<string, number>): boolean {
  if (features.projectRootMentioned || features.gitRemoteMentioned || features.repoRelativePathMentioned || features.packageNameMentioned) return false;
  return /\b(?:npm|pnpm|yarn|bun|npx|pytest|vitest|jest|go test|cargo test|mvn test|gradle test)\b/i.test(text);
}

function mentionsForeignAbsolutePath(root: string, text: string): boolean {
  const normalizedRoot = root.replace(/\\/g, "/").toLowerCase();
  const absolutePaths = [
    ...text.matchAll(/\b[A-Za-z]:[\\/][^\s"'`<>|]+/g),
    ...text.matchAll(/(?:^|\s)(\/(?:Users|home|workspace|tmp|var|opt)\/[^\s"'`<>|]+)/g)
  ].map((match) => (match[1] ?? match[0]).trim().replace(/\\/g, "/").toLowerCase());
  return absolutePaths.some((item) => !item.startsWith(normalizedRoot));
}

function isSafeOpenCodeAmbientTelemetry(text: string): boolean {
  if (!text.includes('"schemaVersion":"openskill-kit.opencode-ambient-event.v1"') && !text.includes('"schemaVersion": "openskill-kit.opencode-ambient-event.v1"')) return false;
  if (!text.includes('"traceContext"')) return false;
  if (!text.includes('"containsRawFields":false') && !text.includes('"containsRawFields": false')) return false;
  if (/"(?:command|cmd|args|argv|path|file|filePath|filename|rawInput|rawOutput|rawPrompt)"\s*:/.test(text)) return false;
  return /"(?:input|output)\.(?:command|path)(?:Kind|Hash|LengthBucket|Extension|Depth|RiskFlags)"\s*:/.test(text);
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
