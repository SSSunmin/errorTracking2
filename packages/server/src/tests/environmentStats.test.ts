/**
 * Integration tests for the per-environment project rollup
 * (GET /api/projects/:id/environments). Mirrors the auth/project helpers used by
 * statsCharts.test.ts.
 *
 * Covers: grouping + busiest-first ordering, the null-environment row, distinct
 * issue/user counts, window exclusion, project isolation, and ownership 404.
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { processEvent } from "../modules/events/process.js";
import type { EventPayload } from "../modules/events/schemas.js";
import { projectEnvironmentStatsResponseSchema } from "../modules/projects/schemas.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";
import { refreshCookieName } from "../modules/auth/routes.js";

interface CookieLike {
  name: string;
  value: string;
}
interface AuthSession {
  accessToken: string;
  userId: string;
}

let app: FastifyInstance;

const getRefreshCookie = (response: { cookies: CookieLike[] }): string => {
  const cookie = response.cookies.find((c) => c.name === refreshCookieName);
  if (!cookie) throw new Error("Expected refresh cookie to be set");
  return `${cookie.name}=${cookie.value}`;
};

const register = async (email: string): Promise<AuthSession> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", name: "Test User" }
  });
  expect(response.statusCode).toBe(201);
  // Touch the refresh cookie so the registration shape stays exercised.
  getRefreshCookie(response);
  const body = tokenResponseSchema.parse(response.json<unknown>());
  return { accessToken: body.accessToken, userId: body.user.id };
};

const authHeaders = (session: AuthSession): { authorization: string } => ({
  authorization: `Bearer ${session.accessToken}`
});

const createProject = async (
  session: AuthSession,
  name: string
): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: authHeaders(session),
    payload: { name, platform: "javascript-browser" }
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{ project: { id: string } }>();
  return body.project.id;
};

const makePayload = (overrides: Partial<EventPayload> = {}): EventPayload => ({
  timestamp: new Date().toISOString(),
  level: "error",
  message: `Unique error ${Math.random().toString(36).slice(2)}`,
  ...overrides
});

const getEnvironments = (
  projectId: string,
  session: AuthSession,
  window = "24h"
) =>
  app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/environments?window=${window}`,
    headers: authHeaders(session)
  });

beforeEach(async () => {
  app = buildApp({
    ingest: {
      enqueue: (data) => Promise.resolve(data.payload.eventId ?? "queued-event")
    }
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("project environment stats", () => {
  test("groups events by environment (busiest first), with a null row for untagged events", async () => {
    const owner = await register("env-stats@example.com");
    const projectId = await createProject(owner, "Env Stats");

    // production: issue A twice (u1, u2) + issue B once (u1) → 3 events, 2 issues, 2 users.
    await processEvent(
      projectId,
      makePayload({ message: "errA", environment: "production", user: { id: "u1" } })
    );
    await processEvent(
      projectId,
      makePayload({ message: "errA", environment: "production", user: { id: "u2" } })
    );
    await processEvent(
      projectId,
      makePayload({ message: "errB", environment: "production", user: { id: "u1" } })
    );
    // staging: issue A once (u3) → 1 event, 1 issue, 1 user.
    await processEvent(
      projectId,
      makePayload({ message: "errA", environment: "staging", user: { id: "u3" } })
    );
    // No environment tag → aggregated into the null row.
    await processEvent(
      projectId,
      makePayload({ message: "errC", user: { id: "u4" } })
    );

    const response = await getEnvironments(projectId, owner);
    expect(response.statusCode).toBe(200);
    const stats = projectEnvironmentStatsResponseSchema.parse(response.json<unknown>());

    expect(stats.environments).toHaveLength(3);
    expect(stats.environments[0]).toMatchObject({
      environment: "production",
      events: 3,
      issues: 2,
      affectedUsers: 2
    });
    // staging and null tie at 1 event; "staging" sorts before the null row.
    expect(stats.environments[1]).toMatchObject({
      environment: "staging",
      events: 1,
      issues: 1,
      affectedUsers: 1
    });
    expect(stats.environments[2]).toMatchObject({
      environment: null,
      events: 1,
      issues: 1,
      affectedUsers: 1
    });
  });

  test("counts the same user once per environment and excludes events without a user", async () => {
    const owner = await register("env-dup-user@example.com");
    const projectId = await createProject(owner, "Env Dup User");

    // u1 is active in BOTH environments; distinct-per-environment means each
    // environment's affectedUsers counts u1 once (no cross-environment dedup).
    await processEvent(
      projectId,
      makePayload({ message: "errA", environment: "production", user: { id: "u1" } })
    );
    await processEvent(
      projectId,
      makePayload({ message: "errA", environment: "staging", user: { id: "u1" } })
    );
    // An event with no user context must not inflate affectedUsers.
    await processEvent(
      projectId,
      makePayload({ message: "errA", environment: "staging" })
    );

    const response = await getEnvironments(projectId, owner);
    const stats = projectEnvironmentStatsResponseSchema.parse(response.json<unknown>());

    const production = stats.environments.find((e) => e.environment === "production");
    const staging = stats.environments.find((e) => e.environment === "staging");
    expect(production).toMatchObject({ events: 1, affectedUsers: 1 });
    // staging: 2 events but only u1 is identifiable → affectedUsers 1.
    expect(staging).toMatchObject({ events: 2, affectedUsers: 1 });
  });

  test("excludes events outside the window", async () => {
    const owner = await register("env-window@example.com");
    const projectId = await createProject(owner, "Env Window");

    await processEvent(
      projectId,
      makePayload({ message: "old", environment: "production", user: { id: "u1" } })
    );
    await prisma.event.updateMany({
      where: { projectId },
      data: { receivedAt: new Date("2000-01-01T00:00:00.000Z") }
    });

    const response = await getEnvironments(projectId, owner);
    const stats = projectEnvironmentStatsResponseSchema.parse(response.json<unknown>());
    expect(stats.environments).toHaveLength(0);
  });

  test("isolates environments per project and 404s for non-members", async () => {
    const owner = await register("env-owner@example.com");
    const projectId = await createProject(owner, "Env Owner");
    await processEvent(
      projectId,
      makePayload({ message: "mine", environment: "production", user: { id: "u1" } })
    );

    // A separate project's events must not leak into this rollup.
    const other = await register("env-other@example.com");
    const otherProjectId = await createProject(other, "Env Other");
    await processEvent(
      otherProjectId,
      makePayload({ message: "theirs", environment: "staging", user: { id: "z9" } })
    );

    const mine = await getEnvironments(projectId, owner);
    const mineStats = projectEnvironmentStatsResponseSchema.parse(mine.json<unknown>());
    expect(mineStats.environments).toHaveLength(1);
    expect(mineStats.environments[0]?.environment).toBe("production");

    // Non-member sees the project as not found.
    const forbidden = await getEnvironments(projectId, other);
    expect(forbidden.statusCode).toBe(404);
  });
});
