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
