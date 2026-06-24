import path from "node:path";
import { z } from "zod";

export const SandboxPolicySchema = z.object({
  schemaVersion: z.literal("openskill-kit.sandbox-policy.v0"),
  mode: z.enum(["local-process", "docker"]),
  projectRoot: z.string().min(1),
  allowNetwork: z.boolean(),
  dockerImage: z.string().min(1).optional(),
  allowedCommands: z.array(z.string().min(1)),
  timeoutMs: z.number().int().min(100).max(300000),
  maxOutputBytes: z.number().int().min(1024).max(10 * 1024 * 1024),
  redactEnvPatterns: z.array(z.string()),
  limitations: z.array(z.string())
});

export type SandboxPolicy = z.infer<typeof SandboxPolicySchema>;

export function createLocalSandboxPolicy(options: {
  projectRoot: string;
  allowNetwork?: boolean;
  allowedCommands?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
}): SandboxPolicy {
  return SandboxPolicySchema.parse({
    schemaVersion: "openskill-kit.sandbox-policy.v0",
    mode: "local-process",
    projectRoot: path.resolve(options.projectRoot),
    allowNetwork: options.allowNetwork ?? false,
    allowedCommands: options.allowedCommands ?? [process.execPath, "node", "npm", "git"],
    timeoutMs: options.timeoutMs ?? 30000,
    maxOutputBytes: options.maxOutputBytes ?? 256 * 1024,
    redactEnvPatterns: [
      "TOKEN",
      "SECRET",
      "KEY",
      "PASSWORD",
      "CREDENTIAL",
      "AUTH"
    ],
    limitations: [
      "local-process mode uses execFile without shell expansion but is not a container boundary",
      "allowNetwork=false is recorded policy metadata; OS-level network blocking requires future container sandbox"
    ]
  });
}

export function createDockerSandboxPolicy(options: {
  projectRoot: string;
  image: string;
  allowNetwork?: boolean;
  allowedCommands?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
}): SandboxPolicy {
  return SandboxPolicySchema.parse({
    schemaVersion: "openskill-kit.sandbox-policy.v0",
    mode: "docker",
    projectRoot: path.resolve(options.projectRoot),
    allowNetwork: options.allowNetwork ?? false,
    dockerImage: options.image,
    allowedCommands: options.allowedCommands ?? ["node", "npm", "git"],
    timeoutMs: options.timeoutMs ?? 30000,
    maxOutputBytes: options.maxOutputBytes ?? 256 * 1024,
    redactEnvPatterns: [
      "TOKEN",
      "SECRET",
      "KEY",
      "PASSWORD",
      "CREDENTIAL",
      "AUTH"
    ],
    limitations: [
      "docker mode uses docker run with mounted project root and no shell expansion",
      "allowNetwork=false maps to docker --network none"
    ]
  });
}

export function isPathInside(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function commandName(command: string): string {
  const base = path.basename(command).toLowerCase();
  return process.platform === "win32" ? base.replace(/\.(cmd|exe|ps1)$/i, "") : base;
}
