import { describe, expect, it } from "vitest";
import { toolSchemas } from "../src/index.js";

describe("OpenCode tool schemas", () => {
  it("validates draft args", () => {
    expect(toolSchemas.draft.parse({ topic: "debug tests" }).topic).toBe("debug tests");
  });

  it("validates forge args", () => {
    expect(toolSchemas.forge.parse({ topic: "evolve skill" }).topic).toBe("evolve skill");
  });
});
