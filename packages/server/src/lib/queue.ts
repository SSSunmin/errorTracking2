import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

import { env } from "../config/env.js";
import type { EventPayload } from "../modules/events/schemas.js";

export const ingestQueueName = "ingest-events";

export interface IngestEventJobData {
  projectId: string;
  payload: EventPayload;
  /** Raw User-Agent of the ingest request, captured server-side for enrichment. */
  userAgent?: string;
}

export const createRedisConnection = (forWorker = false): ConnectionOptions =>
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: forWorker ? null : 3
  }) as unknown as ConnectionOptions;

let queueInstance: Queue<IngestEventJobData> | undefined;

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1_000
  },
  removeOnComplete: {
    count: 1_000
  },
  removeOnFail: {
    count: 5_000
  }
};

export const buildIngestJobOptions = (
  payload: EventPayload
): JobsOptions | undefined =>
  payload.eventId !== undefined ? { jobId: payload.eventId } : undefined;

export const getIngestQueue = (): Queue<IngestEventJobData> => {
  queueInstance ??= new Queue<IngestEventJobData>(ingestQueueName, {
    connection: createRedisConnection(),
    defaultJobOptions
  });

  return queueInstance;
};

export const enqueueIngestEvent = async (
  data: IngestEventJobData
): Promise<string> => {
  const job = await getIngestQueue().add("event", data, buildIngestJobOptions(data.payload));
  return job.id ?? data.payload.eventId ?? "";
};

export const closeIngestQueue = async (): Promise<void> => {
  if (!queueInstance) {
    return;
  }

  await queueInstance.close();
  await queueInstance.disconnect();
  queueInstance = undefined;
};

// ── Retention / pruning queue (P0) ────────────────────────────────────────────

export const retentionQueueName = "retention";

/** Job name + stable scheduler id (idempotent upsert across worker restarts). */
export const retentionJobName = "prune";
export const retentionSchedulerId = "retention-prune";

let retentionQueueInstance: Queue | undefined;

export const getRetentionQueue = (): Queue => {
  retentionQueueInstance ??= new Queue(retentionQueueName, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      // Mirror the ingest queue's resilience: a transient PG/Redis blip mid-prune
      // should retry within the same tick instead of waiting a full cron period.
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 }
    }
  });

  return retentionQueueInstance;
};

/**
 * Register (or update) the repeatable retention job using a stable scheduler id,
 * so restarting the worker does not accumulate duplicate repeatable jobs.
 * No-op when retention is disabled.
 */
export const scheduleRetentionJob = async (): Promise<void> => {
  if (!env.RETENTION_ENABLED) {
    return;
  }

  await getRetentionQueue().upsertJobScheduler(
    retentionSchedulerId,
    { pattern: env.RETENTION_CRON },
    { name: retentionJobName }
  );
};

export const closeRetentionQueue = async (): Promise<void> => {
  if (!retentionQueueInstance) {
    return;
  }

  await retentionQueueInstance.close();
  await retentionQueueInstance.disconnect();
  retentionQueueInstance = undefined;
};
