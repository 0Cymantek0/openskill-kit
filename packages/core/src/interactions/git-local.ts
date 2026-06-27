import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitLocalContextOptions {
  maxChangedFiles?: number;
  maxRecentCommits?: number;
}

export interface GitLocalChangedFile {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  added?: number;
  removed?: number;
}

export interface GitLocalRecentCommit {
  hash: string;
  subject: string;
}

export interface GitLocalContextResult {
  schemaVersion: "openskill-kit.git-local-context.v1";
  adapter: {
    id: "git-local";
    privacy: "metadata-only";
    rawDiffIncluded: false;
  };
  repository: {
    isGitRepository: boolean;
    branch?: string;
    head?: string;
    upstream?: string;
    ahead?: number;
    behind?: number;
  };
  summary: {
    changedFileCount: number;
    stagedFileCount: number;
    unstagedFileCount: number;
    untrackedFileCount: number;
    addedLines: number;
    removedLines: number;
    recentCommitCount: number;
  };
  changedFiles: GitLocalChangedFile[];
  recentCommits: GitLocalRecentCommit[];
  warnings: string[];
  nextActions: string[];
}

interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export async function inspectGitLocalContext(projectRootInput: string, options: GitLocalContextOptions = {}): Promise<GitLocalContextResult> {
  const root = path.resolve(projectRootInput);
  const maxChangedFiles = options.maxChangedFiles ?? 80;
  const maxRecentCommits = options.maxRecentCommits ?? 5;
  const warnings: string[] = [];
  const inside = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return emptyResult(["Not a git repository; git-local metadata unavailable."]);
  }

  const branch = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = await git(root, ["rev-parse", "--short=12", "HEAD"]);
  const upstream = await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const aheadBehind = upstream.ok ? await git(root, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]) : undefined;
  const status = await git(root, ["status", "--porcelain=v1"]);
  const numstat = await git(root, ["diff", "--numstat", "HEAD", "--"]);
  const commits = await git(root, ["log", `--max-count=${maxRecentCommits}`, "--pretty=format:%h%x09%s"]);

  if (!branch.ok) warnings.push("Could not read current branch.");
  if (!head.ok) warnings.push("Could not read HEAD commit.");
  if (!upstream.ok) warnings.push("No upstream branch configured.");
  if (!status.ok) warnings.push("Could not read git status.");
  if (!numstat.ok) warnings.push("Could not read aggregate diff stats.");
  if (!commits.ok) warnings.push("Could not read recent commits.");

  const changed = parseStatus(status.stdout);
  const stats = parseNumstat(numstat.stdout);
  const changedFiles = changed.slice(0, maxChangedFiles).map((file) => ({
    ...file,
    ...stats.get(file.path)
  }));
  if (changed.length > maxChangedFiles) warnings.push(`Changed file list truncated from ${changed.length} to maxChangedFiles=${maxChangedFiles}.`);

  const lineTotals = [...stats.values()].reduce((acc, item) => ({
    added: acc.added + (item.added ?? 0),
    removed: acc.removed + (item.removed ?? 0)
  }), { added: 0, removed: 0 });
  const [ahead, behind] = parseAheadBehind(aheadBehind?.stdout);

  return {
    schemaVersion: "openskill-kit.git-local-context.v1",
    adapter: { id: "git-local", privacy: "metadata-only", rawDiffIncluded: false },
    repository: {
      isGitRepository: true,
      branch: clean(branch.stdout),
      head: clean(head.stdout),
      upstream: upstream.ok ? clean(upstream.stdout) : undefined,
      ahead,
      behind
    },
    summary: {
      changedFileCount: changed.length,
      stagedFileCount: changed.filter((file) => file.staged).length,
      unstagedFileCount: changed.filter((file) => file.unstaged).length,
      untrackedFileCount: changed.filter((file) => file.status === "untracked").length,
      addedLines: lineTotals.added,
      removedLines: lineTotals.removed,
      recentCommitCount: parseCommits(commits.stdout).length
    },
    changedFiles,
    recentCommits: parseCommits(commits.stdout),
    warnings,
    nextActions: nextActions(changed.length, changedFiles.length, warnings)
  };
}

function emptyResult(warnings: string[]): GitLocalContextResult {
  return {
    schemaVersion: "openskill-kit.git-local-context.v1",
    adapter: { id: "git-local", privacy: "metadata-only", rawDiffIncluded: false },
    repository: { isGitRepository: false },
    summary: {
      changedFileCount: 0,
      stagedFileCount: 0,
      unstagedFileCount: 0,
      untrackedFileCount: 0,
      addedLines: 0,
      removedLines: 0,
      recentCommitCount: 0
    },
    changedFiles: [],
    recentCommits: [],
    warnings,
    nextActions: ["Initialize git or run from the repository root before asking OpenSkillKit for local git context."]
  };
}

function parseStatus(text: string): GitLocalChangedFile[] {
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line[0] ?? " ";
    const worktree = line[1] ?? " ";
    const rawPath = line.slice(3).trim();
    const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop()!.trim() : rawPath;
    return {
      path: filePath,
      status: statusLabel(index, worktree),
      staged: index !== " " && index !== "?",
      unstaged: worktree !== " " || index === "?"
    };
  });
}

function parseNumstat(text: string): Map<string, { added: number; removed: number }> {
  const stats = new Map<string, { added: number; removed: number }>();
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const [addedRaw, removedRaw, filePath] = line.split(/\t/);
    if (!filePath) continue;
    stats.set(filePath, {
      added: addedRaw === "-" ? 0 : Number.parseInt(addedRaw ?? "0", 10) || 0,
      removed: removedRaw === "-" ? 0 : Number.parseInt(removedRaw ?? "0", 10) || 0
    });
  }
  return stats;
}

function parseCommits(text: string): GitLocalRecentCommit[] {
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash, subject = ""] = line.split(/\t/);
    return { hash: hash ?? "", subject: subject.slice(0, 160) };
  }).filter((item) => item.hash);
}

function parseAheadBehind(text: string | undefined): [number | undefined, number | undefined] {
  if (!text) return [undefined, undefined];
  const [aheadRaw, behindRaw] = text.trim().split(/\s+/);
  return [Number.parseInt(aheadRaw ?? "", 10), Number.parseInt(behindRaw ?? "", 10)];
}

function statusLabel(index: string, worktree: string): string {
  if (index === "?" || worktree === "?") return "untracked";
  if (index === "A" || worktree === "A") return "added";
  if (index === "M" || worktree === "M") return "modified";
  if (index === "D" || worktree === "D") return "deleted";
  if (index === "R" || worktree === "R") return "renamed";
  if (index === "C" || worktree === "C") return "copied";
  return `${index}${worktree}`.trim() || "unknown";
}

function nextActions(changedCount: number, returnedCount: number, warnings: string[]): string[] {
  const actions = [
    "Use changedFiles as metadata for `openskill-kit context --changed-file` or `finish-task --file`; do not request raw diffs unless the user explicitly asks.",
    "After verification, record safe outcome metadata with `openskill-kit finish-task --summary ... --diff-files ...`."
  ];
  if (changedCount === 0) actions.unshift("No changed files detected; local git context is clean.");
  if (changedCount > returnedCount) actions.push("Rerun with a higher maxChangedFiles only if the harness needs a broader file list.");
  if (warnings.length) actions.push("Review warnings before learning from this repository state.");
  return actions;
}

function clean(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

async function git(cwd: string, args: string[]): Promise<GitRunResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}
