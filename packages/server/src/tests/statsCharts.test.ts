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
  test("counts distinct users by id with email fallback; ignores other issues and out-of-window events", async () => {
    const owner = await register("stats-affected@example.com");
    const { project } = await createProject(owner, "Affected Users");

    // Issue A: u1 (twice — id wins over the email it also carries), u2, and an
    // event identified only by email → 3 distinct users (u1, u2, anon@x.com).
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
    // No user.id (email only) → counted via the email fallback.
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
    expect(aStats.affectedUsers).toBe(3);

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

  test("reports distinct affected users per bucket", async () => {
    const owner = await register("issue-bucket-users@example.com");
    const { project } = await createProject(owner, "Issue Bucket Users");
    const a = await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { id: "u1" } })
    );
    await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { id: "u1" } })
    );
    await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { id: "u2" } })
    );
    await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { email: "no-id@x.com" } })
    );
    // A different issue in the same project must NOT bleed into issue A's bucket.
    await processEvent(
      project.id,
      makePayload({ message: "issue B", user: { id: "u9" } })
    );

    // Pin every event to one timestamp (1h ago, inside the 24h window) so the
    // events land in a single hour bucket regardless of wall-clock boundary.
    await prisma.event.updateMany({
      where: { projectId: project.id },
      data: { receivedAt: new Date(Date.now() - 60 * 60_000) }
    });

    const response = await getIssueStats(project.id, a.issueId, owner);
    const stats = issueStatsResponseSchema.parse(response.json<unknown>());
    expect(stats.buckets).toHaveLength(1);
    // Issue A's 4 events / 3 distinct users (u1, u2, no-id@x.com via fallback);
    // issue B's u9 excluded.
    expect(stats.buckets[0]?.count).toBe(4);
    expect(stats.buckets[0]?.users).toBe(3);
  });

  test("falls back id → email → username, with id taking precedence", async () => {
    const owner = await register("issue-fallback@example.com");
    const { project } = await createProject(owner, "Fallback Keys");
    // u1 appears with an id, then again with the same id plus an email: id wins,
    // so both collapse to one user. A second event is identified only by email,
    // a third only by username → 3 distinct users total.
    const a = await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { id: "u1" } })
    );
    await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { id: "u1", email: "u1@x.com" } })
    );
    await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { email: "only-email@x.com" } })
    );
    await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { username: "only-username" } })
    );
    // Blank id must not block the fallback: this event counts as its email, not
    // as a shared empty-string "user".
    await processEvent(
      project.id,
      makePayload({ message: "issue A", user: { id: "", email: "blank-id@x.com" } })
    );

    const response = await getIssueStats(project.id, a.issueId, owner);
    const stats = issueStatsResponseSchema.parse(response.json<unknown>());
    expect(stats.affectedUsers).toBe(4);
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

    // Two distinct issues; users u1 (issue A) and u2 (issue B) + one email-only
    // event that counts via the fallback → 3 distinct users.
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
    expect(stats.affectedUsers).toBe(3);
    expect(stats.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(4);
  });

  test("reports distinct affected users per bucket", async () => {
    const owner = await register("stats-bucket-users@example.com");
    const { project } = await createProject(owner, "Bucket Users");
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

    // Pin every event into a single hour bucket (see issue-stats test above).
    await prisma.event.updateMany({
      where: { projectId: project.id },
      data: { receivedAt: new Date(Date.now() - 60 * 60_000) }
    });

    const response = await getProjectStats(project.id, owner);
    const stats = projectStatsResponseSchema.parse(response.json<unknown>());
    expect(stats.buckets).toHaveLength(1);
    expect(stats.buckets[0]?.count).toBe(4);
    // u1, u2, and no-id@x.com (email fallback) → 3 distinct.
    expect(stats.buckets[0]?.users).toBe(3);
  });

  test("aggregates users independently per bucket over 7d", async () => {
    const owner = await register("stats-multibucket@example.com");
    const { project } = await createProject(owner, "Multi Bucket");
    const dayOne = await processEvent(
      project.id,
      makePayload({ message: "day one", user: { id: "u1" } })
    );
    const dayTwo = await processEvent(
      project.id,
      makePayload({ message: "day two", user: { id: "u2" } })
    );

    // Pin each issue's event into a distinct day bucket within the 7d window.
    await prisma.event.updateMany({
      where: { issueId: dayOne.issueId },
      data: { receivedAt: new Date(Date.now() - 2 * 24 * 60 * 60_000) }
    });
    await prisma.event.updateMany({
      where: { issueId: dayTwo.issueId },
      data: { receivedAt: new Date(Date.now() - 60 * 60_000) }
    });

    const response = await getProjectStats(project.id, owner, "7d");
    const stats = projectStatsResponseSchema.parse(response.json<unknown>());
    expect(stats.buckets).toHaveLength(2);
    // ASC by bucket: older (u1) first, recent (u2) second — each its own user.
    expect(stats.buckets.map((b) => b.users)).toEqual([1, 1]);
    expect(stats.buckets.map((b) => b.count)).toEqual([1, 1]);
    // Window total stays 2 distinct users.
    expect(stats.affectedUsers).toBe(2);
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
