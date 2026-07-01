import os from "node:os";
import type { LearnV2TaskEpisode } from "./schemas.js";
import { LearnV2DeclassifiedEvidenceSnippetSchema, type LearnV2DeclassifiedEvidenceSnippet } from "./schemas.js";
import { learnV2ShortHash, learnV2Snippet } from "./utils.js";

/**
 * Plan §16.2: Standalone declassified evidence snippets.
 *
 * The vault and pipeline already declassify text inline via utils.learnV2DeclassifyText.
 * This module produces typed, reusable DeclassifiedEvidenceSnippet records that can be
 * attached to ConceptCards and review cards as first-class artifacts with residual-risk
 * scoring and compile-blocking flags.
 *
 * Why standalone: review cards, MCP resources, and compile previews may want to cite a
 * declassified snippet without re-running declassification inline, and reviewers benefit
 * from seeing the exact placeholder map and detector explanations for each redaction.
 */

export interface LearnV2DeclassifyOptions {
  /** Cap snippet length to keep it review/compile-safe. */
  maxChars?: number;
  /** Mark snippet as blocked if residual risk is medium or high. */
  blockOnMediumRisk?: boolean;
}

export function buildLearnV2DeclassifiedSnippet(
  evidenceId: string,
  rawRef: string,
  text: string,
  projectRoot: string,
  options: LearnV2DeclassifyOptions = {}
): LearnV2DeclassifiedEvidenceSnippet {
  const maxChars = options.maxChars ?? 1200;
  const result = localDeclassify(text, projectRoot);
  const snippetText = learnV2Snippet(result.text, maxChars) || "<empty-snippet>";
  const residualRisk = computeResidualRisk(snippetText, result.matches);
  const id = `decl_${learnV2ShortHash(`${evidenceId}:${rawRef}:${snippetText}`)}`;
  const placeholderMap = buildPlaceholderMap(snippetText, result.matches);
  const blockedFromCompile = options.blockOnMediumRisk === true && residualRisk !== "low";
  return LearnV2DeclassifiedEvidenceSnippetSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.declassified-snippet.v1",
    id,
    evidenceId,
    rawRef,
    text: snippetText,
    placeholderMap,
    risk: {
      redacted: result.matches.length > 0,
      residualRisk,
      blockedFromCompile
    },
    createdAt: new Date().toISOString()
  });
}

/**
 * Batch-build declassified snippets from episode messages.
 * Returns the highest-value snippets (corrections, rejections, manual edits, review comments)
 * to attach to concept review cards.
 */
export function buildLearnV2HighValueSnippets(
  episode: LearnV2TaskEpisode,
  projectRoot: string,
  options: LearnV2DeclassifyOptions = {}
): LearnV2DeclassifiedEvidenceSnippet[] {
  const highValueActors = new Set(["user", "reviewer"]);
  const highValueKeywords = /\b(?:wrong|instead|avoid|never|prefer|must|should not|reject|manual edit|review|blocker|security|secret|credential|test|fixture|regression)\b/i;
  const snippets: LearnV2DeclassifiedEvidenceSnippet[] = [];
  for (const message of episode.messages) {
    if (!highValueActors.has(message.actor) && !highValueKeywords.test(message.text)) continue;
    snippets.push(buildLearnV2DeclassifiedSnippet(message.id, message.rawRef, message.text, projectRoot, options));
    if (snippets.length >= 8) break;
  }
  return snippets;
}

function computeResidualRisk(text: string, matches: string[]): "low" | "medium" | "high" {
  if (matches.length === 0) return "low";
  // Re-scan the declassified text for anything the redactor missed.
  if (/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{16,})\b/.test(text)) return "high";
  if (/\b[A-Z]:\\Users\\/i.test(text)) return "medium";
  if (matches.length >= 3) return "medium";
  return "low";
}

function buildPlaceholderMap(text: string, matches: string[]): LearnV2DeclassifiedEvidenceSnippet["placeholderMap"] {
  const map: LearnV2DeclassifiedEvidenceSnippet["placeholderMap"] = {};
  for (const match of [...new Set(matches)]) {
    const placeholder = inferPlaceholder(match);
    map[match] = {
      placeholder,
      detector: "learn-v2-declassify-regex",
      explanation: `Replaced ${match} pattern with ${placeholder} to keep snippet portable and secret-free.`
    };
  }
  return map;
}

function inferPlaceholder(match: string): string {
  if (/secret|token|key|credential|password/i.test(match)) return "<SECRET>";
  if (/path|home|root|dir/i.test(match)) return "<LOCAL_PATH>";
  if (/email|user|name/i.test(match)) return "<IDENTIFIER>";
  return "<REDACTED>";
}

/**
 * Local declassification that mirrors utils.learnV2DeclassifyText but does not
 * require a ProjectConfig. This keeps snippet-building usable from review cards
 * and MCP tools that may not hold a full config object. Custom redaction patterns
 * from config are intentionally omitted here; callers needing custom redactions
 * should use utils.learnV2DeclassifyText directly before building snippets.
 *
 * Matches the core redaction contract: project root, user home, absolute Windows
 * paths, secret-shaped strings, and email-like identifiers are replaced with typed
 * placeholders and recorded in the matches list.
 */
function localDeclassify(text: string, projectRoot: string): { text: string; matches: string[] } {
  const matches = new Set<string>();
  let current = text;
  const replacements: Array<[string, string, string]> = [
    [projectRoot, "[PROJECT_ROOT]", "project-root"],
    [projectRoot.replace(/\\/g, "\\\\"), "[PROJECT_ROOT]", "project-root"],
    [projectRoot.replace(/\\/g, "/"), "[PROJECT_ROOT]", "project-root"]
  ];
  const homedir = (() => {
    try {
      return os.homedir();
    } catch {
      return "";
    }
  })();
  if (homedir) {
    replacements.push(
      [homedir, "[USER_HOME]", "user-home"],
      [homedir.replace(/\\/g, "\\\\"), "[USER_HOME]", "user-home"],
      [homedir.replace(/\\/g, "/"), "[USER_HOME]", "user-home"]
    );
  }
  for (const [needle, replacement, id] of replacements) {
    if (!needle || !current.includes(needle)) continue;
    current = current.split(needle).join(replacement);
    matches.add(id);
  }
  // Absolute Windows user paths.
  current = current.replace(/\b[A-Z]:\\Users\\[^\\\s"'`]+(?:\\[^\s"'`]+)*/g, (match) => {
    matches.add("absolute-user-path");
    return match.includes(".") ? "[ABSOLUTE_USER_PATH:file]" : "[ABSOLUTE_USER_PATH]";
  });
  // Secret-shaped strings.
  current = current.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{16,})\b/g, () => {
    matches.add("secret-like-token");
    return "<SECRET>";
  });
  // Bare Bearer-style tokens in headers.
  current = current.replace(/Bearer\s+[A-Za-z0-9._-]{16,}/gi, () => {
    matches.add("bearer-token");
    return "Bearer <SECRET>";
  });
  return { text: current, matches: [...matches].sort() };
}
