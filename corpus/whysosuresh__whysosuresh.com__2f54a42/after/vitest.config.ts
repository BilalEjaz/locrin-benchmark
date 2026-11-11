// The test run: the site checks and the Worker's tests in workerd. A Worker test sends real requests through
// Miniflare, some of them 4 MB and some 60 in a row, so each test is given longer than vitest's default.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
