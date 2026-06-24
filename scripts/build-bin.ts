import { build } from "esbuild";
import { rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });

await Promise.all([
  build({
    entryPoints: ["packages/cli/src/index.ts"],
    outfile: "dist/index.cjs",
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: false
  }),
  build({
    entryPoints: ["packages/mcp-server/src/index.ts"],
    outfile: "dist/openskill-kit-mcp.cjs",
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: false
  })
]);
