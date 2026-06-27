import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@openskill-kit/core": path.resolve("packages/core/src/index.ts")
    }
  },
  test: {
    include: [
      "packages/**/*.test.ts"
    ],
    testTimeout: 15000
  }
});
