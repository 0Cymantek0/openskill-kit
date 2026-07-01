import type { LearnV2ConceptCard } from "./schemas.js";

/**
 * CommandPolicyRule is the structured conditional command policy artifact described in
 * Plan §27.7. The current compiler renders command-like preferences and workflow commands
 * as flat text; this module produces structured, machine-readable command policies that
 * distinguish available / suggested / required / avoid commands, with conditional scope,
 * cost class, evidence linkage, and known failure modes.
 *
 * Why this matters: Scenario 6 in the plan (command policy conditionality) is a core
 * differentiator. Repeated `npm test` must become "when touching parser files, run the
 * focused parser test first", not an unconditional rule. The structured schema enables
 * agents, hooks, and review checklists to consume command policy deterministically
 * instead of pattern-matching rendered markdown.
 */

export interface CommandPolicyRule {
  id: string;
  conceptId: string;
  command: string;
  status: "available" | "suggested" | "required" | "avoid";
  appliesWhen: string[];
  doesNotApplyWhen: string[];
  scopePaths: string[];
  taskTypes: string[];
  confidence: number;
  evidenceConceptIds: string[];
  failureModes: string[];
  costClass: "cheap" | "normal" | "expensive" | "destructive";
}

export interface CompiledCommandPolicy {
  schemaVersion: "openskill-kit.learn-v2.command-policy.v1";
  generatedAt: string;
  rules: CommandPolicyRule[];
  artifacts: {
    json: string;
    markdown: string;
  };
}

const DESTRUCTIVE_COMMAND_PATTERNS = /\b(?:rm\s+-rf|drop\s+table|truncate|force\s+push|git\s+push\s+--force|DELETE\s+FROM|format\s+[A-Z]:)\b/i;
const EXPENSIVE_COMMAND_HINTS = /\b(?:full\s+suite|integration|e2e|deploy|release|build\s+all|ci\s+run)\b/i;
const FOCUSED_COMMAND_HINTS = /\b(?:test:|spec|parser|unit|focused|single|watch)\b/i;

/**
 * Build CommandPolicyRules from active concept cards.
 *
 * Deterministic mapping:
 * - command-policy concepts with positive polarity -> "suggested" under scope conditions.
 * - command-policy concepts with negative polarity -> "avoid".
 * - security concepts with command-like activation -> "required" under scope conditions.
 * - Available commands from package scripts / repo context are NOT invented here;
 *   they come from the existing repo-pattern / docs adapters and are left as
 *   "available" status only when a concept explicitly references them.
 */
export function buildLearnV2CommandPolicyRules(cards: LearnV2ConceptCard[]): CommandPolicyRule[] {
  const rules: CommandPolicyRule[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    if (card.status !== "active" && card.status !== "locked") continue;
    const commands = card.activation.commands.length
      ? card.activation.commands
      : extractCommandsFromBehavior(card.canonicalBehavior);
    for (const command of commands) {
      const dedupeKey = `${card.id}:${command}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rules.push(buildRule(card, command));
    }
    if (!commands.length && card.atoms.some((atom) => atom.kind === "command-policy")) {
      // Command-policy concept without explicit command text; emit a scope-only
      // available hint so the policy is traceable even if the command is generic.
      rules.push(buildRule(card, "<project-verification-command>"));
    }
  }
  return rules.sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.confidence - a.confidence);
}

function buildRule(card: LearnV2ConceptCard, command: string): CommandPolicyRule {
  const atom = card.atoms.find((item) => item.kind === "command-policy") ?? card.atoms[0]!;
  const isNegative = atom.polarity === "negative";
  const isSecurity = card.atoms.some((item) => item.kind === "security");
  const status: CommandPolicyRule["status"] = isNegative
    ? "avoid"
    : isSecurity
      ? "required"
      : FOCUSED_COMMAND_HINTS.test(command) || FOCUSED_COMMAND_HINTS.test(card.canonicalBehavior)
        ? "suggested"
        : "available";
  return {
    id: `cmd_${card.id.replace(/^concept_/, "")}_${hashCommand(command)}`,
    conceptId: card.id,
    command,
    status,
    appliesWhen: buildAppliesWhen(card),
    doesNotApplyWhen: buildDoesNotApplyWhen(card),
    scopePaths: card.scope.paths.slice(0, 20),
    taskTypes: card.scope.taskTypes.slice(0, 12),
    confidence: card.confidence,
    evidenceConceptIds: [card.id],
    failureModes: inferFailureModes(command, card),
    costClass: inferCostClass(command)
  };
}

function buildAppliesWhen(card: LearnV2ConceptCard): string[] {
  const conditions: string[] = [];
  if (card.scope.paths.length) conditions.push(`Changes touch ${card.scope.paths.slice(0, 4).join(" or ")}`);
  if (card.scope.taskTypes.length) conditions.push(`Task type is ${card.scope.taskTypes.slice(0, 4).join(" or ")}`);
  if (card.activation.phrases.length) conditions.push(`Context matches: ${card.activation.phrases.slice(0, 4).join(", ")}`);
  if (!conditions.length) conditions.push("Task scope matches this concept");
  return conditions;
}

function buildDoesNotApplyWhen(card: LearnV2ConceptCard): string[] {
  const exclusions = [...card.scope.negativeTriggers];
  if (card.scope.taskTypes.length) exclusions.push(`Task is not ${card.scope.taskTypes.slice(0, 3).join(" or ")}`);
  if (!exclusions.length) exclusions.push("Direct user instruction overrides this policy");
  return exclusions.slice(0, 6);
}

function inferFailureModes(command: string, card: LearnV2ConceptCard): string[] {
  const modes: string[] = [];
  if (/\b(?:full|all|integration|e2e)\b/i.test(command)) modes.push("expensive-or-slow");
  if (/\b(?:flaky|timeout|timed?\s*out)\b/i.test(card.canonicalBehavior)) modes.push("known-flaky");
  if (DESTRUCTIVE_COMMAND_PATTERNS.test(command)) modes.push("destructive-if-mistargeted");
  if (/\b(?:watch|serve|dev)\b/i.test(command)) modes.push("long-running-blocking");
  if (!modes.length) modes.push("passes-when-environment-healthy");
  return modes;
}

function inferCostClass(command: string): CommandPolicyRule["costClass"] {
  if (DESTRUCTIVE_COMMAND_PATTERNS.test(command)) return "destructive";
  if (EXPENSIVE_COMMAND_HINTS.test(command)) return "expensive";
  if (FOCUSED_COMMAND_HINTS.test(command)) return "cheap";
  if (/\b(?:lint|format|typecheck|tsc|eslint|prettier)\b/i.test(command)) return "cheap";
  return "normal";
}

function extractCommandsFromBehavior(behavior: string): string[] {
  return [...behavior.matchAll(/`([^`]+)`/g)].map((match) => match[1]!).filter((cmd) => /\s/.test(cmd) || /^[a-z]/i.test(cmd)).slice(0, 6);
}

function statusRank(status: CommandPolicyRule["status"]): number {
  return status === "required" ? 0 : status === "suggested" ? 1 : status === "available" ? 2 : 3;
}

function hashCommand(command: string): string {
  let hash = 0;
  for (let index = 0; index < command.length; index++) {
    hash = ((hash << 5) - hash + command.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 10);
}

export function renderLearnV2CommandPolicyMarkdown(rules: CommandPolicyRule[]): string {
  if (!rules.length) return "# Learn v2 Command Policy\n\nNo active command policies.\n";
  const grouped = {
    required: rules.filter((rule) => rule.status === "required"),
    suggested: rules.filter((rule) => rule.status === "suggested"),
    available: rules.filter((rule) => rule.status === "available"),
    avoid: rules.filter((rule) => rule.status === "avoid")
  };
  const lines = ["# Learn v2 Command Policy", ""];
  for (const [label, group] of Object.entries(grouped)) {
    if (!group.length) continue;
    lines.push(`## ${label.charAt(0).toUpperCase() + label.slice(1)}`, "");
    for (const rule of group) {
      lines.push(`### \`${rule.command}\``, "");
      lines.push(`- Confidence: ${rule.confidence.toFixed(2)}`);
      lines.push(`- Cost: ${rule.costClass}`);
      lines.push(`- Concept: ${rule.conceptId}`);
      if (rule.appliesWhen.length) lines.push(`- Applies when: ${rule.appliesWhen.join("; ")}`);
      if (rule.doesNotApplyWhen.length) lines.push(`- Does not apply when: ${rule.doesNotApplyWhen.join("; ")}`);
      if (rule.scopePaths.length) lines.push(`- Scope paths: ${rule.scopePaths.join(", ")}`);
      if (rule.taskTypes.length) lines.push(`- Task types: ${rule.taskTypes.join(", ")}`);
      if (rule.failureModes.length) lines.push(`- Failure modes: ${rule.failureModes.join(", ")}`);
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}
