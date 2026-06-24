import type { FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { isProduction } from "../../config/env.js";
import { unauthorized } from "../../lib/errors.js";
import { refreshTokenTtlMs } from "../../lib/tokens.js";
import {
  changePassword,
  getCurrentUser,
  loginUser,
  registerUser,
  revokeRefreshToken,
  rotateRefreshToken,
  updateProfile
} from "./service.js";
import {
  changePasswordSchema,
  loginSchema,
  okResponseSchema,
  registerSchema,
  tokenResponseSchema,
  updateProfileSchema,
  userResponseSchema
} from "./schemas.js";

export const refreshCookieName = "mini_sentry_refresh";

const refreshCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: isProduction,
  path: "/api/auth",
  maxAge: Math.floor(refreshTokenTtlMs / 1000)
};

const clearRefreshCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: isProduction,
  path: "/api/auth"
};

const getUserId = (request: FastifyRequest): string => {
  if (!request.user) {
    throw unauthorized("Missing access token");
  }

  return request.user.id;
};

export const authRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const rateLimit = app.rateLimit({
    max: 10,
    timeWindow: "1 minute"
  });

  app.post(
    "/register",
    {
      preHandler: rateLimit,
      schema: {
        body: registerSchema,
        response: {
          201: tokenResponseSchema
        }
      }
    },
    async (request, reply) => {
      const tokens = await registerUser(request.body);

      reply.setCookie(
        refreshCookieName,
        tokens.refreshToken,
        refreshCookieOptions
      );

      return reply.status(201).send({
        accessToken: tokens.accessToken,
        user: tokens.user
      });
    }
  );

  app.post(
    "/login",
    {
      preHandler: rateLimit,
      schema: {
        body: loginSchema,
        response: {
          200: tokenResponseSchema
        }
      }
    },
    async (request, reply) => {
      const tokens = await loginUser(request.body);

      reply.setCookie(
        refreshCookieName,
        tokens.refreshToken,
        refreshCookieOptions
      );

      return reply.send({
        accessToken: tokens.accessToken,
        user: tokens.user
      });
    }
  );

  app.post(
    "/refresh",
    {
      preHandler: rateLimit,
      schema: {
        response: {
          200: tokenResponseSchema
        }
      }
    },
    async (request, reply) => {
      const refreshToken = request.cookies[refreshCookieName];
      if (!refreshToken) {
        throw unauthorized("Missing refresh token");
      }

      const tokens = await rotateRefreshToken(refreshToken);

      reply.setCookie(
        refreshCookieName,
        tokens.refreshToken,
        refreshCookieOptions
      );

      return reply.send({
        accessToken: tokens.accessToken,
        user: tokens.user
      });
    }
  );

  app.post(
    "/logout",
    {
      preHandler: rateLimit,
      schema: {
        response: {
          200: okResponseSchema
        }
      }
    },
    async (request, reply) => {
      await revokeRefreshToken(request.cookies[refreshCookieName]);
      reply.clearCookie(refreshCookieName, clearRefreshCookieOptions);

      return reply.send({ ok: true });
    }
  );

  app.get(
    "/me",
    {
      preHandler: app.requireAuth,
      schema: {
        response: {
          200: userResponseSchema
        }
      }
    },
    async (request) => getCurrentUser(getUserId(request))
  );

  app.patch(
    "/me",
    {
      preHandler: app.requireAuth,
      schema: {
        body: updateProfileSchema,
        response: {
          200: userResponseSchema
        }
      }
    },
    async (request) => updateProfile(getUserId(request), request.body)
  );

  app.patch(
    "/me/password",
    {
      preHandler: [rateLimit, app.requireAuth],
      schema: {
        body: changePasswordSchema,
        response: {
          200: tokenResponseSchema
        }
      }
    },
    async (request, reply) => {
      const tokens = await changePassword(getUserId(request), request.body);

      reply.setCookie(refreshCookieName, tokens.refreshToken, refreshCookieOptions);

      return reply.send({
        accessToken: tokens.accessToken,
        user: tokens.user
      });
    }
  );

  done();
};
