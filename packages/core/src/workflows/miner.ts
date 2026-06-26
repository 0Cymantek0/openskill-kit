import { createHash } from "node:crypto";
import path from "node:path";
import type { OpenSkillEvent } from "../events/schema.js";
import { readEvents, readProjectConfig } from "../events/store.js";
import { readWorkflowGraph, writeWorkflowGraph, writeWorkflowMiningEvidence } from "./store.js";
import { WorkflowGraphSchema, WorkflowMiningEvidenceSchema, WorkflowNodeSchema, type WorkflowGraph, type WorkflowNode } from "./schema.js";

export interface MineWorkflowGraphOptions {
  projectRoot: string;
  minOccurrences?: number;
  maxSequenceLength?: number;
  now?: Date;
}

export interface MineWorkflowGraphResult {
  schemaVersion: "openskill-kit.workflow-mining-result.v1";
  graph: WorkflowGraph;
  mined: WorkflowNode[];
  updated: WorkflowNode[];
  graphPath: string;
  evidencePaths: string[];
  messages: string[];
}

interface SessionSequence {
  sessionId: string;
  eventIds: string[];
  commands: string[];
  files: string[];
  timestamp: string;
}

interface MinedWorkflow {
  node: WorkflowNode;
  occurrences: SessionSequence[];
  sequenceHash: string;
}

export async function mineWorkflowGraph(options: MineWorkflowGraphOptions): Promise<MineWorkflowGraphResult> {
  const root = path.resolve(options.projectRoot);
  const now = options.now ?? new Date();
  const config = await readProjectConfig(root);
  const events = await readEvents(root);
  const minOccurrences = options.minOccurrences ?? 2;
  const maxSequenceLength = options.maxSequenceLength ?? 6;
  const current = await readWorkflowGraph(root, config.projectId, now);
  const minedEntries = mineRepeatedCommandSequences(events, minOccurrences, maxSequenceLength, now, config.learning.mode);
  const mined = minedEntries.map((entry) => entry.node);
  const minedById = new Map(minedEntries.map((entry) => [entry.node.id, entry]));
  const existingById = new Map(current.nodes.map((node) => [node.id, node]));
  const updated: WorkflowNode[] = [];
  for (const node of mined) {
    const existing = existingById.get(node.id);
    if (existing && (existing.status === "active" || existing.status === "locked" || existing.status === "rejected")) continue;
    existingById.set(node.id, existing ? {
      ...node,
      lifecycle: {
        ...node.lifecycle,
        createdAt: existing.lifecycle?.createdAt ?? node.lifecycle?.createdAt ?? now.toISOString(),
        updatedAt: node.lifecycle?.updatedAt ?? now.toISOString()
      }
    } : node);
    updated.push(existingById.get(node.id)!);
  }
  const graph = WorkflowGraphSchema.parse({
    schemaVersion: "openskill-kit.workflow-graph.v1",
    projectId: current.projectId,
    nodes: [...existingById.values()].sort((left, right) => right.confidence - left.confidence || left.name.localeCompare(right.name)),
    conflicts: current.conflicts,
    updatedAt: now.toISOString()
  });
  const graphPath = await writeWorkflowGraph(root, graph);
  const evidencePaths = await Promise.all(updated.map((node) => writeWorkflowMiningEvidence(root, WorkflowMiningEvidenceSchema.parse({
    schemaVersion: "openskill-kit.workflow-mining-evidence.v1",
    workflowId: node.id,
    sequenceHash: minedById.get(node.id)?.sequenceHash ?? node.id.replace(/^wf_/, ""),
    occurrences: (minedById.get(node.id)?.occurrences ?? []).map((occurrence) => ({
      sessionId: occurrence.sessionId,
      timestamp: occurrence.timestamp,
      eventIds: occurrence.eventIds,
      commandFingerprint: node.trigger.commands.join(" && "),
      pathCluster: occurrence.files.map(pathRoot).filter(Boolean)
    })),
    commandFingerprints: node.trigger.commands,
    pathClusters: node.trigger.paths.length ? [node.trigger.paths] : []
  }))));
  return {
    schemaVersion: "openskill-kit.workflow-mining-result.v1",
    graph,
    mined,
    updated,
    graphPath,
    evidencePaths,
    messages: [
      `Mined ${mined.length} repeated workflow candidate(s).`,
      updated.length ? `Updated ${updated.length} workflow graph node(s).` : "No workflow graph updates needed.",
      "Workflow nodes remain candidate/staged until explicit review promotes them."
    ]
  };
}

export function renderWorkflowGraph(graph: WorkflowGraph): string {
  const lines = [
    "# Workflow Graph",
    "",
    `Project: ${graph.projectId}`,
    `Updated: ${graph.updatedAt}`,
    `Nodes: ${graph.nodes.length}`,
    "",
    "| ID | Status | Confidence | Trigger Commands | Steps |",
    "| --- | --- | --- | --- | --- |",
    ...graph.nodes.map((node) => `| ${cell(node.id)} | ${node.status} | ${format(node.confidence)} | ${cell(node.trigger.commands.join(" -> ") || "n/a")} | ${cell(node.steps.map((step) => step.instruction).join(" -> "))} |`)
  ];
  return `${lines.join("\n")}\n`;
}

function mineRepeatedCommandSequences(events: OpenSkillEvent[], minOccurrences: number, maxSequenceLength: number, now: Date, learningMode: string): MinedWorkflow[] {
  const bySession = new Map<string, OpenSkillEvent[]>();
  for (const event of events) bySession.set(event.sessionId, [...(bySession.get(event.sessionId) ?? []), event]);
  const sequences = [...bySession.entries()]
    .map(([sessionId, sessionEvents]) => sequenceFromSession(sessionId, sessionEvents, maxSequenceLength))
    .filter((sequence): sequence is SessionSequence => sequence !== undefined);
  const byFingerprint = new Map<string, SessionSequence[]>();
  for (const sequence of sequences) {
    const fingerprint = sequence.commands.join("\n");
    byFingerprint.set(fingerprint, [...(byFingerprint.get(fingerprint) ?? []), sequence]);
  }
  const mined: MinedWorkflow[] = [];
  for (const [fingerprint, occurrences] of byFingerprint) {
    if (occurrences.length < minOccurrences) continue;
    const commands = fingerprint.split("\n");
    const paths = [...new Set(occurrences.flatMap((occurrence) => occurrence.files.map(pathRoot)))].filter(Boolean).sort();
    const confidence = Math.min(0.92, Math.round((0.46 + occurrences.length * 0.13 + Math.min(commands.length, 4) * 0.04) * 100) / 100);
    const sequenceHash = hash(fingerprint);
    const id = `wf_${sequenceHash.slice(0, 16)}`;
    const status = learningMode === "auto-stage" && confidence >= 0.72 ? "staged" : "candidate";
    const node = WorkflowNodeSchema.parse({
      schemaVersion: "openskill-kit.workflow-node.v1",
      id,
      name: `${commands[0]} workflow`,
      description: `Repeated ${occurrences.length} time(s): ${commands.join(" -> ")}`,
      trigger: {
        paths,
        taskTypes: inferTaskTypes(commands),
        commands,
        naturalLanguagePatterns: []
      },
      steps: [
        ...commands.map((command, index) => ({
          id: `step-${index + 1}`,
          kind: "command",
          instruction: `Run ${command}`,
          command,
          optional: false
        })),
        {
          id: `step-${commands.length + 1}`,
          kind: "summarize",
          instruction: "Summarize workflow outcome and any failing command before final response.",
          optional: false
        }
      ],
      sourceSignalIds: [...new Set(occurrences.flatMap((occurrence) => occurrence.eventIds))].sort(),
      occurrenceCount: occurrences.length,
      confidence,
      status,
      compileTargets: ["skill", "command-policy", "review-checklist"],
      privacy: {
        class: "project-private",
        rationale: "Workflow mined from repeated project-local command sequences."
      },
      lifecycle: {
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      }
    });
    mined.push({ node, occurrences, sequenceHash });
  }
  return mined;
}

function sequenceFromSession(sessionId: string, events: OpenSkillEvent[], maxSequenceLength: number): SessionSequence | undefined {
  const sorted = [...events].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const commands: string[] = [];
  const eventIds: string[] = [];
  const files = new Set<string>();
  for (const event of sorted) {
    for (const file of event.files) files.add(file.path);
    for (const command of event.commands) {
      if (command.status !== "pass") continue;
      const rendered = [command.command, ...command.args].join(" ").trim();
      if (!rendered || commands.at(-1) === rendered) continue;
      commands.push(rendered);
      eventIds.push(event.id);
      if (commands.length >= maxSequenceLength) break;
    }
    if (commands.length >= maxSequenceLength) break;
  }
  if (commands.length < 2) return undefined;
  return {
    sessionId,
    eventIds,
    commands,
    files: [...files].sort(),
    timestamp: sorted.at(-1)?.timestamp ?? new Date(0).toISOString()
  };
}

function inferTaskTypes(commands: string[]): string[] {
  const joined = commands.join(" ").toLowerCase();
  const types = new Set<string>();
  if (/\b(test|vitest|jest|pytest)\b/.test(joined)) types.add("testing");
  if (/\b(typecheck|tsc)\b/.test(joined)) types.add("typescript");
  if (/\b(build|pack)\b/.test(joined)) types.add("release");
  return [...types].sort();
}

function pathRoot(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0] ?? "";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function format(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ").slice(0, 180);
}
