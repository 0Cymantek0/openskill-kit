import { createOpencodeClient } from "@opencode-ai/sdk";
import type { AgentConfig } from "@opencode-ai/sdk/v2";
import type { Plugin } from "@opencode-ai/plugin";
import { describe, expect, it } from "vitest";
import { OpenCodePermissionProfiles } from "../src/index.js";

describe("OpenCode SDK contract", () => {
  it("keeps generated agent permissions compatible with the OpenCode SDK v2 type surface", () => {
    const learnerAgent = {
      description: "Plan explicit learning sources and run review-gated learning.",
      mode: "subagent",
      model: "default",
      steps: 24,
      permission: OpenCodePermissionProfiles["learner-safe"]
    } satisfies AgentConfig;

    const verifierAgent = {
      description: "Verify compiled behavior, harness readiness, and proof boundaries.",
      mode: "subagent",
      model: "default",
      steps: 32,
      permission: OpenCodePermissionProfiles["sandboxed-verifier"]
    } satisfies AgentConfig;
    const allProfiles = Object.entries(OpenCodePermissionProfiles).map(([name, permission]) => ({
      description: `OpenSkillKit ${name} route`,
      mode: "subagent",
      model: "default",
      permission
    }) satisfies AgentConfig);

    expect(learnerAgent.permission).toMatchObject({
      read: "allow",
      grep: "allow",
      edit: "deny",
      question: "allow"
    });
    expect(verifierAgent.permission).toMatchObject({
      bash: expect.objectContaining({
        "*": "deny",
        "npm test*": "ask"
      }),
      websearch: "deny"
    });
    expect(allProfiles).toHaveLength(8);
  });

  it("loads the real OpenCode SDK client and plugin type contract", async () => {
    const client = createOpencodeClient({
      baseUrl: "http://127.0.0.1:9",
      directory: process.cwd()
    });
    const plugin: Plugin = async () => ({
      event: async () => undefined,
      "tool.execute.after": async () => undefined
    });

    expect(typeof client.config.get).toBe("function");
    expect(typeof client.mcp.status).toBe("function");
    await expect(plugin({} as never)).resolves.toHaveProperty("event");
  });
});
