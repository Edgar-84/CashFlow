import { defineConfig } from "vite";

// vitest.config.ts fully supersedes this file for `vitest run` (Vitest does
// not merge the two when both exist) — a plugin added only here would never
// run under the test suite.
export default defineConfig({
  build: {
    outDir: "dist",
  },
});
