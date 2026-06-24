import { promises as fs } from "node:fs";
import path from "node:path";
import { collectRepoContext, type RepoContext } from "../context/collector.js";
import { createLocalEvidenceLedger, writeEvidenceLedger, type AdditionalEvidence, type EvidenceLedger } from "../evidence/ledger.js";
import { auditLeakageInputs, isBlockedByLeakage, writeLeakageAudit, type LeakageAudit } from "../leakage/audit.js";
import { loadSkillPackage } from "../skill/parser.js";
import { slugifySkillName } from "../skill/schema.js";
import { writeSkillPackageFixture } from "../verifier/fixture.js";
import { buildVerifierPack, writeVerifierPack, type RepoVerifierCommandInput, type VerifierPack } from "../verifier/pack.js";

export interface DraftOptions {
  topic: string;
  projectRoot: string;
  noLlm?: boolean;
  now?: Date;
  evidenceFiles?: string[];
  evidenceUrls?: string[];
}

export interface DraftResult {
  runId: string;
  runDir: string;
  skillName: string;
  skillDir: string;
  evidenceLedgerPath: string;
  leakageAuditPath: string;
  verifierPackPath: string;
  runReportPath: string;
  files: string[];
  warnings: string[];
}

export async function draftSkill(options: DraftOptions): Promise<DraftResult> {
  const now = options.now ?? new Date();
  const context = await collectRepoContext(options.projectRoot);
  const skillName = slugifySkillName(options.topic);
  const runId = `${formatTimestamp(now)}-${skillName}`;
  const runDir = path.join(options.projectRoot, ".openskill-kit", "runs", runId);
  const candidateDir = path.join(runDir, "candidate", skillName);
  const referencesDir = path.join(candidateDir, "references");
  await fs.mkdir(referencesDir, { recursive: true });
  const ledgerPath = path.join(runDir, "evidence-ledger.json");
  const leakageAuditPath = path.join(runDir, "leakage-audit.json");
  const verifierPackPath = path.join(runDir, "verifier-pack.json");
  const runReportPath = path.join(runDir, "run-report.md");
  const evidenceInput = await collectEvidenceInputs(options.projectRoot, options.evidenceFiles ?? [], options.evidenceUrls ?? [], now);

  const skillMarkdown = renderSkillMarkdown(skillName, options.topic, context);
  const ledger = createLocalEvidenceLedger(options.topic, context, now, evidenceInput.evidence);
  ledger.warnings.push(...evidenceInput.warnings);
  const researchMarkdown = renderResearchMarkdown(options.topic, context, evidenceInput.evidence);
  const planMarkdown = renderPlanMarkdown(options.topic, context);
  const runJson = {
      runId,
      topic: options.topic,
      mode: options.noLlm ? "deterministic-local" : "deterministic-local",
      createdAt: now.toISOString(),
      skillName,
      artifacts: {
        context: "context.json",
        evidenceLedger: "evidence-ledger.json",
        leakageAudit: "leakage-audit.json",
        verifierPack: "verifier-pack.json",
        runReport: "run-report.md",
        plan: "plan.md",
        candidate: path.join("candidate", skillName, "SKILL.md").replaceAll("\\", "/")
      }
  };

  await fs.writeFile(path.join(candidateDir, "SKILL.md"), skillMarkdown, "utf8");
  await fs.writeFile(path.join(referencesDir, "research.md"), researchMarkdown, "utf8");
  if (evidenceInput.evidence.length) {
    await fs.writeFile(path.join(referencesDir, "evidence.md"), renderEvidenceMarkdown(evidenceInput.evidence), "utf8");
  }
  const fixturePath = await writeSkillPackageFixture(candidateDir);
  await fs.writeFile(path.join(runDir, "context.json"), JSON.stringify(context, null, 2), "utf8");
  await writeEvidenceLedger(ledgerPath, ledger);
  await writeLeakageAudit(leakageAuditPath, evidenceInput.leakageAudit);
  await fs.writeFile(path.join(runDir, "plan.md"), planMarkdown, "utf8");
  const pkg = await loadSkillPackage(candidateDir);
  const verifierPack = buildVerifierPack(pkg, ledger, now, selectRepoVerifierCommands(context));
  await writeVerifierPack(verifierPackPath, verifierPack);
  await fs.writeFile(runReportPath, renderRunReport({
    topic: options.topic,
    runId,
    skillName,
    context,
    ledger,
    leakageAudit: evidenceInput.leakageAudit,
    verifierPack,
    warnings: [...context.warnings, ...evidenceInput.warnings]
  }), "utf8");
  await fs.writeFile(path.join(runDir, "run.json"), JSON.stringify(runJson, null, 2), "utf8");

  return {
    runId,
    runDir,
    skillName,
    skillDir: candidateDir,
    evidenceLedgerPath: ledgerPath,
    leakageAuditPath,
    verifierPackPath,
    runReportPath,
    files: [
      path.join(runDir, "run.json"),
      path.join(runDir, "context.json"),
      ledgerPath,
      leakageAuditPath,
      verifierPackPath,
      runReportPath,
      path.join(runDir, "plan.md"),
      path.join(candidateDir, "SKILL.md"),
      fixturePath,
      path.join(referencesDir, "research.md"),
      ...(evidenceInput.evidence.length ? [path.join(referencesDir, "evidence.md")] : [])
    ],
    warnings: [...context.warnings, ...evidenceInput.warnings]
  };
}

function renderSkillMarkdown(skillName: string, topic: string, context: RepoContext): string {
  const testCommands = Object.entries(context.scripts)
    .filter(([name]) => /test|lint|typecheck|check/.test(name))
    .map(([name, command]) => `- \`${packageRun(context.packageManager, name)}\` (${command})`)
    .join("\n") || "- Inspect package scripts and choose the narrowest real verification command.";
  const frameworks = context.frameworks.length ? context.frameworks.join(", ") : "none detected";
  return `---\nname: ${skillName}\ndescription: Reusable workflow for ${topic.slice(0, 160)}\nlicense: MIT\ncompatibility: opencode,codex\nmetadata:\n  generated_by: openskill-kit\n  mode: deterministic-local\n---\n\n# ${skillName}\n\n## When to use\nUse when task matches: ${topic}\n\n## When not to use\nDo not use for unrelated repos, secret extraction, destructive maintenance, or tasks needing hidden benchmark answers.\n\n## Workflow\n1. Read local repo instructions, README, and relevant config before editing.\n2. Confirm detected stack: ${frameworks}.\n3. Identify smallest code path tied to task and inspect tests before changing behavior.\n4. Make focused edits, then run real verification commands.\n5. If verification fails, diagnose root cause, update workflow notes, and rerun.\n\n## Verification checklist\n${testCommands}\n- Run a focused command first, then broader checks if behavior is shared.\n- Record exact command output and changed files.\n\n## Common mistakes\n- Do not read .env files or print secrets.\n- Do not install global tools unless user approves.\n- Do not treat generated verifier output as hidden benchmark truth.\n- Do not paste bulky research into chat; use references instead.\n\n## References\n- [Research notes](references/research.md)\n`;
}

function renderResearchMarkdown(topic: string, context: RepoContext, evidence: AdditionalEvidence[]): string {
  return `# Research Notes\n\nTopic: ${topic}\n\n## Provenance\n\n- Source type: trusted local repository context\n- Root: ${context.root}\n- Package manager: ${context.packageManager}\n- Config files: ${context.configFiles.join(", ") || "none detected"}\n- Existing skill directories: ${context.existingSkillDirs.join(", ") || "none detected"}\n- Supplied evidence sources: ${evidence.map((item) => item.url ?? item.path ?? item.title).join(", ") || "none"}\n\n## Context Summary\n\nDetected frameworks: ${context.frameworks.join(", ") || "none"}\n\nScripts:\n${Object.entries(context.scripts).map(([name, value]) => `- ${name}: ${value}`).join("\n") || "- none"}\n\n## Incomplete Information\n\nExternal evidence is opt-in and unverified. Treat claims as local-context-only until source version and repo fit are checked.\n`;
}

function renderEvidenceMarkdown(evidence: AdditionalEvidence[]): string {
  return `# Supplied Evidence\n\n${evidence.map((item) => `## ${item.title}\n\n- Kind: ${item.kind}\n- Source: ${item.url ?? item.path ?? "not recorded"}\n- Captured characters: ${item.content.length}\n\n~~~text\n${fenceSafe(item.content.slice(0, 4000))}\n~~~`).join("\n\n")}\n`;
}

function renderPlanMarkdown(topic: string, context: RepoContext): string {
  return `# Draft Plan\n\nTopic: ${topic}\n\n1. Build concise portable SKILL.md.\n2. Keep bulky local context in references.\n3. Include repo verification commands from package scripts.\n4. Audit generated package with scanner.\n5. Install only after validation passes.\n\nDetected package manager: ${context.packageManager}\n`;
}

function renderRunReport(input: {
  topic: string;
  runId: string;
  skillName: string;
  context: RepoContext;
  ledger: EvidenceLedger;
  leakageAudit: LeakageAudit;
  verifierPack: VerifierPack;
  warnings: string[];
}): string {
  const repoSources = input.ledger.sources.filter((source) => source.type === "repo").length;
  const manualSources = input.ledger.sources.filter((source) => source.type === "manual").length;
  const externalSources = input.ledger.sources.filter((source) => source.type === "external").length;
  const commandLines = input.verifierPack.commands.length
    ? input.verifierPack.commands.map((command) => `- ${command.id}: ${command.command} ${command.args.join(" ")}`).join("\n")
    : "- none discovered";
  const warningLines = input.warnings.length
    ? input.warnings.map((warning) => `- ${warning}`).join("\n")
    : "- none";

  return `# OpenSkill Run Report\n\n## Summary\n\n- Run ID: ${input.runId}\n- Topic: ${input.topic}\n- Skill: ${input.skillName}\n- Package manager: ${input.context.packageManager}\n- Frameworks: ${input.context.frameworks.join(", ") || "none detected"}\n\n## Evidence\n\n- Repo sources: ${repoSources}\n- Manual sources: ${manualSources}\n- External sources: ${externalSources}\n- Claims: ${input.ledger.claims.length}\n\n## Leakage Audit\n\n- Status: ${input.leakageAudit.status}\n- Findings: ${input.leakageAudit.findings.length}\n\n## Verifier Pack\n\n- Assertions: ${input.verifierPack.assertions.length}\n- Visible assertions: ${input.verifierPack.visibleAssertionIds.length}\n- Holdout assertions: ${input.verifierPack.holdoutAssertionIds.length}\n- Repository commands:\n${commandLines}\n\n## Warnings\n\n${warningLines}\n\n## Limitations\n\n- Deterministic local mode does not prove downstream agent benchmark success.\n- External evidence is opt-in and unverified until checked against local repo truth.\n- Local-process sandbox is not a container boundary.\n`;
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function packageRun(pm: RepoContext["packageManager"], script: string): string {
  if (pm === "pnpm") return `pnpm ${script}`;
  if (pm === "yarn") return `yarn ${script}`;
  if (pm === "bun") return `bun run ${script}`;
  return `npm run ${script}`;
}

function selectRepoVerifierCommands(context: RepoContext): RepoVerifierCommandInput[] {
  return Object.entries(context.scripts)
    .filter(([name]) => /^(test|typecheck|lint|check|verify)$/.test(name) || /(^|:|-)(test|typecheck|lint|check|verify)($|:|-)/.test(name))
    .slice(0, 3)
    .map(([scriptName, command]) => ({
      scriptName,
      command,
      packageManager: context.packageManager
    }));
}

async function collectEvidenceInputs(projectRoot: string, files: string[], urls: string[], now: Date): Promise<{ evidence: AdditionalEvidence[]; leakageAudit: LeakageAudit; warnings: string[] }> {
  const rawEvidence: AdditionalEvidence[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    const resolved = path.isAbsolute(file) ? file : path.resolve(projectRoot, file);
    const base = path.basename(resolved).toLowerCase();
    if (/^\.env(\.|$)/.test(base)) {
      warnings.push(`Skipped evidence file that looks like an environment secret: ${file}`);
      continue;
    }
    const text = await fs.readFile(resolved, "utf8").catch((error: unknown) => {
      warnings.push(`Could not read evidence file ${file}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    });
    if (text === undefined) continue;
    const maxChars = 12000;
    const content = text.slice(0, maxChars);
    if (text.length > maxChars) warnings.push(`Truncated evidence file ${file} to ${maxChars} chars`);
    rawEvidence.push({
      title: path.basename(resolved),
      kind: "manual",
      path: path.relative(projectRoot, resolved) || path.basename(resolved),
      content
    });
  }
  rawEvidence.push(...await fetchEvidenceUrls(urls, warnings));
  const leakageAudit = auditLeakageInputs(rawEvidence.map((item) => ({
    source: item.url ?? item.path ?? item.title,
    content: item.content
  })), now);
  const evidence = rawEvidence.filter((item) => {
    const source = item.url ?? item.path ?? item.title;
    const blocked = isBlockedByLeakage(leakageAudit, source);
    if (blocked) warnings.push(`Skipped evidence source blocked by leakage audit: ${source}`);
    return !blocked;
  });
  return { evidence, leakageAudit, warnings };
}

async function fetchEvidenceUrls(urls: string[], warnings: string[]): Promise<AdditionalEvidence[]> {
  const evidence: AdditionalEvidence[] = [];
  for (const rawUrl of urls) {
    const parsed = parseEvidenceUrl(rawUrl, warnings);
    if (!parsed) continue;
    const response = await fetch(parsed, {
      redirect: "follow",
      signal: AbortSignal.timeout(10000)
    }).catch((error: unknown) => {
      warnings.push(`Could not fetch evidence URL ${rawUrl}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    });
    if (!response) continue;
    if (!response.ok) {
      warnings.push(`Could not fetch evidence URL ${rawUrl}: HTTP ${response.status}`);
      continue;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/^(text\/|application\/(json|xml|yaml|x-yaml|markdown))/.test(contentType.toLowerCase())) {
      warnings.push(`Skipped evidence URL ${rawUrl}: unsupported content type ${contentType}`);
      continue;
    }
    const text = await response.text();
    const maxChars = 20000;
    const content = text.slice(0, maxChars);
    if (text.length > maxChars) warnings.push(`Truncated evidence URL ${rawUrl} to ${maxChars} chars`);
    evidence.push({
      title: parsed.hostname,
      kind: "external",
      url: parsed.toString(),
      content
    });
  }
  return evidence;
}

function parseEvidenceUrl(rawUrl: string, warnings: string[]): URL | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    warnings.push(`Skipped evidence URL with invalid URL syntax: ${rawUrl}`);
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    warnings.push(`Skipped evidence URL with unsupported protocol: ${rawUrl}`);
    return undefined;
  }
  if (parsed.username || parsed.password || /(?:token|secret|key|password)=/i.test(parsed.search)) {
    warnings.push(`Skipped evidence URL that appears to contain credentials: ${redactUrl(parsed)}`);
    return undefined;
  }
  return parsed;
}

function redactUrl(url: URL): string {
  const copy = new URL(url.toString());
  copy.username = "";
  copy.password = "";
  for (const key of [...copy.searchParams.keys()]) {
    if (/(token|secret|key|password)/i.test(key)) copy.searchParams.set(key, "REDACTED");
  }
  return copy.toString();
}

function fenceSafe(value: string): string {
  return value.replaceAll("~~~", "~~ ~");
}
