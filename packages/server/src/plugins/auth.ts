import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";

import { unauthorized } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/tokens.js";

const getBearerToken = (authorizationHeader: string | undefined): string => {
  if (!authorizationHeader) {
    throw unauthorized("Missing access token");
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw unauthorized("Invalid access token");
  }

  return token;
};

const authPluginCallback: FastifyPluginCallback = (app, _options, done) => {
  app.decorateRequest("user", undefined);

  app.decorate("requireAuth", async (request) => {
    const token = getBearerToken(request.headers.authorization);
    const payload = await verifyAccessToken(token);

    request.user = {
      id: payload.sub
    };
  });

  done();
};

export const authPlugin = fp(authPluginCallback, {
  name: "auth"
});
