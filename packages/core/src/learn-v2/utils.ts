import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { redactValue } from "../events/redaction.js";
import type { ProjectConfig } from "../config/schema.js";

export function learnV2Hash(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function learnV2ShortHash(value: string | Buffer, length = 16): string {
  return learnV2Hash(value).replace(/^sha256:/, "").slice(0, length);
}

export function learnV2IsInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function learnV2SafeLocalPath(value: string, root: string): string {
  const relative = path.relative(root, value);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return `[PROJECT_ROOT]/${relative.replace(/\\/g, "/")}`;
  const home = os.homedir();
  const homeRelative = path.relative(home, value);
  if (homeRelative && !homeRelative.startsWith("..") && !path.isAbsolute(homeRelative)) return `[USER_HOME]/${homeRelative.replace(/\\/g, "/")}`;
  return "[LOCAL_PATH]";
}

export function learnV2DeclassifyText(text: string, root: string, config: ProjectConfig): { text: string; matches: string[]; placeholders: string[] } {
  const matches = new Set<string>();
  const placeholders = new Set<string>();
  const redacted = redactValue(text, config);
  let current = String(redacted.value);
  for (const match of redacted.matches) matches.add(match);
  const replacements: Array<[string, string, string]> = [
    [root, "[PROJECT_ROOT]", "project-root"],
    [root.replace(/\\/g, "\\\\"), "[PROJECT_ROOT]", "project-root"],
    [root.replace(/\\/g, "/"), "[PROJECT_ROOT]", "project-root"],
    [os.homedir(), "[USER_HOME]", "user-home"],
    [os.homedir().replace(/\\/g, "\\\\"), "[USER_HOME]", "user-home"],
    [os.homedir().replace(/\\/g, "/"), "[USER_HOME]", "user-home"]
  ];
  for (const [needle, replacement, id] of replacements) {
    if (!needle || !current.includes(needle)) continue;
    current = current.split(needle).join(replacement);
    matches.add(id);
    placeholders.add(replacement);
  }
  current = current.replace(/\b[A-Z]:\\Users\\[^\\\s"'`]+(?:\\[^\s"'`]+)*/g, (match) => {
    matches.add("absolute-user-path");
    const placeholder = match.includes(".") ? "[ABSOLUTE_USER_PATH:file]" : "[ABSOLUTE_USER_PATH]";
    placeholders.add(placeholder);
    return placeholder;
  });
  current = current.replace(/\b[A-Z]:\\(?!Windows\\|Program Files\\|Program Files \(x86\)\\)[^\s"'`]+/g, () => {
    matches.add("absolute-path");
    placeholders.add("[ABSOLUTE_PATH]");
    return "[ABSOLUTE_PATH]";
  });
  current = current.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => {
    matches.add("email");
    placeholders.add("[REDACTED:email]");
    return "[REDACTED:email]";
  });
  for (const placeholder of current.match(/\[[A-Z0-9_:-]+(?:[^\]]*)?\]/g) ?? []) placeholders.add(placeholder);
  return { text: current, matches: [...matches].sort(), placeholders: [...placeholders].sort() };
}

export function learnV2Snippet(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

export function learnV2NormalizeStatement(statement: string): string {
  const trimmed = statement.trim().replace(/\s+/g, " ");
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

export function learnV2CanonicalKey(statement: string): string {
  return statement.toLowerCase().replace(/[^a-z0-9 ]+/g, "").split(/\s+/).filter((word) => word.length > 3).slice(0, 12).join("-");
}

export function learnV2Title(statement: string): string {
  return learnV2NormalizeStatement(statement)
    .replace(/^(always|prefer|never|avoid|do not|don't|stop|make sure to|default to)\s+/i, "")
    .split(/\s+/)
    .slice(0, 9)
    .join(" ");
}

export async function learnV2ReadPackageName(root: string): Promise<string | undefined> {
  const parsed = await fs.readFile(path.join(root, "package.json"), "utf8").then((text) => JSON.parse(text)).catch(() => undefined);
  return typeof parsed?.name === "string" ? parsed.name : undefined;
}

export async function learnV2ReadGitRemotes(root: string): Promise<string[]> {
  const config = await fs.readFile(path.join(root, ".git", "config"), "utf8").catch(() => "");
  return [...config.matchAll(/url\s*=\s*(.+)/g)].map((match) => match[1]!.trim()).filter(Boolean);
}

export async function learnV2ReadGitHeadCommit(root: string): Promise<string | undefined> {
  const head = (await fs.readFile(path.join(root, ".git", "HEAD"), "utf8").catch(() => "")).trim();
  if (/^[a-f0-9]{40}$/i.test(head)) return head.toLowerCase();
  const refMatch = /^ref:\s+(.+)$/m.exec(head);
  if (!refMatch?.[1]) return undefined;
  const ref = refMatch[1].trim();
  if (!ref.startsWith("refs/") || ref.includes("..") || path.isAbsolute(ref) || ref.includes("\\")) return undefined;
  const refCommit = (await fs.readFile(path.join(root, ".git", ref), "utf8").catch(() => "")).trim();
  return /^[a-f0-9]{40}$/i.test(refCommit) ? refCommit.toLowerCase() : undefined;
}

export async function learnV2ReadGitBranch(root: string): Promise<string | undefined> {
  const head = await fs.readFile(path.join(root, ".git", "HEAD"), "utf8").catch(() => "");
  const refMatch = /^ref:\s+(.+)$/m.exec(head);
  return refMatch?.[1] ? path.basename(refMatch[1]) : undefined;
}

export function learnV2EscapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function learnV2StatusFromText(value: unknown): "pass" | "fail" | "blocked" | "timeout" | "unknown" {
  const status = String(value ?? "").toLowerCase();
  if (/timeout|timed out/.test(status)) return "timeout";
  if (/\b(?:fail|failed|failure|error|exception|stack trace)\b/.test(status)) return "fail";
  if (/\b(?:pass|passed|success|ok|succeeded|accepted|approved)\b/.test(status)) return "pass";
  if (/\b(?:block|blocked|deny|denied|reject|rejected)\b/.test(status)) return "blocked";
  return "unknown";
}

export function learnV2CommandLinesFromText(text: string): string[] {
  const lineCommands = text.split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:\$|PS>|>)\s*/, ""))
    .filter((line) => /^(?:npm|pnpm|yarn|node|tsx|tsc|vitest|pytest|python|git|cargo|go|dotnet|ruff|mypy|eslint)\b/.test(line))
    .slice(0, 20);
  const inlineCommands = [...text.matchAll(/\b((?:npm|pnpm|yarn|node|tsx|tsc|vitest|pytest|python|git|cargo|go|dotnet|ruff|mypy|eslint)\s+[^.;\n]{2,120})/g)]
    .map((match) => match[1]!.trim())
    .slice(0, 20);
  return [...new Set([...lineCommands, ...inlineCommands])].slice(0, 20);
}

export function learnV2FilePathsFromText(text: string): string[] {
  return [...text.matchAll(/\b(?:packages|src|docs|tests|python|examples|plans|scripts)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+\b/g)]
    .map((match) => match[0])
    .filter((file) => !learnV2IsGeneratedPath(file))
    .slice(0, 40);
}

export function learnV2IsGeneratedPath(file: string): boolean {
  return /(^|\/)(dist|build|coverage|node_modules|\.next|target|generated|__generated__)\//.test(file)
    || learnV2IsLockfilePath(file)
    || /\.min\.[jt]s$/.test(file);
}

export function learnV2IsLockfilePath(file: string): boolean {
  return /(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock)$/.test(file);
}
