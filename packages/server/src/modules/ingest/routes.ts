import type { FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { unauthorized } from "../../lib/errors.js";
import { enqueueIngestEvent, type IngestEventJobData } from "../../lib/queue.js";
import { eventPayloadSchema } from "../events/schemas.js";
import { markProjectKeyUsed, validateProjectKey } from "./service.js";

type EnqueueIngestEvent = (data: IngestEventJobData) => Promise<string>;

export interface IngestRoutesOptions {
  enqueue?: EnqueueIngestEvent;
}

const paramsSchema = z.object({
  projectId: z.string().min(1)
});

const querySchema = z.object({
  key: z.string().min(1).optional()
});

const acceptedResponseSchema = z.object({
  id: z.string()
});

const invalidProjectKeyMessage = "Invalid project key";
const ingestBodyLimitBytes = 256 * 1_024;

const permissiveCors = {
  origin: "*",
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["content-type", "x-mini-sentry-key"],
  credentials: false
};

const getPublicKey = (request: FastifyRequest): string => {
  const headerValue = request.headers["x-mini-sentry-key"];
  if (typeof headerValue === "string" && headerValue.length > 0) {
    return headerValue;
  }

  if (Array.isArray(headerValue) && headerValue[0]) {
    return headerValue[0];
  }

  const parsedQuery = querySchema.safeParse(request.query);
  if (parsedQuery.success && parsedQuery.data.key) {
    return parsedQuery.data.key;
  }

  throw unauthorized(invalidProjectKeyMessage);
};

export const ingestRoutes: FastifyPluginCallbackZod<IngestRoutesOptions> = (
  app,
  options,
  done
) => {
  const enqueue = options.enqueue ?? enqueueIngestEvent;
  const rateLimit = app.rateLimit({
    max: 50,
    timeWindow: "10 seconds",
    keyGenerator: (request) => request.ip
  });

  app.options(
    "/:projectId/store",
    {
      preHandler: rateLimit,
      config: {
        cors: permissiveCors
      },
      schema: {
        params: paramsSchema
      }
    },
    (_request, reply) => reply.status(204).send()
  );

  app.post(
    "/:projectId/store",
    {
      preHandler: rateLimit,
      bodyLimit: ingestBodyLimitBytes,
      config: {
        cors: permissiveCors
      },
      schema: {
        params: paramsSchema,
        querystring: querySchema,
        body: eventPayloadSchema,
        response: {
          202: acceptedResponseSchema
        }
      }
    },
    async (request, reply) => {
      const publicKey = getPublicKey(request);
      await validateProjectKey(request.params.projectId, publicKey);

      void markProjectKeyUsed(publicKey).catch((error: unknown) => {
        request.log.warn({ err: error }, "failed to update project key usage");
      });

      const id = await enqueue({
        projectId: request.params.projectId,
        payload: request.body
      });

      return reply.status(202).send({ id });
    }
  );

  done();
};
