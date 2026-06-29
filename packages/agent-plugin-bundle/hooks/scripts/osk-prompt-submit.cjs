#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const input = fs.readFileSync(0, "utf8");
const payload = input.trim() ? JSON.parse(input) : {};
const root = process.cwd();
const configPath = path.join(root, ".openskill-kit", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const now = new Date().toISOString();
const sessionId = String(payload.sessionId || payload.session_id || "hook-session");
const eventType = payload.eventType || payload.event_type || "user-prompt-submit";
const normalized = redact({
  text: payload.prompt || payload.text,
  tool: payload.tool,
  result: payload.result,
  raw: payload.raw ? "[omitted]" : undefined
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
  fs.appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
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
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(temp, filePath);
}
function redact(value) {
  if (typeof value === "string") {
    return value
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED:private-key]")
      .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED:github-token]")
      .replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, "[REDACTED:npm-token]")
      .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED:cloud-access-key]")
      .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH)[A-Z0-9_]*)\s*=\s*([^\s"'\`]+|"[^"]+"|'[^']+'|\`[^\`]+\`)/gi, "$1=[REDACTED:secret-assignment]");
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined).map(([key, nested]) => [key, redact(nested)]));
  return value;
}
