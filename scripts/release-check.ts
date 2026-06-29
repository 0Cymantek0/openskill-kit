import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
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
await verifyStaticOpenCodePlugin();
await verifyPackageManifest();
await verifyPackageDryRun();

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

async function verifyPackageDryRun(): Promise<void> {
  const executable = process.env.npm_execpath ? process.execPath : "npm";
  const finalArgs = process.env.npm_execpath ? [process.env.npm_execpath, "pack", "--dry-run", "--json"] : ["pack", "--dry-run", "--json"];
  const result = await execFileAsync(executable, finalArgs);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
  const parsed = JSON.parse(result.stdout) as Array<{ files?: Array<{ path?: string }> }>;
  const paths = new Set((parsed[0]?.files ?? []).map((file) => file.path).filter((value): value is string => typeof value === "string"));
  const required = [
    "packages/agent-plugin-bundle/mcp/descriptors.public.json",
    "packages/agent-plugin-bundle/mcp/profiles.json",
    "packages/agent-plugin-bundle/opencode/commands/osk-learn.md",
    "packages/agent-plugin-bundle/opencode/agents/osk-learner.md",
    "packages/agent-plugin-bundle/opencode/plugins/openskillkit.ts",
    "packages/agent-plugin-bundle/model-routing.resolved.json"
  ];
  const missing = required.filter((item) => !paths.has(item));
  if (missing.length) throw new Error(`npm package missing harness artifact(s): ${missing.join(", ")}`);
  process.stdout.write(`npm package dry-run includes ${paths.size} files and required harness artifacts\n`);
}

async function verifyStaticOpenCodePlugin(): Promise<void> {
  const plugin = await readFile("packages/agent-plugin-bundle/opencode/plugins/openskillkit.ts", "utf8");
  const required = ["return {", "\"session.created\"", "\"tool.execute.after\"", "\"command.executed\"", "Metadata-only by default"];
  const missing = required.filter((item) => !plugin.includes(item));
  if (missing.length) throw new Error(`static OpenCode plugin missing hook contract marker(s): ${missing.join(", ")}`);
  if (plugin.includes("from \"opencode\"") || plugin.includes("app.on")) {
    throw new Error("static OpenCode plugin must use the hook-object API, not app.on or a runtime opencode import");
  }
  process.stdout.write("static OpenCode plugin uses hook-object API and metadata-only markers\n");
}

async function verifyPackageManifest(): Promise<void> {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    private?: boolean;
    bin?: Record<string, string>;
    files?: string[];
    license?: string;
  };
  if (packageJson.private === true) throw new Error("package.json is private; npm publish/npx install path is blocked");
  if (packageJson.license !== "MIT") throw new Error("package.json license must stay explicit for publish readiness");
  if (packageJson.bin?.["openskill-kit"] !== "dist/index.cjs") throw new Error("package.json missing openskill-kit CLI bin");
  if (packageJson.bin?.["openskill-kit-mcp"] !== "dist/openskill-kit-mcp.cjs") throw new Error("package.json missing openskill-kit-mcp bin");
  const requiredFiles = [
    "dist/**/*",
    "packages/agent-plugin-bundle/.agent-plugin/",
    "packages/agent-plugin-bundle/mcp/",
    "packages/agent-plugin-bundle/opencode/"
  ];
  const files = new Set(packageJson.files ?? []);
  const missing = requiredFiles.filter((item) => !files.has(item));
  if (missing.length) throw new Error(`package.json files allowlist missing publish artifact(s): ${missing.join(", ")}`);
  process.stdout.write("package manifest is publish-ready for npm/npx harness install\n");
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
