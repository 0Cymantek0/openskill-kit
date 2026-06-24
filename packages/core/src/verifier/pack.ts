import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { EvidenceLedger } from "../evidence/ledger.js";
import type { SkillPackage } from "../skill/schema.js";

export const VerifierAssertionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(["schema", "structure", "safety", "installability", "context-efficiency", "portability"]),
  sourceClaimIds: z.array(z.string()),
  deterministic: z.boolean(),
  visibleToExecutor: z.boolean(),
  strength: z.enum(["low", "medium", "high"])
});

export const VerifierPackSchema = z.object({
  schemaVersion: z.literal("openskill-kit.verifier-pack.v0"),
  skillName: z.string().min(1),
  createdAt: z.string().datetime(),
  assertions: z.array(VerifierAssertionSchema).min(1),
  visibleAssertionIds: z.array(z.string()),
  holdoutAssertionIds: z.array(z.string()),
  warnings: z.array(z.string())
});

export type VerifierAssertion = z.infer<typeof VerifierAssertionSchema>;
export type VerifierPack = z.infer<typeof VerifierPackSchema>;

export function buildVerifierPack(pkg: SkillPackage, ledger?: EvidenceLedger, now = new Date()): VerifierPack {
  const claimIds = ledger?.claims.map((claim) => claim.id) ?? [];
  const repoClaims = claimIds.filter((id) => id.startsWith("claim.repo."));
  const assertions: VerifierAssertion[] = [
    {
      id: "assert.skill-frontmatter-valid",
      description: "SKILL.md has valid frontmatter and required manifest fields.",
      type: "schema",
      sourceClaimIds: [],
      deterministic: true,
      visibleToExecutor: true,
      strength: "high"
    },
    {
      id: "assert.skill-progressive-disclosure-sections",
      description: "Skill includes When to use, When not to use, verification, common mistakes, and references.",
      type: "structure",
      sourceClaimIds: repoClaims,
      deterministic: true,
      visibleToExecutor: true,
      strength: "medium"
    },
    {
      id: "assert.skill-safety-scan-pass",
      description: "Safety scan finds no high or critical risky instruction patterns.",
      type: "safety",
      sourceClaimIds: [],
      deterministic: true,
      visibleToExecutor: true,
      strength: "high"
    },
    {
      id: "assert.skill-install-simulation",
      description: "Skill package can be simulated for installation without writing target files.",
      type: "installability",
      sourceClaimIds: [],
      deterministic: true,
      visibleToExecutor: true,
      strength: "high"
    },
    {
      id: "assert.skill-context-efficient",
      description: "Main SKILL.md body is concise enough for agent progressive disclosure.",
      type: "context-efficiency",
      sourceClaimIds: [],
      deterministic: true,
      visibleToExecutor: true,
      strength: "medium"
    },
    {
      id: "assert.skill-portable-adapters",
      description: "Skill declares compatibility metadata for portable agent use.",
      type: "portability",
      sourceClaimIds: [],
      deterministic: true,
      visibleToExecutor: true,
      strength: "medium"
    }
  ];

  return {
    schemaVersion: "openskill-kit.verifier-pack.v0",
    skillName: pkg.manifest.name,
    createdAt: now.toISOString(),
    assertions,
    visibleAssertionIds: assertions.map((assertion) => assertion.id),
    holdoutAssertionIds: [],
    warnings: [
      "Verifier pack checks skill package quality only; it does not claim downstream agent performance.",
      ...(ledger ? ledger.warnings : ["No evidence ledger supplied for verifier pack."])
    ]
  };
}

export async function writeVerifierPack(file: string, pack: VerifierPack): Promise<void> {
  VerifierPackSchema.parse(pack);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(pack, null, 2), "utf8");
}

export async function readVerifierPack(file: string): Promise<VerifierPack> {
  return VerifierPackSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
}
