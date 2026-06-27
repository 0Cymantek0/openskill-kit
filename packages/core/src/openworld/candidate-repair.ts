import { createHash } from "node:crypto";
import path from "node:path";
import { createDockerSandboxPolicy, createLocalSandboxPolicy } from "../sandbox/policy.js";
import { runSandboxCommand } from "../sandbox/runner.js";
import { reviseOpenWorldCandidateSkill } from "./candidate-skill.js";
import { OpenWorldCandidateRepairRunSchema, type OpenWorldCandidateRepairRun, type OpenWorldEvolutionRun } from "./schema.js";
import {
  readOpenWorldCandidateSkill,
  writeOpenWorldCandidateRepairRun,
  writeOpenWorldTaskTextArtifact
} from "./store.js";

export interface RunOpenWorldCandidateRepairLoopOptions {
  candidateSkillId: string;
  suiteId?: string;
  maxRounds?: number;
  failureType?: OpenWorldEvolutionRun["rounds"][number]["failureType"];
  notes?: string[];
  sandboxMode?: "local-process" | "docker";
  dockerImage?: string;
  timeoutMs?: number;
  now?: Date;
}

export interface RunOpenWorldCandidateRepairLoopResult {
  schemaVersion: "openskill-kit.openworld-candidate-repair-run-result.v1";
  run: OpenWorldCandidateRepairRun;
  repairRunPath: string;
}

export async function runOpenWorldCandidateRepairLoop(
  projectRoot: string,
  taskId: string,
  options: RunOpenWorldCandidateRepairLoopOptions
): Promise<RunOpenWorldCandidateRepairLoopResult> {
  const root = path.resolve(projectRoot);
  const startedAt = options.now ?? new Date();
  const sandboxMode = options.sandboxMode ?? "local-process";
  if (sandboxMode === "docker" && !options.dockerImage) throw new Error("OpenWorld docker candidate repair requires dockerImage.");
  const maxRounds = Math.max(1, Math.min(options.maxRounds ?? 1, 5));
  const candidate = await readOpenWorldCandidateSkill(root, taskId, options.candidateSkillId);
  const runId = `owrepair_${shortHash(`${taskId}:${candidate.id}:${startedAt.toISOString()}`)}`;
  const rounds: OpenWorldCandidateRepairRun["rounds"] = [];
  let status: OpenWorldCandidateRepairRun["status"] = "failed";
  for (let index = 0; index < maxRounds; index += 1) {
    const revision = await reviseOpenWorldCandidateSkill(root, taskId, {
      candidateSkillId: candidate.id,
      roundIndex: index,
      failureType: options.failureType,
      notes: options.notes?.length ? options.notes : ["Repair loop requested a source-grounded candidate revision."],
      now: new Date(startedAt.getTime() + index)
    });
    const probe = await runRevisionProbe(root, taskId, candidate.id, revision.revision.id, revision.revision.artifacts.skillPath, {
      sandboxMode,
      dockerImage: options.dockerImage,
      timeoutMs: options.timeoutMs
    });
    const roundStatus = probe.summary.blocked || probe.summary.timeout
      ? "blocked"
      : probe.summary.fail
        ? "failed"
        : "passed";
    rounds.push({
      index,
      status: roundStatus,
      failureType: roundStatus === "blocked" ? "sandbox-error" : roundStatus === "failed" ? "skill-failure" : undefined,
      revisionId: revision.revision.id,
      revisionPath: revision.revision.artifacts.revisionPath,
      probeScriptPath: probe.probeScriptPath,
      probeResultPath: probe.probeResultPath,
      probeSummary: probe.summary,
      notes: [
        `Repair probe ran in ${probe.sandboxMode} sandbox mode.`,
        roundStatus === "passed" ? "Revision probe passed structural, reference, and oracle-marker checks." : "Revision probe did not pass; inspect probe result artifact."
      ]
    });
    if (roundStatus === "passed") {
      status = "passed";
      break;
    }
    if (roundStatus === "blocked") {
      status = "blocked";
      break;
    }
  }
  const completedAt = new Date(startedAt.getTime() + rounds.length).toISOString();
  const draft = OpenWorldCandidateRepairRunSchema.parse({
    schemaVersion: "openskill-kit.openworld-candidate-repair-run.v1",
    id: runId,
    taskId,
    candidateSkillId: candidate.id,
    suiteId: options.suiteId,
    startedAt: startedAt.toISOString(),
    completedAt,
    status,
    sandboxMode,
    dockerImage: sandboxMode === "docker" ? options.dockerImage : undefined,
    maxRounds,
    hiddenOracleProof: false,
    rounds,
    limitations: [
      "Repair loop writes candidate artifacts only; no active behavior changed.",
      sandboxMode === "docker"
        ? "Repair probe requested Docker sandbox mode; host Docker availability and image trust remain operator responsibilities."
        : "Repair probe runs in local-process sandbox mode, not a container boundary.",
      "Repair probe validates structure, anchor reference presence, and oracle-marker absence; it does not prove hidden-oracle benchmark success."
    ]
  });
  const repairRunPath = await writeOpenWorldCandidateRepairRun(root, draft);
  const run = OpenWorldCandidateRepairRunSchema.parse({
    ...draft,
    artifacts: {
      repairRunPath: path.relative(root, repairRunPath).replace(/\\/g, "/")
    }
  });
  await writeOpenWorldCandidateRepairRun(root, run);
  return { schemaVersion: "openskill-kit.openworld-candidate-repair-run-result.v1", run, repairRunPath };
}

async function runRevisionProbe(root: string, taskId: string, candidateId: string, revisionId: string, skillPath: string, options: { sandboxMode: "local-process" | "docker"; dockerImage?: string; timeoutMs?: number }): Promise<{
  sandboxMode: "local-process" | "docker";
  probeScriptPath: string;
  probeResultPath: string;
  summary: { pass: number; fail: number; blocked: number; timeout: number };
}> {
  const script = renderProbeScript(skillPath);
  const scriptPath = await writeOpenWorldTaskTextArtifact(root, taskId, ["candidates", candidateId, "repairs", revisionId, "repair-probe.cjs"], script);
  const policy = options.sandboxMode === "docker"
    ? createDockerSandboxPolicy({
      projectRoot: root,
      image: options.dockerImage!,
      allowNetwork: false,
      allowedCommands: ["node"],
      timeoutMs: options.timeoutMs ?? 30000,
      maxOutputBytes: 128 * 1024
    })
    : createLocalSandboxPolicy({
      projectRoot: root,
      allowNetwork: false,
      allowedCommands: [process.execPath, "node"],
      timeoutMs: options.timeoutMs ?? 30000,
      maxOutputBytes: 128 * 1024
    });
  const result = await runSandboxCommand(policy, {
    command: options.sandboxMode === "docker" ? "node" : process.execPath,
    args: [path.relative(root, scriptPath).replace(/\\/g, "/")],
    cwd: root
  });
  const parsed = parseProbeOutput(result.stdout);
  const summary = result.status === "blocked"
    ? { pass: 0, fail: 0, blocked: 1, timeout: 0 }
    : result.status === "timeout"
      ? { pass: 0, fail: 0, blocked: 0, timeout: 1 }
      : parsed ?? { pass: result.status === "pass" ? 1 : 0, fail: result.status === "fail" ? 1 : 0, blocked: 0, timeout: 0 };
  const resultPath = await writeOpenWorldTaskTextArtifact(root, taskId, ["candidates", candidateId, "repairs", revisionId, "repair-probe-result.json"], `${JSON.stringify({
    schemaVersion: "openskill-kit.openworld-candidate-repair-probe-result.v1",
    revisionId,
    sandboxStatus: result.status,
    command: result.command,
    args: result.args,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    blockedReason: result.blockedReason,
    probe: parsed,
    stderr: result.stderr.slice(0, 4000)
  }, null, 2)}\n`);
  return {
    sandboxMode: options.sandboxMode,
    probeScriptPath: path.relative(root, scriptPath).replace(/\\/g, "/"),
    probeResultPath: path.relative(root, resultPath).replace(/\\/g, "/"),
    summary
  };
}

function renderProbeScript(skillPath: string): string {
  return `const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const skillPath = path.join(root, ${JSON.stringify(skillPath)});
const skillDir = path.dirname(skillPath);
const anchorsPath = path.join(skillDir, "references", "anchors.md");
const checks = [];
function check(name, pass, message) {
  checks.push({ name, status: pass ? "pass" : "fail", message });
}
const skillText = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, "utf8") : "";
const anchorsText = fs.existsSync(anchorsPath) ? fs.readFileSync(anchorsPath, "utf8") : "";
check("skill-exists", skillText.length > 0, "SKILL.md exists");
check("revision-notes", /## Refinement Notes/.test(skillText), "revision notes recorded");
check("anchors-reference", anchorsText.length > 0, "anchors reference exists");
check("oracle-marker", !/\\b(hidden[-_\\s]?tests?|oracle[-_\\s]?private|oracle[-_\\s]?output|target[-_\\s]?answer|reference[-_\\s]?solution)\\b/i.test(skillText + "\\n" + anchorsText), "no oracle markers in revision package");
const summary = checks.reduce((acc, item) => {
  if (item.status === "pass") acc.pass += 1;
  else acc.fail += 1;
  return acc;
}, { pass: 0, fail: 0, blocked: 0, timeout: 0 });
console.log(JSON.stringify({ schemaVersion: "openskill-kit.openworld-candidate-repair-probe.v1", checks, summary }, null, 2));
process.exit(summary.fail ? 1 : 0);
`;
}

function parseProbeOutput(stdout: string): { pass: number; fail: number; blocked: number; timeout: number } | undefined {
  try {
    const parsed = JSON.parse(stdout) as { summary?: { pass?: number; fail?: number; blocked?: number; timeout?: number } };
    if (!parsed.summary) return undefined;
    return {
      pass: parsed.summary.pass ?? 0,
      fail: parsed.summary.fail ?? 0,
      blocked: parsed.summary.blocked ?? 0,
      timeout: parsed.summary.timeout ?? 0
    };
  } catch {
    return undefined;
  }
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
