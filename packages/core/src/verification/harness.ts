import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser/lib/esm/main.js";
import { OSK_PUBLIC_COMMAND_COUNT } from "../commands/families.js";
import { validateOpenCodeConfigSchema } from "./opencode-config.js";

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
    opencodeAgentCount?: number;
    opencodePluginReady?: boolean;
  };
  limits: {
    publicCommandCount: number;
    publicMcpToolCount: number;
    opencodeAgentCount: number;
    maxOpenCodeCommandBytes: number;
    maxOpenCodeAgentBytes: number;
    maxOpenCodePluginBytes: number;
    maxOpenCodeSkillBytes: number;
  };
  findings: HarnessVerificationFinding[];
}

const COMMON_OPENCODE_BUILT_INS = new Set(["help.md", "init.md", "login.md", "logout.md", "models.md", "theme.md", "config.md", "exit.md", "quit.md"]);
const REQUIRED_COMMAND_TEXT = ["Never read raw prompts", "Never read raw diffs", "Never read hidden benchmark answers"];
const REQUIRED_AGENT_TEXT = ["mode: subagent", "Use OSK MCP facade tools first", "Never store raw prompts"];
const REQUIRED_PLUGIN_TEXT = ["Metadata-only by default", "opencode-events.jsonl", "import type { Plugin } from \"@opencode-ai/plugin\"", "export const server = OpenSkillKitPlugin", "event: async", "session.created", "tool.execute.before", "tool.execute.after", "command.execute.before", "file.edited", "permission.ask", "permission.replied", "session.diff", "tui.command.execute"];
const EXPECTED_OPENCODE_AGENTS = ["osk-router.md", "osk-learner.md", "osk-reviewer.md", "osk-researcher.md", "osk-evolver.md", "osk-verifier.md", "osk-evaluator.md", "osk-docs.md"];
// Raw-prone keys that must never be copied verbatim into ambient metadata.
// Commands and paths are only allowed as *projection sources* (commandHash,
// commandKind, pathHash, pathKind, ...), never as stored raw values.
const FORBIDDEN_PLUGIN_SAFE_KEYS = ["prompt", "diff", "content", "message", "text", "output", "command", "cmd", "args", "argv", "path", "file", "filepath", "filename", "cwd", "env", "url"];
// Markers proving the safe-mode plugin projects commands/paths into derived
// fields rather than storing raw values. Field keys are built with template
// literals, so we assert on the projection helpers and suffix tokens that
// appear literally in the generated source.
const REQUIRED_PLUGIN_DERIVED_FIELDS = ["projectCommand", "projectPath", "classifyCommand", "classifyPath", "hashValue", "getRiskFlags", "Kind", "Hash", "LengthBucket", "Extension", "Depth"];
const BROAD_SKILL_DESCRIPTION = /\b(use for all coding|all coding tasks|always use|preferred over all other skills)\b/i;
const MAX_OPENCODE_COMMAND_BYTES = 6_000;
const MAX_OPENCODE_AGENT_BYTES = 6_000;
const MAX_OPENCODE_PLUGIN_BYTES = 14_000;
const MAX_OPENCODE_SKILL_BYTES = 8_000;

export async function verifyHarnessReadiness(projectRoot: string, now: Date = new Date()): Promise<HarnessReadinessVerification> {
  const root = path.resolve(projectRoot);
  const pluginRoot = path.join(root, ".openskill-kit", "compiled", "plugin");
  const findings: HarnessVerificationFinding[] = [];
  const commandMap = await readJson<any>(path.join(pluginRoot, "commands", "commands.json"));
  const families = await readJson<any>(path.join(pluginRoot, "commands", "families.json"));
  const publicDescriptors = await readJson<any>(path.join(pluginRoot, "mcp", "descriptors.public.json"));
  const opencodeCommandFiles = await listFiles(path.join(pluginRoot, "opencode", "commands"));
  const opencodeAgentFiles = await listFiles(path.join(pluginRoot, "opencode", "agents"));
  const opencodePluginPath = path.join(pluginRoot, "opencode", "plugins", "openskillkit.ts");
  const opencodeSkillFiles = (await listFiles(path.join(pluginRoot, "opencode", "skills"))).filter((file) => file.endsWith("SKILL.md"));
  await addOpenCodeConfigSchemaFindings(root, findings);

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
    const mappedCommand = commandMap?.commands?.find?.((item: any) => item.commandFile === relative || item.command === commandFromFilename(relative));
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
    if (mappedCommand?.mcpTool) {
      findings.push(finding(
        `opencode-command-facade:${path.basename(relative)}`,
        text.includes(`\`${mappedCommand.mcpTool}\``) ? "pass" : "fail",
        `OpenCode command ${relative} ${text.includes(`\`${mappedCommand.mcpTool}\``) ? "references" : "does not reference"} mapped MCP facade ${mappedCommand.mcpTool}.`,
        "Regenerate OpenCode commands from the command-family registry.",
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

  findings.push(finding(
    "opencode-agent-count",
    opencodeAgentFiles.length === EXPECTED_OPENCODE_AGENTS.length ? "pass" : "fail",
    `Generated ${opencodeAgentFiles.length} OpenCode agent file(s); expected ${EXPECTED_OPENCODE_AGENTS.length}.`,
    "Regenerate OpenCode agents from the model-routing projection."
  ));

  for (const expected of EXPECTED_OPENCODE_AGENTS) {
    findings.push(finding(
      `opencode-agent-present:${expected}`,
      opencodeAgentFiles.includes(expected) ? "pass" : "fail",
      `OpenCode agent ${expected} is ${opencodeAgentFiles.includes(expected) ? "present" : "missing"}.`,
      "Regenerate OpenCode agents from the model-routing projection.",
      path.join(pluginRoot, "opencode", "agents", expected)
    ));
  }

  for (const relative of opencodeAgentFiles) {
    const file = path.join(pluginRoot, "opencode", "agents", relative);
    const bytes = await fileBytes(file);
    const text = await fs.readFile(file, "utf8");
    findings.push(finding(
      `opencode-agent-size:${relative}`,
      bytes <= MAX_OPENCODE_AGENT_BYTES ? "pass" : "warn",
      `OpenCode agent ${relative} is ${bytes} byte(s); budget is ${MAX_OPENCODE_AGENT_BYTES}.`,
      "Shorten agent prompt text or move detail to command docs/skills.",
      file
    ));
    for (const required of REQUIRED_AGENT_TEXT) {
      findings.push(finding(
        `opencode-agent-safety:${relative}:${slug(required)}`,
        text.includes(required) ? "pass" : "fail",
        `OpenCode agent ${relative} ${text.includes(required) ? "includes" : "is missing"} required text: ${required}.`,
        "Regenerate OpenCode agents from the model-routing projection.",
        file
      ));
    }
  }

  const opencodePluginText = await fs.readFile(opencodePluginPath, "utf8").catch(() => "");
  findings.push(finding(
    "opencode-plugin-present",
    opencodePluginText ? "pass" : "fail",
    `OpenCode plugin file ${opencodePluginText ? "is present" : "is missing"}.`,
    "Regenerate plugin artifacts for OpenCode.",
    opencodePluginPath
  ));
  if (opencodePluginText) {
    const bytes = await fileBytes(opencodePluginPath);
    findings.push(finding(
      "opencode-plugin-size",
      bytes <= MAX_OPENCODE_PLUGIN_BYTES ? "pass" : "warn",
      `OpenCode plugin is ${bytes} byte(s); budget is ${MAX_OPENCODE_PLUGIN_BYTES}.`,
      "Keep generated plugin small and move explanation into docs.",
      opencodePluginPath
    ));
    for (const required of REQUIRED_PLUGIN_TEXT) {
      findings.push(finding(
        `opencode-plugin-hook:${slug(required)}`,
        opencodePluginText.includes(required) ? "pass" : "fail",
        `OpenCode plugin ${opencodePluginText.includes(required) ? "includes" : "is missing"} required hook/privacy text: ${required}.`,
        "Regenerate OpenCode plugin hooks from the compiler.",
        opencodePluginPath
      ));
    }
    const forbiddenKeys = forbiddenPluginSafeKeys(opencodePluginText);
    findings.push(finding(
      "opencode-plugin-safe-key-whitelist",
      forbiddenKeys.length ? "fail" : "pass",
      forbiddenKeys.length ? `OpenCode plugin safe whitelist includes raw-prone key(s): ${forbiddenKeys.join(", ")}.` : "OpenCode plugin safe whitelist excludes raw command/path/prompt/diff/content keys.",
      "Keep ambient capture metadata-only; project commands and paths into derived fields instead of storing raw values.",
      opencodePluginPath
    ));
    const missingDerived = REQUIRED_PLUGIN_DERIVED_FIELDS.filter((field) => !opencodePluginText.includes(field));
    findings.push(finding(
      "opencode-plugin-derived-fields",
      missingDerived.length ? "fail" : "pass",
      missingDerived.length ? `OpenCode plugin is missing privacy-safe derived field(s): ${missingDerived.join(", ")}.` : "OpenCode plugin projects commands and paths into privacy-safe derived metadata.",
      "Regenerate the OpenCode plugin so commands and paths are projected into hash/kind/extension/depth fields.",
      opencodePluginPath
    ));
    const unsafeRawCopy = unsafeRawCommandPathCopy(opencodePluginText);
    findings.push(finding(
      "opencode-plugin-no-raw-copy",
      unsafeRawCopy.length ? "fail" : "pass",
      unsafeRawCopy.length ? `OpenCode plugin copies raw command/path values verbatim: ${unsafeRawCopy.join(", ")}.` : "OpenCode plugin does not copy raw command/path values into ambient metadata.",
      "Route command/path values through the projection helpers instead of copying them raw.",
      opencodePluginPath
    ));
    const evalMode = opencodePluginText.includes('traceMode === "eval"')
      && opencodePluginText.includes('containsRawFields: true')
      && opencodePluginText.includes('intendedUse: "local-evaluation-only"')
      && opencodePluginText.includes('opencode-events.raw.jsonl');
    findings.push(finding(
      "opencode-plugin-eval-mode-gated",
      evalMode ? "pass" : "fail",
      evalMode ? "OpenCode plugin gates high-fidelity eval traces behind an explicit, clearly-labeled eval mode." : "OpenCode plugin is missing an explicit, clearly-labeled eval/debug trace mode.",
      "Keep eval/debug traces opt-in, labeled, and written to a separate file from normal ambient learning.",
      opencodePluginPath
    ));
  }

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
      opencodeCommandCount: opencodeCommandFiles.length,
      opencodeAgentCount: opencodeAgentFiles.length,
      opencodePluginReady: opencodePluginText ? !findings.some((item) => item.id.startsWith("opencode-plugin-") && item.severity === "fail") : false
    },
    limits: {
      publicCommandCount: OSK_PUBLIC_COMMAND_COUNT,
      publicMcpToolCount: 12,
      opencodeAgentCount: EXPECTED_OPENCODE_AGENTS.length,
      maxOpenCodeCommandBytes: MAX_OPENCODE_COMMAND_BYTES,
      maxOpenCodeAgentBytes: MAX_OPENCODE_AGENT_BYTES,
      maxOpenCodePluginBytes: MAX_OPENCODE_PLUGIN_BYTES,
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

async function addOpenCodeConfigSchemaFindings(root: string, findings: HarnessVerificationFinding[]): Promise<void> {
  const candidates = [path.join(root, "opencode.json"), path.join(root, "opencode.jsonc")];
  for (const file of candidates) {
    const text = await fs.readFile(file, "utf8").catch(() => undefined);
    if (text === undefined) continue;
    const errors: ParseError[] = [];
    const parsed = parseJsonc(stripUtf8Bom(text), errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length) {
      findings.push(finding(
        `opencode-config-schema:${path.basename(file)}`,
        "fail",
        `OpenCode config ${path.basename(file)} is not valid JSONC: ${errors.map((error) => `error ${error.error} at offset ${error.offset}`).join(", ")}.`,
        "Fix syntax before running OpenCode or attaching OSK.",
        file
      ));
      continue;
    }
    const validation = validateOpenCodeConfigSchema(parsed);
    findings.push(finding(
      `opencode-config-schema:${path.basename(file)}`,
      validation.valid ? "pass" : "fail",
      validation.valid
        ? `OpenCode config ${path.basename(file)} matches https://opencode.ai/config.json.`
        : `OpenCode config ${path.basename(file)} fails https://opencode.ai/config.json: ${validation.errors.slice(0, 5).join("; ")}.`,
      "Align opencode.json/jsonc with the OpenCode config schema.",
      file
    ));
  }
}

function stripUtf8Bom(text: string): string {
  return text.replace(/^\uFEFF+/, "");
}

function finding(id: string, severity: HarnessVerificationFinding["severity"], message: string, recommendation?: string, file?: string): HarnessVerificationFinding {
  return { id, severity, message, recommendation, file };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function commandFromFilename(relative: string): string {
  return `/${path.basename(relative, ".md").replace(/-/g, " ")}`;
}

function forbiddenPluginSafeKeys(text: string): string[] {
  // The primitive-copy whitelist is what gets stored verbatim. Commands and paths are
  // never copied raw: they are only read as projection sources (COMMAND_KEYS/PATH_KEYS)
  // and reduced to derived fields, so those source arrays are intentionally excluded.
  const whitelist = text.match(/SAFE_PRIMITIVE_KEYS\s*=\s*\[([^\]]+)\]/);
  const haystack = whitelist?.[1] ?? text;
  return FORBIDDEN_PLUGIN_SAFE_KEYS.filter((key) => new RegExp(`["']${key}["']`).test(haystack));
}

// Catches raw command/path values being stored verbatim into ambient metadata.
// The safe projection path routes command/path values through projectCommand/
// projectPath and never copies them directly into the output record. Any
// copy-loop whose key source contains a raw-prone key (command, path, args,
// cwd, env, output, ...) is unsafe because it stores the raw value verbatim.
function unsafeRawCommandPathCopy(text: string): string[] {
  // The metadata-copy loop is the only place primitive values are assigned
  // straight to the output record. Find its key source, then flag any raw-prone
  // keys it iterates. The safe plugin's source only carries SAFE_PRIMITIVE_KEYS
  // here, so this stays empty for the real generated plugin.
  const loopSource = text.match(/(?:for|forEach)\s*\(\s*(?:const\s+\w+\s+of|[^)]*\bof)\s+([A-Za-z0-9_]+)\b/);
  const sourceName = loopSource?.[1];
  if (!sourceName) return [];
  const sourceDef = text.match(new RegExp(`(?:const|let|var)\\s+${sourceName}\\s*=\\s*\\[([^\\]]+)\\]`));
  const haystack = sourceDef?.[1] ?? "";
  if (!haystack) return [];
  const directCopy = /\bfor\s*\(\s*const\s+\w+\s+of\b[\s\S]{0,160}?\bout\[[^\]]+\]\s*=\s*(?:value|item)\b/.test(text);
  if (!directCopy) return [];
  return FORBIDDEN_PLUGIN_SAFE_KEYS.filter((key) => new RegExp(`["']${key}["']`).test(haystack));
}
