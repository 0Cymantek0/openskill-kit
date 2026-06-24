import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { draftSkill, type DraftResult } from "../draft/draft.js";
import { verifySkill, type VerifierReport } from "../verifier/verifier.js";

export const EvolutionDiagnosisSchema = z.object({
  kind: z.enum(["pass", "validation-error", "safety-risk", "fixture-failure", "package-warning"]),
  message: z.string().min(1),
  nextAction: z.enum(["freeze", "refine-required", "manual-review"])
});

export const EvolutionRoundSchema = z.object({
  id: z.string().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  verifierStatus: z.enum(["pass", "fail", "warning"]),
  diagnosis: EvolutionDiagnosisSchema,
  repair: z.object({
    status: z.enum(["applied", "skipped"]),
    actions: z.array(z.string())
  }).optional(),
  reportPath: z.string().optional(),
  executionPath: z.string().optional()
});

export const EvolutionRunSchema = z.object({
  schemaVersion: z.literal("openskill-kit.evolution-run.v0"),
  topic: z.string().min(1),
  runId: z.string().min(1),
  runDir: z.string().min(1),
  skillName: z.string().min(1),
  skillDir: z.string().min(1),
  status: z.enum(["frozen", "needs-refinement", "manual-review"]),
  rounds: z.array(EvolutionRoundSchema).min(1),
  artifacts: z.object({
    draftRun: z.string(),
    evolution: z.string(),
    roundsDir: z.string()
  }),
  limitations: z.array(z.string())
});

export type EvolutionDiagnosis = z.infer<typeof EvolutionDiagnosisSchema>;
export type EvolutionRound = z.infer<typeof EvolutionRoundSchema>;
export type EvolutionRun = z.infer<typeof EvolutionRunSchema>;

export interface EvolveOptions {
  topic: string;
  projectRoot: string;
  noLlm?: boolean;
  now?: Date;
  evidenceFiles?: string[];
  evidenceUrls?: string[];
  maxRounds?: number;
  runRepoChecks?: boolean;
}

export async function evolveSkill(options: EvolveOptions): Promise<EvolutionRun> {
  const draft = await draftSkill(options);
  return evolveDraft(draft, {
    topic: options.topic,
    maxRounds: options.maxRounds,
    runRepoChecks: options.runRepoChecks
  });
}

export async function evolveDraft(draft: DraftResult, options: { topic: string; maxRounds?: number; runRepoChecks?: boolean }): Promise<EvolutionRun> {
  const roundsDir = path.join(draft.runDir, "rounds");
  await fs.mkdir(roundsDir, { recursive: true });

  const maxRounds = Math.max(1, Math.min(options.maxRounds ?? 3, 5));
  const rounds: EvolutionRound[] = [];
  for (let index = 0; index < maxRounds; index += 1) {
    const round = await runRound(draft, `round-${index}`, options.runRepoChecks === true);
    rounds.push(round);
    if (round.diagnosis.nextAction === "freeze" || round.diagnosis.nextAction === "manual-review") break;
    const repair = await repairSkillPackage(draft.skillDir, round.diagnosis);
    round.repair = repair;
    await fs.writeFile(path.join(draft.runDir, "rounds", `${round.id}.json`), JSON.stringify(round, null, 2), "utf8");
    if (repair.status === "skipped") break;
  }

  const finalRound = rounds[rounds.length - 1]!;
  const status = finalRound.diagnosis.nextAction === "freeze"
    ? "frozen"
    : finalRound.diagnosis.nextAction === "manual-review"
      ? "manual-review"
      : "needs-refinement";

  const evolution: EvolutionRun = {
    schemaVersion: "openskill-kit.evolution-run.v0",
    topic: options.topic,
    runId: draft.runId,
    runDir: draft.runDir,
    skillName: draft.skillName,
    skillDir: draft.skillDir,
    status,
    rounds,
    artifacts: {
      draftRun: path.join(draft.runDir, "run.json"),
      evolution: path.join(draft.runDir, "evolution.json"),
      roundsDir
    },
    limitations: [
      "This evolve loop runs deterministic local draft plus capped verifier rounds.",
      "Refinement is deterministic package repair only; no LLM refinement is executed yet.",
      "No downstream agent benchmark is executed yet."
    ]
  };

  EvolutionRunSchema.parse(evolution);
  await fs.writeFile(path.join(draft.runDir, "evolution.json"), JSON.stringify(evolution, null, 2), "utf8");
  return evolution;
}

async function runRound(draft: DraftResult, id: string, runRepoChecks: boolean): Promise<EvolutionRound> {
  const startedAt = new Date();
  const reportDir = path.join(draft.runDir, "reports", id);
  const report = await verifySkill(draft.skillDir, reportDir, undefined, { runRepoChecks });
  const completedAt = new Date();
  const diagnosis = diagnoseVerifierReport(report);
  const round: EvolutionRound = {
    id,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    verifierStatus: report.status,
    diagnosis,
    reportPath: report.reportPath,
    executionPath: report.executionPath
  };
  EvolutionRoundSchema.parse(round);
  await fs.writeFile(path.join(draft.runDir, "rounds", `${id}.json`), JSON.stringify(round, null, 2), "utf8");
  return round;
}

export async function repairSkillPackage(skillDir: string, diagnosis: EvolutionDiagnosis): Promise<{ status: "applied" | "skipped"; actions: string[] }> {
  if (diagnosis.nextAction !== "refine-required") {
    return { status: "skipped", actions: [] };
  }
  const skillPath = path.join(skillDir, "SKILL.md");
  const actions: string[] = [];
  let markdown = await fs.readFile(skillPath, "utf8");
  if (!markdown.includes("## Verification checklist")) {
    markdown += "\n## Verification checklist\n- Run the verifier command for this skill package.\n";
    actions.push("Added missing Verification checklist section.");
  }
  if (!markdown.includes("## Common mistakes")) {
    markdown += "\n## Common mistakes\n- Do not skip validation or hide verifier failures.\n";
    actions.push("Added missing Common mistakes section.");
  }
  if (!markdown.includes("## References")) {
    markdown += "\n## References\n- [Research notes](references/research.md)\n";
    actions.push("Added missing References section.");
  }
  if (actions.length === 0) {
    return { status: "skipped", actions: [] };
  }
  await fs.writeFile(skillPath, markdown, "utf8");
  return { status: "applied", actions };
}

export function diagnoseVerifierReport(report: VerifierReport): EvolutionDiagnosis {
  if (report.issues.some((issue) => issue.severity === "error")) {
    return {
      kind: "validation-error",
      message: "Skill package has validation errors.",
      nextAction: "refine-required"
    };
  }
  if (report.safety.status === "fail") {
    return {
      kind: "safety-risk",
      message: "Safety scanner found high or critical risk.",
      nextAction: "manual-review"
    };
  }
  if (report.fixtureResults.some((fixture) => fixture.status === "fail" || fixture.status === "blocked" || fixture.status === "timeout")) {
    return {
      kind: "fixture-failure",
      message: "Generated fixture check failed in sandbox.",
      nextAction: "refine-required"
    };
  }
  if (report.status === "warning") {
    return {
      kind: "package-warning",
      message: "Verifier completed with warnings.",
      nextAction: "manual-review"
    };
  }
  return {
    kind: "pass",
    message: "Verifier round passed; skill can be frozen as a local candidate.",
    nextAction: "freeze"
  };
}
