import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertOpenWorldArtifactPath, auditOpenWorldLeakage, sanitizeOpenWorldQuery } from "../src/index.js";

describe("OpenWorld leakage barrier", () => {
  it("sanitizes queries and blocks forbidden oracle content", () => {
    const task = {
      id: "owtask_leakage",
      forbiddenIdentifiers: ["benchmark-case-42"],
      forbiddenPaths: ["hidden/oracle.json"]
    };
    const sanitized = sanitizeOpenWorldQuery("Find docs for benchmark-case-42 hidden oracle", task);
    expect(sanitized).not.toContain("benchmark-case-42");
    expect(sanitized).not.toMatch(/\boracle\b/i);

    const audit = auditOpenWorldLeakage([
      { source: "query", surface: "query", value: "Find benchmark-case-42 target answer" },
      { source: "anchor", surface: "content", value: "This claim came from hidden/oracle.json" }
    ], task, new Date("2026-06-26T00:00:00.000Z"));
    expect(audit.status).toBe("blocked");
    expect(audit.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining(["forbidden-query-token", "forbidden-identifier", "forbidden-path", "oracle-marker"]));
  });

  it("keeps artifact writes in OpenWorld-owned directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-openworld-path-"));
    expect(assertOpenWorldArtifactPath(root, path.join(root, ".openskill-kit", "openworld", "tasks", "a", "task.json"))).toContain(".openskill-kit");
    expect(() => assertOpenWorldArtifactPath(root, path.join(root, "docs", "leak.json"))).toThrow(/OpenWorld artifact path/);
  });
});
