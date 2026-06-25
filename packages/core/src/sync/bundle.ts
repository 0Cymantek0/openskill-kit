import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { readProjectConfig } from "../events/store.js";
import { writeFileAtomic, writeJsonAtomic, withFileLock } from "../storage/atomic.js";

export interface ProjectBehaviorPackResult {
  schemaVersion: "openskill-kit.project-pack.v1";
  packPath: string;
  manifestPath: string;
  files: string[];
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
      ".openskill-kit/compiled/skills/project-behavior/SKILL.md",
      ".openskill-kit/compiled/skills/project-behavior/references/active-preferences.md",
      ".openskill-kit/compiled/behavior/path-map.json",
      ".openskill-kit/compiled/behavior/command-policy.md",
      ".openskill-kit/compiled/behavior/review-checklist.md",
      ".openskill-kit/compiled/hooks/hooks.json",
      ".openskill-kit/compiled/mcp/server-config.json"
    ];
    for (const rel of files) {
      const source = path.join(root, rel);
      if (!await exists(source)) continue;
      const dest = path.join(packRoot, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(source, dest);
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
      includes: ["preferences", "skills", "hooks", "mcp"],
      privacy: { rawEventsIncluded: false, rawSignalsIncluded: false },
      privacyStatement: "Pack excludes raw events, raw signals, private evidence blobs, review drafts, eval run output, reports, raw prompts, raw diffs, and secret-like local state.",
      generatedArtifacts: copied.map((file) => ({ file, type: artifactType(file) })),
      files: copied,
      hashes
    });
    return { schemaVersion: "openskill-kit.project-pack.v1", packPath: packRoot, manifestPath, files: [...copied, "manifest.json"].sort() };
  });
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
}

export async function verifyProjectBehaviorPack(packPathInput: string): Promise<VerifyProjectBehaviorPackResult> {
  const packPath = path.resolve(packPathInput);
  const manifest = await readManifest(packPath);
  const issues: string[] = [];
  if (manifest.schemaVersion !== "openskill-kit.project-pack.v1") issues.push("Invalid manifest schema version");
  if (manifest.privacy?.rawEventsIncluded !== false) issues.push("Pack must not include raw events");
  if (manifest.privacy?.rawSignalsIncluded !== false) issues.push("Pack must not include raw signals");
  for (const blocked of [".openskill-kit/events/", ".openskill-kit/signals/", ".openskill-kit/evidence/blobs/", ".openskill-kit/reviews/", ".openskill-kit/evals/runs/", ".openskill-kit/reports/"]) {
    if (manifest.files?.some((file: string) => file.startsWith(blocked))) issues.push(`Private path included: ${blocked}`);
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
  return { schemaVersion: "openskill-kit.project-pack-verify.v1", status: issues.length ? "fail" : "pass", packPath, issues, files: manifest.files ?? [], signature };
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
  files: Array<{ source: string; destination: string }>;
  issues: string[];
  reviewPath?: string;
}

export async function importProjectBehaviorPack(projectRootInput: string, packPathInput: string, options: { dryRun?: boolean; trustHooks?: boolean; review?: boolean } = {}): Promise<ImportProjectBehaviorPackResult> {
  const projectRoot = path.resolve(projectRootInput);
  const packPath = path.resolve(packPathInput);
  return withFileLock(path.join(projectRoot, ".openskill-kit", ".import.lock"), async () => {
    const manifest = await readManifest(packPath);
    const verification = await verifyProjectBehaviorPack(packPath);
    if (verification.status === "fail") {
      return { schemaVersion: "openskill-kit.project-pack-import.v1", status: "blocked", packPath, projectRoot, files: [], issues: verification.issues };
    }
    const files = verification.files
      .filter((file) => options.trustHooks === true || !file.startsWith(".openskill-kit/compiled/hooks/"))
      .map((file) => ({ source: path.join(packPath, file), destination: path.join(projectRoot, file) }));
    const reviewPath = options.review ? await writeImportReview(projectRoot, packPath, manifest, verification, files, options.trustHooks === true) : undefined;
    if (options.dryRun !== false) {
      return { schemaVersion: "openskill-kit.project-pack-import.v1", status: "planned", packPath, projectRoot, files, issues: options.trustHooks ? [] : ["Hooks excluded until trustHooks is true"], reviewPath };
    }
    for (const file of files) {
      await fs.mkdir(path.dirname(file.destination), { recursive: true });
      await fs.copyFile(file.source, file.destination);
    }
    return { schemaVersion: "openskill-kit.project-pack-import.v1", status: "imported", packPath, projectRoot, files, issues: options.trustHooks ? [] : ["Hooks excluded until trustHooks is true"], reviewPath };
  });
}

async function writeImportReview(
  projectRoot: string,
  packPath: string,
  manifest: any,
  verification: VerifyProjectBehaviorPackResult,
  files: Array<{ source: string; destination: string }>,
  trustHooks: boolean
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
    "## Files Planned",
    "",
    ...(files.length ? files.map((file) => `- ${path.relative(projectRoot, file.destination).replace(/\\/g, "/")}`) : ["- none"]),
    ""
  ];
  await writeFileAtomic(reviewPath, lines.join("\n"));
  return reviewPath;
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
