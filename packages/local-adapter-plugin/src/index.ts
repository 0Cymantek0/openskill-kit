import { z } from "zod";
import {
  draftSkill,
  evaluateSkill,
  evolveSkill,
  installSkill,
  readRegistry,
  runDoctor,
  scanSkillPath,
  verifySkill,
  type InstallTarget
} from "@openskill-kit/core";
import path from "node:path";

const targetSchema = z.string().min(1);

export const toolSchemas = {
  draft: z.object({ topic: z.string().min(1), projectRoot: z.string().optional(), evidenceFiles: z.array(z.string().min(1)).default([]), evidenceUrls: z.array(z.string().url()).default([]) }),
  evolve: z.object({
    topic: z.string().min(1),
    projectRoot: z.string().optional(),
    evidenceFiles: z.array(z.string().min(1)).default([]),
    evidenceUrls: z.array(z.string().url()).default([]),
    maxRounds: z.number().int().min(1).max(5).default(3),
    runRepoChecks: z.boolean().default(false)
  }),
  audit: z.object({ skillPath: z.string().min(1), projectRoot: z.string().optional() }),
  test: z.object({ skillPath: z.string().min(1), projectRoot: z.string().optional(), runRepoChecks: z.boolean().default(false) }),
  evaluate: z.object({ skillPath: z.string().min(1), projectRoot: z.string().optional(), runRepoChecks: z.boolean().default(false) }),
  install: z.object({
    skillPath: z.string().min(1),
    target: targetSchema,
    projectRoot: z.string().optional(),
    dryRun: z.boolean().default(true),
    yes: z.boolean().default(false),
    allowCriticalRisk: z.boolean().default(false)
  }),
  list: z.object({ projectRoot: z.string().optional() }),
  doctor: z.object({ projectRoot: z.string().optional() })
};

export async function openskillKitDraft(args: z.infer<typeof toolSchemas.draft>) {
  const parsed = toolSchemas.draft.parse(args);
  const result = await draftSkill({ topic: parsed.topic, projectRoot: parsed.projectRoot ?? process.cwd(), noLlm: true, evidenceFiles: parsed.evidenceFiles, evidenceUrls: parsed.evidenceUrls });
  return summarize("drafted", result);
}

export async function openskillKitEvolve(args: z.infer<typeof toolSchemas.evolve>) {
  const parsed = toolSchemas.evolve.parse(args);
  const result = await evolveSkill({ topic: parsed.topic, projectRoot: parsed.projectRoot ?? process.cwd(), noLlm: true, evidenceFiles: parsed.evidenceFiles, evidenceUrls: parsed.evidenceUrls, maxRounds: parsed.maxRounds, runRepoChecks: parsed.runRepoChecks });
  return summarize(`evolve ${result.status}`, {
    skillName: result.skillName,
    runDir: result.runDir,
    rounds: result.rounds.map((round) => ({
      id: round.id,
      verifierStatus: round.verifierStatus,
      diagnosis: round.diagnosis
    }))
  });
}

export async function openskillKitAudit(args: z.infer<typeof toolSchemas.audit>) {
  const parsed = toolSchemas.audit.parse(args);
  const root = parsed.projectRoot ?? process.cwd();
  const report = await scanSkillPath(resolvePath(parsed.skillPath, root));
  return summarize(`audit ${report.status}`, { score: report.score, findings: report.findings.length });
}

export async function openskillKitTest(args: z.infer<typeof toolSchemas.test>) {
  const parsed = toolSchemas.test.parse(args);
  const root = parsed.projectRoot ?? process.cwd();
  const report = await verifySkill(resolvePath(parsed.skillPath, root), undefined, undefined, { runRepoChecks: parsed.runRepoChecks });
  return summarize(`test ${report.status}`, { scores: report.scores, issues: report.issues.length, commands: report.commandResults.length });
}

export async function openskillKitEvaluate(args: z.infer<typeof toolSchemas.evaluate>) {
  const parsed = toolSchemas.evaluate.parse(args);
  const root = parsed.projectRoot ?? process.cwd();
  const report = await evaluateSkill(resolvePath(parsed.skillPath, root), { runRepoChecks: parsed.runRepoChecks });
  return summarize(`evaluate ${report.status}`, {
    verifierStatus: report.verifierStatus,
    leakageStatus: report.leakageStatus,
    gates: report.gates,
    metrics: report.metrics,
    artifacts: report.artifacts
  });
}

export async function openskillKitInstall(args: z.infer<typeof toolSchemas.install>) {
  const parsed = toolSchemas.install.parse(args);
  const root = parsed.projectRoot ?? process.cwd();
  const result = await installSkill({
    skillPath: resolvePath(parsed.skillPath, root),
    target: normalizeInstallTarget(parsed.target),
    projectRoot: root,
    dryRun: parsed.dryRun,
    yes: parsed.yes,
    allowCriticalRisk: parsed.allowCriticalRisk
  });
  return summarize(result.status, result);
}

export async function openskillKitList(args: z.infer<typeof toolSchemas.list>) {
  const parsed = toolSchemas.list.parse(args);
  const registry = await readRegistry(parsed.projectRoot ?? process.cwd());
  return summarize("list", registry.skills.map((skill) => ({ name: skill.name, status: skill.status })));
}

export async function openskillKitDoctor(args: z.infer<typeof toolSchemas.doctor>) {
  const parsed = toolSchemas.doctor.parse(args);
  const report = await runDoctor(parsed.projectRoot ?? process.cwd());
  return summarize(`doctor ${report.status}`, report.checks);
}

function summarize(kind: string, data: unknown) {
  return {
    kind,
    data
  };
}

function resolvePath(value: string, root: string): string {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function normalizeInstallTarget(value: string): InstallTarget {
  const legacyProject = ["open", "code-project"].join("");
  const legacyGlobal = ["open", "code-global"].join("");
  const normalized = value === legacyProject ? "local-project" : value === legacyGlobal ? "local-global" : value;
  if (normalized === "local-project" || normalized === "local-global" || normalized === "agents-project" || normalized === "agents-global") return normalized;
  throw new Error(`Invalid target: ${value}`);
}
