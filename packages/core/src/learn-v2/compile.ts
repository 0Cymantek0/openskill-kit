import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ProjectConfig } from "../config/schema.js";
import type { PreferenceNode } from "../preferences/schema.js";
import type { WorkflowNode } from "../workflows/schema.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import type { LearnV2ConceptCard } from "./schemas.js";
import { learnV2ShortHash } from "./utils.js";
import { LEARN_V2_GENERATED_DIRS, LEARN_V2_GENERATED_FILES } from "./paths.js";


export interface LearnV2CompilePreview {
  schemaVersion: "openskill-kit.learn-v2.compile-preview.v1";
  generatedAt: string;
  activeConceptCount: number;
  candidateConceptCount: number;
  preferenceNodes: PreferenceNode[];
  workflowNodes: WorkflowNode[];
  declassificationReport: {
    rawRefsExported: false;
    blockedPrivatePaths: string[];
    placeholders: string[];
    status: "pass" | "fail";
    issues: string[];
  };
  artifacts: {
    json: string;
    markdown: string;
  };
}

export async function compileLearnV2ConceptPreview(rootInput: string, config: ProjectConfig, cards: LearnV2ConceptCard[], now: Date): Promise<LearnV2CompilePreview> {
  const root = path.resolve(rootInput);
  const active = cards.filter((card) => card.status === "active" || card.status === "locked");
  const candidate = cards.filter((card) => card.status === "candidate" || card.status === "staged" || card.status === "conflict");
  const preferenceNodes = active.map((card) => conceptToPreference(config.projectId, card, now));
  const workflowNodes = active.filter((card) => card.atoms.some((atom) => atom.kind === "workflow" || atom.kind === "command-policy" || atom.kind === "verification"))
    .map((card) => conceptToWorkflow(card, now));
  const report = declassificationReport(cards, preferenceNodes, workflowNodes);
  const dir = path.join(root, ".openskill-kit", "learn-v2", "compiled-preview");
  const json = path.join(dir, "concept-compile-preview.json");
  const markdown = path.join(dir, "concept-compile-preview.md");
  const preview: LearnV2CompilePreview = {
    schemaVersion: "openskill-kit.learn-v2.compile-preview.v1",
    generatedAt: now.toISOString(),
    activeConceptCount: active.length,
    candidateConceptCount: candidate.length,
    preferenceNodes,
    workflowNodes,
    declassificationReport: report,
    artifacts: { json, markdown }
  };
  await writeJsonAtomic(json, preview);
  await fs.writeFile(markdown, renderCompilePreview(preview), "utf8");
  return preview;
}

function conceptToPreference(projectId: string, card: LearnV2ConceptCard, now: Date): PreferenceNode {
  const atom = card.atoms[0]!;
  return {
    schemaVersion: "openskill-kit.preference-node.v2",
    id: `pref_${card.id}`,
    title: card.title,
    statement: card.canonicalBehavior,
    category: categoryFor(card),
    scope: {
      level: card.scope.level,
      paths: card.scope.paths
    },
    confidence: card.confidence,
    status: card.status === "locked" ? "locked" : "active",
    polarity: atom.polarity,
    evidence: card.evidenceIds.map((evidenceId) => ({
      signalId: `learn-v2:${card.id}`,
      eventIds: [evidenceId],
      weight: card.confidence,
      cardIds: [card.id],
      quote: undefined
    })),
    strength: atom.polarity === "negative" ? "must-not" : card.risk === "high" ? "must" : "should",
    exceptions: card.scope.negativeTriggers,
    privacy: {
      class: "project-private",
      rationale: "Compiled from reviewed learn-v2 concept card; raw refs are local-only."
    },
    compileTargets: ["context-pack", "agent-skills", "project-rules"],
    lifecycle: {
      state: "active",
      reviewedAt: now.toISOString(),
      promotedAt: now.toISOString()
    },
    createdAt: card.lifecycle.createdAt,
    updatedAt: now.toISOString()
  };
}

function conceptToWorkflow(card: LearnV2ConceptCard, now: Date): WorkflowNode {
  return {
    schemaVersion: "openskill-kit.workflow-node.v1",
    id: `workflow_${card.id}`,
    name: card.title,
    description: card.behaviorDelta,
    trigger: {
      paths: card.scope.paths,
      taskTypes: card.scope.taskTypes,
      commands: card.activation.commands,
      naturalLanguagePatterns: card.activation.phrases
    },
    steps: [{
      id: `step_${learnV2ShortHash(card.canonicalBehavior)}`,
      instruction: card.canonicalBehavior,
      kind: card.activation.commands.length ? "command" : "check",
      optional: card.risk === "low",
      command: card.activation.commands[0]
    }],
    evidenceCardIds: card.evidenceIds,
    preferenceNodeIds: [`pref_${card.id}`],
    anchorCardIds: [],
    occurrenceCount: Math.max(1, card.rawRefs.length),
    confidence: card.confidence,
    status: card.status === "locked" ? "locked" : "active",
    compileTargets: ["skill", "command-policy", "review-checklist", "mcp-resource", "context-pack"],
    privacy: {
      class: "project-private",
      rationale: "Compiled from reviewed learn-v2 concept card; raw refs are local-only."
    },
    lifecycle: {
      createdAt: card.lifecycle.createdAt,
      updatedAt: now.toISOString(),
      reviewedAt: now.toISOString(),
      promotedAt: now.toISOString()
    },
    sourceSignalIds: [`learn-v2:${card.id}`]
  };
}

function categoryFor(card: LearnV2ConceptCard): PreferenceNode["category"] {
  const kind = card.atoms[0]?.kind;
  if (kind === "security") return "security";
  if (kind === "verification" || kind === "command-policy") return "testing";
  if (kind === "dependency-policy") return "dependency-policy";
  if (kind === "review-policy") return "review-policy";
  return "workflow";
}

export function declassificationReport(
  cards: LearnV2ConceptCard[],
  preferenceNodes: PreferenceNode[] = [],
  workflowNodes: WorkflowNode[] = []
): LearnV2CompilePreview["declassificationReport"] {
  const text = JSON.stringify({
    concepts: cards.map((card) => ({
      id: card.id,
      title: card.title,
      canonicalBehavior: card.canonicalBehavior,
      behaviorDelta: card.behaviorDelta,
      activation: card.activation,
      scope: card.scope,
      conditions: card.conditions,
      counterevidence: card.counterevidence,
      evidenceIds: card.evidenceIds,
      atoms: card.atoms.map((atom) => ({
        id: atom.id,
        kind: atom.kind,
        statement: atom.statement,
        scope: atom.scope,
        rationale: atom.rationale,
        counterevidence: atom.counterevidence
      }))
    })),
    compiledOutputs: {
      preferenceNodes,
      workflowNodes
    }
  });
  const issues: string[] = [];
  if (/raw_[A-Za-z0-9_-]{8,}/i.test(text)) issues.push("raw-ref-like-token-in-output");

  const home = os.homedir();
  const homePattern = home ? new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  if ((homePattern && homePattern.test(text)) || /\b[A-Z]:\\+Users\\+/i.test(text) || /\/(?:Users|home)\/[^\/\s"'`]+/i.test(text)) {
    issues.push("absolute-user-path-in-output");
  }

  if (/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{16,})\b/.test(text)) {
    issues.push("secret-like-token-in-output");
  }

  const allPrivate = [...LEARN_V2_GENERATED_DIRS, ...LEARN_V2_GENERATED_FILES];
  for (const p of allPrivate) {
    if (text.includes(p)) {
      issues.push("private-path-reference-in-output");
    }
  }

  return {
    rawRefsExported: false,
    blockedPrivatePaths: [...LEARN_V2_GENERATED_DIRS, ...LEARN_V2_GENERATED_FILES].sort(),
    placeholders: [...new Set(cards.flatMap((card) => card.privacy.placeholders))],
    status: issues.length ? "fail" : "pass",
    issues
  };
}

function renderCompilePreview(preview: LearnV2CompilePreview): string {
  return [
    "# Learn v2 Compile Preview",
    "",
    `Generated: ${preview.generatedAt}`,
    `Active concepts: ${preview.activeConceptCount}`,
    `Candidate concepts excluded: ${preview.candidateConceptCount}`,
    `Preference nodes: ${preview.preferenceNodes.length}`,
    `Workflow nodes: ${preview.workflowNodes.length}`,
    "",
    "## Declassification",
    "",
    `Status: ${preview.declassificationReport.status}`,
    `Raw refs exported: ${preview.declassificationReport.rawRefsExported}`,
    preview.declassificationReport.issues.length ? `Issues: ${preview.declassificationReport.issues.join(", ")}` : "Issues: none",
    "",
    "## Active Behaviors",
    "",
    ...(preview.preferenceNodes.length ? preview.preferenceNodes.map((node) => `- ${node.title}: ${node.statement}`) : ["- none"])
  ].join("\n");
}
