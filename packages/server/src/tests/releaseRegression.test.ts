import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod/v4";

import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { processEvent } from "../modules/events/process.js";
import type { EventPayload } from "../modules/events/schemas.js";
import { refreshCookieName } from "../modules/auth/routes.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";
import { releaseIssuesResponseSchema } from "../modules/issues/schemas.js";
import { createProjectResponseSchema } from "../modules/projects/schemas.js";

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

const getReleaseIssues = async (
  projectId: string,
  release: string,
  session: AuthSession
) => {
  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/releases/${encodeURIComponent(release)}/issues`,
    headers: authHeaders(session)
  });
  return response;
};

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
// Tests
// ---------------------------------------------------------------------------

describe("release regression view", () => {
  test("newIssues lists only issues whose firstRelease matches", async () => {
    const owner = await register("release-new@example.com");
    const { project } = await createProject(owner, "Release New");

    const v1 = await processEvent(
      project.id,
      makePayload({ message: "born in v1", release: "v1.0" })
    );
    // Issue that first appeared in v2 — must not show under v1.
    await processEvent(
      project.id,
      makePayload({ message: "born in v2", release: "v2.0" })
    );

    const response = await getReleaseIssues(project.id, "v1.0", owner);
    expect(response.statusCode).toBe(200);
    const body = releaseIssuesResponseSchema.parse(response.json<unknown>());

    expect(body.release).toBe("v1.0");
    expect(body.newIssues).toHaveLength(1);
    expect(body.newIssues[0]?.id).toBe(v1.issueId);
    expect(body.regressedIssues).toHaveLength(0);
  });

  test("regressedIssues lists only issues that regressed in the given release", async () => {
    const owner = await register("release-regress@example.com");
    const { project } = await createProject(owner, "Release Regress");

    // Issue first seen in v1.0, resolved, then regresses in v2.0.
    const issue = await processEvent(
      project.id,
      makePayload({ message: "the regressor", release: "v1.0" })
    );
    await prisma.issue.update({
      where: { id: issue.issueId },
      data: { status: "resolved" }
    });
    const regression = await processEvent(
      project.id,
      makePayload({ message: "the regressor", release: "v2.0" })
    );
    expect(regression.regressed).toBe(true);

    // v2.0 view: regressor shows under regressedIssues, not newIssues.
    const v2 = await getReleaseIssues(project.id, "v2.0", owner);
    expect(v2.statusCode).toBe(200);
    const v2Body = releaseIssuesResponseSchema.parse(v2.json<unknown>());
    expect(v2Body.regressedIssues).toHaveLength(1);
    expect(v2Body.regressedIssues[0]?.id).toBe(issue.issueId);
    expect(v2Body.newIssues).toHaveLength(0);

    // v1.0 view: regressor is a NEW issue (firstRelease), not regressed.
    const v1 = await getReleaseIssues(project.id, "v1.0", owner);
    const v1Body = releaseIssuesResponseSchema.parse(v1.json<unknown>());
    expect(v1Body.newIssues).toHaveLength(1);
    expect(v1Body.newIssues[0]?.id).toBe(issue.issueId);
    expect(v1Body.regressedIssues).toHaveLength(0);
  });

  test("does not mix releases or projects, and returns empty for unknown release", async () => {
    const owner = await register("release-isolation@example.com");
    const { project: projectA } = await createProject(owner, "Project A");
    const { project: projectB } = await createProject(owner, "Project B");

    await processEvent(
      projectA.id,
      makePayload({ message: "A v1", release: "v1.0" })
    );
    await processEvent(
      projectB.id,
      makePayload({ message: "B v1", release: "v1.0" })
    );

    // Project A's v1.0 view sees only A's issue.
    const a = await getReleaseIssues(projectA.id, "v1.0", owner);
    const aBody = releaseIssuesResponseSchema.parse(a.json<unknown>());
    expect(aBody.newIssues).toHaveLength(1);

    // Unknown release → empty both lists.
    const unknown = await getReleaseIssues(projectA.id, "v9.9", owner);
    expect(unknown.statusCode).toBe(200);
    const unknownBody = releaseIssuesResponseSchema.parse(unknown.json<unknown>());
    expect(unknownBody.newIssues).toHaveLength(0);
    expect(unknownBody.regressedIssues).toHaveLength(0);
  });

  test("rejects access to a project the caller does not own with 404", async () => {
    const owner = await register("release-owner@example.com");
    const other = await register("release-other@example.com");
    const { project } = await createProject(owner, "Owned");

    await processEvent(
      project.id,
      makePayload({ message: "owned issue", release: "v1.0" })
    );

    const response = await getReleaseIssues(project.id, "v1.0", other);
    expect(response.statusCode).toBe(404);
  });
});
