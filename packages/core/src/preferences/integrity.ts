import path from "node:path";
import { promises as fs } from "node:fs";
import { readEvents } from "../events/store.js";
import { redactValue } from "../events/redaction.js";
import type { ProjectConfig } from "../config/schema.js";
import type { OpenSkillEvent } from "../events/schema.js";
import type { PreferenceNode } from "./schema.js";
import { detectConflicts } from "./conflict.js";
import { migratePreferenceGraph } from "./migrations.js";
import { writeJsonAtomic } from "../storage/atomic.js";

export interface MemoryIntegrityIssue {
  nodeId: string;
  severity: "warn" | "fail";
  code:
    | "missing-evidence"
    | "missing-source-event"
    | "secret-like-content"
    | "prompt-injection-marker"
    | "hidden-behavior"
    | "destructive-command"
    | "global-promotion"
    | "locked-conflict";
  message: string;
}

export interface MemoryIntegrityReport {
  schemaVersion: "openskill-kit.memory-integrity.v1";
  status: "pass" | "warn" | "fail";
  checkedAt: string;
  nodeCount: number;
  issues: MemoryIntegrityIssue[];
}

export async function validateMemoryIntegrity(projectRoot: string, nodes?: PreferenceNode[], config?: ProjectConfig): Promise<MemoryIntegrityReport> {
  const root = path.resolve(projectRoot);
  const graph = nodes ? undefined : await readGraph(root);
  const checkedNodes = nodes ?? graph?.nodes ?? [];
  const events = await readEvents(root).catch(() => []);
  const eventIds = new Set(events.map((event) => event.id));
  const issues = validateMemoryNodes(checkedNodes, { eventIds, events, config });
  const status = issues.some((issue) => issue.severity === "fail") ? "fail" : issues.length ? "warn" : "pass";
  return {
    schemaVersion: "openskill-kit.memory-integrity.v1",
    status,
    checkedAt: new Date().toISOString(),
    nodeCount: checkedNodes.length,
    issues
  };
}

async function readGraph(root: string): Promise<{ nodes: PreferenceNode[] }> {
  return fs.readFile(path.join(root, ".openskill-kit", "preferences", "graph.json"), "utf8")
    .then((text) => migratePreferenceGraph(JSON.parse(text)))
    .catch(() => ({ nodes: [] }));
}

export function validateMemoryNodes(
  nodes: PreferenceNode[],
  context: { eventIds?: Set<string>; events?: OpenSkillEvent[]; config?: ProjectConfig } = {}
): MemoryIntegrityIssue[] {
  const issues: MemoryIntegrityIssue[] = [];
  const eventIds = context.eventIds ?? new Set<string>();
  for (const node of nodes) {
    if (!node.evidence.length) {
      issues.push(issue(node, "warn", "missing-evidence", "Preference has no evidence references."));
    }
    for (const evidence of node.evidence) {
      for (const eventId of evidence.eventIds) {
        if (eventIds.size > 0 && !eventIds.has(eventId)) {
          issues.push(issue(node, "warn", "missing-source-event", `Evidence event not found: ${eventId}`));
        }
      }
      if (evidence.quote && context.config?.privacy.redactSecrets !== false) {
        const redacted = redactValue(evidence.quote, context.config);
        if (redacted.redacted) issues.push(issue(node, "fail", "secret-like-content", `Evidence quote matched redaction rules: ${redacted.matches.join(", ")}`));
      }
    }
    const statement = node.statement.toLowerCase();
    if (/ignore (all |any |the )?(previous|prior|system|developer) instructions/.test(statement)) {
      issues.push(issue(node, "fail", "prompt-injection-marker", "Statement contains instruction override language."));
    }
    if (/(hide|conceal|do not mention|don't mention|secretly|without telling).{0,80}(behavior|rule|instruction|preference|memory)/.test(statement)) {
      issues.push(issue(node, "fail", "hidden-behavior", "Statement attempts to hide behavior from users or agents."));
    }
    if (/(rm -rf|drop table|delete all|format disk|erase database|truncate table)/.test(statement) && node.status !== "locked") {
      issues.push(issue(node, "fail", "destructive-command", "Destructive command preferences require manual locked status."));
    }
    if (node.scope.level === "global" && node.status !== "locked") {
      issues.push(issue(node, "warn", "global-promotion", "Global-scope preferences should be explicitly locked after review."));
    }
  }
  const lockedConflicts = detectConflicts(nodes.filter((node) => node.status === "locked" || node.status === "active"));
  for (const conflict of lockedConflicts) {
    for (const nodeId of conflict.nodeIds) {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (node?.status === "locked") issues.push(issue(node, "fail", "locked-conflict", conflict.reason));
    }
  }
  return dedupeIssues(issues);
}

export async function writeMemoryIntegrityReport(projectRoot: string, report: MemoryIntegrityReport): Promise<string> {
  const file = path.join(path.resolve(projectRoot), ".openskill-kit", "preferences", "integrity-report.json");
  await writeJsonAtomic(file, report);
  return file;
}

function issue(node: PreferenceNode, severity: MemoryIntegrityIssue["severity"], code: MemoryIntegrityIssue["code"], message: string): MemoryIntegrityIssue {
  return { nodeId: node.id, severity, code, message };
}

function dedupeIssues(issues: MemoryIntegrityIssue[]): MemoryIntegrityIssue[] {
  const seen = new Set<string>();
  const out: MemoryIntegrityIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.nodeId}:${issue.severity}:${issue.code}:${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}
