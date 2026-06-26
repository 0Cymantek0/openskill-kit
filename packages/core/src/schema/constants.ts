export const PreferenceCategories = [
  "tooling",
  "architecture",
  "testing",
  "frontend",
  "backend",
  "api",
  "api-design",
  "security",
  "workflow",
  "style",
  "dependency-policy",
  "review-policy",
  "command-policy",
  "documentation",
  "error-handling",
  "general"
] as const;

export type PreferenceCategory = typeof PreferenceCategories[number];

export const ScopeLevels = [
  "project",
  "path",
  "directory",
  "package",
  "language",
  "task",
  "user",
  "global"
] as const;

export type ScopeLevel = typeof ScopeLevels[number];

export const PreferenceStatuses = ["candidate", "staged", "active", "rejected", "locked", "conflict"] as const;
export type PreferenceStatus = typeof PreferenceStatuses[number];

export const PreferencePolarities = ["positive", "negative", "neutral"] as const;
export type PreferencePolarity = typeof PreferencePolarities[number];

export const SignalKinds = [
  "explicit-preference",
  "acceptance",
  "rejection",
  "edit-delta",
  "tool-choice",
  "test-outcome",
  "review-feedback",
  "semantic-proposal",
  "repo-pattern"
] as const;

export type SignalKind = typeof SignalKinds[number];

export const CompileTargets = [
  "context-pack",
  "agent-skills",
  "hooks",
  "mcp-resources",
  "project-rules",
  "plugin"
] as const;

export type CompileTarget = typeof CompileTargets[number];

export const PolicyArtifactTargets = ["path-map", "command-policy", "review-checklist"] as const;
export type PolicyArtifactTarget = typeof PolicyArtifactTargets[number];

export const SuggestedCompileTargets = [...CompileTargets, ...PolicyArtifactTargets] as const;
export type SuggestedCompileTarget = typeof SuggestedCompileTargets[number];

export function normalizeCompileTargets(input: readonly string[]): CompileTarget[] {
  const allowed = new Set<string>(CompileTargets);
  const out: CompileTarget[] = [];
  for (const value of input) {
    if (allowed.has(value) && !out.includes(value as CompileTarget)) out.push(value as CompileTarget);
  }
  return out;
}
