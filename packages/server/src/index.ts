import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

const app = buildApp();

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, "shutting down");

  try {
    await app.close();
    await prisma.$disconnect();
    process.exitCode = 0;
  } catch (error) {
    app.log.error({ error }, "shutdown failed");
    process.exitCode = 1;
  }
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await app.listen({ host: "0.0.0.0", port: env.API_PORT });
} catch (error) {
  app.log.error({ error }, "server failed to start");
  await prisma.$disconnect();
  process.exitCode = 1;
}
