import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const steps = [
  ["npm", ["test"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "smoke"]]
] as const;

for (const [command, args] of steps) {
  const executable = command === "npm" && process.env.npm_execpath ? process.execPath : command;
  const finalArgs = command === "npm" && process.env.npm_execpath ? [process.env.npm_execpath, ...args] : [...args];
  const result = await execFileAsync(executable, finalArgs);
  if (result.stdout.trim()) process.stdout.write(result.stdout);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
}

await removePythonBytecode("python");
await runStep("npm", ["run", "package:dry-run"]);

try {
  const result = await execFileAsync("python", ["-m", "pytest", "python", "-q"]);
  if (result.stdout.trim()) process.stdout.write(result.stdout);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
} catch (error) {
  const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
  if (err.code === "ENOENT") {
    process.stdout.write("python not found; skipped python OpenWorld tests\n");
  } else {
    if (err.stdout?.trim()) process.stdout.write(err.stdout);
    if (err.stderr?.trim()) process.stderr.write(err.stderr);
    throw error;
  }
}

async function runStep(command: string, args: string[]): Promise<void> {
  const executable = command === "npm" && process.env.npm_execpath ? process.execPath : command;
  const finalArgs = command === "npm" && process.env.npm_execpath ? [process.env.npm_execpath, ...args] : [...args];
  const result = await execFileAsync(executable, finalArgs);
  if (result.stdout.trim()) process.stdout.write(result.stdout);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
}

async function removePythonBytecode(dir: string): Promise<void> {
  const entries = await import("node:fs/promises").then((fs) => fs.readdir(dir, { withFileTypes: true }).catch(() => []));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") await rm(full, { recursive: true, force: true });
      else await removePythonBytecode(full);
    } else if (/\.py[cod]$/i.test(entry.name)) {
      await rm(full, { force: true });
    }
  }
}
