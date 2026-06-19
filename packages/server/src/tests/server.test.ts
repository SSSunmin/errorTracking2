import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod/v4";

import { buildApp } from "../app.js";
import { env } from "../config/env.js";
import { buildIngestJobOptions, type IngestEventJobData } from "../lib/queue.js";
import { refreshCookieName } from "../modules/auth/routes.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";
import { processEvent } from "../modules/events/process.js";
import type { EventPayload } from "../modules/events/schemas.js";
import {
  issueDetailResponseSchema,
  issueEventsResponseSchema,
  issueStatsResponseSchema,
  listIssuesResponseSchema,
  updateIssueResponseSchema
} from "../modules/issues/schemas.js";
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
let enqueueCalls: IngestEventJobData[];
const validClientEventId = "11111111-1111-4111-8111-111111111111";

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

const currentTimestamp = (): string => new Date().toISOString();

const nestObject = (depth: number): unknown => {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }

  return value;
};

const createProjectViaApi = async (
  session: AuthSession,
  name = "Browser App"
): Promise<z.infer<typeof createProjectResponseSchema>> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: authHeaders(session),
    payload: {
      name,
      platform: "javascript-browser"
    }
  });

  expect(response.statusCode).toBe(201);
  return createProjectResponseSchema.parse(response.json<unknown>());
};

beforeEach(async () => {
  enqueueCalls = [];
  app = buildApp({
    ingest: {
      enqueue: (data) => {
        enqueueCalls.push(data);
        return Promise.resolve(data.payload.eventId ?? "queued-event");
      }
    }
  });
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

describe("ingest", () => {
  const validEventPayload = (): EventPayload => ({
    eventId: validClientEventId,
    timestamp: currentTimestamp(),
    level: "error",
    message: "Browser failed"
  });

  test("valid DSN key enqueues an event", async () => {
    const owner = await register("ingest-owner@example.com");
    const created = await createProjectViaApi(owner, "Ingest Project");

    const response = await app.inject({
      method: "POST",
      url: `/api/${created.project.id}/store`,
      headers: {
        "x-mini-sentry-key": created.key.publicKey,
        origin: "https://customer.example"
      },
      payload: validEventPayload()
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.json<unknown>()).toEqual({ id: validClientEventId });
    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0]?.projectId).toBe(created.project.id);
    expect(enqueueCalls[0]?.payload.message).toBe("Browser failed");
  });

  test("missing, invalid, inactive, and wrong-project keys are rejected", async () => {
    const owner = await register("ingest-reject@example.com");
    const first = await createProjectViaApi(owner, "First Ingest");
    const second = await createProjectViaApi(owner, "Second Ingest");

    const missing = await app.inject({
      method: "POST",
      url: `/api/${first.project.id}/store`,
      payload: validEventPayload()
    });
    expect(missing.statusCode).toBe(401);
    expect(errorResponseSchema.parse(missing.json<unknown>()).error.message).toBe(
      "Invalid project key"
    );

    const invalid = await app.inject({
      method: "POST",
      url: `/api/${first.project.id}/store?key=not-a-key`,
      payload: validEventPayload()
    });
    expect(invalid.statusCode).toBe(401);
    expect(errorResponseSchema.parse(invalid.json<unknown>()).error.message).toBe(
      "Invalid project key"
    );

    const wrongProject = await app.inject({
      method: "POST",
      url: `/api/${second.project.id}/store?key=${first.key.publicKey}`,
      payload: validEventPayload()
    });
    expect(wrongProject.statusCode).toBe(401);
    expect(
      errorResponseSchema.parse(wrongProject.json<unknown>()).error.message
    ).toBe("Invalid project key");

    const disableResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${first.project.id}/keys/${first.key.id}`,
      headers: authHeaders(owner),
      payload: {
        isActive: false
      }
    });
    expect(disableResponse.statusCode).toBe(200);

    const inactive = await app.inject({
      method: "POST",
      url: `/api/${first.project.id}/store`,
      headers: {
        "x-mini-sentry-key": first.key.publicKey
      },
      payload: validEventPayload()
    });
    expect(inactive.statusCode).toBe(401);
    expect(errorResponseSchema.parse(inactive.json<unknown>()).error.message).toBe(
      "Invalid project key"
    );
  });

  test("bad payload returns 400", async () => {
    const owner = await register("ingest-bad-payload@example.com");
    const created = await createProjectViaApi(owner, "Bad Payload");

    const response = await app.inject({
      method: "POST",
      url: `/api/${created.project.id}/store`,
      headers: {
        "x-mini-sentry-key": created.key.publicKey
      },
      payload: {
        message: "missing timestamp"
      }
    });

    expect(response.statusCode).toBe(400);
  });

  test("rejects deep JSON, too many frames, empty events, and oversized bodies", async () => {
    const owner = await register("ingest-limits@example.com");
    const created = await createProjectViaApi(owner, "Limits");
    const headers = {
      "content-type": "application/json",
      "x-mini-sentry-key": created.key.publicKey
    };

    const deepNested = await app.inject({
      method: "POST",
      url: `/api/${created.project.id}/store`,
      headers,
      payload: {
        ...validEventPayload(),
        tags: {
          nested: nestObject(9)
        }
      }
    });
    expect(deepNested.statusCode).toBe(400);

    const tooManyFrames = await app.inject({
      method: "POST",
      url: `/api/${created.project.id}/store`,
      headers,
      payload: {
        ...validEventPayload(),
        exception: {
          type: "Error",
          value: "too many frames",
          stacktrace: {
            frames: Array.from({ length: 101 }, () => ({ filename: "app.js" }))
          }
        }
      }
    });
    expect(tooManyFrames.statusCode).toBe(400);

    const emptyEvent = await app.inject({
      method: "POST",
      url: `/api/${created.project.id}/store`,
      headers,
      payload: {
        timestamp: currentTimestamp()
      }
    });
    expect(emptyEvent.statusCode).toBe(400);

    const oversized = await app.inject({
      method: "POST",
      url: `/api/${created.project.id}/store`,
      headers,
      payload: JSON.stringify({
        ...validEventPayload(),
        message: "x".repeat(2 * 1_024 * 1_024 + 1_000)
      })
    });
    expect(oversized.statusCode).toBe(413);
  });

  test("client eventId is used as the BullMQ idempotency job id", () => {
    expect(buildIngestJobOptions(validEventPayload())).toEqual({
      jobId: validClientEventId
    });
  });

  test("ingest CORS is public but auth CORS is not", async () => {
    const owner = await register("cors-owner@example.com");
    const created = await createProjectViaApi(owner, "CORS Project");

    const ingestResponse = await app.inject({
      method: "POST",
      url: `/api/${created.project.id}/store`,
      headers: {
        "x-mini-sentry-key": created.key.publicKey,
        origin: "https://arbitrary.example"
      },
      payload: validEventPayload()
    });
    expect(ingestResponse.statusCode).toBe(202);
    expect(ingestResponse.headers["access-control-allow-origin"]).toBe("*");

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: {
        origin: "https://arbitrary.example"
      },
      payload: {
        email: "cors-owner@example.com",
        password: "password123"
      }
    });
    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.headers["access-control-allow-origin"]).not.toBe("*");
    expect(loginResponse.headers["access-control-allow-origin"]).not.toBe(
      "https://arbitrary.example"
    );
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

describe("issue APIs", () => {
  const issuePayload: EventPayload = {
    timestamp: currentTimestamp(),
    level: "error",
    message: "Issue API failure",
    exception: {
      type: "TypeError",
      value: "Issue API failure",
      stacktrace: {
        frames: [
          {
            function: "loadDashboard",
            filename: "dashboard.ts",
            in_app: true
          }
        ]
      }
    },
    tags: {
      area: "issues"
    }
  };

  test("list, detail, events, stats, status update, and ownership isolation", async () => {
    const owner = await register("issues-owner@example.com");
    const otherUser = await register("issues-other@example.com");
    const created = await createProjectViaApi(owner, "Issues Project");

    const first = await processEvent(created.project.id, issuePayload);
    await processEvent(created.project.id, issuePayload);

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/issues`,
      headers: authHeaders(owner)
    });
    expect(listResponse.statusCode).toBe(200);
    const list = listIssuesResponseSchema.parse(listResponse.json<unknown>());
    expect(list.issues).toHaveLength(1);
    expect(list.issues[0]?.id).toBe(first.issueId);
    expect(list.issues[0]?.timesSeen).toBe(2);

    const isolatedListResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/issues`,
      headers: authHeaders(otherUser)
    });
    expect(isolatedListResponse.statusCode).toBe(404);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/issues/${first.issueId}`,
      headers: authHeaders(owner)
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = issueDetailResponseSchema.parse(detailResponse.json<unknown>());
    expect(detail.issue.latestEvent?.message).toBe("Issue API failure");

    const eventsResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/issues/${first.issueId}/events`,
      headers: authHeaders(owner)
    });
    expect(eventsResponse.statusCode).toBe(200);
    const events = issueEventsResponseSchema.parse(eventsResponse.json<unknown>());
    expect(events.events).toHaveLength(2);
    expect(events.events[0]?.tags).toEqual({ area: "issues" });

    const statsResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/issues/${first.issueId}/stats?window=24h`,
      headers: authHeaders(owner)
    });
    expect(statsResponse.statusCode).toBe(200);
    const stats = issueStatsResponseSchema.parse(statsResponse.json<unknown>());
    expect(stats.buckets).toHaveLength(1);
    expect(stats.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2);

    const excessiveIssuesPageResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/issues?page=101&limit=100`,
      headers: authHeaders(owner)
    });
    expect(excessiveIssuesPageResponse.statusCode).toBe(400);

    const excessiveEventsPageResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${created.project.id}/issues/${first.issueId}/events?page=101&limit=100`,
      headers: authHeaders(owner)
    });
    expect(excessiveEventsPageResponse.statusCode).toBe(400);

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.project.id}/issues/${first.issueId}`,
      headers: authHeaders(owner),
      payload: {
        status: "resolved"
      }
    });
    expect(updateResponse.statusCode).toBe(200);
    const updated = updateIssueResponseSchema.parse(
      updateResponse.json<unknown>()
    );
    expect(updated.issue.status).toBe("resolved");

    const isolatedUpdateResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.project.id}/issues/${first.issueId}`,
      headers: authHeaders(otherUser),
      payload: {
        status: "ignored"
      }
    });
    expect(isolatedUpdateResponse.statusCode).toBe(404);
  });
});
