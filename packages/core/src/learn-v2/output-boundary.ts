import type { ProjectConfig } from "../config/schema.js";
import { learnV2DeclassifyText } from "./utils.js";

export type LearnV2ModelOutputBoundaryValidation =
  | { ok: true }
  | { ok: false; reason: "unsafe-output-content"; detail: string };

const PLACEHOLDER_TOKEN_PATTERN = /\[(?:PROJECT_ROOT|USER_HOME|LOCAL_PATH|ABSOLUTE_PATH|ABSOLUTE_USER_PATH(?::[a-z]+)?|REDACTED:[^\]]+)\]/gi;
const RAW_REF_PATTERN = /\braw_[A-Za-z0-9][A-Za-z0-9_-]{5,}\b/g;
const UNIX_USER_PATH_PATTERN = /(?:^|[\s"'`])(?:\/home\/|\/Users\/)[^\s"'`]+/g;
const WINDOWS_USER_PATH_PATTERN = /\b[A-Za-z]:\\\\Users\\\\[^\s"'`]+/g;
const RAW_VAULT_PATH_PATTERN = /\.openskill-kit[\\/]+learn-v2[\\/]+raw-vault/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export function validateLearnV2ModelOutputBoundary(
  root: string,
  config: ProjectConfig,
  output: unknown
): LearnV2ModelOutputBoundaryValidation {
  const text = stringifyModelOutput(output);
  const issues = new Set<string>();
  const declassified = learnV2DeclassifyText(text, root, config);
  for (const match of declassified.matches) issues.add(match);
  collectPattern(issues, text, PLACEHOLDER_TOKEN_PATTERN, "declassification-placeholder");
  collectPattern(issues, text, RAW_REF_PATTERN, "raw-ref");
  collectPattern(issues, text, UNIX_USER_PATH_PATTERN, "absolute-user-path");
  collectPattern(issues, text, WINDOWS_USER_PATH_PATTERN, "absolute-user-path");
  collectPattern(issues, text, RAW_VAULT_PATH_PATTERN, "raw-vault-path");
  collectPattern(issues, text, EMAIL_PATTERN, "email");

  if (!issues.size) return { ok: true };
  return {
    ok: false,
    reason: "unsafe-output-content",
    detail: `Model output crosses declassification boundary: ${[...issues].sort().slice(0, 8).join(", ")}`
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
