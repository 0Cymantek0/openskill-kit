import { z } from "zod";

export const skillNamePattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const SkillManifestSchema = z.object({
  name: z.string().min(1).max(64).regex(skillNamePattern),
  description: z.string().min(1).max(1024),
  license: z.string().optional(),
  compatibility: z.union([z.string(), z.array(z.string())]).optional(),
  metadata: z.record(z.string(), z.string()).optional()
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export interface SkillPackage {
  root: string;
  manifest: SkillManifest;
  body: string;
  files: string[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
  path?: string;
}

export function slugifySkillName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "generated-skill";
}
