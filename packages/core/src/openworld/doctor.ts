import path from "node:path";
import { promises as fs } from "node:fs";

export interface OpenWorldDoctorCapability {
  name: string;
  status: "available" | "scaffold" | "missing";
  message: string;
}

export interface OpenWorldDoctorReport {
  schemaVersion: "openskill-kit.openworld-doctor.v1";
  status: "pass" | "warn" | "fail";
  projectRoot: string;
  taskCount: number;
  capabilities: OpenWorldDoctorCapability[];
  nextActions: string[];
}

export async function runOpenWorldDoctor(projectRootInput: string): Promise<OpenWorldDoctorReport> {
  const projectRoot = path.resolve(projectRootInput);
  const tasksDir = path.join(projectRoot, ".openskill-kit", "openworld", "tasks");
  const taskCount = await fs.readdir(tasksDir).then((entries) => entries.length).catch(() => 0);
  const capabilities: OpenWorldDoctorCapability[] = [
    { name: "Task records", status: "available", message: "Local OpenWorld task records are supported." },
    { name: "Leakage barrier", status: "available", message: "Queries, paths, content, and artifacts can be scanned for forbidden identifiers." },
    { name: "Local source ingestion", status: "available", message: "Project-local files can become audited OpenWorld sources." },
    { name: "Explicit web source ingestion", status: "available", message: "HTTP(S) URLs can be fetched only when the task has allowWeb enabled; source text is leakage-audited before caching." },
    { name: "Source index and trust cache", status: "available", message: "OpenWorld source metadata, content hashes, cache paths, and trust scores are recorded." },
    { name: "Anchor Cards", status: "available", message: "Anchor Cards can be drafted from local sources." },
    { name: "Virtual verifier suite", status: "scaffold", message: "Visible/holdout verifier manifests are drafted, not generated executable benchmark suites." },
    { name: "Autonomous web search", status: "missing", message: "No autonomous query planning or web/doc/repo search engine is implemented." },
    { name: "LLM skill generation", status: "missing", message: "No built-in model generation loop is implemented." },
    { name: "Sandboxed refinement", status: "missing", message: "No containerized iterative OpenSkill refinement loop is implemented." },
    { name: "Hidden-oracle benchmark proof", status: "missing", message: "Existing evals do not prove hidden-oracle benchmark improvement." }
  ];
  return {
    schemaVersion: "openskill-kit.openworld-doctor.v1",
    status: "warn",
    projectRoot,
    taskCount,
    capabilities,
    nextActions: [
      "Use local files or explicit allowWeb URL ingestion with leakage checks for current OpenWorld experiments.",
      "Do not claim paper-level OpenSkill behavior until autonomous retrieval, executable virtual tests, sandbox refinement, and hidden-oracle evals exist.",
      "Promote OpenWorld output only through normal review and memory-integrity gates."
    ]
  };
}
