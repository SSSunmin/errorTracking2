import type { FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { unauthorized } from "../../lib/errors.js";
import { issueRoutes } from "../issues/routes.js";
import {
  createProject,
  createProjectKey,
  deleteProject,
  getProject,
  listProjectKeys,
  listProjects,
  rotateProjectKey,
  updateProject,
  updateProjectKey
} from "./service.js";
import {
  createProjectKeySchema,
  createProjectResponseSchema,
  createProjectSchema,
  listProjectKeysResponseSchema,
  listProjectsResponseSchema,
  projectKeyParamsSchema,
  projectKeyResponseSchema,
  projectParamsSchema,
  projectResponseSchema,
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

  void app.register(issueRoutes);

  done();
};
