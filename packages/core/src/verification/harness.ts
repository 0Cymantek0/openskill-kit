import { promises as fs } from "node:fs";
import path from "node:path";
import { OSK_PUBLIC_COMMAND_COUNT } from "../commands/families.js";

export interface HarnessVerificationFinding {
  id: string;
  severity: "pass" | "warn" | "fail";
  message: string;
  file?: string;
  recommendation?: string;
}

export interface HarnessReadinessVerification {
  schemaVersion: "openskill-kit.harness-readiness-verification.v1";
  status: "pass" | "warn" | "fail";
  projectRoot: string;
  checkedAt: string;
  summary: {
    findings: number;
    failures: number;
    warnings: number;
    publicCommandCount?: number;
    publicMcpToolCount?: number;
    opencodeCommandCount?: number;
  };
  limits: {
    publicCommandCount: number;
    publicMcpToolCount: number;
    maxOpenCodeCommandBytes: number;
    maxOpenCodeSkillBytes: number;
  };
  findings: HarnessVerificationFinding[];
}

const COMMON_OPENCODE_BUILT_INS = new Set(["help.md", "init.md", "login.md", "logout.md", "models.md", "theme.md", "config.md", "exit.md", "quit.md"]);
const REQUIRED_COMMAND_TEXT = ["Never read raw prompts", "Never read raw diffs", "Never read hidden benchmark answers"];
const BROAD_SKILL_DESCRIPTION = /\b(use for all coding|all coding tasks|always use|preferred over all other skills)\b/i;
const MAX_OPENCODE_COMMAND_BYTES = 6_000;
const MAX_OPENCODE_SKILL_BYTES = 8_000;

export async function verifyHarnessReadiness(projectRoot: string, now: Date = new Date()): Promise<HarnessReadinessVerification> {
  const root = path.resolve(projectRoot);
  const pluginRoot = path.join(root, ".openskill-kit", "compiled", "plugin");
  const findings: HarnessVerificationFinding[] = [];
  const commandMap = await readJson<any>(path.join(pluginRoot, "commands", "commands.json"));
  const families = await readJson<any>(path.join(pluginRoot, "commands", "families.json"));
  const publicDescriptors = await readJson<any>(path.join(pluginRoot, "mcp", "descriptors.public.json"));
  const opencodeCommandFiles = await listFiles(path.join(pluginRoot, "opencode", "commands"));
  const opencodeSkillFiles = (await listFiles(path.join(pluginRoot, "opencode", "skills"))).filter((file) => file.endsWith("SKILL.md"));

  if (!commandMap) {
    findings.push(finding("command-map-missing", "fail", "Compiled plugin command map is missing.", "Run `openskill-kit compile --target plugin`."));
  } else {
    const publicCount = Number(commandMap.publicFamilyCount ?? commandMap.commands?.length ?? 0);
    findings.push(finding(
      "public-command-count",
      publicCount === OSK_PUBLIC_COMMAND_COUNT ? "pass" : "fail",
      `Public command family count is ${publicCount}; expected ${OSK_PUBLIC_COMMAND_COUNT}.`,
      "Regenerate command maps from the command-family registry."
    ));
  }

  if (!families?.families?.length) {
    findings.push(finding("command-families-missing", "fail", "Compiled command-family registry projection is missing.", "Run `openskill-kit compile --target plugin`."));
  }

  if (!publicDescriptors) {
    findings.push(finding("public-mcp-descriptors-missing", "fail", "Public MCP descriptor profile is missing.", "Run `openskill-kit compile --target plugin`."));
  } else {
    const toolCount = Array.isArray(publicDescriptors.tools) ? publicDescriptors.tools.length : 0;
    findings.push(finding(
      "public-mcp-tool-count",
      toolCount <= 12 ? "pass" : "fail",
      `Public MCP profile exposes ${toolCount} tool(s); maximum is 12.`,
      "Move low-level tools to the advanced MCP profile."
    ));
  }

  for (const relative of opencodeCommandFiles) {
    const file = path.join(pluginRoot, "opencode", "commands", relative);
    const bytes = await fileBytes(file);
    const text = await fs.readFile(file, "utf8");
    const severity = COMMON_OPENCODE_BUILT_INS.has(path.basename(relative)) ? "fail" : "pass";
    findings.push(finding(
      `opencode-command-name:${path.basename(relative)}`,
      severity,
      `OpenCode command file ${relative} ${severity === "pass" ? "does not collide with common built-ins" : "collides with a common built-in"}.`,
      "Rename generated OSK command files to keep the osk-* prefix.",
      file
    ));
    findings.push(finding(
      `opencode-command-size:${path.basename(relative)}`,
      bytes <= MAX_OPENCODE_COMMAND_BYTES ? "pass" : "warn",
      `OpenCode command ${relative} is ${bytes} byte(s); budget is ${MAX_OPENCODE_COMMAND_BYTES}.`,
      "Shorten prompt text or move detail to docs/skills.",
      file
    ));
    for (const required of REQUIRED_COMMAND_TEXT) {
      findings.push(finding(
        `opencode-command-safety:${path.basename(relative)}:${slug(required)}`,
        text.includes(required) ? "pass" : "fail",
        `OpenCode command ${relative} ${text.includes(required) ? "includes" : "is missing"} safety text: ${required}.`,
        "Regenerate commands from the command-family registry safety rules.",
        file
      ));
    }
  }

  findings.push(finding(
    "opencode-command-count",
    opencodeCommandFiles.length === OSK_PUBLIC_COMMAND_COUNT ? "pass" : "fail",
    `Generated ${opencodeCommandFiles.length} OpenCode command file(s); expected ${OSK_PUBLIC_COMMAND_COUNT}.`,
    "Compile plugin artifacts and verify command-family registry projection."
  ));

  for (const relative of opencodeSkillFiles) {
    const file = path.join(pluginRoot, "opencode", "skills", relative);
    const text = await fs.readFile(file, "utf8");
    const bytes = await fileBytes(file);
    findings.push(finding(
      `opencode-skill-size:${relative}`,
      bytes <= MAX_OPENCODE_SKILL_BYTES ? "pass" : "warn",
      `OpenCode skill ${relative} is ${bytes} byte(s); budget is ${MAX_OPENCODE_SKILL_BYTES}.`,
      "Move bulky references out of SKILL.md.",
      file
    ));
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
    const description = frontmatter?.[1]?.match(/^description:\s*(.+)$/m)?.[1] ?? "";
    findings.push(finding(
      `opencode-skill-description:${relative}`,
      description && !BROAD_SKILL_DESCRIPTION.test(description) ? "pass" : "warn",
      description ? `OpenCode skill ${relative} has scoped description.` : `OpenCode skill ${relative} is missing description.`,
      "Use narrow trigger descriptions so harness skill selection stays precise.",
      file
    ));
  }

  const failures = findings.filter((item) => item.severity === "fail").length;
  const warnings = findings.filter((item) => item.severity === "warn").length;
  return {
    schemaVersion: "openskill-kit.harness-readiness-verification.v1",
    status: failures ? "fail" : warnings ? "warn" : "pass",
    projectRoot: root,
    checkedAt: now.toISOString(),
    summary: {
      findings: findings.length,
      failures,
      warnings,
      publicCommandCount: Number(commandMap?.publicFamilyCount ?? commandMap?.commands?.length ?? undefined),
      publicMcpToolCount: Array.isArray(publicDescriptors?.tools) ? publicDescriptors.tools.length : undefined,
      opencodeCommandCount: opencodeCommandFiles.length
    },
    limits: {
      publicCommandCount: OSK_PUBLIC_COMMAND_COUNT,
      publicMcpToolCount: 12,
      maxOpenCodeCommandBytes: MAX_OPENCODE_COMMAND_BYTES,
      maxOpenCodeSkillBytes: MAX_OPENCODE_SKILL_BYTES
    },
    findings
  };
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  };
  await walk(root);
  return out.sort();
}

async function fileBytes(file: string): Promise<number> {
  return (await fs.stat(file)).size;
}

function finding(id: string, severity: HarnessVerificationFinding["severity"], message: string, recommendation?: string, file?: string): HarnessVerificationFinding {
  return { id, severity, message, recommendation, file };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
