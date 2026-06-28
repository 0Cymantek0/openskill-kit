import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { OpenWorldHiddenOracleHarnessSchema, type OpenWorldHiddenOracleHarness } from "./schema.js";
import { readOpenWorldTask, writeOpenWorldTaskTextArtifact } from "./store.js";

const SCAN_DIRS = ["sources", "anchors", "verifiers", "candidates", "reports", path.join("research", "executions")];
const SCAN_EXTENSIONS = new Set([".json", ".md", ".txt", ".cjs", ".js"]);

export interface BuildOpenWorldHiddenOracleHarnessOptions {
  suiteId?: string;
  deniedPaths?: string[];
  benchmarkName?: string;
  benchmarkResultPath?: string;
  now?: Date;
}

export interface BuildOpenWorldHiddenOracleHarnessResult {
  schemaVersion: "openskill-kit.openworld-hidden-oracle-harness-result.v1";
  harness: OpenWorldHiddenOracleHarness;
  harnessPath: string;
  markdownPath: string;
}

export async function buildOpenWorldHiddenOracleHarness(
  projectRoot: string,
  taskId: string,
  options: BuildOpenWorldHiddenOracleHarnessOptions = {}
): Promise<BuildOpenWorldHiddenOracleHarnessResult> {
  const root = path.resolve(projectRoot);
  const task = await readOpenWorldTask(root, taskId);
  const now = options.now ?? new Date();
  const deniedInputs = [...new Set([...(task.forbiddenPaths ?? []), ...(options.deniedPaths ?? [])].map((item) => item.trim()).filter(Boolean))];
  const benchmarkReadiness = buildBenchmarkReadiness(root, options);
  const deniedPaths = deniedInputs.map((deniedPath, index) => {
    const normalized = normalizePathText(deniedPath);
    const resolved = path.resolve(root, deniedPath);
    return {
      id: `denied_${index + 1}`,
      raw: deniedPath,
      variants: pathVariants(deniedPath),
      record: {
        id: `denied_${index + 1}`,
        pathHash: shortHash(normalized),
        insideProject: isInside(root, resolved)
      }
    };
  });
  const files = await collectScanFiles(root, taskId);
  const leaks: OpenWorldHiddenOracleHarness["leaks"] = [];
  for (const file of files) {
    const content = await fs.readFile(file.absolutePath, "utf8").catch(() => "");
    const haystack = normalizePathText(content);
    for (const denied of deniedPaths) {
      if (denied.variants.some((variant) => variant && haystack.includes(variant))) {
        leaks.push({
          artifactPath: file.relativePath,
          deniedPathId: denied.record.id,
          deniedPathHash: denied.record.pathHash
        });
      }
    }
  }
  const status = leaks.length ? "fail" : deniedPaths.length ? "pass" : "warn";
  const draft = OpenWorldHiddenOracleHarnessSchema.parse({
    schemaVersion: "openskill-kit.openworld-hidden-oracle-harness.v1",
    id: `oworacle_${shortHash(`${taskId}:${options.suiteId ?? "none"}:${now.toISOString()}`)}`,
    taskId,
    suiteId: options.suiteId,
    generatedAt: now.toISOString(),
    status,
    proofLevel: deniedPaths.length ? "static-denied-path" : "not-proof",
    hiddenOracleProof: false,
    deniedPathProof: {
      deniedPathCount: deniedPaths.length,
      scannedArtifactCount: files.length,
      leakedReferenceCount: leaks.length,
      osBoundaryEnforced: false,
      status: leaks.length ? "fail" : deniedPaths.length ? "pass" : "not-enforced"
    },
    benchmarkReadiness,
    deniedPaths: deniedPaths.map((item) => item.record),
    scannedArtifacts: files.map((file) => file.relativePath),
    leaks,
    limitations: [
      "This harness never reads denied oracle file contents.",
      "This is static denied-path exposure proof over generated OpenWorld artifacts, not hidden-oracle benchmark proof.",
      "Benchmark readiness metadata is not a benchmark result and never changes hiddenOracleProof.",
      "local-process sandbox mode does not enforce OS-level path denial; containerized denial remains future work.",
      "Control artifacts such as task records, leakage audits, and research plans may contain configured forbidden path metadata and are not scanned as runtime/generation outputs."
    ]
  });
  const harnessPath = await writeOpenWorldTaskTextArtifact(root, taskId, ["harness", `${draft.id}.json`], `${JSON.stringify(draft, null, 2)}\n`);
  const markdownPath = await writeOpenWorldTaskTextArtifact(root, taskId, ["harness", `${draft.id}.md`], renderOpenWorldHiddenOracleHarness(draft));
  const harness = OpenWorldHiddenOracleHarnessSchema.parse({
    ...draft,
    artifacts: {
      harnessPath: path.relative(root, harnessPath).replace(/\\/g, "/"),
      markdownPath: path.relative(root, markdownPath).replace(/\\/g, "/")
    }
  });
  await writeOpenWorldTaskTextArtifact(root, taskId, ["harness", `${harness.id}.json`], `${JSON.stringify(harness, null, 2)}\n`);
  return { schemaVersion: "openskill-kit.openworld-hidden-oracle-harness-result.v1", harness, harnessPath, markdownPath };
}

export function renderOpenWorldHiddenOracleHarness(harness: OpenWorldHiddenOracleHarness): string {
  return [
    `# OpenWorld Hidden-Oracle Harness ${harness.id}`,
    "",
    `Status: ${harness.status}`,
    `Proof level: ${harness.proofLevel}`,
    `Hidden-oracle proof: no`,
    `Benchmark readiness: ${harness.benchmarkReadiness.status}`,
    `OS path boundary enforced: ${harness.deniedPathProof.osBoundaryEnforced ? "yes" : "no"}`,
    "",
    "## Denied Path Proof",
    "",
    `- Denied paths: ${harness.deniedPathProof.deniedPathCount}`,
    `- Scanned artifacts: ${harness.deniedPathProof.scannedArtifactCount}`,
    `- Leaked references: ${harness.deniedPathProof.leakedReferenceCount}`,
    `- Status: ${harness.deniedPathProof.status}`,
    "",
    "## Benchmark Readiness",
    "",
    `- Status: ${harness.benchmarkReadiness.status}`,
    `- Benchmark: ${harness.benchmarkReadiness.benchmarkName ?? "none"}`,
    `- Result path hash: ${harness.benchmarkReadiness.resultPathHash ?? "none"}`,
    `- Hidden-oracle proof: no`,
    "",
    "Required before benchmark proof:",
    "",
    ...harness.benchmarkReadiness.requirementsForProof.map((item) => `- ${item}`),
    "",
    "## Leaks",
    "",
    ...(harness.leaks.length
      ? harness.leaks.map((leak) => `- ${leak.artifactPath}: ${leak.deniedPathId} ${leak.deniedPathHash}`)
      : ["None"]),
    "",
    "## Limitations",
    "",
    ...harness.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].join("\n");
}

function buildBenchmarkReadiness(root: string, options: BuildOpenWorldHiddenOracleHarnessOptions): OpenWorldHiddenOracleHarness["benchmarkReadiness"] {
  const benchmarkName = options.benchmarkName?.trim() || undefined;
  const resultPath = options.benchmarkResultPath?.trim() || undefined;
  const resultPathHash = resultPath ? shortHash(path.resolve(root, resultPath)) : undefined;
  return {
    status: resultPath ? "external-result-referenced" : benchmarkName ? "configured-no-result" : "not-configured",
    benchmarkName,
    resultPathHash,
    hiddenOracleProof: false,
    requirementsForProof: [
      "real benchmark task suite configured",
      "oracle files denied from generation and refinement context",
      "isolated target evaluation runner executed after candidate freeze",
      "result summary imported without raw oracle content"
    ]
  };
}

async function collectScanFiles(root: string, taskId: string): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  const taskRoot = path.join(root, ".openskill-kit", "openworld", "tasks", taskId);
  const files: Array<{ absolutePath: string; relativePath: string }> = [];
  for (const dir of SCAN_DIRS) {
    await walk(path.join(taskRoot, dir), files, root);
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function walk(dir: string, out: Array<{ absolutePath: string; relativePath: string }>, root: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out, root);
      continue;
    }
    if (!entry.isFile() || !SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    out.push({ absolutePath: full, relativePath: path.relative(root, full).replace(/\\/g, "/") });
  }
}

function pathVariants(value: string): string[] {
  const normalized = normalizePathText(value);
  const basename = path.basename(value).toLowerCase();
  return [...new Set([normalized, normalized.replaceAll("/", "\\"), basename].map((item) => normalizePathText(item)).filter((item) => item.length >= 3))];
}

function normalizePathText(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
