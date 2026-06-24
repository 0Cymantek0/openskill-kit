import { z } from "zod";
import {
  draftSkill,
  evolveSkill,
  installSkill,
  readRegistry,
  runDoctor,
  scanSkillPath,
  verifySkill,
  type InstallTarget
} from "@openskill-kit/core";

const targetSchema = z.enum(["opencode-project", "opencode-global", "agents-project", "agents-global"]);

export const toolSchemas = {
  draft: z.object({ topic: z.string().min(1), projectRoot: z.string().optional() }),
  evolve: z.object({ topic: z.string().min(1), projectRoot: z.string().optional() }),
  audit: z.object({ skillPath: z.string().min(1) }),
  test: z.object({ skillPath: z.string().min(1) }),
  install: z.object({ skillPath: z.string().min(1), target: targetSchema, dryRun: z.boolean().default(true) }),
  list: z.object({ projectRoot: z.string().optional() }),
  doctor: z.object({ projectRoot: z.string().optional() })
};

export async function openskillKitDraft(args: z.infer<typeof toolSchemas.draft>) {
  const parsed = toolSchemas.draft.parse(args);
  const result = await draftSkill({ topic: parsed.topic, projectRoot: parsed.projectRoot ?? process.cwd(), noLlm: true });
  return summarize("drafted", result);
}

export async function openskillKitEvolve(args: z.infer<typeof toolSchemas.evolve>) {
  const parsed = toolSchemas.evolve.parse(args);
  const result = await evolveSkill({ topic: parsed.topic, projectRoot: parsed.projectRoot ?? process.cwd(), noLlm: true });
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
  const report = await scanSkillPath(parsed.skillPath);
  return summarize(`audit ${report.status}`, { score: report.score, findings: report.findings.length });
}

export async function openskillKitTest(args: z.infer<typeof toolSchemas.test>) {
  const parsed = toolSchemas.test.parse(args);
  const report = await verifySkill(parsed.skillPath);
  return summarize(`test ${report.status}`, { scores: report.scores, issues: report.issues.length });
}

export async function openskillKitInstall(args: z.infer<typeof toolSchemas.install>) {
  const parsed = toolSchemas.install.parse(args);
  const result = await installSkill({
    skillPath: parsed.skillPath,
    target: parsed.target as InstallTarget,
    projectRoot: process.cwd(),
    dryRun: parsed.dryRun
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
