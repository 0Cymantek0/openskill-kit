import path from "node:path";
import { createHash } from "node:crypto";
import { OpenWorldLeakageAuditSchema, type OpenWorldLeakageAudit, type OpenWorldLeakageFinding, type OpenWorldTask } from "./schema.js";

export interface LeakageScanInput {
  source: string;
  surface: "query" | "path" | "content" | "artifact";
  value: string;
}

export function sanitizeOpenWorldQuery(query: string, task: Pick<OpenWorldTask, "forbiddenIdentifiers" | "forbiddenPaths">): string {
  let sanitized = query;
  for (const forbidden of [...task.forbiddenIdentifiers, ...task.forbiddenPaths]) {
    sanitized = replaceForbidden(sanitized, forbidden);
  }
  sanitized = sanitized.replace(/\b(hidden|oracle|ground[-_\s]?truth|gold[-_\s]?answer|target[-_\s]?answer)\b/gi, "[redacted]");
  return sanitized.replace(/\s+/g, " ").trim();
}

export function auditOpenWorldLeakage(
  inputs: LeakageScanInput[],
  task: Pick<OpenWorldTask, "id" | "forbiddenIdentifiers" | "forbiddenPaths">,
  now = new Date()
): OpenWorldLeakageAudit {
  const findings: OpenWorldLeakageFinding[] = [];
  const sanitizedQueries: Array<{ original: string; sanitized: string }> = [];
  for (const input of inputs) {
    if (input.surface === "query") {
      const sanitized = sanitizeOpenWorldQuery(input.value, task);
      sanitizedQueries.push({ original: input.value, sanitized });
      if (sanitized !== input.value) findings.push(finding("forbidden-query-token", "block", "query", input.source, "Query contained forbidden oracle or benchmark identifier.", input.value));
    }
    findings.push(...scanForbiddenValues(input, task.forbiddenIdentifiers, "forbidden-identifier", "Forbidden identifier appeared in OpenWorld artifact."));
    findings.push(...scanForbiddenValues(input, task.forbiddenPaths, "forbidden-path", "Forbidden path appeared in OpenWorld artifact."));
    findings.push(...scanBuiltInOracleMarkers(input));
  }
  const status = findings.some((item) => item.level === "block") ? "blocked" : findings.length ? "warning" : "pass";
  return OpenWorldLeakageAuditSchema.parse({
    schemaVersion: "openskill-kit.openworld-leakage-audit.v1",
    id: `owaud_${shortHash(`${task.id}:${now.toISOString()}:${inputs.map((item) => item.source).join(",")}`)}`,
    taskId: task.id,
    scannedAt: now.toISOString(),
    status,
    forbiddenIdentifiers: task.forbiddenIdentifiers,
    forbiddenPaths: task.forbiddenPaths,
    findings,
    sanitizedQueries
  });
}

export function assertOpenWorldArtifactPath(projectRoot: string, file: string): string {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, file);
  const allowed = [
    path.join(root, ".openskill-kit", "openworld"),
    path.join(root, ".openskill-kit", "evolution")
  ];
  if (!allowed.some((base) => target === base || target.startsWith(`${base}${path.sep}`))) {
    throw new Error(`OpenWorld artifact path must stay under .openskill-kit/openworld or .openskill-kit/evolution: ${file}`);
  }
  return target;
}

function scanForbiddenValues(input: LeakageScanInput, values: string[], id: string, message: string): OpenWorldLeakageFinding[] {
  const findings: OpenWorldLeakageFinding[] = [];
  for (const value of values.filter((item) => item.trim().length > 0)) {
    if (!containsValue(input.value, value)) continue;
    findings.push(finding(id, "block", input.surface, input.source, message, value));
  }
  return findings;
}

function scanBuiltInOracleMarkers(input: LeakageScanInput): OpenWorldLeakageFinding[] {
  const markers = [
    /\b(hidden[-_\s]?tests?|oracle[-_\s]?private|oracle[-_\s]?output)\b/i,
    /\b(ground[-_\s]?truth|gold[-_\s]?answer|target[-_\s]?answer)\b/i,
    /\b(reference[-_\s]?solution|solution[-_\s]?trace|successful[-_\s]?trace)\b/i
  ];
  const findings: OpenWorldLeakageFinding[] = [];
  for (const pattern of markers) {
    const match = input.value.match(pattern);
    if (match?.[0]) findings.push(finding("oracle-marker", "block", input.surface, input.source, "Oracle or hidden benchmark marker appeared in OpenWorld artifact.", match[0]));
  }
  return findings;
}

function replaceForbidden(value: string, forbidden: string): string {
  if (!forbidden.trim()) return value;
  return value.split(forbidden).join("[redacted]");
}

function containsValue(value: string, forbidden: string): boolean {
  return value.toLowerCase().includes(forbidden.toLowerCase());
}

function finding(id: string, level: "warn" | "block", surface: OpenWorldLeakageFinding["surface"], source: string, message: string, match: string): OpenWorldLeakageFinding {
  return { id, level, surface, source, message, match: match.slice(0, 160) };
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
