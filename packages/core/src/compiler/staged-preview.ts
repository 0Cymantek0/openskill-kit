import path from "node:path";
import { readProjectConfig } from "../events/store.js";
import { readPreferenceGraph } from "../preferences/graph.js";
import type { PreferenceNode } from "../preferences/schema.js";
import { writeFileAtomic } from "../storage/atomic.js";

export interface CompileStagedPreviewResult {
  schemaVersion: "openskill-kit.staged-preview.v1";
  previewPath: string;
  stagedPreferenceCount: number;
  bytes: number;
}

export async function compileStagedPreview(projectRoot: string): Promise<CompileStagedPreviewResult> {
  const root = path.resolve(projectRoot);
  const config = await readProjectConfig(root);
  const graph = await readPreferenceGraph(root);
  const staged = graph.nodes.filter((node) => node.status === "staged");
  const body = renderStagedPreview(config.projectName, staged);
  const previewPath = path.join(root, ".openskill-kit", "compiled", "previews", "staged-context-pack.md");
  await writeFileAtomic(previewPath, body);
  return {
    schemaVersion: "openskill-kit.staged-preview.v1",
    previewPath,
    stagedPreferenceCount: staged.length,
    bytes: Buffer.byteLength(body)
  };
}

function renderStagedPreview(projectName: string, nodes: PreferenceNode[]): string {
  const lines = [
    "# OpenSkillKit Staged Behavior Preview",
    "",
    `Project: ${projectName}`,
    "",
    "These preferences are staged for review only. They are not included in active compiled agent behavior until accepted or locked.",
    ""
  ];
  if (!nodes.length) lines.push("No staged preferences.", "");
  for (const node of nodes.sort((a, b) => a.category.localeCompare(b.category) || b.confidence - a.confidence || a.title.localeCompare(b.title))) {
    const scope = node.scope.paths.length ? ` Paths: ${node.scope.paths.slice(0, 5).join(", ")}.` : "";
    lines.push(`- [${node.category}] ${node.statement}.${scope} Confidence: ${node.confidence}.`);
  }
  lines.push("");
  return lines.join("\n");
}
