import path from "node:path";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { validateSkillPackage } from "../skill/parser.js";
import { slugifySkillName } from "../skill/schema.js";
import { scanSkillPath } from "../safety/scanner.js";
import { auditOpenWorldLeakage } from "./leakage.js";
import {
  OpenWorldCandidateSkillRevisionSchema,
  OpenWorldCandidateSkillSchema,
  type AnchorCard,
  type OpenWorldCandidateSkill,
  type OpenWorldCandidateSkillRevision,
  type OpenWorldEvolutionRun,
  type OpenWorldTask
} from "./schema.js";
import {
  readAnchorCard,
  readOpenWorldCandidateSkill,
  readOpenWorldTask,
  writeOpenWorldCandidateSkill,
  writeOpenWorldCandidateSkillRevision,
  writeOpenWorldLeakageAudit,
  writeOpenWorldTaskTextArtifact
} from "./store.js";

export interface GenerateOpenWorldCandidateSkillOptions {
  anchorIds: string[];
  suiteIds?: string[];
  name?: string;
  write?: boolean;
  now?: Date;
}

export interface GenerateOpenWorldCandidateSkillResult {
  schemaVersion: "openskill-kit.openworld-candidate-skill-result.v1";
  candidate: OpenWorldCandidateSkill;
  candidatePath?: string;
  skillPath?: string;
  anchorsReferencePath?: string;
}

export async function generateOpenWorldCandidateSkill(
  projectRoot: string,
  taskId: string,
  options: GenerateOpenWorldCandidateSkillOptions
): Promise<GenerateOpenWorldCandidateSkillResult> {
  const root = path.resolve(projectRoot);
  const task = await readOpenWorldTask(root, taskId);
  if (!options.anchorIds.length) throw new Error("OpenWorld candidate skill requires at least one Anchor Card.");
  const now = options.now ?? new Date();
  const anchors = await Promise.all([...new Set(options.anchorIds)].map((anchorId) => readAnchorCard(root, taskId, anchorId)));
  const sourceIds = [...new Set(anchors.map((anchor) => anchor.sourceId))];
  const skillName = slugifySkillName(options.name ?? `${task.title} candidate`);
  const candidateId = `owskill_${shortHash(`${taskId}:${skillName}:${anchors.map((anchor) => anchor.id).join(",")}`)}`;
  const skillDir = path.join(".openskill-kit", "openworld", "tasks", taskId, "candidates", candidateId, skillName).replace(/\\/g, "/");
  const skillPath = path.join(skillDir, "SKILL.md").replace(/\\/g, "/");
  const anchorsReferencePath = path.join(skillDir, "references", "anchors.md").replace(/\\/g, "/");
  const markdown = renderCandidateSkill({ task, skillName, anchors, sourceIds });
  const anchorReference = renderAnchorReference(task, anchors);
  const audit = auditOpenWorldLeakage([
    { source: skillPath, surface: "artifact", value: markdown },
    { source: anchorsReferencePath, surface: "artifact", value: anchorReference }
  ], task, now);
  if (audit.status === "blocked") throw new Error(`OpenWorld candidate skill blocked by leakage audit: ${audit.findings.map((finding) => finding.id).join(", ")}`);

  if (options.write === false) {
    const draft = OpenWorldCandidateSkillSchema.parse({
      schemaVersion: "openskill-kit.openworld-candidate-skill.v1",
      id: candidateId,
      taskId,
      createdAt: now.toISOString(),
      skillName,
      status: "warning",
      proofLevel: "candidate-artifact",
      hiddenOracleProof: false,
      sourceIds,
      anchorIds: anchors.map((anchor) => anchor.id),
      suiteIds: options.suiteIds ?? [],
      artifacts: { skillDir, skillPath, anchorsReferencePath },
      validation: { issueCount: 0, errorCount: 0, warningCount: 0 },
      safety: { status: "pass", score: 100, findingCount: 0 },
      leakageAuditId: audit.id,
      limitations: limitations()
    });
    return { schemaVersion: "openskill-kit.openworld-candidate-skill-result.v1", candidate: draft };
  }

  const auditPath = await writeOpenWorldLeakageAudit(root, audit);
  const writtenSkillPath = await writeOpenWorldTaskTextArtifact(root, taskId, ["candidates", candidateId, skillName, "SKILL.md"], markdown);
  const writtenAnchorReferencePath = await writeOpenWorldTaskTextArtifact(root, taskId, ["candidates", candidateId, skillName, "references", "anchors.md"], anchorReference);
  const issues = await validateSkillPackage(path.dirname(writtenSkillPath));
  const safety = await scanSkillPath(path.dirname(writtenSkillPath));
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const status = safety.status === "fail" || errorCount > 0 ? "blocked" : warningCount > 0 || audit.status === "warning" ? "warning" : "ready";
  const draft = OpenWorldCandidateSkillSchema.parse({
    schemaVersion: "openskill-kit.openworld-candidate-skill.v1",
    id: candidateId,
    taskId,
    createdAt: now.toISOString(),
    skillName,
    status,
    proofLevel: "candidate-artifact",
    hiddenOracleProof: false,
    sourceIds,
    anchorIds: anchors.map((anchor) => anchor.id),
    suiteIds: options.suiteIds ?? [],
    artifacts: {
      skillDir,
      skillPath,
      anchorsReferencePath,
      candidatePath: path.join(".openskill-kit", "openworld", "tasks", taskId, "candidates", `${candidateId}.json`).replace(/\\/g, "/")
    },
    validation: {
      issueCount: issues.length,
      errorCount,
      warningCount
    },
    safety: {
      status: safety.status,
      score: safety.score,
      findingCount: safety.findings.length
    },
    leakageAuditId: audit.id,
    limitations: [
      ...limitations(),
      `Leakage audit: ${path.relative(root, auditPath).replace(/\\/g, "/")}`
    ]
  });
  const candidatePath = await writeOpenWorldCandidateSkill(root, draft);
  return {
    schemaVersion: "openskill-kit.openworld-candidate-skill-result.v1",
    candidate: OpenWorldCandidateSkillSchema.parse({
      ...draft,
      artifacts: {
        ...draft.artifacts,
        candidatePath: path.relative(root, candidatePath).replace(/\\/g, "/")
      }
    }),
    candidatePath,
    skillPath: writtenSkillPath,
    anchorsReferencePath: writtenAnchorReferencePath
  };
}

export interface ReviseOpenWorldCandidateSkillOptions {
  candidateSkillId: string;
  roundIndex: number;
  failureType?: OpenWorldEvolutionRun["rounds"][number]["failureType"];
  notes: string[];
  now?: Date;
}

export interface ReviseOpenWorldCandidateSkillResult {
  schemaVersion: "openskill-kit.openworld-candidate-skill-revision-result.v1";
  revision: OpenWorldCandidateSkillRevision;
  revisionPath?: string;
  skillPath?: string;
}

export async function reviseOpenWorldCandidateSkill(
  projectRoot: string,
  taskId: string,
  options: ReviseOpenWorldCandidateSkillOptions
): Promise<ReviseOpenWorldCandidateSkillResult> {
  const root = path.resolve(projectRoot);
  const task = await readOpenWorldTask(root, taskId);
  const candidate = await readOpenWorldCandidateSkill(root, taskId, options.candidateSkillId);
  if (candidate.status === "blocked") throw new Error(`OpenWorld candidate skill ${candidate.id} is blocked and cannot be revised.`);
  const now = options.now ?? new Date();
  const revisionId = `owskillrev_${shortHash(`${candidate.id}:${options.roundIndex}:${now.toISOString()}`)}`;
  const skillDir = path.join(".openskill-kit", "openworld", "tasks", taskId, "candidates", candidate.id, "revisions", revisionId, candidate.skillName).replace(/\\/g, "/");
  const skillPath = path.join(skillDir, "SKILL.md").replace(/\\/g, "/");
  const originalText = await fs.readFile(path.join(root, candidate.artifacts.skillPath), "utf8");
  const revisedText = appendRevisionNotes(originalText, task, options);
  const audit = auditOpenWorldLeakage([{ source: skillPath, surface: "artifact", value: revisedText }], task, now);
  if (audit.status === "blocked") throw new Error(`OpenWorld candidate revision blocked by leakage audit: ${audit.findings.map((finding) => finding.id).join(", ")}`);
  const auditPath = await writeOpenWorldLeakageAudit(root, audit);
  const writtenSkillPath = await writeOpenWorldTaskTextArtifact(root, taskId, ["candidates", candidate.id, "revisions", revisionId, candidate.skillName, "SKILL.md"], revisedText);
  const originalAnchorReference = candidate.artifacts.anchorsReferencePath
    ? await fs.readFile(path.join(root, candidate.artifacts.anchorsReferencePath), "utf8").catch(() => "")
    : "";
  if (originalAnchorReference) {
    await writeOpenWorldTaskTextArtifact(root, taskId, ["candidates", candidate.id, "revisions", revisionId, candidate.skillName, "references", "anchors.md"], originalAnchorReference);
  }
  const issues = await validateSkillPackage(path.dirname(writtenSkillPath));
  const safety = await scanSkillPath(path.dirname(writtenSkillPath));
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const status = safety.status === "fail" || errorCount > 0 ? "blocked" : warningCount > 0 || audit.status === "warning" ? "warning" : "ready";
  const draft = OpenWorldCandidateSkillRevisionSchema.parse({
    schemaVersion: "openskill-kit.openworld-candidate-skill-revision.v1",
    id: revisionId,
    taskId,
    candidateSkillId: candidate.id,
    createdAt: now.toISOString(),
    status,
    failureType: options.failureType,
    diagnosis: options.notes.join(" "),
    artifacts: {
      skillDir,
      skillPath,
      revisionPath: path.join(".openskill-kit", "openworld", "tasks", taskId, "candidates", candidate.id, "revisions", `${revisionId}.json`).replace(/\\/g, "/")
    },
    validation: {
      issueCount: issues.length,
      errorCount,
      warningCount
    },
    safety: {
      status: safety.status,
      score: safety.score,
      findingCount: safety.findings.length
    },
    leakageAuditId: audit.id,
    notes: [
      "Revision is a candidate artifact only; no active behavior changed.",
      "Revision must pass verifier and review gates before promotion.",
      `Leakage audit: ${path.relative(root, auditPath).replace(/\\/g, "/")}`
    ]
  });
  const revisionPath = await writeOpenWorldCandidateSkillRevision(root, draft);
  return {
    schemaVersion: "openskill-kit.openworld-candidate-skill-revision-result.v1",
    revision: OpenWorldCandidateSkillRevisionSchema.parse({
      ...draft,
      artifacts: {
        ...draft.artifacts,
        revisionPath: path.relative(root, revisionPath).replace(/\\/g, "/")
      }
    }),
    revisionPath,
    skillPath: writtenSkillPath
  };
}

function renderCandidateSkill(input: { task: OpenWorldTask; skillName: string; anchors: AnchorCard[]; sourceIds: string[] }): string {
  const anchorLines = input.anchors.map((anchor) => `- ${anchor.id}: ${anchor.claim}`).join("\n");
  const pathLines = [...new Set(input.anchors.flatMap((anchor) => anchor.paths))].map((item) => `- \`${item}\``).join("\n") || "- No path-specific scope recorded.";
  return `---\nname: ${input.skillName}\ndescription: OpenWorld candidate skill for ${input.task.title.slice(0, 140)}\nlicense: MIT\ncompatibility: local-agent,agent-plugin\nmetadata:\n  generated_by: openskill-kit\n  mode: openworld-candidate\n  task_id: ${input.task.id}\n---\n\n# ${input.skillName}\n\n## When to use\nUse only for task context matching: ${input.task.title}\n\n## When not to use\nDo not use for unrelated tasks, hidden benchmark answers, broad project policy, or any source not represented by the Anchor Cards.\n\n## Grounding\nThis candidate is grounded in these Anchor Cards:\n${anchorLines}\n\nSource ids: ${input.sourceIds.join(", ")}\n\n## Workflow\n1. Read current project instructions and relevant files before acting.\n2. Compare the task against the Anchor Cards in [anchors](references/anchors.md).\n3. Apply only the behavior directly supported by those anchors.\n4. Run the OpenWorld visible verifier before relying on this candidate.\n5. Run holdout only after visible passes.\n6. Send any promoted behavior through review-only promotion; do not activate directly.\n\n## Scope Hints\n${pathLines}\n\n## Verification checklist\n- \`openskill-kit openworld verifier-quality --task-id ${input.task.id} --suite-id <suite_id>\`\n- \`openskill-kit openworld run-verifier --task-id ${input.task.id} --suite-id <suite_id> --split visible\`\n- \`openskill-kit openworld refine --task-id ${input.task.id} --suite-id <suite_id>\`\n\n## Common mistakes\n- Do not infer hidden target answers from source wording.\n- Do not copy raw source text into agent chat when an Anchor Card id is enough.\n- Do not promote this candidate without review, leakage checks, verifier pass, and eval report.\n\n## References\n- [Anchor reference](references/anchors.md)\n`;
}

function renderAnchorReference(task: OpenWorldTask, anchors: AnchorCard[]): string {
  return [
    `# Anchor Reference for ${task.title}`,
    "",
    `Task: ${task.id}`,
    "",
    ...anchors.flatMap((anchor) => [
      `## ${anchor.id}`,
      "",
      `- Source: ${anchor.sourceId}`,
      `- Type: ${anchor.anchorType}`,
      `- Confidence: ${anchor.confidence}`,
      `- Privacy: ${anchor.privacyClass}`,
      `- Usable for: ${anchor.usableFor.join(", ")}`,
      `- Claim: ${anchor.claim}`,
      anchor.sourceQuote ? `- Quote: ${anchor.sourceQuote}` : "- Quote: not recorded",
      ""
    ])
  ].join("\n");
}

function appendRevisionNotes(
  originalText: string,
  task: OpenWorldTask,
  options: ReviseOpenWorldCandidateSkillOptions
): string {
  return `${originalText.trimEnd()}\n\n## Refinement Notes\n\n- Task: ${task.id}\n- Round: ${options.roundIndex}\n- Failure type: ${options.failureType ?? "unknown"}\n${options.notes.map((note) => `- Diagnosis: ${note}`).join("\n")}\n- Next action: repair only source-grounded behavior; do not infer hidden target answers.\n- Promotion rule: review-only after verifier and eval report pass.\n`;
}

function limitations(): string[] {
  return [
    "Candidate skill is generated from Anchor Cards and is not active behavior.",
    "Candidate skill is not hidden-oracle benchmark proof.",
    "Candidate skill must pass verifier and review gates before promotion."
  ];
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
