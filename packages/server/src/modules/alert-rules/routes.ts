import type { FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { unauthorized } from "../../lib/errors.js";
import {
  createAlertRule,
  deleteAlertRule,
  getAlertRule,
  listAlertRules,
  updateAlertRule
} from "./service.js";
import {
  alertRuleParamsSchema,
  alertRuleResponseSchema,
  createAlertRuleSchema,
  listAlertRulesResponseSchema,
  updateAlertRuleSchema
} from "./schemas.js";

const getUserId = (request: FastifyRequest): string => {
  if (!request.user) {
    throw unauthorized("Missing access token");
  }

  return request.user.id;
};

export const alertRuleRoutes: FastifyPluginCallbackZod = (
  app,
  _options,
  done
) => {
  app.addHook("preHandler", app.requireAuth);

  app.get(
    "/:id/alert-rules",
    {
      schema: {
        params: alertRuleParamsSchema.pick({ id: true }),
        response: {
          200: listAlertRulesResponseSchema
        }
      }
    },
    async (request) =>
      listAlertRules(getUserId(request), request.params.id)
  );

  app.post(
    "/:id/alert-rules",
    {
      schema: {
        params: alertRuleParamsSchema.pick({ id: true }),
        body: createAlertRuleSchema,
        response: {
          201: alertRuleResponseSchema
        }
      }
    },
    async (request, reply) => {
      const response = await createAlertRule(
        getUserId(request),
        request.params.id,
        request.body
      );

      return reply.status(201).send(response);
    }
  );

  app.get(
    "/:id/alert-rules/:ruleId",
    {
      schema: {
        params: alertRuleParamsSchema,
        response: {
          200: alertRuleResponseSchema
        }
      }
    },
    async (request) =>
      getAlertRule(
        getUserId(request),
        request.params.id,
        request.params.ruleId
      )
  );

  app.patch(
    "/:id/alert-rules/:ruleId",
    {
      schema: {
        params: alertRuleParamsSchema,
        body: updateAlertRuleSchema,
        response: {
          200: alertRuleResponseSchema
        }
      }
    },
    async (request) =>
      updateAlertRule(
        getUserId(request),
        request.params.id,
        request.params.ruleId,
        request.body
      )
  );

  app.delete(
    "/:id/alert-rules/:ruleId",
    {
      schema: {
        params: alertRuleParamsSchema
      }
    },
    async (request, reply) => {
      await deleteAlertRule(
        getUserId(request),
        request.params.id,
        request.params.ruleId
      );

      return reply.status(204).send();
    }
  );

  done();
};
