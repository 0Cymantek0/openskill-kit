import { z } from "zod";

export const OskCommandVisibilitySchema = z.enum(["public", "public-alias", "advanced", "internal", "legacy"]);
export type OskCommandVisibility = z.infer<typeof OskCommandVisibilitySchema>;

export const OskApprovalClassSchema = z.enum([
  "read-only",
  "writes-osk-state",
  "writes-project-config",
  "runs-sandbox",
  "imports-external-source",
  "installs-harness-artifact",
  "shares-or-imports-pack"
]);
export type OskApprovalClass = z.infer<typeof OskApprovalClassSchema>;

export const OskCommandFamilySchema = z.object({
  schemaVersion: z.literal("openskill-kit.command-family.v1"),
  id: z.string().min(1),
  publicCommand: z.string().min(1),
  commandFile: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  visibility: OskCommandVisibilitySchema,
  oneLine: z.string().min(1),
  userIntent: z.string().min(1),
  whyPublic: z.string().min(1),
  mcpTool: z.string().min(1).optional(),
  cli: z.string().min(1),
  readOnly: z.boolean(),
  approvalRequired: z.boolean(),
  approvalClasses: z.array(OskApprovalClassSchema).default([]),
  skills: z.array(z.string()).default([]),
  subagents: z.array(z.string()).default([]),
  artifactsRead: z.array(z.string()).default([]),
  artifactsWrite: z.array(z.string()).default([]),
  neverReads: z.array(z.string()).default([]),
  neverWrites: z.array(z.string()).default([]),
  workflowSteps: z.array(z.string().min(1)).min(1),
  outputSummary: z.string().min(1),
  failureModes: z.array(z.object({
    code: z.string().min(1),
    userMessage: z.string().min(1),
    recovery: z.string().min(1)
  })).default([]),
  tests: z.array(z.string().min(1)).default([])
});
export type OskCommandFamily = z.infer<typeof OskCommandFamilySchema>;

export interface AgentPluginCommandProjection {
  command: string;
  aliases: string[];
  description: string;
  mcpTool?: string;
  cli: string;
  readOnly: boolean;
  approvalRequired: boolean;
  fallback: "cli";
  visibility: OskCommandVisibility;
  familyId: string;
}

const PRIVACY_NEVER_READS = [
  "raw prompts by default",
  "raw diffs by default",
  "user/global memories without explicit export approval",
  "shell history paths without explicit file selection",
  "hidden benchmark answers"
];

const PRIVACY_NEVER_WRITES = [
  "active learned behavior without review",
  "global harness config by default",
  "raw transcript copies into compiled artifacts"
];

export const OSK_PUBLIC_COMMAND_FAMILIES: OskCommandFamily[] = [
  family({
    id: "init",
    publicCommand: "/osk init",
    commandFile: "osk-init.md",
    aliases: ["openskill init", "bootstrap openskill"],
    oneLine: "Initialize project-local OSK state and preview harness attach.",
    userIntent: "Set up OpenSkillKit in this repository without silently taking over the harness.",
    whyPublic: "Bootstrap is a common first-run workflow that must discover surfaces, compile artifacts, and show safe next actions.",
    mcpTool: "osk_get_status",
    cli: "openskill-kit init && openskill-kit status",
    readOnly: false,
    approvalRequired: false,
    approvalClasses: ["writes-osk-state"],
    skills: ["osk-operating-manual"],
    subagents: ["osk-router"],
    artifactsRead: ["project harness metadata", ".openskill-kit/config.json"],
    artifactsWrite: [".openskill-kit/config.json", ".openskill-kit/detection/*"],
    workflowSteps: ["Initialize local OSK state if missing.", "Run status and detection.", "Show plugin readiness and dry-run attach next actions."],
    outputSummary: "Readiness, detected harnesses, privacy gates, and next command.",
    tests: ["init command appears in registry", "bootstrap never writes host config"]
  }),
  family({
    id: "status",
    publicCommand: "/osk status",
    commandFile: "osk-status.md",
    aliases: ["osk status", "openskill status"],
    oneLine: "Show behavior, review, plugin, and harness health.",
    userIntent: "Know whether OSK is ready and what needs attention.",
    whyPublic: "Status is the low-risk first call for any harness and the fallback when commands fail.",
    mcpTool: "osk_get_status",
    cli: "openskill-kit status",
    readOnly: true,
    approvalRequired: false,
    approvalClasses: ["read-only"],
    skills: ["osk-operating-manual"],
    subagents: ["osk-router"],
    artifactsRead: [".openskill-kit status artifacts", "compiled plugin status", "OpenWorld proof summary", "attach receipts"],
    artifactsWrite: [],
    workflowSteps: ["Read adaptive status.", "Read compiled plugin and attach status.", "Read OpenWorld artifact proof summary without running verifiers.", "Return compact next actions."],
    outputSummary: "Counts, readiness, descriptor drift, pending review, OpenWorld proof boundary, and next actions.",
    tests: ["status command remains read-only", "status reports OpenCode attach state", "status reports OpenWorld proof boundary"]
  }),
  family({
    id: "task",
    publicCommand: "/osk task",
    commandFile: "osk-task.md",
    aliases: ["/osk context", "/osk finish task", "osk task context", "osk task finish"],
    oneLine: "Load task context before work and record safe outcome after work.",
    userIntent: "Use the right project behavior now, then teach OSK from the completed task.",
    whyPublic: "Task start/finish is the daily workflow loop for harness users.",
    mcpTool: "osk_get_task_context",
    cli: "openskill-kit context --query \"<task>\"",
    readOnly: false,
    approvalRequired: false,
    approvalClasses: ["writes-osk-state"],
    skills: ["project-behavior", "project-workflows"],
    subagents: ["osk-router"],
    artifactsRead: ["preferences", "workflows", "review queue", "plugin status"],
    artifactsWrite: ["route trace", "safe task events when finishing"],
    workflowSteps: ["For context, call task-context facade first.", "For finish, call finish-task with safe summary, files, commands, and outcome.", "Stage learned behavior for review."],
    outputSummary: "Compact context or finish digest with review next actions.",
    tests: ["context returns plugin install profile", "finish stores summaries without raw diff"]
  }),
  family({
    id: "learn",
    publicCommand: "/osk learn",
    commandFile: "osk-learn.md",
    aliases: ["learn this session", "/osk learn from this session"],
    oneLine: "Plan and run explicit, review-gated learning from selected sources.",
    userIntent: "Teach OSK from current session, safe detected sources, or explicit imports.",
    whyPublic: "Learning touches private evidence, so it needs a visible source picker and approval boundary.",
    mcpTool: "osk_plan_learning_sources",
    cli: "openskill-kit osk learn",
    readOnly: false,
    approvalRequired: true,
    approvalClasses: ["writes-osk-state", "imports-external-source"],
    skills: ["osk-learning", "osk-review-gate"],
    subagents: ["osk-learner"],
    artifactsRead: ["detected surfaces", "interaction import receipts", "event metadata"],
    artifactsWrite: ["LearnSourcePlan", "LearnRun", "Evidence Cards", "review queue"],
    workflowSteps: ["Detect candidate learning sources.", "Ask or validate selected source.", "Preview explicit imports.", "Append redacted events only after approval.", "Run lifecycle learning and stage candidates."],
    outputSummary: "Sources considered/used, events appended, signals, evidence cards, candidate behavior, privacy statement.",
    failureModes: [
      { code: "explicit-import-required", userMessage: "Source needs preview/apply approval.", recovery: "Run preview first, then apply only after user approval." },
      { code: "raw-memory-blocked", userMessage: "Raw memory stores are blocked.", recovery: "Ask for an explicit export file." }
    ],
    tests: ["learn activates nothing", "all-detected excludes user memories and shell history"]
  }),
  family({
    id: "review",
    publicCommand: "/osk review",
    commandFile: "osk-review.md",
    aliases: ["/osk review pending behavior", "review behavior"],
    oneLine: "Inspect and approve, reject, lock, or demote candidate behavior.",
    userIntent: "Decide what learned behavior becomes active.",
    whyPublic: "Human review is the core safety boundary before activation.",
    mcpTool: "osk_review_behavior",
    cli: "openskill-kit review",
    readOnly: false,
    approvalRequired: true,
    approvalClasses: ["writes-osk-state"],
    skills: ["osk-review-gate"],
    subagents: ["osk-reviewer"],
    artifactsRead: ["review queue", "Evidence Cards", "Preference Graph", "Workflow Graph"],
    artifactsWrite: ["review decisions", "calibration report"],
    workflowSteps: ["Show pending behavior with evidence.", "Explain risk and compile impact.", "Apply selected review action only when requested."],
    outputSummary: "Pending items, evidence summaries, actions taken, and compile next action.",
    tests: ["review queue shows sanitized evidence", "actions update calibration"]
  }),
  family({
    id: "research",
    publicCommand: "/osk research",
    commandFile: "osk-research.md",
    aliases: ["/osk openworld source plan", "osk ow source plan"],
    oneLine: "Plan leakage-audited sources and anchors for unfamiliar tasks.",
    userIntent: "Find grounded knowledge and verifier anchors without leaking target answers.",
    whyPublic: "OpenWorld research is the first visible paper-style workflow stage.",
    mcpTool: "osk_run_openworld_workflow",
    cli: "openskill-kit openworld source-plan --task-id <task-id>",
    readOnly: false,
    approvalRequired: false,
    approvalClasses: ["writes-osk-state"],
    skills: ["osk-openworld"],
    subagents: ["osk-researcher"],
    artifactsRead: ["OpenWorld task", "allowed local files", "explicit URLs"],
    artifactsWrite: ["Source Cards", "Anchor Cards", "leakage audit"],
    workflowSteps: ["Check leakage barrier.", "Plan local and explicit web sources.", "Draft anchor candidates with provenance."],
    outputSummary: "Source plan, blocked candidates, proof level, and next evolve/verify command.",
    tests: ["research labels proof level", "blocked identifiers never appear in queries"]
  }),
  family({
    id: "evolve",
    publicCommand: "/osk evolve",
    commandFile: "osk-evolve.md",
    aliases: ["/osk evolve this skill", "evolve skill"],
    oneLine: "Generate review-only candidate skills from anchored OpenWorld evidence.",
    userIntent: "Create a new source-grounded skill when local memory is not enough.",
    whyPublic: "Evolution is a high-value product workflow distinct from local learning.",
    mcpTool: "osk_run_openworld_workflow",
    cli: "openskill-kit openworld refine --task-id <task-id> --suite-id <suite-id> --candidate-id <candidate-id>",
    readOnly: false,
    approvalRequired: false,
    approvalClasses: ["writes-osk-state", "runs-sandbox"],
    skills: ["osk-openworld"],
    subagents: ["osk-evolver", "osk-verifier"],
    artifactsRead: ["Anchor Cards", "candidate skills", "verifier suites"],
    artifactsWrite: ["candidate skill revisions", "EvolutionRun"],
    workflowSteps: ["Generate or select candidate skill.", "Run visible verifier refinement.", "Run holdout check.", "Keep promotion review-only."],
    outputSummary: "Candidate, verifier results, proof level, limitations, and review next action.",
    tests: ["evolve never directly activates behavior", "holdout run reports limitations"]
  }),
  family({
    id: "verify",
    publicCommand: "/osk verify",
    commandFile: "osk-verify.md",
    aliases: ["/osk openworld verifier quality", "/osk openworld run verifier", "osk ow verify"],
    oneLine: "Run integrity, privacy, verifier, and proof-boundary checks.",
    userIntent: "Know whether behavior or OpenWorld artifacts are safe and credible.",
    whyPublic: "Verification is the trust surface before deploy, pack, or promotion.",
    mcpTool: "osk_verify_behavior",
    cli: "openskill-kit openworld verifier-quality --task-id <task-id> --suite-id <suite-id>",
    readOnly: false,
    approvalRequired: false,
    approvalClasses: ["writes-osk-state", "runs-sandbox"],
    skills: ["osk-review-gate", "osk-openworld"],
    subagents: ["osk-verifier"],
    artifactsRead: ["compiled artifacts", "verifier suites", "OpenWorld reports"],
    artifactsWrite: ["verification reports"],
    workflowSteps: ["Check descriptor integrity, command smell, OpenCode collisions, public MCP profile size, and generated artifact bloat.", "Check leakage and proof labels.", "Run verifier/sandbox only with explicit mode."],
    outputSummary: "Pass/fail checks, proof level, hiddenOracleProof flag, and remediation.",
    tests: ["artifact verifier does not claim hidden oracle proof", "raw prompts absent from compiled plugin"]
  }),
  family({
    id: "compile",
    publicCommand: "/osk compile",
    commandFile: "osk-compile.md",
    aliases: ["/osk update skills", "/osk update AGENTS.md", "osk compile"],
    oneLine: "Compile active reviewed behavior into harness artifacts.",
    userIntent: "Refresh skills, command maps, MCP descriptors, hooks, and manifests.",
    whyPublic: "Compile is the visible boundary between reviewed behavior and generated artifacts.",
    mcpTool: "osk_compile_deploy",
    cli: "openskill-kit compile --target plugin",
    readOnly: false,
    approvalRequired: false,
    approvalClasses: ["writes-osk-state"],
    skills: ["osk-operating-manual"],
    subagents: [],
    artifactsRead: ["active preferences", "active workflows", "config"],
    artifactsWrite: [".openskill-kit/compiled/*"],
    workflowSteps: ["Compile from active reviewed behavior only.", "Generate command maps and host artifacts.", "Run integrity hashes."],
    outputSummary: "Compiled targets, artifact paths, descriptor hashes, and attach next action.",
    tests: ["command maps generated from registry", "OpenCode commands generated"]
  }),
  family({
    id: "deploy",
    publicCommand: "/osk deploy",
    commandFile: "osk-deploy.md",
    aliases: ["/osk attach plugin", "osk attach", "deploy opencode"],
    oneLine: "Preview or apply project-local harness attachment with receipts.",
    userIntent: "Make the current harness use OSK artifacts safely.",
    whyPublic: "Deploy writes host config and must be dry-run first.",
    mcpTool: "osk_compile_deploy",
    cli: "openskill-kit agent attach-plugin --host opencode --dry-run",
    readOnly: false,
    approvalRequired: true,
    approvalClasses: ["writes-project-config", "installs-harness-artifact"],
    skills: ["osk-operating-manual"],
    subagents: ["osk-router"],
    artifactsRead: ["compiled plugin", "host config"],
    artifactsWrite: ["project-local host config", ".opencode/*", "attach receipts"],
    workflowSteps: ["Compile plugin if needed.", "Preview exact host config changes.", "Apply only with explicit approval.", "Write receipt."],
    outputSummary: "Planned/applied files, diff summary, receipt, restart instructions.",
    tests: ["deploy dry-run does not write host config", "OpenCode patch preserves user config"]
  }),
  family({
    id: "eval",
    publicCommand: "/osk eval",
    commandFile: "osk-eval.md",
    aliases: ["/osk run behavior eval", "behavior eval"],
    oneLine: "Measure OSK behavior through replay or external-agent evals.",
    userIntent: "Check whether OSK improves outcomes and does not bloat context.",
    whyPublic: "Evaluation proves the behavior layer works in real workflows.",
    mcpTool: "osk_run_eval",
    cli: "openskill-kit eval",
    readOnly: false,
    approvalRequired: false,
    approvalClasses: ["writes-osk-state"],
    skills: ["osk-operating-manual"],
    subagents: ["osk-evaluator"],
    artifactsRead: ["eval fixtures", "compiled behavior", "review outcomes"],
    artifactsWrite: ["eval reports", "calibration events"],
    workflowSteps: ["Run replay or configured external-agent eval.", "Summarize pass/fail and deltas.", "Record calibration-safe outcomes."],
    outputSummary: "Eval status, baseline comparison if present, artifacts, and residual risk.",
    tests: ["behavior eval records calibration", "external eval remains opt-in"]
  }),
  family({
    id: "pack",
    publicCommand: "/osk pack",
    commandFile: "osk-pack.md",
    aliases: ["/osk sync project behavior pack", "sync behavior pack"],
    oneLine: "Export, verify, diff, sign, or import behavior packs through trust gates.",
    userIntent: "Share or import reviewed behavior without private evidence leakage.",
    whyPublic: "Pack operations cross project boundaries and need explicit provenance.",
    mcpTool: "osk_pack_behavior",
    cli: "openskill-kit pack export",
    readOnly: false,
    approvalRequired: true,
    approvalClasses: ["shares-or-imports-pack"],
    skills: ["osk-review-gate"],
    subagents: ["osk-reviewer"],
    artifactsRead: ["active behavior", "pack metadata", "signatures"],
    artifactsWrite: ["behavior packs", "pack import reviews"],
    workflowSteps: ["Export only share-safe behavior.", "Verify signatures and privacy.", "Import as staged review items only."],
    outputSummary: "Pack path, signature state, included/excluded classes, and review next action.",
    tests: ["pack excludes private vault", "import never activates directly"]
  })
];

export const OSK_PUBLIC_COMMAND_COUNT = 12;

export function validateOskCommandFamilies(families: OskCommandFamily[] = OSK_PUBLIC_COMMAND_FAMILIES): OskCommandFamily[] {
  const parsed = families.map((item) => OskCommandFamilySchema.parse(item));
  const publicFamilies = parsed.filter((item) => item.visibility === "public");
  if (publicFamilies.length !== OSK_PUBLIC_COMMAND_COUNT) throw new Error(`Expected ${OSK_PUBLIC_COMMAND_COUNT} public OSK command families, got ${publicFamilies.length}`);
  assertUnique(parsed.map((item) => item.id), "command family id");
  assertUnique(parsed.map((item) => item.publicCommand), "public command");
  assertUnique(parsed.map((item) => item.commandFile), "command file");
  return parsed;
}

export function pluginCommandProjections(families: OskCommandFamily[] = OSK_PUBLIC_COMMAND_FAMILIES): AgentPluginCommandProjection[] {
  return validateOskCommandFamilies(families).map((item) => ({
    command: item.publicCommand,
    aliases: item.aliases,
    description: item.oneLine,
    mcpTool: item.mcpTool,
    cli: item.cli,
    readOnly: item.readOnly,
    approvalRequired: item.approvalRequired,
    fallback: "cli",
    visibility: item.visibility,
    familyId: item.id
  }));
}

function family(input: Omit<OskCommandFamily, "schemaVersion" | "visibility" | "neverReads" | "neverWrites" | "failureModes" | "tests"> & Partial<Pick<OskCommandFamily, "failureModes" | "tests" | "neverReads" | "neverWrites">>): OskCommandFamily {
  return OskCommandFamilySchema.parse({
    schemaVersion: "openskill-kit.command-family.v1",
    visibility: "public",
    neverReads: input.neverReads ?? PRIVACY_NEVER_READS,
    neverWrites: input.neverWrites ?? PRIVACY_NEVER_WRITES,
    failureModes: input.failureModes ?? [],
    tests: input.tests ?? [],
    ...input
  });
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}
