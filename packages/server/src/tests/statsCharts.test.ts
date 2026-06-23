import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod/v4";

import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { processEvent } from "../modules/events/process.js";
import type { EventPayload } from "../modules/events/schemas.js";
import { issueStatsResponseSchema } from "../modules/issues/schemas.js";
import {
  createProjectResponseSchema,
  projectStatsResponseSchema
} from "../modules/projects/schemas.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";
import { refreshCookieName } from "../modules/auth/routes.js";

// ---------------------------------------------------------------------------
// Shared helpers (same patterns as issueFilters.test.ts)
// ---------------------------------------------------------------------------

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

const createProject = async (
  session: AuthSession,
  name: string
): Promise<z.infer<typeof createProjectResponseSchema>> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: authHeaders(session),
    payload: { name, platform: "javascript-browser" }
  });
  expect(response.statusCode).toBe(201);
  return createProjectResponseSchema.parse(response.json<unknown>());
};

const currentTimestamp = (): string => new Date().toISOString();

const makePayload = (overrides: Partial<EventPayload> = {}): EventPayload => ({
  timestamp: currentTimestamp(),
  level: "error",
  message: `Unique error ${Math.random().toString(36).slice(2)}`,
  ...overrides
});

const getIssueStats = async (
  projectId: string,
  issueId: string,
  session: AuthSession,
  window = "24h"
) =>
  app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/issues/${issueId}/stats?window=${window}`,
    headers: authHeaders(session)
  });

const getProjectStats = async (
  projectId: string,
  session: AuthSession,
  window = "24h"
) =>
  app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/stats?window=${window}`,
    headers: authHeaders(session)
  });

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// affectedUsers (issue stats)
// ---------------------------------------------------------------------------

describe("issue stats affectedUsers", () => {
  test("counts distinct user.id; ignores null id, other issues, and out-of-window events", async () => {
    const owner = await register("stats-affected@example.com");
    const { project } = await createProject(owner, "Affected Users");

    // Issue A: three events from two distinct users (u1 twice, u2 once)
    // plus one event with no user.id → affectedUsers should be 2.
    const a1 = await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { id: "u1" } })
    );
    await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { id: "u1", email: "u1@x.com" } })
    );
    await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { id: "u2" } })
    );
    // No user.id (email only) → excluded from the distinct id count.
    await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { email: "anon@x.com" } })
    );

    // Issue B (different fingerprint): a distinct user that must NOT bleed into A.
    await processEvent(
      project.id,
      makePayload({ message: "issue B", user: { id: "u3" } })
    );

    const aResponse = await getIssueStats(project.id, a1.issueId, owner);
    expect(aResponse.statusCode).toBe(200);
    const aStats = issueStatsResponseSchema.parse(aResponse.json<unknown>());
    expect(aStats.affectedUsers).toBe(2);

    // Move all of issue A's events outside the 24h window → affectedUsers 0.
    await prisma.event.updateMany({
      where: { issueId: a1.issueId },
      data: { receivedAt: new Date("2000-01-01T00:00:00.000Z") }
    });
    const oldResponse = await getIssueStats(project.id, a1.issueId, owner);
    const oldStats = issueStatsResponseSchema.parse(oldResponse.json<unknown>());
    expect(oldStats.affectedUsers).toBe(0);
    expect(oldStats.buckets).toHaveLength(0);
  });

  test("returns 404 for an issue whose project the caller does not own", async () => {
    const owner = await register("issue-stats-owner@example.com");
    const other = await register("issue-stats-other@example.com");
    const { project } = await createProject(owner, "Owned");
    const event = await processEvent(
      project.id,
      makePayload({ message: "owned issue", user: { id: "u1" } })
    );

    const response = await getIssueStats(project.id, event.issueId, other);
    expect(response.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// project stats endpoint
// ---------------------------------------------------------------------------

describe("project stats endpoint", () => {
  test("aggregates events across issues with totalEvents and affectedUsers", async () => {
    const owner = await register("stats-project@example.com");
    const { project } = await createProject(owner, "Project Stats");

    // Two distinct issues; users u1 (issue A) and u2 (issue B) + one null-id event.
    await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { id: "u1" } })
    );
    await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { id: "u1" } })
    );
    await processEvent(
      project.id,
      makePayload({ message: "issue B", user: { id: "u2" } })
    );
    await processEvent(
      project.id,
      makePayload({ message: "issue B", user: { email: "no-id@x.com" } })
    );

    const response = await getProjectStats(project.id, owner);
    expect(response.statusCode).toBe(200);
    const stats = projectStatsResponseSchema.parse(response.json<unknown>());

    expect(stats.totalEvents).toBe(4);
    expect(stats.affectedUsers).toBe(2);
    expect(stats.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(4);
  });

  test("does not mix events from other projects", async () => {
    const owner = await register("stats-project-isolation@example.com");
    const { project: projectA } = await createProject(owner, "Project A");
    const { project: projectB } = await createProject(owner, "Project B");

    await processEvent(
      projectA.id,
      makePayload({ message: "A event", user: { id: "ua" } })
    );
    await processEvent(
      projectB.id,
      makePayload({ message: "B event", user: { id: "ub" } })
    );

    const response = await getProjectStats(projectA.id, owner);
    const stats = projectStatsResponseSchema.parse(response.json<unknown>());
    expect(stats.totalEvents).toBe(1);
    expect(stats.affectedUsers).toBe(1);
  });

  test("returns 404 for a project the caller does not own", async () => {
    const owner = await register("stats-owner@example.com");
    const other = await register("stats-other@example.com");
    const { project } = await createProject(owner, "Owned");

    const response = await getProjectStats(project.id, other);
    expect(response.statusCode).toBe(404);
  });
});
