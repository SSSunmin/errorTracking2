import type { FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { badRequest, unauthorized } from "../../lib/errors.js";
import { listSourceMaps, uploadSourceMap } from "./service.js";
import {
  listSourceMapsResponseSchema,
  sourceMapParamsSchema,
  sourceMapUploadQuerySchema,
  sourceMapUploadResponseSchema
} from "./schemas.js";

const getUserId = (request: FastifyRequest): string => {
  if (!request.user) {
    throw unauthorized("Missing access token");
  }

  return request.user.id;
};

// Source maps embed original source and must never be writable with the public
// DSN key (which ships to browsers), so uploads are JWT-authenticated like the
// rest of the project-management API. Maps can be large; allow generous bytes.
const sourceMapBodyLimitBytes = 20 * 1_024 * 1_024;

export const sourceMapRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.addHook("preHandler", app.requireAuth);

  // Scoped to this plugin: raw map bytes arrive as octet-stream, but sibling
  // JSON routes (project/key CRUD) keep their default parser.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, parserDone) => {
      parserDone(null, body);
    }
  );

  app.post(
    "/:id/releases/:release/sourcemaps",
    {
      bodyLimit: sourceMapBodyLimitBytes,
      schema: {
        params: sourceMapParamsSchema,
        querystring: sourceMapUploadQuerySchema,
        response: {
          201: sourceMapUploadResponseSchema
        }
      }
    },
    async (request, reply) => {
      const body = request.body;
      if (!Buffer.isBuffer(body)) {
        throw badRequest("Source map body must be raw bytes");
      }

      const summary = await uploadSourceMap(
        getUserId(request),
        request.params.id,
        request.params.release,
        request.query.filename,
        body
      );

      return reply.status(201).send(summary);
    }
  );

  app.get(
    "/:id/releases/:release/sourcemaps",
    {
      schema: {
        params: sourceMapParamsSchema,
        response: {
          200: listSourceMapsResponseSchema
        }
      }
    },
    async (request) =>
      listSourceMaps(getUserId(request), request.params.id, request.params.release)
  );

  done();
};
