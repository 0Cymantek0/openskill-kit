import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, randomBytes, scryptSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { readProjectConfig } from "../events/store.js";
import { writeFileAtomic, writeJsonAtomic, withFileLock } from "../storage/atomic.js";
import { LEARN_V2_GENERATED_DIRS, LEARN_V2_GENERATED_FILES } from "../learn-v2/paths.js";

const LEARN_V2_CONCEPT_RESOURCE_REL = ".openskill-kit/compiled/mcp/resources/learn-v2-concepts.json";

export interface ProjectBehaviorPackResult {
  schemaVersion: "openskill-kit.project-pack.v1";
  packPath: string;
  manifestPath: string;
  files: string[];
  publishAudit: ProjectBehaviorPackPublishAudit;
}

export interface EncryptedProjectBehaviorPackResult {
  schemaVersion: "openskill-kit.encrypted-project-pack.v1";
  status: "exported";
  encryptedPath: string;
  sourcePackPath: string;
  fileCount: number;
  privacyStatement: string;
}

export interface ProjectBehaviorPackPublishAuditFinding {
  ruleId: string;
  level: "warn" | "block";
  file: string;
  message: string;
  sample: string;
}

export interface ProjectBehaviorPackPublishAudit {
  schemaVersion: "openskill-kit.project-pack-publish-audit.v1";
  status: "pass" | "fail";
  scannedAt: string;
  filesScanned: number;
  findings: ProjectBehaviorPackPublishAuditFinding[];
  summary: {
    warn: number;
    block: number;
  };
}

export async function exportProjectBehaviorPack(projectRoot: string): Promise<ProjectBehaviorPackResult> {
  const root = path.resolve(projectRoot);
  return withFileLock(path.join(root, ".openskill-kit", "compiled", ".pack.lock"), async () => {
    const packRoot = path.join(root, ".openskill-kit", "compiled", "project-behavior-pack");
    await fs.rm(packRoot, { recursive: true, force: true });
    const files = [
      ".openskill-kit/config.json",
      ".openskill-kit/project.json",
      ".openskill-kit/preferences/graph.md",
      ".openskill-kit/preferences/active/index.md",
      ".openskill-kit/compiled/context-pack.md",
      ...await compiledSkillFiles(root),
      ".openskill-kit/compiled/behavior/path-map.json",
      ".openskill-kit/compiled/behavior/command-policy.md",
      ".openskill-kit/compiled/behavior/command-policy.json",
      ".openskill-kit/compiled/behavior/review-checklist.md",
      ".openskill-kit/compiled/hooks/hooks.json",
      ".openskill-kit/compiled/mcp/server-config.json",
      LEARN_V2_CONCEPT_RESOURCE_REL
    ];
    for (const rel of files) {
      const source = path.join(root, rel);
      if (!await exists(source)) continue;
      const dest = path.join(packRoot, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(source, dest);
    }
    const initialCopied = await listFiles(packRoot);
    const publishAudit = await auditProjectBehaviorPackPayload(packRoot, initialCopied);
    const publishAuditPath = path.join(packRoot, "publish-audit.json");
    await writeJsonAtomic(publishAuditPath, publishAudit);
    if (publishAudit.status !== "pass") {
      throw new Error(`Behavior pack publish audit failed: ${publishAudit.findings.map((finding) => `${finding.file}:${finding.ruleId}`).join("; ")}`);
    }
    const copied = await listFiles(packRoot);
    const hashes = Object.fromEntries(await Promise.all(copied.map(async (file) => [file, await sha256(path.join(packRoot, file))])));
    const manifestPath = path.join(packRoot, "manifest.json");
    const config = await readProjectConfig(root);
    const source = await readSourceMetadata(root);
    await writeJsonAtomic(manifestPath, {
      schemaVersion: "openskill-kit.project-pack.v1",
      manifestVersion: 1,
      createdAt: new Date().toISOString(),
      project: {
        id: config.projectId,
        name: config.projectName,
        createdAt: config.createdAt
      },
      compatibility: {
        minVersion: "0.1.0",
        configSchema: config.schemaVersion,
        preferenceSchema: "openskill-kit.preference-graph.v1"
      },
      source,
      trust: {
        level: "local-export",
        hooksTrustedByDefault: false,
        importRequiresReview: true
      },
      publishAudit: {
        status: publishAudit.status,
        path: "publish-audit.json",
        findingCount: publishAudit.findings.length
      },
      includes: ["preferences", "skills", "hooks", "mcp"],
      privacy: { rawEventsIncluded: false, rawSignalsIncluded: false },
      privacyStatement: "Pack excludes raw events, raw signals, learn-v2 raw vault records, analysis, episode stores, model request artifacts, model response artifacts, outcome telemetry, concept store, activation index, review, eval and compile-preview artifacts, raw learning vault records, ambient hook metadata, interaction import runs, private evidence blobs, review drafts, eval run output, reports, raw prompts, raw diffs, and secret-like local state.",
      generatedArtifacts: copied.map((file) => ({ file, type: artifactType(file) })),
      files: copied,
      hashes
    });
    return { schemaVersion: "openskill-kit.project-pack.v1", packPath: packRoot, manifestPath, files: [...copied, "manifest.json"].sort(), publishAudit };
  });
}

export async function exportEncryptedProjectBehaviorPack(
  projectRoot: string,
  options: { passphrase: string; outputPath?: string }
): Promise<EncryptedProjectBehaviorPackResult> {
  if (!options.passphrase) throw new Error("Encrypted sync export requires a passphrase");
  const root = path.resolve(projectRoot);
  const pack = await exportProjectBehaviorPack(root);
  const verification = await verifyProjectBehaviorPack(pack.packPath);
  if (verification.status !== "pass") throw new Error(`Cannot encrypt invalid behavior pack: ${verification.issues.join("; ")}`);
  const files = await readPackPayload(pack.packPath, [...verification.files, "manifest.json"]);
  const manifest = await readManifest(pack.packPath);
  const plaintext = Buffer.from(JSON.stringify({
    schemaVersion: "openskill-kit.sync-payload.v1",
    createdAt: new Date().toISOString(),
    privacyStatement: manifest.privacyStatement,
    files
  }), "utf8");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(options.passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encryptedPath = path.resolve(options.outputPath ?? path.join(root, ".openskill-kit", "sync", "project-behavior-pack.enc.json"));
  await writeJsonAtomic(encryptedPath, {
    schemaVersion: "openskill-kit.encrypted-project-pack.v1",
    algorithm: "aes-256-gcm",
    kdf: "scrypt",
    createdAt: new Date().toISOString(),
    sourcePackHash: createHash("sha256").update(JSON.stringify(manifest.hashes ?? {})).digest("hex"),
    privacy: {
      rawEventsIncluded: false,
      rawSignalsIncluded: false,
      statement: manifest.privacyStatement
    },
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  });
  return {
    schemaVersion: "openskill-kit.encrypted-project-pack.v1",
    status: "exported",
    encryptedPath,
    sourcePackPath: pack.packPath,
    fileCount: verification.files.length + 1,
    privacyStatement: manifest.privacyStatement
  };
}

export async function importEncryptedProjectBehaviorPack(
  projectRoot: string,
  encryptedPathInput: string,
  options: { passphrase: string; dryRun?: boolean; trustHooks?: boolean; review?: boolean; maxChangedFiles?: number }
): Promise<ImportProjectBehaviorPackResult & { encryptedPath: string }> {
  if (!options.passphrase) throw new Error("Encrypted sync import requires a passphrase");
  const projectRootResolved = path.resolve(projectRoot);
  const encryptedPath = path.resolve(encryptedPathInput);
  const envelope = JSON.parse(await fs.readFile(encryptedPath, "utf8"));
  if (envelope.schemaVersion !== "openskill-kit.encrypted-project-pack.v1") throw new Error("Invalid encrypted pack schema");
  if (envelope.algorithm !== "aes-256-gcm" || envelope.kdf !== "scrypt") throw new Error("Unsupported encrypted pack algorithm");
  const key = scryptSync(options.passphrase, Buffer.from(envelope.salt, "base64"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
  const payload = JSON.parse(plaintext.toString("utf8")) as { schemaVersion: string; files: Record<string, string> };
  if (payload.schemaVersion !== "openskill-kit.sync-payload.v1") throw new Error("Invalid encrypted sync payload");
  const unpackRoot = path.join(os.tmpdir(), `openskill-kit-sync-${createHash("sha256").update(encryptedPath).digest("hex").slice(0, 12)}`);
  await fs.rm(unpackRoot, { recursive: true, force: true });
  for (const [rel, base64] of Object.entries(payload.files)) {
    const normalized = normalizePackRel(rel);
    const dest = path.join(unpackRoot, normalized);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, Buffer.from(base64, "base64"));
  }
  const imported = await importProjectBehaviorPack(projectRootResolved, unpackRoot, {
    dryRun: options.dryRun,
    trustHooks: options.trustHooks,
    review: options.review,
    maxChangedFiles: options.maxChangedFiles
  });
  return { ...imported, encryptedPath };
}

export interface VerifyProjectBehaviorPackResult {
  schemaVersion: "openskill-kit.project-pack-verify.v1";
  status: "pass" | "fail";
  packPath: string;
  issues: string[];
  files: string[];
  signature: {
    status: "present" | "missing" | "valid" | "invalid";
    keyId?: string;
    publicKeyPath?: string;
  };
  publishAudit: {
    status: "pass" | "fail";
    findingCount: number;
    auditPath?: string;
  };
}

export async function verifyProjectBehaviorPack(packPathInput: string): Promise<VerifyProjectBehaviorPackResult> {
  const packPath = path.resolve(packPathInput);
  const manifest = await readManifest(packPath);
  const issues: string[] = [];
  if (manifest.schemaVersion !== "openskill-kit.project-pack.v1") issues.push("Invalid manifest schema version");
  if (manifest.privacy?.rawEventsIncluded !== false) issues.push("Pack must not include raw events");
  if (manifest.privacy?.rawSignalsIncluded !== false) issues.push("Pack must not include raw signals");
  for (const blocked of privatePackPathPrefixes()) {
    if (manifest.files?.some((file: string) => file.startsWith(blocked))) issues.push(`Private path included: ${blocked}`);
  }
  for (const file of manifest.files ?? []) {
    if (file.endsWith(".lock") || path.basename(file).endsWith(".lock")) {
      issues.push(`Lock file included: ${file}`);
    }
  }
  for (const file of manifest.files ?? []) {
    const expected = manifest.hashes?.[file];
    if (!expected) {
      issues.push(`Missing hash for ${file}`);
      continue;
    }
    const actual = await sha256(path.join(packPath, file)).catch(() => undefined);
    if (actual !== expected) issues.push(`Hash mismatch for ${file}`);
  }
  const signature = await verifyManifestSignature(packPath, manifest);
  if (signature.status === "invalid") issues.push("Invalid pack signature");
  const publishAudit = await auditProjectBehaviorPackPayload(packPath, manifest.files ?? []);
  if (publishAudit.status !== "pass") {
    for (const finding of publishAudit.findings) issues.push(`Publish audit ${finding.level}: ${finding.file}: ${finding.ruleId}`);
  }
  const manifestAuditPath = typeof manifest.publishAudit?.path === "string" ? manifest.publishAudit.path : undefined;
  if (manifestAuditPath) {
    const auditPath = path.join(packPath, normalizePackRel(manifestAuditPath));
    const manifestAudit = await readPublishAudit(auditPath).catch(() => undefined);
    if (!manifestAudit) issues.push("Manifest publish audit is missing or invalid");
    else if (manifestAudit.status !== "pass") issues.push("Manifest publish audit did not pass");
  }
  return {
    schemaVersion: "openskill-kit.project-pack-verify.v1",
    status: issues.length ? "fail" : "pass",
    packPath,
    issues,
    files: manifest.files ?? [],
    signature,
    publishAudit: {
      status: publishAudit.status,
      findingCount: publishAudit.findings.length,
      auditPath: manifestAuditPath
    }
  };
}

export interface SignProjectBehaviorPackResult {
  schemaVersion: "openskill-kit.project-pack-sign.v1";
  packPath: string;
  manifestPath: string;
  publicKeyPath: string;
  keyId: string;
  signature: string;
}

export async function signProjectBehaviorPack(packPathInput: string, keyDirInput?: string): Promise<SignProjectBehaviorPackResult> {
  const packPath = path.resolve(packPathInput);
  const manifestPath = path.join(packPath, "manifest.json");
  const manifest = await readManifest(packPath);
  const keyDir = path.resolve(keyDirInput ?? path.join(os.homedir(), ".openskill-kit", "keys"));
  const keys = await ensureSigningKeys(keyDir);
  const payload = canonicalSignableManifest(manifest);
  const signature = cryptoSign(null, Buffer.from(payload), keys.privateKey).toString("base64");
  const keyId = createHash("sha256").update(keys.publicKey).digest("hex").slice(0, 16);
  const signed = {
    ...manifest,
    signature: {
      algorithm: "ed25519",
      keyId,
      value: signature,
      publicKey: keys.publicKey,
      publicKeyPath: keys.publicKeyPath
    }
  };
  await writeJsonAtomic(manifestPath, signed);
  return { schemaVersion: "openskill-kit.project-pack-sign.v1", packPath, manifestPath, publicKeyPath: keys.publicKeyPath, keyId, signature };
}

export interface InspectProjectBehaviorPackResult {
  schemaVersion: "openskill-kit.project-pack-inspect.v1";
  packPath: string;
  status: "pass" | "fail";
  fileCount: number;
  includes: string[];
  privacy: unknown;
  signature: VerifyProjectBehaviorPackResult["signature"];
  issues: string[];
}

export async function inspectProjectBehaviorPack(packPathInput: string): Promise<InspectProjectBehaviorPackResult> {
  const packPath = path.resolve(packPathInput);
  const manifest = await readManifest(packPath);
  const verification = await verifyProjectBehaviorPack(packPath);
  return {
    schemaVersion: "openskill-kit.project-pack-inspect.v1",
    packPath,
    status: verification.status,
    fileCount: manifest.files?.length ?? 0,
    includes: manifest.includes ?? [],
    privacy: manifest.privacy,
    signature: verification.signature,
    issues: verification.issues
  };
}

export interface DiffProjectBehaviorPackResult {
  schemaVersion: "openskill-kit.project-pack-diff.v1";
  leftPackPath: string;
  rightPackPath: string;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

export async function diffProjectBehaviorPacks(leftPackPathInput: string, rightPackPathInput: string): Promise<DiffProjectBehaviorPackResult> {
  const leftPackPath = path.resolve(leftPackPathInput);
  const rightPackPath = path.resolve(rightPackPathInput);
  const left = await readManifest(leftPackPath);
  const right = await readManifest(rightPackPath);
  const leftHashes = left.hashes ?? {};
  const rightHashes = right.hashes ?? {};
  const leftFiles = new Set(Object.keys(leftHashes));
  const rightFiles = new Set(Object.keys(rightHashes));
  const added = [...rightFiles].filter((file) => !leftFiles.has(file)).sort();
  const removed = [...leftFiles].filter((file) => !rightFiles.has(file)).sort();
  const changed = [...rightFiles].filter((file) => leftFiles.has(file) && leftHashes[file] !== rightHashes[file]).sort();
  const unchanged = [...rightFiles].filter((file) => leftFiles.has(file) && leftHashes[file] === rightHashes[file]).sort();
  return { schemaVersion: "openskill-kit.project-pack-diff.v1", leftPackPath, rightPackPath, added, removed, changed, unchanged };
}

export interface ImportProjectBehaviorPackResult {
  schemaVersion: "openskill-kit.project-pack-import.v1";
  status: "planned" | "imported" | "blocked";
  packPath: string;
  projectRoot: string;
  files: Array<{ source: string; destination: string; status: "added" | "changed" | "unchanged" }>;
  issues: string[];
  reviewPath?: string;
  learnV2ConceptSummary?: LearnV2PackConceptSummary;
}

export interface LearnV2PackConceptSummary {
  schemaVersion: "openskill-kit.learn-v2-pack-concept-summary.v1";
  resourceCount: number;
  activeCount: number;
  lockedCount: number;
  highRiskCount: number;
  commandCount: number;
  pathScopedCount: number;
  conceptIds: string[];
}

export async function importProjectBehaviorPack(projectRootInput: string, packPathInput: string, options: { dryRun?: boolean; trustHooks?: boolean; review?: boolean; maxChangedFiles?: number } = {}): Promise<ImportProjectBehaviorPackResult> {
  const projectRoot = path.resolve(projectRootInput);
  const packPath = path.resolve(packPathInput);
  return withFileLock(path.join(projectRoot, ".openskill-kit", ".import.lock"), async () => {
    const manifest = await readManifest(packPath);
    const verification = await verifyProjectBehaviorPack(packPath);
    if (verification.status === "fail") {
      return { schemaVersion: "openskill-kit.project-pack-import.v1", status: "blocked", packPath, projectRoot, files: [], issues: verification.issues };
    }
    const learnV2ConceptSummary = await readLearnV2PackConceptSummary(packPath, verification.files);
    const files = verification.files
      .filter((file) => options.trustHooks === true || !file.startsWith(".openskill-kit/compiled/hooks/"))
      .map((file) => ({ source: path.join(packPath, file), destination: path.join(projectRoot, file) }));
    const plannedFiles = await Promise.all(files.map(async (file) => ({
      ...file,
      status: await fileImportStatus(file.source, file.destination)
    })));
    const changedCount = plannedFiles.filter((file) => file.status === "changed").length;
    const gateIssues = [
      ...(options.trustHooks ? [] : ["Hooks excluded until trustHooks is true"]),
      ...(typeof options.maxChangedFiles === "number" && changedCount > options.maxChangedFiles ? [`Changed file count ${changedCount} exceeds maxChangedFiles ${options.maxChangedFiles}`] : [])
    ];
    const reviewPath = options.review ? await writeImportReview(projectRoot, packPath, manifest, verification, plannedFiles, options.trustHooks === true, learnV2ConceptSummary) : undefined;
    if (typeof options.maxChangedFiles === "number" && changedCount > options.maxChangedFiles) {
      return { schemaVersion: "openskill-kit.project-pack-import.v1", status: "blocked", packPath, projectRoot, files: plannedFiles, issues: gateIssues, reviewPath, learnV2ConceptSummary };
    }
    if (options.dryRun !== false) {
      return { schemaVersion: "openskill-kit.project-pack-import.v1", status: "planned", packPath, projectRoot, files: plannedFiles, issues: gateIssues, reviewPath, learnV2ConceptSummary };
    }
    for (const file of plannedFiles) {
      await fs.mkdir(path.dirname(file.destination), { recursive: true });
      await fs.copyFile(file.source, file.destination);
    }
    return { schemaVersion: "openskill-kit.project-pack-import.v1", status: "imported", packPath, projectRoot, files: plannedFiles, issues: gateIssues, reviewPath, learnV2ConceptSummary };
  });
}

async function writeImportReview(
  projectRoot: string,
  packPath: string,
  manifest: any,
  verification: VerifyProjectBehaviorPackResult,
  files: Array<{ source: string; destination: string; status: "added" | "changed" | "unchanged" }>,
  trustHooks: boolean,
  learnV2ConceptSummary: LearnV2PackConceptSummary
): Promise<string> {
  const id = createHash("sha256").update(`${packPath}:${JSON.stringify(manifest.hashes ?? {})}`).digest("hex").slice(0, 12);
  const reviewPath = path.join(projectRoot, ".openskill-kit", "reviews", "imports", `import-${id}.md`);
  const lines = [
    "# Project Behavior Pack Import Review",
    "",
    `Pack: ${packPath}`,
    `Status: ${verification.status}`,
    `Project: ${manifest.project?.name ?? "unknown"} (${manifest.project?.id ?? "unknown"})`,
    `Signature: ${verification.signature.status}${verification.signature.keyId ? ` (${verification.signature.keyId})` : ""}`,
    `Trust hooks: ${trustHooks}`,
    "",
    "## Privacy",
    "",
    manifest.privacyStatement ?? "No privacy statement in manifest.",
    "",
    "## Issues",
    "",
    ...(verification.issues.length ? verification.issues.map((issue) => `- ${issue}`) : ["- none"]),
    "",
    "## Learn v2 Concepts",
    "",
    `- Resources: ${learnV2ConceptSummary.resourceCount}`,
    `- Active: ${learnV2ConceptSummary.activeCount}`,
    `- Locked: ${learnV2ConceptSummary.lockedCount}`,
    `- High risk: ${learnV2ConceptSummary.highRiskCount}`,
    `- Command activations: ${learnV2ConceptSummary.commandCount}`,
    `- Path scoped: ${learnV2ConceptSummary.pathScopedCount}`,
    `- Concept ids: ${learnV2ConceptSummary.conceptIds.length ? learnV2ConceptSummary.conceptIds.join(", ") : "none"}`,
    "- Import review does not auto-activate Learn v2 concepts; apply only copies the reviewed pack artifacts.",
    "",
    "## Files Planned",
    "",
    ...(files.length ? files.map((file) => `- ${file.status}: ${path.relative(projectRoot, file.destination).replace(/\\/g, "/")}`) : ["- none"]),
    ""
  ];
  await writeFileAtomic(reviewPath, lines.join("\n"));
  return reviewPath;
}

async function readLearnV2PackConceptSummary(packPath: string, files: string[]): Promise<LearnV2PackConceptSummary> {
  const empty: LearnV2PackConceptSummary = {
    schemaVersion: "openskill-kit.learn-v2-pack-concept-summary.v1",
    resourceCount: 0,
    activeCount: 0,
    lockedCount: 0,
    highRiskCount: 0,
    commandCount: 0,
    pathScopedCount: 0,
    conceptIds: []
  };
  if (!files.includes(LEARN_V2_CONCEPT_RESOURCE_REL)) return empty;
  const parsed = JSON.parse(await fs.readFile(path.join(packPath, LEARN_V2_CONCEPT_RESOURCE_REL), "utf8"));
  if (parsed?.schemaVersion !== "openskill-kit.mcp.learn-v2-concept-resources.v1" || !Array.isArray(parsed.resources)) return empty;
  const summary = { ...empty };
  const conceptIds = new Set<string>();
  for (const resource of parsed.resources) {
    const concept = resource && typeof resource === "object" ? (resource as { concept?: unknown }).concept : undefined;
    if (!concept || typeof concept !== "object") continue;
    const item = concept as {
      id?: unknown;
      status?: unknown;
      risk?: unknown;
      scope?: { level?: unknown; paths?: unknown };
      activation?: { commands?: unknown };
    };
    summary.resourceCount += 1;
    if (item.status === "active") summary.activeCount += 1;
    if (item.status === "locked") summary.lockedCount += 1;
    if (item.risk === "high") summary.highRiskCount += 1;
    if (Array.isArray(item.activation?.commands) && item.activation.commands.length > 0) summary.commandCount += 1;
    const paths = Array.isArray(item.scope?.paths) ? item.scope.paths : [];
    if (item.scope?.level === "path" || paths.length > 0) summary.pathScopedCount += 1;
    if (typeof item.id === "string" && item.id.trim()) conceptIds.add(item.id);
  }
  summary.conceptIds = [...conceptIds].sort();
  return summary;
}

async function fileImportStatus(source: string, destination: string): Promise<"added" | "changed" | "unchanged"> {
  if (!await exists(destination)) return "added";
  return await sha256(source) === await sha256(destination) ? "unchanged" : "changed";
}

async function auditProjectBehaviorPackPayload(packRoot: string, files: string[], now = new Date()): Promise<ProjectBehaviorPackPublishAudit> {
  const findings: ProjectBehaviorPackPublishAuditFinding[] = [];
  const uniqueFiles = [...new Set(files)].map(normalizePackRel).sort();
  for (const file of uniqueFiles) {
    findings.push(...auditPackPath(file));
    const full = path.join(packRoot, file);
    const text = await fs.readFile(full, "utf8").catch(() => undefined);
    if (typeof text !== "string") continue;
    findings.push(...auditPackContent(file, text));
    findings.push(...auditStructuredPackContent(file, text));
  }
  const summary = {
    warn: findings.filter((finding) => finding.level === "warn").length,
    block: findings.filter((finding) => finding.level === "block").length
  };
  return {
    schemaVersion: "openskill-kit.project-pack-publish-audit.v1",
    status: summary.block > 0 ? "fail" : "pass",
    scannedAt: now.toISOString(),
    filesScanned: uniqueFiles.length,
    findings,
    summary
  };
}

function auditPackPath(file: string): ProjectBehaviorPackPublishAuditFinding[] {
  const findings: ProjectBehaviorPackPublishAuditFinding[] = [];
  if (file.endsWith(".lock") || path.basename(file).endsWith(".lock")) {
    findings.push({
      ruleId: "lock-file-in-pack",
      level: "block" as const,
      file,
      message: "Behavior packs must not include lock files.",
      sample: file
    });
  }
  for (const prefix of privatePackPathPrefixes()) {
    if (file.startsWith(prefix)) {
      findings.push({
        ruleId: "private-path-in-pack",
        level: "block" as const,
        file,
        message: "Behavior packs must not include raw local learning, review, telemetry, eval-run, or private evidence paths.",
        sample: prefix
      });
    }
  }
  return findings;
}

function getPrivateArtifactRegex(): RegExp {
  const parts = privatePackPathPrefixes().map((p) => {
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (p.endsWith("/")) {
      return escaped.replace(/\\\/$/, "(?:\\/|$)");
    }
    return escaped;
  });
  return new RegExp(`(?:${parts.join("|")})`, "i");
}

function auditPackContent(file: string, text: string): ProjectBehaviorPackPublishAuditFinding[] {
  const home = os.homedir();
  const homePattern = home ? new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

  const rules = [
    {
      ruleId: "secret-like-token",
      level: "block" as const,
      message: "Pack payload contains a secret-shaped token.",
      pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{16,})\b/i,
      sample: "<SECRET>"
    },
    {
      ruleId: "secret-assignment",
      level: "block" as const,
      message: "Pack payload contains a secret-like config assignment.",
      pattern: /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*\s*=\s*[^\s"'`]+/i,
      sample: "NAME=<SECRET>"
    },
    {
      ruleId: "absolute-user-path",
      level: "block" as const,
      message: "Pack payload contains a machine-local user path.",
      pattern: /\b[A-Z]:\\Users\\[^\\\s"'`]+|\/(?:Users|home)\/[^\/\s"'`]+/i,
      sample: "<USER_HOME>"
    },
    ...(homePattern ? [{
      ruleId: "user-home-path",
      level: "block" as const,
      message: "Pack payload contains the local user home path.",
      pattern: homePattern,
      sample: "<USER_HOME_PATH>"
    }] : []),
    {
      ruleId: "raw-vault-ref",
      level: "block" as const,
      message: "Pack payload contains a raw vault reference.",
      pattern: /\braw_[A-Za-z0-9_-]{8,}\b/i,
      sample: "<RAW_REF>"
    },
    {
      ruleId: "private-artifact-reference",
      level: "block" as const,
      message: "Pack payload references private raw-local learning artifacts.",
      pattern: getPrivateArtifactRegex(),
      sample: "<PRIVATE_ARTIFACT_PATH>"
    }
  ];
  const findings: ProjectBehaviorPackPublishAuditFinding[] = [];
  for (const rule of rules) {
    if (!rule.pattern.test(text)) continue;
    findings.push({
      ruleId: rule.ruleId,
      level: rule.level,
      file,
      message: rule.message,
      sample: rule.sample
    });
  }
  return findings;
}

function auditStructuredPackContent(file: string, text: string): ProjectBehaviorPackPublishAuditFinding[] {
  if (file !== LEARN_V2_CONCEPT_RESOURCE_REL) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [finding("learn-v2-resource-invalid-json", "block", file, "Compiled Learn v2 concept resource JSON is invalid.", "<INVALID_JSON>")];
  }
  if (!parsed || typeof parsed !== "object" || (parsed as { schemaVersion?: unknown }).schemaVersion !== "openskill-kit.mcp.learn-v2-concept-resources.v1") {
    return [finding("learn-v2-resource-invalid-schema", "block", file, "Compiled Learn v2 concept resources use an unexpected schema.", "<INVALID_SCHEMA>")];
  }
  const resources = Array.isArray((parsed as { resources?: unknown }).resources) ? (parsed as { resources: unknown[] }).resources : [];
  const findings: ProjectBehaviorPackPublishAuditFinding[] = [];
  for (const resource of resources) {
    const concept = resource && typeof resource === "object" ? (resource as { concept?: unknown }).concept : undefined;
    if (!concept || typeof concept !== "object") {
      findings.push(finding("learn-v2-resource-missing-concept", "block", file, "Compiled Learn v2 resource is missing concept payload.", "<MISSING_CONCEPT>"));
      continue;
    }
    const item = concept as {
      id?: unknown;
      behavior?: unknown;
      status?: unknown;
      scope?: { level?: unknown; paths?: unknown; taskTypes?: unknown };
      activation?: { commands?: unknown };
      confidence?: unknown;
      risk?: unknown;
      evidenceCount?: unknown;
      sourceReliability?: unknown;
    };
    const id = typeof item.id === "string" && item.id ? item.id : "<unknown>";
    const evidenceCount = typeof item.evidenceCount === "number" ? item.evidenceCount : 0;
    const sourceReliability = typeof item.sourceReliability === "number" ? item.sourceReliability : 0;
    const paths = Array.isArray(item.scope?.paths) ? item.scope.paths : [];
    const taskTypes = Array.isArray(item.scope?.taskTypes) ? item.scope.taskTypes : [];
    const commands = Array.isArray(item.activation?.commands) ? item.activation.commands : [];
    const scopeLevel = typeof item.scope?.level === "string" ? item.scope.level : "unknown";
    const risk = typeof item.risk === "string" ? item.risk : "unknown";
    if (typeof item.behavior !== "string" || item.behavior.trim().length === 0) {
      findings.push(finding("learn-v2-unsupported-resource", "block", file, "Compiled Learn v2 concept has no behavior text.", id));
    }
    if (item.status !== "active" && item.status !== "locked") {
      findings.push(finding("learn-v2-inactive-resource", "block", file, "Compiled Learn v2 resource includes a non-active concept.", id));
    }
    if (evidenceCount < 1) {
      findings.push(finding("learn-v2-concept-without-evidence", "block", file, "Compiled Learn v2 concept has no evidence count.", id));
    }
    if (sourceReliability < 0.45) {
      findings.push(finding("learn-v2-weak-source-reliability", "block", file, "Compiled Learn v2 concept source reliability is too weak for export.", id));
    }
    if (scopeLevel === "project" && paths.length === 0 && taskTypes.length === 0 && evidenceCount < 2) {
      findings.push(finding("learn-v2-overbroad-weak-concept", "block", file, "Compiled Learn v2 project-scope concept has weak evidence and no narrowing scope.", id));
    }
    if (commands.length > 0 && (risk === "high" || scopeLevel === "project" && paths.length === 0 && taskTypes.length === 0)) {
      findings.push(finding("learn-v2-unsafe-command-policy", "block", file, "Compiled Learn v2 command activation is high-risk or too broadly scoped for export.", id));
    }
  }
  return findings;
}

function finding(ruleId: string, level: ProjectBehaviorPackPublishAuditFinding["level"], file: string, message: string, sample: string): ProjectBehaviorPackPublishAuditFinding {
  return { ruleId, level, file, message, sample };
}

function privatePackPathPrefixes(): string[] {
  const extraExcludes = [
    ".openskill-kit/ambient/"
  ];
  const all = [...LEARN_V2_GENERATED_DIRS, ...LEARN_V2_GENERATED_FILES, ...extraExcludes];
  return [...new Set(all)].sort();
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  }
  await walk(root);
  return out.sort();
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(packPath: string): Promise<any> {
  return JSON.parse(await fs.readFile(path.join(packPath, "manifest.json"), "utf8"));
}

async function readPublishAudit(file: string): Promise<ProjectBehaviorPackPublishAudit> {
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  if (parsed?.schemaVersion !== "openskill-kit.project-pack-publish-audit.v1") throw new Error("Invalid publish audit schema");
  if (parsed.status !== "pass" && parsed.status !== "fail") throw new Error("Invalid publish audit status");
  return parsed as ProjectBehaviorPackPublishAudit;
}

async function readPackPayload(packPath: string, files: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rel of [...new Set(files)].sort()) {
    const normalized = normalizePackRel(rel);
    out[normalized] = (await fs.readFile(path.join(packPath, normalized))).toString("base64");
  }
  return out;
}

function normalizePackRel(rel: string): string {
  const normalized = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) throw new Error(`Unsafe pack path: ${rel}`);
  return normalized;
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

async function readSourceMetadata(root: string): Promise<Record<string, unknown>> {
  const head = await fs.readFile(path.join(root, ".git", "HEAD"), "utf8").catch(() => "");
  const refMatch = /^ref:\s+(.+)$/m.exec(head);
  const ref = refMatch?.[1];
  const commit = ref
    ? await fs.readFile(path.join(root, ".git", ref), "utf8").then((value) => value.trim()).catch(() => undefined)
    : head.trim() || undefined;
  return {
    rootName: path.basename(root),
    git: {
      branch: ref ? path.basename(ref) : undefined,
      commit
    }
  };
}

function artifactType(file: string): string {
  if (file.includes("/compiled/skills/")) return "skill";
  if (file.includes("/compiled/hooks/")) return "hook";
  if (file.includes("/compiled/mcp/")) return "mcp";
  if (file.includes("/compiled/behavior/")) return "policy";
  if (file.includes("/preferences/")) return "preference";
  if (file.endsWith("config.json") || file.endsWith("project.json")) return "metadata";
  return "artifact";
}

async function compiledSkillFiles(root: string): Promise<string[]> {
  const skillsRoot = path.join(root, ".openskill-kit", "compiled", "skills");
  const files = await listFiles(skillsRoot);
  return files.map((file) => `.openskill-kit/compiled/skills/${file}`);
}

async function ensureSigningKeys(keyDir: string): Promise<{ privateKey: string; publicKey: string; publicKeyPath: string }> {
  await fs.mkdir(keyDir, { recursive: true });
  const privateKeyPath = path.join(keyDir, "project-pack-ed25519.private.pem");
  const publicKeyPath = path.join(keyDir, "project-pack-ed25519.public.pem");
  const existingPrivate = await fs.readFile(privateKeyPath, "utf8").catch(() => undefined);
  const existingPublic = await fs.readFile(publicKeyPath, "utf8").catch(() => undefined);
  if (existingPrivate && existingPublic) return { privateKey: existingPrivate, publicKey: existingPublic, publicKeyPath };
  const pair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  await writeFileAtomic(privateKeyPath, pair.privateKey);
  await fs.chmod(privateKeyPath, 0o600).catch(() => undefined);
  await writeFileAtomic(publicKeyPath, pair.publicKey);
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicKeyPath };
}

async function verifyManifestSignature(packPath: string, manifest: any): Promise<VerifyProjectBehaviorPackResult["signature"]> {
  if (!manifest.signature?.value) return { status: "missing" };
  const publicKeyPath = manifest.signature.publicKeyPath;
  const publicKey = typeof manifest.signature.publicKey === "string"
    ? manifest.signature.publicKey
    : typeof publicKeyPath === "string" ? await fs.readFile(publicKeyPath, "utf8").catch(() => undefined) : undefined;
  if (!publicKey) return { status: "invalid", publicKeyPath };
  const ok = cryptoVerify(null, Buffer.from(canonicalSignableManifest(manifest)), publicKey, Buffer.from(manifest.signature.value, "base64"));
  return { status: ok ? "valid" : "invalid", keyId: manifest.signature.keyId, publicKeyPath };
}

function canonicalSignableManifest(manifest: any): string {
  const { signature: _signature, ...unsigned } = manifest;
  return JSON.stringify(sortObject(unsigned));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sortObject(nested)]));
  }
  return value;
}
