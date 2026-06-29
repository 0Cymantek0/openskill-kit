import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const ModelRouteNames = ["router", "learner", "reviewer", "researcher", "evolver", "verifier", "evaluator", "docs"] as const;
export type ModelRouteName = typeof ModelRouteNames[number];

export const HarnessNames = ["opencode", "codex", "claude-code", "cursor", "generic-mcp"] as const;
export type HarnessName = typeof HarnessNames[number];

export const OpenCodePermissionProfileNames = ["read-only", "learner-safe", "review-gate", "research-ask-web", "evolution-safe", "sandboxed-verifier", "eval-safe", "docs-safe"] as const;
export type OpenCodePermissionProfileName = typeof OpenCodePermissionProfileNames[number];
export type OpenCodePermissionValue = "allow" | "ask" | "deny";
export type OpenCodePermissionRule = OpenCodePermissionValue | Record<string, OpenCodePermissionValue>;
export type OpenCodePermissionMap = Record<string, OpenCodePermissionRule>;

const askOskOnlyBash: Record<string, OpenCodePermissionValue> = {
  "openskill-kit *": "ask",
  "npx openskill-kit *": "ask",
  "node *openskill-kit*": "ask",
  "git status*": "allow",
  "git log*": "allow",
  "git diff*": "deny",
  "*": "deny"
};

const verifierBash: Record<string, OpenCodePermissionValue> = {
  "openskill-kit *": "ask",
  "npx openskill-kit *": "ask",
  "node *openskill-kit*": "ask",
  "npm test*": "ask",
  "npm run test*": "ask",
  "npm run release-check": "ask",
  "pnpm test*": "ask",
  "pnpm run test*": "ask",
  "*": "deny"
};

const readOnlyBase: OpenCodePermissionMap = {
  read: "allow",
  list: "allow",
  grep: "allow",
  glob: "allow",
  edit: "deny",
  bash: "deny",
  question: "ask",
  external_directory: "deny",
  webfetch: "deny",
  websearch: "deny",
  task: "deny",
  skill: "allow"
};

export const OpenCodePermissionProfiles: Record<OpenCodePermissionProfileName, OpenCodePermissionMap> = {
  "read-only": {
    ...readOnlyBase,
    bash: {
      "openskill-kit status*": "allow",
      "openskill-kit osk status*": "allow",
      "openskill-kit osk task context*": "allow",
      "git status*": "allow",
      "git log*": "allow",
      "*": "deny"
    }
  },
  "learner-safe": {
    ...readOnlyBase,
    bash: askOskOnlyBash,
    question: "allow",
    external_directory: "ask"
  },
  "review-gate": {
    ...readOnlyBase,
    bash: askOskOnlyBash,
    question: "allow"
  },
  "research-ask-web": {
    ...readOnlyBase,
    bash: askOskOnlyBash,
    question: "ask",
    webfetch: "ask",
    websearch: "deny"
  },
  "evolution-safe": {
    ...readOnlyBase,
    bash: askOskOnlyBash,
    task: "ask"
  },
  "sandboxed-verifier": {
    ...readOnlyBase,
    bash: verifierBash
  },
  "eval-safe": {
    ...readOnlyBase,
    bash: verifierBash
  },
  "docs-safe": {
    ...readOnlyBase,
    edit: {
      "docs/**": "ask",
      "*.md": "ask",
      ".openskill-kit/compiled/plugin/README.md": "ask",
      "*": "deny"
    },
    bash: askOskOnlyBash
  }
};

export const ModelRouteSchema = z.object({
  model: z.string().min(1).optional(),
  fallbackModels: z.array(z.string().min(1)).default([]),
  reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxSteps: z.number().int().min(1).max(200).optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  permissionsProfile: z.enum(OpenCodePermissionProfileNames).optional(),
  notes: z.string().optional()
}).strict();

const RoutesSchema = z.object({
  router: ModelRouteSchema.default({ fallbackModels: [] }),
  learner: ModelRouteSchema.default({ fallbackModels: [] }),
  reviewer: ModelRouteSchema.default({ fallbackModels: [] }),
  researcher: ModelRouteSchema.default({ fallbackModels: [] }),
  evolver: ModelRouteSchema.default({ fallbackModels: [] }),
  verifier: ModelRouteSchema.default({ fallbackModels: [] }),
  evaluator: ModelRouteSchema.default({ fallbackModels: [] }),
  docs: ModelRouteSchema.default({ fallbackModels: [] })
}).strict();

const HarnessOverrideRoutesSchema = z.object({
  router: ModelRouteSchema.optional(),
  learner: ModelRouteSchema.optional(),
  reviewer: ModelRouteSchema.optional(),
  researcher: ModelRouteSchema.optional(),
  evolver: ModelRouteSchema.optional(),
  verifier: ModelRouteSchema.optional(),
  evaluator: ModelRouteSchema.optional(),
  docs: ModelRouteSchema.optional()
}).strict();

const HarnessOverridesSchema = z.record(z.string(), HarnessOverrideRoutesSchema).superRefine((value, ctx) => {
  const allowed = new Set<string>(HarnessNames);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `Unknown harness override "${key}". Expected one of: ${HarnessNames.join(", ")}`
      });
    }
  }
});

export const OpenSkillKitModelRoutingSchema = z.object({
  schemaVersion: z.literal("openskill-kit.model-routing.v1"),
  defaultHarness: z.enum(HarnessNames).default("opencode"),
  defaultModel: z.string().min(1).optional(),
  routes: RoutesSchema.default({
    router: { fallbackModels: [] },
    learner: { fallbackModels: [] },
    reviewer: { fallbackModels: [] },
    researcher: { fallbackModels: [] },
    evolver: { fallbackModels: [] },
    verifier: { fallbackModels: [] },
    evaluator: { fallbackModels: [] },
    docs: { fallbackModels: [] }
  }),
  harnessOverrides: HarnessOverridesSchema.default({}),
  safety: z.object({
    requireUserApprovalForModelNotInHost: z.boolean().default(true),
    allowNetworkModelsForPrivateSources: z.boolean().default(false),
    redactModelIdsInPublicArtifacts: z.boolean().default(false)
  }).default({
    requireUserApprovalForModelNotInHost: true,
    allowNetworkModelsForPrivateSources: false,
    redactModelIdsInPublicArtifacts: false
  }),
  updatedAt: z.string().datetime().optional()
}).strict();

export type ModelRoute = z.infer<typeof ModelRouteSchema>;
export type OpenSkillKitModelRouting = z.infer<typeof OpenSkillKitModelRoutingSchema>;

export interface ResolvedModelRoute extends ModelRoute {
  route: ModelRouteName;
  harness: HarnessName;
  model: string;
}

export interface ResolvedModelRouting {
  schemaVersion: "openskill-kit.model-routing.resolved.v1";
  sourcePath: string;
  harness: HarnessName;
  defaultModel: string;
  safety: OpenSkillKitModelRouting["safety"];
  routes: Record<ModelRouteName, ResolvedModelRoute>;
}

export function createDefaultModelRouting(input: { updatedAt?: string } = {}): OpenSkillKitModelRouting {
  return OpenSkillKitModelRoutingSchema.parse({
    schemaVersion: "openskill-kit.model-routing.v1",
    defaultHarness: "opencode",
    defaultModel: "default",
    routes: {
      router: { reasoningEffort: "low", maxSteps: 8, permissionsProfile: "read-only" },
      learner: { reasoningEffort: "medium", maxSteps: 24, permissionsProfile: "learner-safe" },
      reviewer: { reasoningEffort: "medium", maxSteps: 16, permissionsProfile: "review-gate" },
      researcher: { reasoningEffort: "high", maxSteps: 32, permissionsProfile: "research-ask-web" },
      evolver: { reasoningEffort: "high", maxSteps: 40, permissionsProfile: "evolution-safe" },
      verifier: { reasoningEffort: "high", temperature: 0, maxSteps: 24, permissionsProfile: "sandboxed-verifier" },
      evaluator: { reasoningEffort: "medium", temperature: 0, maxSteps: 24, permissionsProfile: "eval-safe" },
      docs: { reasoningEffort: "low", maxSteps: 12, permissionsProfile: "docs-safe" }
    },
    safety: {},
    updatedAt: input.updatedAt
  });
}

export function modelRoutingPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".openskill-kit", "model-routing.json");
}

export async function ensureModelRouting(projectRoot: string, now: Date = new Date()): Promise<{ path: string; routing: OpenSkillKitModelRouting; created: boolean }> {
  const file = modelRoutingPath(projectRoot);
  const existing = await readModelRouting(projectRoot).catch((error) => {
    throw error instanceof Error ? error : new Error(String(error));
  });
  if (existing) return { path: file, routing: existing, created: false };
  const routing = createDefaultModelRouting({ updatedAt: now.toISOString() });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(routing, null, 2)}\n`, "utf8");
  return { path: file, routing, created: true };
}

export async function readModelRouting(projectRoot: string): Promise<OpenSkillKitModelRouting | undefined> {
  const file = modelRoutingPath(projectRoot);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw new Error(`Invalid OpenSkillKit model routing JSON at ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = OpenSkillKitModelRoutingSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid OpenSkillKit model routing at ${file}: ${result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`).join("; ")}`);
  }
  return result.data;
}

export async function readOrCreateModelRouting(projectRoot: string, now: Date = new Date()): Promise<{ path: string; routing: OpenSkillKitModelRouting; created: boolean }> {
  return ensureModelRouting(projectRoot, now);
}

export function resolveModelRouting(input: {
  routing: OpenSkillKitModelRouting;
  sourcePath: string;
  harness?: HarnessName;
}): ResolvedModelRouting {
  const harness = input.harness ?? input.routing.defaultHarness;
  const defaultModel = input.routing.defaultModel ?? "default";
  const overrides = input.routing.harnessOverrides[harness] ?? {};
  const routes = Object.fromEntries(ModelRouteNames.map((route) => {
    const base = input.routing.routes[route] ?? {};
    const override: Partial<ModelRoute> = overrides[route] ?? {};
    const merged = ModelRouteSchema.parse({
      ...base,
      ...override,
      fallbackModels: override.fallbackModels ?? base.fallbackModels ?? []
    });
    return [route, {
      ...merged,
      route,
      harness,
      model: merged.model ?? defaultModel
    }];
  })) as Record<ModelRouteName, ResolvedModelRoute>;
  return {
    schemaVersion: "openskill-kit.model-routing.resolved.v1",
    sourcePath: input.sourcePath,
    harness,
    defaultModel,
    safety: input.routing.safety,
    routes
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}
