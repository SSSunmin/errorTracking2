import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { afterAll, beforeEach } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../..");

dotenv.config({ path: path.join(repoRoot, ".env"), override: false });
process.env.NODE_ENV = "test";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is required for server tests");
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const { prisma } = await import("../lib/prisma.js");

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Notification",
      "AlertRule",
      "EventReplay",
      "EventSnapshot",
      "Event",
      "Issue",
      "ProjectKey",
      "Project",
      "RefreshToken",
      "User"
    RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});
