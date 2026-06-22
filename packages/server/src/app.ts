import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  serializerCompiler,
  validatorCompiler
} from "fastify-type-provider-zod";
import { ZodError } from "zod/v4";

import { env } from "./config/env.js";
import { HttpError } from "./lib/errors.js";
import { closeIngestQueue } from "./lib/queue.js";
import { authRoutes } from "./modules/auth/routes.js";
import { ingestRoutes, type IngestRoutesOptions } from "./modules/ingest/routes.js";
import { projectRoutes } from "./modules/projects/routes.js";
import { replayRoutes } from "./modules/replay/routes.js";
import { authPlugin } from "./plugins/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdkDistDir = resolve(__dirname, "../../sdk/dist");
const servedSdkFiles = new Set([
  "mini-sentry.global.js",
  "mini-sentry.min.js"
]);

const logger =
  env.NODE_ENV === "development"
    ? {
        level: "info",
        transport: {
          target: "pino-pretty",
          options: {
            ignore: "pid,hostname",
            translateTime: "SYS:standard"
          }
        }
      }
    : {
        level: env.NODE_ENV === "test" ? "silent" : "info"
      };

const hasStatusCode = (value: unknown): value is { statusCode: number } =>
  typeof value === "object" &&
  value !== null &&
  "statusCode" in value &&
  typeof value.statusCode === "number";

export interface BuildAppOptions {
  ingest?: IngestRoutesOptions;
}

export const buildApp = (options: BuildAppOptions = {}): FastifyInstance => {
  const app = fastify({
    logger
  });

  app.addHook("onClose", async () => {
    await closeIngestQueue();
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error.validation
        }
      });
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, "response serialization failed");
      return reply.status(500).send({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Internal server error"
        }
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: error.issues
        }
      });
    }

    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {})
        }
      });
    }

    const statusCode =
      hasStatusCode(error) && error.statusCode >= 400 ? error.statusCode : 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, "request failed");
    }

    return reply.status(statusCode).send({
      error: {
        code: statusCode === 429 ? "RATE_LIMITED" : "INTERNAL_SERVER_ERROR",
        message: statusCode === 429 ? "Too many requests" : "Internal server error"
      }
    });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Route not found"
      }
    })
  );

  app.get("/health", () => ({
    status: "ok"
  }));

  void app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true
  });
  void app.register(cookie);
  void app.register(rateLimit, {
    global: false
  });
  if (existsSync(sdkDistDir)) {
    void app.register(staticPlugin, {
      root: sdkDistDir,
      prefix: "/sdk/",
      cacheControl: false,
      decorateReply: false,
      index: false,
      wildcard: false,
      setHeaders: (response) => {
        response.setHeader("cache-control", "no-cache");
        response.setHeader("content-type", "application/javascript; charset=utf-8");
      },
      allowedPath: (pathName) => servedSdkFiles.has(basename(pathName))
    });
  }
  void app.register(authPlugin);
  void app.register(ingestRoutes, { prefix: "/api", ...options.ingest });
  void app.register(replayRoutes, { prefix: "/api" });
  void app.register(authRoutes, { prefix: "/api/auth" });
  void app.register(projectRoutes, { prefix: "/api/projects" });

  return app;
};

export { env };
