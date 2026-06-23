import { Worker } from "bullmq";

import { env } from "./config/env.js";
import {
  closeRetentionQueue,
  createRedisConnection,
  ingestQueueName,
  retentionQueueName,
  scheduleRetentionJob,
  type IngestEventJobData
} from "./lib/queue.js";
import { prisma } from "./lib/prisma.js";
import { processEvent } from "./modules/events/process.js";
import { pruneRetention } from "./modules/retention/prune.js";
import { processAlertsForEvent } from "./notifications/service.js";

const worker = new Worker<IngestEventJobData>(
  ingestQueueName,
  async (job) => {
    // Future hardening: committed-then-redelivered jobs need durable idempotency
    // beyond BullMQ jobId dedupe to provide strict exactly-once processing.
    const result = await processEvent(job.data.projectId, job.data.payload, {
      ...(job.data.userAgent !== undefined ? { userAgent: job.data.userAgent } : {})
    });
    await processAlertsForEvent(job.data.projectId, result);
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

// ── Retention / pruning worker (P0) ───────────────────────────────────────────
// concurrency 1: a single pruning pass at a time avoids overlapping bulk deletes.
const retentionWorker = new Worker(
  retentionQueueName,
  async () => pruneRetention(),
  {
    connection: createRedisConnection(true),
    concurrency: 1
  }
);

retentionWorker.on("completed", (job, result) => {
  console.log(`Retention prune ${job.id ?? "<unknown>"} complete`, result);
});

retentionWorker.on("failed", (job, error) => {
  console.error(`Retention prune ${job?.id ?? "<unknown>"} failed`, error);
});

// Register the repeatable schedule on boot (idempotent; no-op when disabled).
void scheduleRetentionJob().then(
  () => {
    if (env.RETENTION_ENABLED) {
      console.log(`Retention scheduled: cron "${env.RETENTION_CRON}"`);
    }
  },
  (error: unknown) => {
    console.error("Failed to schedule retention job", error);
  }
);

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  console.log(`Received ${signal}; shutting down worker`);

  try {
    await worker.close();
    await retentionWorker.close();
    await closeRetentionQueue();
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
