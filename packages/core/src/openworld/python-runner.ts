import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface OpenWorldPythonRunOptions {
  projectRoot: string;
  args: string[];
  timeoutMs?: number;
  pythonCommand?: string;
}

export interface OpenWorldPythonRunResult {
  schemaVersion: "openskill-kit.python-runner.v1";
  command: string;
  stdout: string;
  stderr: string;
  result: unknown;
}

export async function runOpenWorldPython(options: OpenWorldPythonRunOptions): Promise<OpenWorldPythonRunResult> {
  const root = path.resolve(options.projectRoot);
  const pythonDir = resolvePythonPath(root);
  const command = options.pythonCommand ?? process.env.OPENSKILLKIT_PYTHON ?? "python";
  const bootstrap = [
    "import sys",
    `sys.path.insert(0, ${JSON.stringify(pythonDir)})`,
    "from openskillkit_evolution.cli import main",
    "main()"
  ].join("; ");
  const args = ["-c", bootstrap, "--project-root", root, ...options.args];
  const env = sanitizedPythonEnv(pythonDir);
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: root,
    env,
    timeout: options.timeoutMs ?? 30_000,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });
  const parsed = parseJson(stdout);
  return {
    schemaVersion: "openskill-kit.python-runner.v1",
    command,
    stdout,
    stderr,
    result: parsed
  };
}

function resolvePythonPath(projectRoot: string): string {
  const candidates = [
    ...(process.env.OPENSKILLKIT_PYTHONPATH ? [process.env.OPENSKILLKIT_PYTHONPATH] : []),
    path.join(projectRoot, "python"),
    path.resolve("python"),
    ...(process.argv[1] ? walkCandidates(path.dirname(path.resolve(process.argv[1]))) : [])
  ];
  const found = candidates.find((candidate) => existsSync(path.join(candidate, "openskillkit_evolution")));
  return found ?? path.resolve("python");
}

function walkCandidates(start: string): string[] {
  const out: string[] = [];
  let current = path.resolve(start);
  while (true) {
    out.push(path.join(current, "python"));
    const parent = path.dirname(current);
    if (parent === current) return out;
    current = parent;
  }
}

function sanitizedPythonEnv(pythonDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "PATHEXT", "TMP", "TEMP", "HOME", "USERPROFILE"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.PYTHONPATH = process.env.PYTHONPATH ? `${pythonDir}${path.delimiter}${process.env.PYTHONPATH}` : pythonDir;
  env.PYTHONNOUSERSITE = "1";
  env.OPENSKILLKIT_OPENWORLD = "1";
  return env;
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`OpenWorld Python runner returned non-JSON output: ${stdout.slice(0, 500)}`);
  }
}
