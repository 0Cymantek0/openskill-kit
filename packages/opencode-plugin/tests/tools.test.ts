import { describe, expect, it } from "vitest";
import { toolSchemas } from "../src/index.js";

describe("OpenCode tool schemas", () => {
  it("validates draft args", () => {
    expect(toolSchemas.draft.parse({ topic: "debug tests" }).topic).toBe("debug tests");
  });
});
