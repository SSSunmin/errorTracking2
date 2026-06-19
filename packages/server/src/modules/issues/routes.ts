import type { FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { unauthorized } from "../../lib/errors.js";
import {
  getEventReplay,
  getEventSnapshot,
  getIssue,
  getIssueStats,
  listIssueEvents,
  listIssues,
  updateIssueStatus
} from "./service.js";
import {
  eventSnapshotParamsSchema,
  eventSnapshotResponseSchema,
  issueDetailResponseSchema,
  issueEventsResponseSchema,
  issueParamsSchema,
  issueStatsQuerySchema,
  issueStatsResponseSchema,
  listEventsQuerySchema,
  listIssuesQuerySchema,
  listIssuesResponseSchema,
  updateIssueResponseSchema,
  updateIssueSchema
} from "./schemas.js";

const getUserId = (request: FastifyRequest): string => {
  if (!request.user) {
    throw unauthorized("Missing access token");
  }

  return request.user.id;
};

export const issueRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.addHook("preHandler", app.requireAuth);

  app.get(
    "/:id/issues",
    {
      schema: {
        params: issueParamsSchema.pick({ id: true }),
        querystring: listIssuesQuerySchema,
        response: {
          200: listIssuesResponseSchema
        }
      }
    },
    async (request) =>
      listIssues(getUserId(request), request.params.id, request.query)
  );

  app.get(
    "/:id/issues/:issueId",
    {
      schema: {
        params: issueParamsSchema,
        response: {
          200: issueDetailResponseSchema
        }
      }
    },
    async (request) =>
      getIssue(getUserId(request), request.params.id, request.params.issueId)
  );

  app.get(
    "/:id/issues/:issueId/events",
    {
      schema: {
        params: issueParamsSchema,
        querystring: listEventsQuerySchema,
        response: {
          200: issueEventsResponseSchema
        }
      }
    },
    async (request) =>
      listIssueEvents(
        getUserId(request),
        request.params.id,
        request.params.issueId,
        request.query
      )
  );

  app.get(
    "/:id/issues/:issueId/events/:eventId/snapshot",
    {
      schema: {
        params: eventSnapshotParamsSchema,
        response: {
          200: eventSnapshotResponseSchema
        }
      }
    },
    async (request) =>
      getEventSnapshot(
        getUserId(request),
        request.params.id,
        request.params.issueId,
        request.params.eventId
      )
  );

  app.get(
    "/:id/issues/:issueId/events/:eventId/replay",
    {
      // The body is raw gzip bytes (not JSON), so this route opts out of zod
      // response serialization and streams the stored Buffer directly with
      // content-encoding: gzip — the browser transparently decodes it to JSON.
      schema: {
        params: eventSnapshotParamsSchema
      }
    },
    async (request, reply) => {
      const data = await getEventReplay(
        getUserId(request),
        request.params.id,
        request.params.issueId,
        request.params.eventId
      );

      if (data === null) {
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Replay not found"
          }
        });
      }

      return reply
        .header("content-type", "application/json")
        .header("content-encoding", "gzip")
        .send(data);
    }
  );

  app.get(
    "/:id/issues/:issueId/stats",
    {
      schema: {
        params: issueParamsSchema,
        querystring: issueStatsQuerySchema,
        response: {
          200: issueStatsResponseSchema
        }
      }
    },
    async (request) =>
      getIssueStats(
        getUserId(request),
        request.params.id,
        request.params.issueId,
        request.query
      )
  );

  app.patch(
    "/:id/issues/:issueId",
    {
      schema: {
        params: issueParamsSchema,
        body: updateIssueSchema,
        response: {
          200: updateIssueResponseSchema
        }
      }
    },
    async (request) =>
      updateIssueStatus(
        getUserId(request),
        request.params.id,
        request.params.issueId,
        request.body
      )
  );

  done();
};
