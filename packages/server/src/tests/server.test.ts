import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod/v4";

import { buildApp } from "../app.js";
import { env } from "../config/env.js";
import { refreshCookieName } from "../modules/auth/routes.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";
import {
  createProjectResponseSchema,
  listProjectKeysResponseSchema,
  listProjectsResponseSchema,
  projectKeyResponseSchema,
  projectResponseSchema
} from "../modules/projects/schemas.js";

const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string()
  })
});

interface CookieLike {
  name: string;
  value: string;
}

interface CookieResponse {
  cookies: CookieLike[];
}

interface AuthSession {
  accessToken: string;
  refreshCookie: string;
  userId: string;
}

let app: FastifyInstance;

const getRefreshCookie = (response: CookieResponse): string => {
  const cookie = response.cookies.find(
    (candidate) => candidate.name === refreshCookieName
  );

  if (!cookie) {
    throw new Error("Expected refresh cookie to be set");
  }

  return `${cookie.name}=${cookie.value}`;
};

const register = async (
  email: string,
  password = "password123"
): Promise<AuthSession> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      password,
      name: "Test User"
    }
  });

  expect(response.statusCode).toBe(201);
  const body = tokenResponseSchema.parse(response.json<unknown>());

  return {
    accessToken: body.accessToken,
    refreshCookie: getRefreshCookie(response),
    userId: body.user.id
  };
};

const authHeaders = (session: AuthSession): { authorization: string } => ({
  authorization: `Bearer ${session.accessToken}`
});

const expectedDsn = (publicKey: string, projectId: string): string =>
  `${env.DSN_SCHEME}://${publicKey}@${env.DSN_HOST}/${projectId}`;

beforeEach(async () => {
  app = buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("auth", () => {
  test("register, login, and me happy path", async () => {
    const registered = await register("happy@example.com");

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "happy@example.com",
        password: "password123"
      }
    });

    expect(loginResponse.statusCode).toBe(200);
    const loginBody = tokenResponseSchema.parse(loginResponse.json<unknown>());
    expect(loginBody.user.id).toBe(registered.userId);
    expect(getRefreshCookie(loginResponse)).toContain(refreshCookieName);

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        authorization: `Bearer ${loginBody.accessToken}`
      }
    });

    expect(meResponse.statusCode).toBe(200);
    const meBody = z
      .object({
        id: z.string(),
        email: z.string(),
        passwordHash: z.never().optional()
      })
      .loose()
      .parse(meResponse.json<unknown>());
    expect(meBody.id).toBe(registered.userId);
    expect(meBody.email).toBe("happy@example.com");
  });

  test("duplicate email returns 409", async () => {
    await register("duplicate@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "duplicate@example.com",
        password: "password123"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(errorResponseSchema.parse(response.json<unknown>()).error.code).toBe(
      "CONFLICT"
    );
  });

  test("bad login returns 401 with a generic message", async () => {
    await register("bad-login@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "bad-login@example.com",
        password: "wrong-password"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(errorResponseSchema.parse(response.json<unknown>()).error.message).toBe(
      "Invalid email or password"
    );
  });

  test("refresh rotates and invalidates the previous refresh token", async () => {
    const session = await register("refresh@example.com");

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: {
        cookie: session.refreshCookie
      }
    });

    expect(refreshResponse.statusCode).toBe(200);
    const rotated = tokenResponseSchema.parse(refreshResponse.json<unknown>());
    expect(rotated.accessToken).not.toBe(session.accessToken);
    const rotatedRefreshCookie = getRefreshCookie(refreshResponse);

    const replayResponse = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: {
        cookie: session.refreshCookie
      }
    });

    expect(replayResponse.statusCode).toBe(401);

    const familyRevokedResponse = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: {
        cookie: rotatedRefreshCookie
      }
    });

    expect(familyRevokedResponse.statusCode).toBe(401);
  });

  test("logout revokes the current refresh token", async () => {
    const session = await register("logout@example.com");

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie: session.refreshCookie
      }
    });

    expect(logoutResponse.statusCode).toBe(200);

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: {
        cookie: session.refreshCookie
      }
    });

    expect(refreshResponse.statusCode).toBe(401);
  });
});

describe("projects and keys", () => {
  test("project CRUD, ownership isolation, key rotation, and DSN format", async () => {
    const owner = await register("owner@example.com");
    const otherUser = await register("other@example.com");

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: authHeaders(owner),
      payload: {
        name: "Browser App",
        platform: "javascript-browser"
      }
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createProjectResponseSchema.parse(
      createResponse.json<unknown>()
    );
    expect(created.project.slug).toBe("browser-app");
    expect(created.dsn).toBe(
      expectedDsn(created.key.publicKey, created.project.id)
    );

    const isolatedResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}`,
      headers: authHeaders(otherUser)
    });
    expect(isolatedResponse.statusCode).toBe(404);

    const isolatedUpdateResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.project.id}`,
      headers: authHeaders(otherUser),
      payload: {
        name: "Stolen Project"
      }
    });
    expect(isolatedUpdateResponse.statusCode).toBe(404);

    const isolatedDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.project.id}`,
      headers: authHeaders(otherUser)
    });
    expect(isolatedDeleteResponse.statusCode).toBe(404);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: authHeaders(owner)
    });
    expect(listResponse.statusCode).toBe(200);
    const listed = listProjectsResponseSchema.parse(listResponse.json<unknown>());
    expect(listed.projects).toHaveLength(1);
    expect(listed.projects[0]?.keyCount).toBe(1);

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.project.id}`,
      headers: authHeaders(owner),
      payload: {
        name: "Browser Client",
        platform: "browser"
      }
    });
    expect(updateResponse.statusCode).toBe(200);
    const updated = projectResponseSchema.parse(updateResponse.json<unknown>());
    expect(updated.project.name).toBe("Browser Client");
    expect(updated.project.platform).toBe("browser");

    const keyResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${created.project.id}/keys`,
      headers: authHeaders(owner),
      payload: {
        label: "Production"
      }
    });
    expect(keyResponse.statusCode).toBe(201);
    const newKey = projectKeyResponseSchema.parse(keyResponse.json<unknown>());
    expect(newKey.key.label).toBe("Production");
    expect(newKey.dsn).toBe(
      expectedDsn(newKey.key.publicKey, created.project.id)
    );

    const rotateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${created.project.id}/keys/${newKey.key.id}/rotate`,
      headers: authHeaders(owner)
    });
    expect(rotateResponse.statusCode).toBe(201);
    const rotated = projectKeyResponseSchema.parse(rotateResponse.json<unknown>());
    expect(rotated.key.publicKey).not.toBe(newKey.key.publicKey);

    const disableResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.project.id}/keys/${rotated.key.id}`,
      headers: authHeaders(owner),
      payload: {
        isActive: false
      }
    });
    expect(disableResponse.statusCode).toBe(200);
    const disabled = projectKeyResponseSchema.parse(
      disableResponse.json<unknown>()
    );
    expect(disabled.key.isActive).toBe(false);

    const keysResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/keys`,
      headers: authHeaders(owner)
    });
    expect(keysResponse.statusCode).toBe(200);
    const keys = listProjectKeysResponseSchema.parse(
      keysResponse.json<unknown>()
    );
    expect(keys.keys).toHaveLength(3);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.project.id}`,
      headers: authHeaders(owner)
    });
    expect(deleteResponse.statusCode).toBe(204);

    const missingResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}`,
      headers: authHeaders(owner)
    });
    expect(missingResponse.statusCode).toBe(404);
  });

  test("creating two projects with the same name allocates distinct slugs", async () => {
    const owner = await register("slug-owner@example.com");

    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: authHeaders(owner),
      payload: {
        name: "Repeated Name"
      }
    });
    expect(firstResponse.statusCode).toBe(201);
    const first = createProjectResponseSchema.parse(firstResponse.json<unknown>());

    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: authHeaders(owner),
      payload: {
        name: "Repeated Name"
      }
    });
    expect(secondResponse.statusCode).toBe(201);
    const second = createProjectResponseSchema.parse(
      secondResponse.json<unknown>()
    );

    expect(first.project.slug).toBe("repeated-name");
    expect(second.project.slug).not.toBe(first.project.slug);
  });
});
