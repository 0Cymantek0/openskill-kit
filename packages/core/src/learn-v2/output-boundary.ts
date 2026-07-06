import type { ProjectConfig } from "../config/schema.js";
import { learnV2DeclassifyText } from "./utils.js";
import { LEARN_V2_GENERATED_DIRS, LEARN_V2_GENERATED_FILES } from "./paths.js";

export type LearnV2ModelOutputBoundaryValidation =
  | { ok: true }
  | { ok: false; reason: "unsafe-output-content"; detail: string };

export interface LearnV2ArtifactBoundaryInput {
  label: string;
  content: unknown;
}

export interface LearnV2ArtifactBoundaryReport {
  rawRefsExported: false;
  blockedPrivatePaths: string[];
  placeholders: string[];
  status: "pass" | "fail";
  issues: string[];
  scannedArtifacts: string[];
  issueCounts: Record<string, number>;
}

const PLACEHOLDER_TOKEN_PATTERN = /\[(?:PROJECT_ROOT|USER_HOME|LOCAL_PATH|ABSOLUTE_PATH|ABSOLUTE_USER_PATH(?::[a-z]+)?|REDACTED:[^\]]+)\]/gi;
const RAW_REF_PATTERN = /\braw_[A-Za-z0-9][A-Za-z0-9_-]{5,}\b/g;
const UNIX_USER_PATH_PATTERN = /(?:^|[\s"'`])(?:\/home\/|\/Users\/)[^\s"'`]+/g;
const WINDOWS_USER_PATH_PATTERN = /\b[A-Za-z]:[\\/]+Users[\\/]+[^\s"'`]+/g;
const RAW_VAULT_PATH_PATTERN = /\.openskill-kit[\\/]+learn-v2[\\/]+raw-vault/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SECRET_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{16,})\b/g;

export function validateLearnV2ModelOutputBoundary(
  root: string,
  config: ProjectConfig,
  output: unknown
): LearnV2ModelOutputBoundaryValidation {
  const text = stringifyModelOutput(output);
  const issues = new Set<string>();
  const declassified = learnV2DeclassifyText(text, root, config);
  for (const match of declassified.matches) issues.add(match);
  collectPattern(issues, text, RAW_REF_PATTERN, "raw-ref");
  collectPattern(issues, text, UNIX_USER_PATH_PATTERN, "absolute-user-path");
  collectPattern(issues, text, WINDOWS_USER_PATH_PATTERN, "absolute-user-path");
  collectPattern(issues, text, RAW_VAULT_PATH_PATTERN, "raw-vault-path");
  collectPattern(issues, text, EMAIL_PATTERN, "email");
  collectPattern(issues, text, SECRET_PATTERN, "secret-like-token");

  if (!issues.size) return { ok: true };
  return {
    ok: false,
    reason: "unsafe-output-content",
    detail: `Model output crosses declassification boundary: ${[...issues].sort().slice(0, 8).join(", ")}`
  };
}

export function scanLearnV2OutputArtifactBoundary(
  root: string,
  config: ProjectConfig,
  artifacts: LearnV2ArtifactBoundaryInput[]
): LearnV2ArtifactBoundaryReport {
  const issueCounts = new Map<string, number>();
  const placeholders = new Set<string>();
  const blockedPrivatePaths = [...LEARN_V2_GENERATED_DIRS, ...LEARN_V2_GENERATED_FILES].sort();
  const rootVariants = [
    root,
    root.replace(/\\/g, "\\\\"),
    root.replace(/\\/g, "/")
  ].filter(Boolean);
  const projectRootPatterns = rootVariants.map((value) => new RegExp(escapeRegExp(value), "i"));

  for (const artifact of artifacts) {
    const text = stringifyModelOutput(artifact.content);
    const declassified = learnV2DeclassifyText(text, root, config);
    for (const match of declassified.matches) recordIssue(issueCounts, artifact.label, match);
    collectPatternFromText(issueCounts, artifact.label, text, RAW_REF_PATTERN, "raw-ref-like-token-in-output");
    collectPatternFromText(issueCounts, artifact.label, text, UNIX_USER_PATH_PATTERN, "absolute-user-path-in-output");
    collectPatternFromText(issueCounts, artifact.label, text, WINDOWS_USER_PATH_PATTERN, "absolute-user-path-in-output");
    collectPatternFromText(issueCounts, artifact.label, text, RAW_VAULT_PATH_PATTERN, "raw-vault-path-in-output");
    collectPatternFromText(issueCounts, artifact.label, text, EMAIL_PATTERN, "email-like-identifier-in-output");
    collectPatternFromText(issueCounts, artifact.label, text, SECRET_PATTERN, "secret-like-token-in-output");
    collectPatternFromText(issueCounts, artifact.label, text, PLACEHOLDER_TOKEN_PATTERN, undefined, placeholders);
    for (const pattern of projectRootPatterns) collectPatternFromText(issueCounts, artifact.label, text, pattern, "project-root-path-in-output");
    for (const privatePath of blockedPrivatePaths) {
      if (text.includes(privatePath)) recordIssue(issueCounts, artifact.label, "private-path-reference-in-output");
    }
  }

  const issues = [...issueCounts.keys()].sort();
  return {
    rawRefsExported: false,
    blockedPrivatePaths,
    placeholders: [...placeholders].sort(),
    status: issues.length ? "fail" : "pass",
    issues,
    scannedArtifacts: artifacts.map((artifact) => artifact.label).sort(),
    issueCounts: Object.fromEntries([...issueCounts.entries()].sort(([a], [b]) => a.localeCompare(b)))
  };
}

function stringifyModelOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output) ?? "";
  } catch {
    return String(output);
  }
}

function collectPattern(issues: Set<string>, text: string, pattern: RegExp, issue: string): void {
  pattern.lastIndex = 0;
  if (pattern.test(text)) issues.add(issue);
}

function collectPatternFromText(
  issues: Map<string, number>,
  label: string,
  text: string,
  pattern: RegExp,
  issue?: string,
  placeholders?: Set<string>
): void {
  pattern.lastIndex = 0;
  if (placeholders) {
    if (pattern.global) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        if (match[0]) placeholders.add(match[0]);
      }
      return;
    }
    const match = pattern.exec(text);
    if (match?.[0]) placeholders.add(match[0]);
    return;
  }
  if (issue && pattern.test(text)) recordIssue(issues, label, issue);
}

function recordIssue(issues: Map<string, number>, label: string, issue: string): void {
  void label;
  const key = issue;
  issues.set(key, (issues.get(key) ?? 0) + 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
