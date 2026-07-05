import path from "node:path";
import { writeFileAtomic, writeJsonAtomic } from "../storage/atomic.js";

export interface CompileHooksResult {
  schemaVersion: "openskill-kit.hooks.v1";
  hooksPath: string;
  scripts: string[];
}

export async function compileHookAdapter(projectRoot: string): Promise<CompileHooksResult> {
  const root = path.resolve(projectRoot);
  const hooksDir = path.join(root, ".openskill-kit", "compiled", "hooks");
  const scriptsDir = path.join(hooksDir, "scripts");
  const promptScript = path.join(scriptsDir, "osk-prompt-submit.cjs");
  const sessionScript = path.join(scriptsDir, "osk-session-end.cjs");
  const scriptBody = hookScriptBody();
  await writeFileAtomic(promptScript, scriptBody);
  await writeFileAtomic(sessionScript, scriptBody);
  const hooksPath = path.join(hooksDir, "hooks.json");
  await writeJsonAtomic(hooksPath, {
    schemaVersion: "openskill-kit.hooks.v1",
    hooks: [
      { event: "prompt-submit", command: "node .openskill-kit/compiled/hooks/scripts/osk-prompt-submit.cjs" },
      { event: "session-end", command: "node .openskill-kit/compiled/hooks/scripts/osk-session-end.cjs" }
    ]
  });
  return { schemaVersion: "openskill-kit.hooks.v1", hooksPath, scripts: [promptScript, sessionScript] };
}

function hookScriptBody(): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const input = fs.readFileSync(0, "utf8");
const payload = input.trim() ? JSON.parse(input) : {};
const root = process.cwd();
const configPath = path.join(root, ".openskill-kit", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const now = new Date().toISOString();
const rawSessionId = String(payload.sessionId || payload.session_id || "hook-session");
const eventType = payload.eventType || payload.event_type || "user-prompt-submit";
const traceContext = buildTraceContext(config.projectId, root, payload.traceContext, rawSessionId, now);
const sessionId = traceContext.oskSessionId;
const normalized = redact({
  text: payload.prompt || payload.text,
  tool: payload.tool,
  result: payload.result,
  raw: payload.raw ? "[omitted]" : undefined,
  traceContext
});
const event = {
  schemaVersion: "openskill-kit.event.v1",
  id: "evt_" + now.replace(/[^0-9]/g, "").slice(0, 14) + "_" + crypto.createHash("sha256").update(config.projectId + sessionId + eventType + now).digest("hex").slice(0, 12),
  projectId: config.projectId,
  sessionId,
  timestamp: now,
  eventType,
  source: { adapter: "openskill-kit-hook" },
  intent: typeof normalized.text === "string" ? normalized.text.slice(0, config.privacy?.maxSnippetChars || 2000) : undefined,
  normalized,
  files: Array.isArray(payload.files) ? payload.files.map((file) => ({ path: String(file.path || file), action: file.action || "unknown" })) : [],
  commands: Array.isArray(payload.commands) ? payload.commands : [],
  privacy: { redacted: JSON.stringify(normalized).includes("[REDACTED:"), rawStored: false, containsUserText: Boolean(payload.prompt || payload.text), containsCode: false }
};
const dir = path.join(root, ".openskill-kit", "events");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, now.slice(0, 7) + ".jsonl");
const indexPath = path.join(dir, "index.json");
withLock(path.join(dir, ".events.lock"), () => {
  fs.appendFileSync(file, JSON.stringify(event) + "\\n", "utf8");
  let index = { schemaVersion: "openskill-kit.event-index.v1", eventCount: 0, files: {}, updatedAt: now };
  if (fs.existsSync(indexPath)) index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const name = path.basename(file);
  const entry = index.files[name] || { count: 0, firstTimestamp: now, lastTimestamp: now };
  entry.count += 1;
  entry.firstTimestamp = entry.firstTimestamp < now ? entry.firstTimestamp : now;
  entry.lastTimestamp = entry.lastTimestamp > now ? entry.lastTimestamp : now;
  index.files[name] = entry;
  index.eventCount += 1;
  index.updatedAt = now;
  writeJsonAtomic(indexPath, index);
});
function withLock(lock, fn) {
  const start = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lock, { recursive: false });
      break;
    } catch (error) {
      if (error && error.code !== "EEXIST") throw error;
      const stat = fs.existsSync(lock) ? fs.statSync(lock) : undefined;
      if (stat && Date.now() - stat.mtimeMs > 30000) {
        fs.rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - start > 10000) throw new Error("Timed out waiting for event lock");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}
function writeJsonAtomic(filePath, value) {
  const temp = filePath + "." + process.pid + "." + Date.now() + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\\n", "utf8");
  fs.renameSync(temp, filePath);
}
function buildTraceContext(projectId, projectRoot, payloadTraceContext, fallbackSessionId, createdAt) {
  const payloadTrace = payloadTraceContext && typeof payloadTraceContext === "object" && !Array.isArray(payloadTraceContext) ? payloadTraceContext : {};
  const envSessionId = safeTraceId(process.env.OSK_SESSION_ID, "osk_session");
  const envEpisodeId = safeTraceId(process.env.OSK_EPISODE_ID, "osk_episode");
  const envTraceId = safeTraceId(process.env.OSK_TRACE_ID, "osk_trace");
  const payloadSessionId = safeTraceId(payloadTrace.oskSessionId, "osk_session");
  const payloadEpisodeId = safeTraceId(payloadTrace.oskEpisodeId, "osk_episode");
  const payloadTraceId = safeTraceId(payloadTrace.oskTraceId, "osk_trace");
  const payloadOpenCodeSessionId = safeTraceId(payloadTrace.opencodeSessionId, "opencode_session");
  const envOpenCodeSessionId = safeTraceId(process.env.OPENCODE_SESSION_ID, "opencode_session");
  const seed = projectId + ":" + projectRoot + ":" + fallbackSessionId;
  return {
    schemaVersion: "openskill-kit.learn-v2.trace-context.v1",
    oskSessionId: envSessionId || payloadSessionId || "osk_session_" + hashBare(seed + ":session"),
    oskEpisodeId: envEpisodeId || payloadEpisodeId || "osk_episode_" + hashBare(seed + ":episode"),
    oskTraceId: envTraceId || payloadTraceId || "osk_trace_" + hashBare(seed + ":trace"),
    opencodeSessionId: envOpenCodeSessionId || payloadOpenCodeSessionId,
    source: envSessionId || envEpisodeId || envTraceId ? "env" : payloadSessionId || payloadEpisodeId || payloadTraceId ? "payload" : "generated",
    projectRootHash: "sha256:" + hashBare(projectRoot),
    createdAt
  };
}
function safeTraceId(value, prefix) {
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(value)) return undefined;
  return value.startsWith(prefix + "_") || value.startsWith(prefix + ":") ? value : undefined;
}
function hashBare(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}
function redact(value) {
  if (typeof value === "string") {
    return value
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED:private-key]")
      .replace(/\\bgh[pousr]_[A-Za-z0-9_]{20,}\\b/g, "[REDACTED:github-token]")
      .replace(/\\bnpm_[A-Za-z0-9]{20,}\\b/g, "[REDACTED:npm-token]")
      .replace(/\\bAKIA[0-9A-Z]{16}\\b/g, "[REDACTED:cloud-access-key]")
      .replace(/\\b([A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH)[A-Z0-9_]*)\\s*=\\s*([^\\s"'\\\`]+|"[^"]+"|'[^']+'|\\\`[^\\\`]+\\\`)/gi, "$1=[REDACTED:secret-assignment]");
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined).map(([key, nested]) => [key, redact(nested)]));
  return value;
}
`;
}
