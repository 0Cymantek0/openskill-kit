import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  extractSignals,
  getAdaptiveStatus,
  importInteractionSource,
  initAdaptiveProject,
  listInteractionAdapters,
  readEvents,
  readInteractionImportRuns,
  runFullDoctor,
  updatePreferenceGraph
} from "../src/index.js";

describe("interaction import", () => {
  it("describes supported adapters for harness-driven imports", () => {
    const adapters = listInteractionAdapters();
    expect(adapters.map((adapter) => adapter.id)).toEqual(["manual-import", "codex", "claude-code", "cursor"]);
    expect(adapters.every((adapter) => adapter.privacy === "explicit-import-only")).toBe(true);
    expect(adapters.find((adapter) => adapter.id === "codex")?.acceptedFormats).toContain("JSONL messages");
  });

  it("previews and imports cross-agent exports without copying raw source logs", async () => {
    const root = await tempProject();
    const source = path.join(root, "codex-export.jsonl");
    await writeFile(source, [
      JSON.stringify({ role: "user", content: "Always prefer focused tests before full suite. SECRET=sk-live-secret should redact.", timestamp: "2026-06-27T04:00:00.000Z", sessionId: "codex-a" }),
      JSON.stringify({ type: "post-tool-use", command: "npm", args: ["test"], status: "pass", timestamp: "2026-06-27T04:01:00.000Z", sessionId: "codex-a" })
    ].join("\n"), "utf8");

    const planned = await importInteractionSource(root, source, {
      adapter: "codex",
      agentName: "Codex",
      now: new Date("2026-06-27T05:00:00.000Z")
    });
    expect(planned.status).toBe("planned");
    expect(planned.parsedEventCount).toBe(2);
    expect(planned.appendedEventCount).toBe(0);
    expect(planned.source.adapterKnown).toBe(true);
    expect(planned.source.adapterStatus).toBe("available");
    expect(planned.source.agentName).toBe("Codex");
    expect(await readEvents(root)).toHaveLength(0);
    expect(await readFile(planned.artifacts.markdownPath, "utf8")).not.toContain("sk-live-secret");

    const imported = await importInteractionSource(root, source, {
      adapter: "codex",
      agentName: "Codex",
      dryRun: false,
      now: new Date("2026-06-27T05:01:00.000Z")
    });
    expect(imported.status).toBe("imported");
    expect(imported.appendedEventCount).toBe(2);
    const events = await readEvents(root);
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain("sk-live-secret");
    expect(events[0]?.source.adapter).toBe("codex");
    expect(events[0]?.source.agentName).toBe("Codex");
    expect(events[0]?.privacy.rawStored).toBe(false);

    const signals = await extractSignals(root, new Date("2026-06-27T05:02:00.000Z"));
    expect(signals.signals.some((signal) => signal.statement.includes("focused tests before full suite"))).toBe(true);
    const graph = await updatePreferenceGraph(root, new Date("2026-06-27T05:03:00.000Z"));
    expect(graph.graph.nodes.some((node) => node.statement.includes("focused tests before full suite"))).toBe(true);

    const duplicate = await importInteractionSource(root, source, {
      adapter: "codex",
      dryRun: false,
      now: new Date("2026-06-27T05:04:00.000Z")
    });
    expect(duplicate.status).toBe("blocked");
    expect(duplicate.messages.join(" ")).toContain("already imported");
    const runs = await readInteractionImportRuns(root);
    expect(runs.some((run) => run.status === "imported" && run.source.adapter === "codex")).toBe(true);
    const status = await getAdaptiveStatus(root);
    expect(status.interactionImportCount).toBeGreaterThanOrEqual(3);
    expect(status.importedInteractionEventCount).toBe(2);
    expect(status.blockedInteractionImportCount).toBeGreaterThanOrEqual(1);
    const doctor = await runFullDoctor(root);
    const importCheck = doctor.checks.find((check) => check.name === "Interaction imports");
    expect(importCheck?.status).toBe("warn");
    expect(importCheck?.message).toContain("blocked");
  });

  it("extracts useful events from plain text exports conservatively", async () => {
    const root = await tempProject();
    const source = path.join(root, "notes.md");
    await writeFile(source, [
      "# Session",
      "Prefer release changes run smoke before handoff.",
      "$ npm run smoke passed",
      "Casual line without reusable signal."
    ].join("\n"), "utf8");

    const imported = await importInteractionSource(root, source, {
      adapter: "manual-notes",
      dryRun: false,
      now: new Date("2026-06-27T06:00:00.000Z")
    });
    expect(imported.appendedEventCount).toBe(2);
    const events = await readEvents(root);
    expect(events.map((event) => event.eventType)).toEqual(["user-prompt-submit", "post-tool-use"]);
    expect(events[1]?.commands[0]?.command).toBe("npm");
    expect(events[1]?.commands[0]?.args).toEqual(["run", "smoke"]);
  });

  it("allows unknown adapters but marks generic parsing as experimental", async () => {
    const root = await tempProject();
    const source = path.join(root, "unknown-export.jsonl");
    await writeFile(source, JSON.stringify({ role: "user", content: "Always keep adapter imports explicit.", sessionId: "new-agent" }), "utf8");

    const planned = await importInteractionSource(root, source, {
      adapter: "New Agent",
      now: new Date("2026-06-27T07:00:00.000Z")
    });

    expect(planned.status).toBe("planned");
    expect(planned.source.adapter).toBe("new-agent");
    expect(planned.source.adapterKnown).toBe(false);
    expect(planned.source.adapterStatus).toBe("experimental");
    expect(planned.warnings.join(" ")).toContain("Unknown interaction adapter");
    expect(await readFile(planned.artifacts.markdownPath, "utf8")).toContain("Adapter known: no");
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "osk-interactions-"));
  await initAdaptiveProject({ projectRoot: root, projectName: "interactions", now: new Date("2026-06-27T00:00:00.000Z") });
  return root;
}
