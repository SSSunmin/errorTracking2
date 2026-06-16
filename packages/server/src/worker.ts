import { Worker } from "bullmq";

import { createRedisConnection, ingestQueueName, type IngestEventJobData } from "./lib/queue.js";
import { prisma } from "./lib/prisma.js";
import { processEvent } from "./modules/events/process.js";

const worker = new Worker<IngestEventJobData>(
  ingestQueueName,
  async (job) => {
    // Future hardening: committed-then-redelivered jobs need durable idempotency
    // beyond BullMQ jobId dedupe to provide strict exactly-once processing.
    await processEvent(job.data.projectId, job.data.payload);
  },
  {
    connection: createRedisConnection(true),
    concurrency: 10,
    lockDuration: 60_000,
    lockRenewTime: 30_000
  }
);

worker.on("completed", (job) => {
  console.log(`Processed ingest job ${job.id ?? "<unknown>"}`);
});

worker.on("failed", (job, error) => {
  console.error(`Ingest job ${job?.id ?? "<unknown>"} failed`, error);
});

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  console.log(`Received ${signal}; shutting down worker`);

  try {
    await worker.close();
    await prisma.$disconnect();
    process.exitCode = 0;
  } catch (error) {
    console.error("Worker shutdown failed", error);
    process.exitCode = 1;
  }
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
