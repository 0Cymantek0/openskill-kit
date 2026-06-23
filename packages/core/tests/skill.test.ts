import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSkillPackage, slugifySkillName, validateSkillPackage } from "../src/index.js";

describe("skill parser", () => {
  it("validates kebab-case names and loads frontmatter", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osk-skill-"));
    const skillDir = path.join(root, "repo-debug");
    await mkdir(skillDir);
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: repo-debug\ndescription: Debug repo failures\n---\n\n## When to use\nUse it.\n\n## When not to use\nAvoid unrelated tasks.\n", "utf8");
    const pkg = await loadSkillPackage(skillDir);
    expect(pkg.manifest.name).toBe("repo-debug");
    expect(await validateSkillPackage(skillDir)).toEqual([]);
  });

  it("slugifies topics into valid names", () => {
    expect(slugifySkillName("Handle Supabase RLS debugging!")).toBe("handle-supabase-rls-debugging");
  });
});
