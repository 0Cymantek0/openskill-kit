import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const LeakageFindingSchema = z.object({
  id: z.string().min(1),
  level: z.enum(["warn", "block"]),
  source: z.string().min(1),
  sourceType: z.enum(["path", "content"]),
  message: z.string().min(1),
  match: z.string().min(1)
});

export const LeakageAuditSchema = z.object({
  schemaVersion: z.literal("openskill-kit.leakage-audit.v0"),
  mode: z.literal("benchmark-no-supervision"),
  status: z.enum(["pass", "warning", "blocked"]),
  scannedAt: z.string().datetime(),
  findings: z.array(LeakageFindingSchema),
  warnings: z.array(z.string())
});

export type LeakageFinding = z.infer<typeof LeakageFindingSchema>;
export type LeakageAudit = z.infer<typeof LeakageAuditSchema>;

export interface LeakageInput {
  source: string;
  content?: string;
}

interface Rule {
  id: string;
  level: LeakageFinding["level"];
  sourceType: LeakageFinding["sourceType"];
  message: string;
  pattern: RegExp;
}

const pathRules: Rule[] = [
  {
    id: "hidden-tests-path",
    level: "block",
    sourceType: "path",
    message: "Path looks like hidden or private target tests.",
    pattern: /(^|[\\/_.-])(hidden[-_]?tests?|tests?[-_]?hidden|private[-_]?tests?)([\\/_.-]|$)/i
  },
  {
    id: "oracle-path",
    level: "block",
    sourceType: "path",
    message: "Path looks like target oracle or verifier output.",
    pattern: /(^|[\\/_.-])(oracle|gold[-_]?answers?|ground[-_]?truth|verifier[-_]?outputs?)([\\/_.-]|$)/i
  },
  {
    id: "solution-trace-path",
    level: "block",
    sourceType: "path",
    message: "Path looks like reference solution or successful trace data.",
    pattern: /(^|[\\/_.-])(reference[-_]?solutions?|solution[-_]?traces?|successful[-_]?traces?)([\\/_.-]|$)/i
  }
];

const contentRules: Rule[] = [
  {
    id: "hidden-test-marker",
    level: "block",
    sourceType: "content",
    message: "Content contains a hidden-test marker.",
    pattern: /\b(begin|start|end)\s+hidden\s+tests?\b/i
  },
  {
    id: "ground-truth-marker",
    level: "block",
    sourceType: "content",
    message: "Content contains a ground-truth answer marker.",
    pattern: /\b(ground_truth_answer|target[_-]?answer|gold[_-]?answer)\b/i
  },
  {
    id: "oracle-output-marker",
    level: "block",
    sourceType: "content",
    message: "Content contains a target oracle output marker.",
    pattern: /\b(oracle[_-]?output|target[_-]?verifier[_-]?output)\b/i
  }
];

export function auditLeakageInputs(inputs: LeakageInput[], now = new Date()): LeakageAudit {
  const findings: LeakageFinding[] = [];
  for (const input of inputs) {
    const normalizedSource = input.source.replaceAll("\\", "/");
    findings.push(...applyRules(pathRules, input.source, normalizedSource));
    if (input.content) {
      findings.push(...applyRules(contentRules, input.source, input.content));
    }
  }
  const status = findings.some((finding) => finding.level === "block")
    ? "blocked"
    : findings.length > 0
      ? "warning"
      : "pass";
  return LeakageAuditSchema.parse({
    schemaVersion: "openskill-kit.leakage-audit.v0",
    mode: "benchmark-no-supervision",
    status,
    scannedAt: now.toISOString(),
    findings,
    warnings: [
      "Leakage audit covers explicit evidence inputs only; future retrieval adapters must call the same audit before adding sources.",
      "Existing public repository tests remain allowed observable context."
    ]
  });
}

export function isBlockedByLeakage(audit: LeakageAudit, source: string): boolean {
  return audit.findings.some((finding) => finding.level === "block" && finding.source === source);
}

export async function writeLeakageAudit(file: string, audit: LeakageAudit): Promise<void> {
  LeakageAuditSchema.parse(audit);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(audit, null, 2), "utf8");
}

export async function readLeakageAudit(file: string): Promise<LeakageAudit> {
  return LeakageAuditSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
}

function applyRules(rules: Rule[], source: string, value: string): LeakageFinding[] {
  const findings: LeakageFinding[] = [];
  for (const rule of rules) {
    const match = value.match(rule.pattern);
    if (!match?.[0]) continue;
    findings.push({
      id: rule.id,
      level: rule.level,
      source,
      sourceType: rule.sourceType,
      message: rule.message,
      match: match[0].slice(0, 160)
    });
  }
  return findings;
}
