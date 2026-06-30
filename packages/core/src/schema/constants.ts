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

export const OPENSKILLKIT_MCP_PROFILE_ENV = "OPENSKILLKIT_MCP_PROFILE";
export const OpenSkillMcpProfiles = ["public", "advanced"] as const;
export type OpenSkillMcpProfile = typeof OpenSkillMcpProfiles[number];

export const PUBLIC_MCP_PROFILE_TOOLS = [
  "osk_get_status",
  "osk_get_task_context",
  "osk_finish_task",
  "osk_plan_learning_sources",
  "osk_run_learning_plan",
  "osk_review_behavior",
  "osk_run_openworld_workflow",
  "osk_verify_behavior",
  "osk_compile_deploy",
  "osk_run_eval",
  "osk_pack_behavior",
  "osk_get_docs_help"
] as const;

export function normalizeCompileTargets(input: readonly string[]): CompileTarget[] {
  const allowed = new Set<string>(CompileTargets);
  const out: CompileTarget[] = [];
  for (const value of input) {
    if (allowed.has(value) && !out.includes(value as CompileTarget)) out.push(value as CompileTarget);
  }
  return out;
}
