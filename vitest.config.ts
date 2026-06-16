import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "examples/*/src/**/*.test.ts"],
    globalSetup: ["packages/server/src/tests/globalSetup.ts"],
    setupFiles: ["packages/server/src/tests/setup.ts"],
    fileParallelism: false,
    globals: false
  }
});
