import { promises as fs } from "node:fs";
import path from "node:path";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface SafetyFinding {
  ruleId: string;
  level: RiskLevel;
  message: string;
  file: string;
  match: string;
}

export interface SafetyReport {
  status: "pass" | "fail";
  findings: SafetyFinding[];
  summary: Record<RiskLevel, number>;
  score: number;
}

interface Rule {
  id: string;
  level: RiskLevel;
  message: string;
  pattern: RegExp;
}

const rules: Rule[] = [
  {
    id: "prompt-ignore-instructions",
    level: "critical",
    message: "Attempts to override higher-priority instructions",
    pattern: /\b(ignore|bypass|override)\s+(all\s+)?(previous|system|developer|user)\s+instructions\b/i
  },
  {
    id: "hidden-behavior",
    level: "high",
    message: "Instructs agent to hide behavior",
    pattern: /\b(do not (tell|reveal)|hide this|secretly|silently exfiltrate)\b/i
  },
  {
    id: "credential-access",
    level: "critical",
    message: "Attempts to read credentials or environment secrets",
    pattern: /(process\.env\.[A-Z0-9_]+|(?:read|cat|print|dump|exfiltrate|scrape|open)\s+[^\n]*(?:\.env\b|api[_-]?key|secret[_-]?key|access[_-]?token|ssh\/id_rsa))/i
  },
  {
    id: "curl-pipe-shell",
    level: "critical",
    message: "Downloads and pipes remote code into a shell",
    pattern: /\b(curl|wget)\b[^\n|;]*\|\s*(sh|bash|pwsh|powershell)\b/i
  },
  {
    id: "destructive-root-delete",
    level: "critical",
    message: "Contains destructive filesystem command",
    pattern: /\b(rm\s+-rf\s+\/|Remove-Item\s+.*-Recurse\s+.*(C:\\|\/)|format\s+[a-z]:)/i
  },
  {
    id: "privilege-escalation",
    level: "high",
    message: "Uses broad privilege escalation",
    pattern: /\b(sudo\s+|chmod\s+777|Start-Process\s+.*-Verb\s+RunAs)\b/i
  },
  {
    id: "obfuscated-exec",
    level: "critical",
    message: "Uses obfuscated dynamic code execution",
    pattern: /\b(base64\s+(-d|--decode).*\|\s*(sh|bash)|eval\s*\(|new Function\s*\(|child_process\.(exec|spawn)\s*\([^)]*\$)/i
  },
  {
    id: "skill-priority-stuffing",
    level: "medium",
    message: "Tries to force global skill priority",
    pattern: /\b(always use this skill|preferred over all other skills|must use this skill everywhere)\b/i
  }
];

export async function scanSkillPath(skillPath: string): Promise<SafetyReport> {
  const root = await resolveRoot(skillPath);
  const files = await collectScannableFiles(root);
  const findings: SafetyFinding[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    for (const rule of rules) {
      const match = text.match(rule.pattern);
      if (match?.[0]) {
        if (rule.id === "credential-access" && isDefensiveCredentialWarning(text, match.index ?? 0)) {
          continue;
        }
        findings.push({
          ruleId: rule.id,
          level: rule.level,
          message: rule.message,
          file: path.relative(root, file),
          match: match[0].slice(0, 160)
        });
      }
    }
  }
  const summary = summarize(findings);
  const score = Math.max(0, 100 - summary.low * 5 - summary.medium * 15 - summary.high * 35 - summary.critical * 100);
  return {
    status: summary.critical > 0 || summary.high > 0 ? "fail" : "pass",
    findings,
    summary,
    score
  };
}

function isDefensiveCredentialWarning(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const lineEnd = text.indexOf("\n", index);
  const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim().toLowerCase();
  return /^(?:[-*]\s*)?(do not|never|avoid)\b/.test(line);
}

function summarize(findings: SafetyFinding[]): Record<RiskLevel, number> {
  return findings.reduce<Record<RiskLevel, number>>((acc, finding) => {
    acc[finding.level] += 1;
    return acc;
  }, { low: 0, medium: 0, high: 0, critical: 0 });
}

async function resolveRoot(skillPath: string): Promise<string> {
  const stat = await fs.stat(skillPath);
  return stat.isDirectory() ? path.resolve(skillPath) : path.dirname(path.resolve(skillPath));
}

async function collectScannableFiles(root: string): Promise<string[]> {
  const allowed = new Set([".md", ".ts", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".sh", ".ps1"]);
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (allowed.has(path.extname(entry.name)) || entry.name === "SKILL.md") files.push(full);
    }
  }
  await walk(root);
  return files;
}
