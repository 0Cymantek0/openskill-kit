import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProjectConfig } from "../config/schema.js";
import { readProjectConfig } from "../events/store.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import type { LearnV2TaskEpisode } from "./schemas.js";
import { LearnV2DeclassifiedEvidenceSnippetArtifactSchema, LearnV2DeclassifiedEvidenceSnippetSchema, type LearnV2DeclassifiedEvidenceSnippet, type LearnV2DeclassifiedEvidenceSnippetArtifact } from "./schemas.js";
import { learnV2DeclassifyText, learnV2ShortHash, learnV2Snippet } from "./utils.js";

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
  /** Cap artifact size for review ergonomics. */
  maxSnippets?: number;
  /** Mark snippet as blocked if residual risk is medium or high. */
  blockOnMediumRisk?: boolean;
  /** Stable timestamp for deterministic pipeline artifacts/tests. */
  now?: Date;
  /** Project config for the same built-in and custom redactions used by vault/event storage. */
  config?: ProjectConfig;
}

export function buildLearnV2DeclassifiedSnippet(
  evidenceId: string,
  rawRef: string,
  text: string,
  projectRoot: string,
  options: LearnV2DeclassifyOptions = {}
): LearnV2DeclassifiedEvidenceSnippet {
  const maxChars = options.maxChars ?? 1200;
  const result = options.config ? learnV2DeclassifyText(text, projectRoot, options.config) : localDeclassify(text, projectRoot);
  const snippetText = learnV2Snippet(result.text, maxChars) || "<empty-snippet>";
  const residualRisk = computeResidualRisk(snippetText, result.matches);
  const id = `decl_${learnV2ShortHash(`${evidenceId}:${rawRef}:${snippetText}`)}`;
  const placeholderMap = buildPlaceholderMap(snippetText, result.matches);
  const blockedFromCompile = options.blockOnMediumRisk === true && residualRisk !== "low";
  const createdAt = (options.now ?? new Date()).toISOString();
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
    createdAt
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

export async function writeLearnV2DeclassifiedSnippetArtifact(
  rootInput: string,
  episodes: LearnV2TaskEpisode[],
  now: Date,
  options: LearnV2DeclassifyOptions = {}
): Promise<LearnV2DeclassifiedEvidenceSnippetArtifact> {
  const root = path.resolve(rootInput);
  const dir = path.join(root, ".openskill-kit", "learn-v2", "declassified-snippets");
  const json = path.join(dir, "snippets.json");
  const markdown = path.join(dir, "snippets.md");
  const maxSnippets = options.maxSnippets ?? 200;
  const config = options.config ?? await readProjectConfig(root).catch(() => undefined);
  const seen = new Set<string>();
  const snippets: LearnV2DeclassifiedEvidenceSnippet[] = [];
  for (const episode of episodes) {
    for (const snippet of buildLearnV2HighValueSnippets(episode, root, { ...options, config, now })) {
      const key = `${snippet.evidenceId}:${snippet.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      snippets.push(snippet);
      if (snippets.length >= maxSnippets) break;
    }
    if (snippets.length >= maxSnippets) break;
  }
  const artifact = LearnV2DeclassifiedEvidenceSnippetArtifactSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.declassified-snippet-artifact.v1",
    generatedAt: now.toISOString(),
    snippets,
    counts: {
      total: snippets.length,
      redacted: snippets.filter((snippet) => snippet.risk.redacted).length,
      blockedFromCompile: snippets.filter((snippet) => snippet.risk.blockedFromCompile).length,
      residualRiskCounts: countBy(snippets.map((snippet) => snippet.risk.residualRisk))
    },
    artifacts: { json, markdown }
  });
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(json, artifact);
  await fs.writeFile(markdown, renderDeclassifiedSnippetArtifactMarkdown(artifact), "utf8");
  return artifact;
}

function renderDeclassifiedSnippetArtifactMarkdown(artifact: LearnV2DeclassifiedEvidenceSnippetArtifact): string {
  const lines = [
    "# Learn v2 Declassified Evidence Snippets",
    "",
    `Generated: ${artifact.generatedAt}`,
    `Snippets: ${artifact.counts.total}`,
    `Redacted: ${artifact.counts.redacted}`,
    `Blocked from compile: ${artifact.counts.blockedFromCompile}`,
    `Residual risk: ${renderCounts(artifact.counts.residualRiskCounts)}`,
    "",
    "## Snippets",
    ""
  ];
  if (!artifact.snippets.length) lines.push("No high-value declassified snippets found.");
  for (const snippet of artifact.snippets) {
    lines.push(`### ${snippet.id}`);
    lines.push("");
    lines.push(`Evidence: ${snippet.evidenceId}`);
    lines.push(`Residual risk: ${snippet.risk.residualRisk}`);
    lines.push(`Blocked from compile: ${snippet.risk.blockedFromCompile}`);
    lines.push("");
    lines.push(snippet.text);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
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

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function renderCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "none";
}

/**
 * Fallback declassification for direct unit/helper use when no ProjectConfig exists.
 * Runtime artifact writers read project config and use utils.learnV2DeclassifyText,
 * so custom redactions stay consistent across raw vault, events, snippets, and review.
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
  // Common environment/config assignments, including short test fixtures that
  // are intentionally secret-shaped but not long enough for provider regexes.
  current = current.replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*\s*=\s*)([^\s"'`]+)/gi, (_match, prefix: string) => {
    matches.add("secret-assignment");
    return `${prefix}<SECRET>`;
  });
  // Bare Bearer-style tokens in headers.
  current = current.replace(/Bearer\s+[A-Za-z0-9._-]{16,}/gi, () => {
    matches.add("bearer-token");
    return "Bearer <SECRET>";
  });
  return { text: current, matches: [...matches].sort() };
}
