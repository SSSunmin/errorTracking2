import { PrismaClient } from "@prisma/client";

import { env } from "../config/env.js";

const globalForPrisma = globalThis as typeof globalThis & {
  miniSentryPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.miniSentryPrisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: env.DATABASE_URL
      }
    }
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.miniSentryPrisma = prisma;
}
