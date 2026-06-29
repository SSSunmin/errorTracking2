import type { FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { unauthorized } from "../../lib/errors.js";
import { alertRuleRoutes } from "../alert-rules/routes.js";
import { issueRoutes } from "../issues/routes.js";
import { sourceMapRoutes } from "../sourcemaps/routes.js";
import {
  addMember,
  listMembers,
  removeMember,
  updateMemberRole
} from "./members.service.js";
import {
  createProject,
  createProjectKey,
  deleteProject,
  getProject,
  getProjectEnvironmentStats,
  getProjectStats,
  listProjectKeys,
  listProjects,
  rotateProjectKey,
  updateProject,
  updateProjectKey
} from "./service.js";
import {
  addMemberSchema,
  createProjectKeySchema,
  createProjectResponseSchema,
  createProjectSchema,
  listMembersResponseSchema,
  listProjectKeysResponseSchema,
  listProjectsResponseSchema,
  memberParamsSchema,
  memberResponseSchema,
  projectKeyParamsSchema,
  projectKeyResponseSchema,
  projectEnvironmentStatsResponseSchema,
  projectParamsSchema,
  projectResponseSchema,
  projectStatsQuerySchema,
  projectStatsResponseSchema,
  updateMemberSchema,
  updateProjectKeySchema,
  updateProjectSchema
} from "./schemas.js";

const getUserId = (request: FastifyRequest): string => {
  if (!request.user) {
    throw unauthorized("Missing access token");
  }

  return request.user.id;
};

export const projectRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.addHook("preHandler", app.requireAuth);

  app.get(
    "/",
    {
      schema: {
        response: {
          200: listProjectsResponseSchema
        }
      }
    },
    async (request) => listProjects(getUserId(request))
  );

  app.post(
    "/",
    {
      schema: {
        body: createProjectSchema,
        response: {
          201: createProjectResponseSchema
        }
      }
    },
    async (request, reply) => {
      const response = await createProject(getUserId(request), request.body);
      return reply.status(201).send(response);
    }
  );

  app.get(
    "/:id",
    {
      schema: {
        params: projectParamsSchema,
        response: {
          200: projectResponseSchema
        }
      }
    },
    async (request) => getProject(getUserId(request), request.params.id)
  );

  app.patch(
    "/:id",
    {
      schema: {
        params: projectParamsSchema,
        body: updateProjectSchema,
        response: {
          200: projectResponseSchema
        }
      }
    },
    async (request) =>
      updateProject(getUserId(request), request.params.id, request.body)
  );

  app.delete(
    "/:id",
    {
      schema: {
        params: projectParamsSchema
      }
    },
    async (request, reply) => {
      await deleteProject(getUserId(request), request.params.id);
      return reply.status(204).send();
    }
  );

  app.get(
    "/:id/stats",
    {
      schema: {
        params: projectParamsSchema,
        querystring: projectStatsQuerySchema,
        response: {
          200: projectStatsResponseSchema
        }
      }
    },
    async (request) =>
      getProjectStats(getUserId(request), request.params.id, request.query)
  );

  app.get(
    "/:id/environments",
    {
      schema: {
        params: projectParamsSchema,
        querystring: projectStatsQuerySchema,
        response: {
          200: projectEnvironmentStatsResponseSchema
        }
      }
    },
    async (request) =>
      getProjectEnvironmentStats(
        getUserId(request),
        request.params.id,
        request.query
      )
  );

  app.get(
    "/:id/keys",
    {
      schema: {
        params: projectParamsSchema,
        response: {
          200: listProjectKeysResponseSchema
        }
      }
    },
    async (request) => listProjectKeys(getUserId(request), request.params.id)
  );

  app.post(
    "/:id/keys",
    {
      schema: {
        params: projectParamsSchema,
        body: createProjectKeySchema,
        response: {
          201: projectKeyResponseSchema
        }
      }
    },
    async (request, reply) => {
      const response = await createProjectKey(
        getUserId(request),
        request.params.id,
        request.body
      );

      return reply.status(201).send(response);
    }
  );

  app.post(
    "/:id/keys/:keyId/rotate",
    {
      schema: {
        params: projectKeyParamsSchema,
        response: {
          201: projectKeyResponseSchema
        }
      }
    },
    async (request, reply) => {
      const response = await rotateProjectKey(
        getUserId(request),
        request.params.id,
        request.params.keyId
      );

      return reply.status(201).send(response);
    }
  );

  app.patch(
    "/:id/keys/:keyId",
    {
      schema: {
        params: projectKeyParamsSchema,
        body: updateProjectKeySchema,
        response: {
          200: projectKeyResponseSchema
        }
      }
    },
    async (request) =>
      updateProjectKey(
        getUserId(request),
        request.params.id,
        request.params.keyId,
        request.body
      )
  );

  app.get(
    "/:id/members",
    {
      schema: {
        params: projectParamsSchema,
        response: {
          200: listMembersResponseSchema
        }
      }
    },
    async (request) => listMembers(getUserId(request), request.params.id)
  );

  app.post(
    "/:id/members",
    {
      schema: {
        params: projectParamsSchema,
        body: addMemberSchema,
        response: {
          201: memberResponseSchema
        }
      }
    },
    async (request, reply) => {
      const response = await addMember(
        getUserId(request),
        request.params.id,
        request.body
      );

      return reply.status(201).send(response);
    }
  );

  app.patch(
    "/:id/members/:userId",
    {
      schema: {
        params: memberParamsSchema,
        body: updateMemberSchema,
        response: {
          200: memberResponseSchema
        }
      }
    },
    async (request) =>
      updateMemberRole(
        getUserId(request),
        request.params.id,
        request.params.userId,
        request.body
      )
  );

  app.delete(
    "/:id/members/:userId",
    {
      schema: {
        params: memberParamsSchema
      }
    },
    async (request, reply) => {
      await removeMember(
        getUserId(request),
        request.params.id,
        request.params.userId
      );

      return reply.status(204).send();
    }
  );

  void app.register(issueRoutes);
  void app.register(alertRuleRoutes);
  void app.register(sourceMapRoutes);

  done();
};
