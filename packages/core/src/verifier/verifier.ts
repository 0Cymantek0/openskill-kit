import { promises as fs } from "node:fs";
import path from "node:path";
import { scanSkillPath, type SafetyReport } from "../safety/scanner.js";
import { validateSkillPackage, loadSkillPackage } from "../skill/parser.js";
import type { ValidationIssue } from "../skill/schema.js";

export interface VerifierReport {
  status: "pass" | "fail" | "warning";
  skillPath: string;
  generatedAt: string;
  issues: ValidationIssue[];
  safety: SafetyReport;
  scores: {
    safety: number;
    structure: number;
    installability: number;
    contextEfficiency: number;
    portability: number;
  };
}

export async function verifySkill(skillPath: string, reportDir?: string): Promise<VerifierReport> {
  const issues = await validateSkillPackage(skillPath);
  const safety = await scanSkillPath(skillPath);
  const pkg = issues.some((issue) => issue.severity === "error") ? undefined : await loadSkillPackage(skillPath);
  const bodyLength = pkg?.body.length ?? 999999;
  const scores = {
    safety: safety.score,
    structure: Math.max(0, 100 - issues.filter((issue) => issue.severity === "error").length * 40 - issues.filter((issue) => issue.severity === "warning").length * 10),
    installability: issues.some((issue) => issue.severity === "error") ? 0 : 100,
    contextEfficiency: bodyLength <= 4000 ? 100 : bodyLength <= 8000 ? 70 : 30,
    portability: pkg?.manifest.compatibility ? 100 : 70
  };
  const hasError = issues.some((issue) => issue.severity === "error") || safety.status === "fail";
  const hasWarning = issues.some((issue) => issue.severity === "warning") || Object.values(safety.summary).some((count) => count > 0);
  const report: VerifierReport = {
    status: hasError ? "fail" : hasWarning ? "warning" : "pass",
    skillPath: path.resolve(skillPath),
    generatedAt: new Date().toISOString(),
    issues,
    safety,
    scores
  };
  if (reportDir) {
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(path.join(reportDir, "verifier.json"), JSON.stringify(report, null, 2), "utf8");
  }
  return report;
}
