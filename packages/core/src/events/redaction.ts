import type { ProjectConfig } from "../config/schema.js";

export interface RedactionResult {
  value: unknown;
  redacted: boolean;
  matches: string[];
}

interface RedactionRule {
  id: string;
  pattern: RegExp;
}

const builtInRules: RedactionRule[] = [
  { id: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { id: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{20,}\b/g },
  { id: "cloud-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "secret-assignment", pattern: /\b([A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH)[A-Z0-9_]*)\s*=\s*([^\s"'`]+|"[^"]+"|'[^']+'|`[^`]+`)/gi },
  { id: "env-file", pattern: /(^|[\\/])\.env(?:\.[A-Za-z0-9_-]+)?\b/g }
];

export function redactValue(value: unknown, config?: ProjectConfig): RedactionResult {
  const customRules = (config?.privacy.customRedactions ?? []).map((source, index) => ({
    id: `custom-${index + 1}`,
    pattern: new RegExp(source, "gi")
  }));
  const matches = new Set<string>();
  const rules = [...builtInRules, ...customRules];
  const redacted = redactRecursive(value, rules, matches);
  return { value: redacted, redacted: matches.size > 0, matches: [...matches].sort() };
}

function redactRecursive(value: unknown, rules: RedactionRule[], matches: Set<string>): unknown {
  if (typeof value === "string") return redactString(value, rules, matches);
  if (Array.isArray(value)) return value.map((item) => redactRecursive(item, rules, matches));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactRecursive(nested, rules, matches)]));
  }
  return value;
}

function redactString(value: string, rules: RedactionRule[], matches: Set<string>): string {
  let current = value;
  for (const rule of rules) {
    current = current.replace(rule.pattern, (match, maybeName: string | undefined) => {
      matches.add(rule.id);
      if (rule.id === "secret-assignment" && maybeName) return `${maybeName}=[REDACTED:${rule.id}]`;
      return `[REDACTED:${rule.id}]`;
    });
  }
  return current;
}
