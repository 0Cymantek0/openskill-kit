import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import {
  learnV2EscapeRegExp,
  learnV2IsInside,
  learnV2ReadGitRemotes,
  learnV2ReadPackageName
} from "./utils.js";

export const LearnV2ProjectFingerprintSchema = z.object({
  schemaVersion: z.literal("openskill-kit.learn-v2.project-fingerprint.v1"),
  rootName: z.string().min(1),
  packageName: z.string().optional(),
  remotes: z.array(z.string()).default([]),
  markerFiles: z.array(z.string()).default([]),
  topLevelDirs: z.array(z.string()).default([])
});
export type LearnV2ProjectFingerprint = z.infer<typeof LearnV2ProjectFingerprintSchema>;

export const LearnV2ProjectRelevanceSchema = z.object({
  score: z.number().min(0).max(1),
  decision: z.enum(["accept", "review", "reject"]),
  reasons: z.array(z.string()).default([]),
  matchedPaths: z.array(z.string()).default([]),
  matchedRemotes: z.array(z.string()).default([])
});
export type LearnV2ProjectRelevance = z.infer<typeof LearnV2ProjectRelevanceSchema>;

export async function buildLearnV2ProjectFingerprint(root: string): Promise<LearnV2ProjectFingerprint> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const markerNames = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "AGENTS.md", "README.md"];
  return LearnV2ProjectFingerprintSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.project-fingerprint.v1",
    rootName: path.basename(root),
    packageName: await learnV2ReadPackageName(root),
    remotes: await learnV2ReadGitRemotes(root),
    markerFiles: markerNames.filter((name) => entries.some((entry) => entry.name === name && entry.isFile())),
    topLevelDirs: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).filter((name) => !name.startsWith(".")).sort().slice(0, 20)
  });
}

export async function scoreLearnV2ProjectRelevance(
  root: string,
  sourcePath: string,
  text: string,
  fingerprint?: LearnV2ProjectFingerprint
): Promise<LearnV2ProjectRelevance> {
  fingerprint ??= await buildLearnV2ProjectFingerprint(root);
  let score = 0;
  const reasons = new Set<string>();
  const matchedPaths = new Set<string>();
  const matchedRemotes = new Set<string>();
  const normalizedRoot = root.replace(/\\/g, "/");
  if (learnV2IsInside(root, sourcePath)) {
    score += 0.48;
    reasons.add("source-file-inside-project");
    matchedPaths.add(path.relative(root, sourcePath).replace(/\\/g, "/"));
  }
  if (text.includes(root) || text.includes(normalizedRoot)) {
    score += 0.3;
    reasons.add("project-root-mentioned");
    matchedPaths.add("[PROJECT_ROOT]");
  }
  if (fingerprint.packageName && new RegExp(`\\b${learnV2EscapeRegExp(fingerprint.packageName)}\\b`, "i").test(text)) {
    score += 0.18;
    reasons.add("package-name-mentioned");
  }
  if (fingerprint.rootName && new RegExp(`\\b${learnV2EscapeRegExp(fingerprint.rootName)}\\b`, "i").test(text)) {
    score += 0.08;
    reasons.add("root-name-mentioned");
  }
  for (const remote of fingerprint.remotes) {
    if (!remote || !text.includes(remote)) continue;
    score += 0.28;
    reasons.add("git-remote-mentioned");
    matchedRemotes.add(remote);
  }
  const dirPattern = fingerprint.topLevelDirs.length
    ? `(?:${fingerprint.topLevelDirs.map(learnV2EscapeRegExp).join("|")})`
    : "(?:packages|src|docs|tests|python|examples)";
  const relativeMentions = [...text.matchAll(new RegExp(`\\b${dirPattern}/[A-Za-z0-9_./-]+\\b`, "g"))]
    .map((match) => match[0])
    .slice(0, 20);
  if (relativeMentions.length) {
    score += Math.min(0.25, relativeMentions.length * 0.04);
    reasons.add("repo-relative-path-mentioned");
    for (const mention of relativeMentions) matchedPaths.add(mention);
  }
  const globalMemoryRisk = /(?:global memory|user memory|personal memory|all projects|across repos)/i.test(text);
  if (globalMemoryRisk && !learnV2IsInside(root, sourcePath)) {
    score = Math.min(score, 0.24);
    reasons.add("global-memory-risk");
  }
  const bounded = Math.min(1, Math.max(0, score));
  const decision = bounded >= 0.5 ? "accept" : bounded >= 0.25 ? "review" : "reject";
  return LearnV2ProjectRelevanceSchema.parse({
    score: Number(bounded.toFixed(2)),
    decision,
    reasons: [...reasons].sort(),
    matchedPaths: [...matchedPaths].sort(),
    matchedRemotes: [...matchedRemotes].sort()
  });
}
