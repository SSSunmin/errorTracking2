import type { FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { badRequest, unauthorized } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { markProjectKeyUsed, validateProjectKey } from "../ingest/service.js";

const paramsSchema = z.object({
  projectId: z.string().min(1)
});

// The replay body is RAW gzip bytes, so query params carry the link id and the
// best-effort metadata the SDK knows (event count, recorded duration).
const querySchema = z.object({
  key: z.string().min(1).optional(),
  eventId: z.string().min(1),
  count: z.coerce.number().int().nonnegative().optional(),
  durMs: z.coerce.number().int().nonnegative().optional()
});

const acceptedResponseSchema = z.object({
  id: z.string()
});

const invalidProjectKeyMessage = "Invalid project key";
const missingEventIdMessage = "Missing replay eventId";
// A gzipped 30s rolling buffer is far smaller than the raw DOM stream, but allow
// headroom for chatty pages. The per-IP rate limit bounds abuse of this size.
const replayBodyLimitBytes = 5 * 1_024 * 1_024;

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

export const replayRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  // Scoped to THIS plugin only: the raw-buffer parser must not disturb the JSON
  // ingest route, which lives in a sibling plugin with its own encapsulation.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, parserDone) => {
      parserDone(null, body);
    }
  );

  const rateLimit = app.rateLimit({
    max: 50,
    timeWindow: "10 seconds",
    keyGenerator: (request) => request.ip
  });

  app.options(
    "/:projectId/replay",
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
    "/:projectId/replay",
    {
      preHandler: rateLimit,
      bodyLimit: replayBodyLimitBytes,
      config: {
        cors: permissiveCors
      },
      schema: {
        params: paramsSchema,
        querystring: querySchema,
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

      const clientEventId = request.query.eventId;
      if (clientEventId.length === 0) {
        throw badRequest(missingEventIdMessage);
      }

      // The Fastify octet-stream parser yields a Buffer; reject anything else so
      // we never persist a malformed (e.g. JSON-parsed) body.
      const body = request.body;
      if (!Buffer.isBuffer(body)) {
        throw badRequest("Replay body must be raw bytes");
      }

      // Prisma's Bytes field wants Uint8Array<ArrayBuffer>; a Node Buffer can be
      // backed by a SharedArrayBuffer pool, so copy into a plain Uint8Array.
      const data = Uint8Array.from(body);

      // Upsert so SDK retries (keepalive re-sends) are idempotent rather than a
      // unique-constraint 500. This is best-effort from the SDK's perspective, so
      // a DB failure surfaces as a 5xx but never crashes the process.
      await prisma.eventReplay.upsert({
        where: { clientEventId },
        create: {
          clientEventId,
          projectId: request.params.projectId,
          data,
          sizeBytes: data.length,
          ...(request.query.count !== undefined
            ? { eventCount: request.query.count }
            : {}),
          ...(request.query.durMs !== undefined
            ? { durationMs: request.query.durMs }
            : {})
        },
        update: {
          data,
          sizeBytes: data.length,
          ...(request.query.count !== undefined
            ? { eventCount: request.query.count }
            : {}),
          ...(request.query.durMs !== undefined
            ? { durationMs: request.query.durMs }
            : {})
        }
      });

      return reply.status(202).send({ id: clientEventId });
    }
  );

  done();
};
