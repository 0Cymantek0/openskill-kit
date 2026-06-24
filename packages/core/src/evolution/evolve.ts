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
}

export async function evolveSkill(options: EvolveOptions): Promise<EvolutionRun> {
  const draft = await draftSkill(options);
  const roundsDir = path.join(draft.runDir, "rounds");
  await fs.mkdir(roundsDir, { recursive: true });

  const round = await runRound(draft, "round-0");
  const status = round.diagnosis.nextAction === "freeze"
    ? "frozen"
    : round.diagnosis.nextAction === "manual-review"
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
    rounds: [round],
    artifacts: {
      draftRun: path.join(draft.runDir, "run.json"),
      evolution: path.join(draft.runDir, "evolution.json"),
      roundsDir
    },
    limitations: [
      "This evolve loop runs deterministic local draft plus one verifier round.",
      "No LLM refinement, external retrieval, or downstream agent benchmark is executed yet."
    ]
  };

  EvolutionRunSchema.parse(evolution);
  await fs.writeFile(path.join(draft.runDir, "evolution.json"), JSON.stringify(evolution, null, 2), "utf8");
  return evolution;
}

async function runRound(draft: DraftResult, id: string): Promise<EvolutionRound> {
  const startedAt = new Date();
  const reportDir = path.join(draft.runDir, "reports", id);
  const report = await verifySkill(draft.skillDir, reportDir);
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
