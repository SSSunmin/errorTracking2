import { defineConfig } from "vitest/config";

// Two projects so UI/SDK unit tests don't drag in the server's Postgres setup.
// - "server": integration tests that hit the DB → globalSetup (create test DB +
//   migrate) and per-file truncate.
// - "ui": pure dashboard/sdk/example unit tests → no DB, runnable with no infra.
// fileParallelism is a root-only option (ignored inside a project), so it lives
// here: server files share one database and must run serially to avoid racing
// the per-file TRUNCATE.
export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      {
        test: {
          name: "server",
          include: ["packages/server/src/**/*.test.ts"],
          globalSetup: ["packages/server/src/tests/globalSetup.ts"],
          setupFiles: ["packages/server/src/tests/setup.ts"],
          globals: false
        }
      },
      {
        test: {
          name: "ui",
          include: [
            "packages/dashboard/src/**/*.test.{ts,tsx}",
            "packages/sdk/src/**/*.test.ts",
            "examples/*/src/**/*.test.{ts,tsx}"
          ],
          globals: false
        }
      }
    ]
  }
});
