import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // No global DOM default (D603): every existing test file stays on this
    // "node" environment. A file whose behaviour is DOM glue opts in per-file
    // with a `// @vitest-environment jsdom` docblock instead of flipping the
    // suite-wide default.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
