import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const steps = [
  ["npm", ["test"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "smoke"]],
  ["npm", ["run", "package:dry-run"]]
] as const;

for (const [command, args] of steps) {
  const executable = command === "npm" && process.env.npm_execpath ? process.execPath : command;
  const finalArgs = command === "npm" && process.env.npm_execpath ? [process.env.npm_execpath, ...args] : [...args];
  const result = await execFileAsync(executable, finalArgs);
  if (result.stdout.trim()) process.stdout.write(result.stdout);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
}
