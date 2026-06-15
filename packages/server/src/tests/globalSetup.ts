import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../..");
const serverRoot = path.resolve(currentDir, "../..");
const envPath = path.join(repoRoot, ".env");

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const getPrismaBin = (): string =>
  path.join(
    repoRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma"
  );

export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: envPath, override: false });
  process.env.NODE_ENV = "test";

  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for server tests");
  }

  process.env.DATABASE_URL = testDatabaseUrl;

  const testUrl = new URL(testDatabaseUrl);
  const databaseName = testUrl.pathname.replace(/^\//, "");
  if (!databaseName || databaseName === "mini_sentry") {
    throw new Error("TEST_DATABASE_URL must point at a dedicated test database");
  }

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";

  const client = new pg.Client({
    connectionString: adminUrl.toString()
  });

  await client.connect();

  try {
    const result = await client.query<{ exists: number }>(
      "SELECT 1 AS exists FROM pg_database WHERE datname = $1",
      [databaseName]
    );

    if (result.rowCount === 0) {
      await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    }
  } finally {
    await client.end();
  }

  execFileSync(
    getPrismaBin(),
    ["migrate", "deploy", "--schema", path.join(serverRoot, "prisma", "schema.prisma")],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test"
      },
      stdio: "inherit",
      // Node 20+ refuses to spawn .cmd/.bat via execFileSync without a shell (EINVAL on Windows)
      shell: process.platform === "win32"
    }
  );
}
