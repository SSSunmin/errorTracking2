import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { processEvent } from "../modules/events/process.js";
import type { EventPayload } from "../modules/events/schemas.js";
import { listIssuesResponseSchema } from "../modules/issues/schemas.js";
import { createProjectResponseSchema } from "../modules/projects/schemas.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";
import { refreshCookieName } from "../modules/auth/routes.js";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Shared helpers (same patterns as server.test.ts)
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

/** Build a minimal valid EventPayload with a unique message so each call
 *  produces a distinct fingerprint (= distinct Issue). */
const makePayload = (overrides: Partial<EventPayload> = {}): EventPayload => ({
  timestamp: currentTimestamp(),
  level: "error",
  message: `Unique error ${Math.random().toString(36).slice(2)}`,
  ...overrides
});

/** List issues for a project with optional query-string params. */
const listIssues = async (
  projectId: string,
  session: AuthSession,
  params: Record<string, string> = {}
) => {
  const qs = new URLSearchParams(params).toString();
  const url = `/api/projects/${projectId}/issues${qs ? `?${qs}` : ""}`;
  const response = await app.inject({
    method: "GET",
    url,
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
      enqueue: (data) =>
        Promise.resolve(data.payload.eventId ?? "queued-event")
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

describe("issue list filters", () => {
  // -------------------------------------------------------------------------
  // level filter
  // -------------------------------------------------------------------------
  test("level filter returns only issues matching the given level", async () => {
    const owner = await register("filter-level@example.com");
    const { project } = await createProject(owner, "Level Filter");

    const errorResult = await processEvent(
      project.id,
      makePayload({ level: "error", message: "an error event" })
    );
    const warningResult = await processEvent(
      project.id,
      makePayload({ level: "warning", message: "a warning event" })
    );
    const fatalResult = await processEvent(
      project.id,
      makePayload({ level: "fatal", message: "a fatal event" })
    );

    // Filter by error — only the error issue should appear
    const errorResponse = await listIssues(project.id, owner, {
      level: "error"
    });
    expect(errorResponse.statusCode).toBe(200);
    const errorList = listIssuesResponseSchema.parse(
      errorResponse.json<unknown>()
    );
    expect(errorList.issues).toHaveLength(1);
    expect(errorList.issues[0]?.id).toBe(errorResult.issueId);
    expect(errorList.issues[0]?.level).toBe("error");

    // Filter by warning — only the warning issue
    const warningResponse = await listIssues(project.id, owner, {
      level: "warning"
    });
    expect(warningResponse.statusCode).toBe(200);
    const warningList = listIssuesResponseSchema.parse(
      warningResponse.json<unknown>()
    );
    expect(warningList.issues).toHaveLength(1);
    expect(warningList.issues[0]?.id).toBe(warningResult.issueId);

    // Filter by fatal — only the fatal issue
    const fatalResponse = await listIssues(project.id, owner, {
      level: "fatal"
    });
    expect(fatalResponse.statusCode).toBe(200);
    const fatalList = listIssuesResponseSchema.parse(
      fatalResponse.json<unknown>()
    );
    expect(fatalList.issues).toHaveLength(1);
    expect(fatalList.issues[0]?.id).toBe(fatalResult.issueId);

    // No filter — all three issues
    const allResponse = await listIssues(project.id, owner);
    expect(allResponse.statusCode).toBe(200);
    const allList = listIssuesResponseSchema.parse(allResponse.json<unknown>());
    expect(allList.issues).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // invalid level value → 400
  // -------------------------------------------------------------------------
  test("invalid level value returns 400", async () => {
    const owner = await register("filter-invalid-level@example.com");
    const { project } = await createProject(owner, "Invalid Level");

    const response = await listIssues(project.id, owner, {
      level: "critical" // not in the enum
    });
    expect(response.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------------
  // release filter
  // -------------------------------------------------------------------------
  test("release filter returns only issues that have an event in that release", async () => {
    const owner = await register("filter-release@example.com");
    const { project } = await createProject(owner, "Release Filter");

    const v1Result = await processEvent(
      project.id,
      makePayload({ message: "error in v1.0", release: "v1.0" })
    );
    const v2Result = await processEvent(
      project.id,
      makePayload({ message: "error in v2.0", release: "v2.0" })
    );
    // Issue with no release
    await processEvent(
      project.id,
      makePayload({ message: "error with no release" })
    );

    // Filter release=v1.0 → only v1 issue
    const v1Response = await listIssues(project.id, owner, {
      release: "v1.0"
    });
    expect(v1Response.statusCode).toBe(200);
    const v1List = listIssuesResponseSchema.parse(v1Response.json<unknown>());
    expect(v1List.issues).toHaveLength(1);
    expect(v1List.issues[0]?.id).toBe(v1Result.issueId);

    // Filter release=v2.0 → only v2 issue
    const v2Response = await listIssues(project.id, owner, {
      release: "v2.0"
    });
    expect(v2Response.statusCode).toBe(200);
    const v2List = listIssuesResponseSchema.parse(v2Response.json<unknown>());
    expect(v2List.issues).toHaveLength(1);
    expect(v2List.issues[0]?.id).toBe(v2Result.issueId);

    // Filter release=v3.0 (no match) → empty
    const v3Response = await listIssues(project.id, owner, {
      release: "v3.0"
    });
    expect(v3Response.statusCode).toBe(200);
    const v3List = listIssuesResponseSchema.parse(v3Response.json<unknown>());
    expect(v3List.issues).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // environment filter
  // -------------------------------------------------------------------------
  test("environment filter returns only issues that have an event in that environment", async () => {
    const owner = await register("filter-env@example.com");
    const { project } = await createProject(owner, "Env Filter");

    const prodResult = await processEvent(
      project.id,
      makePayload({ message: "error in production", environment: "production" })
    );
    const stagingResult = await processEvent(
      project.id,
      makePayload({ message: "error in staging", environment: "staging" })
    );
    // Issue with no environment
    await processEvent(
      project.id,
      makePayload({ message: "error no env" })
    );

    // Filter environment=production → only prod issue
    const prodResponse = await listIssues(project.id, owner, {
      environment: "production"
    });
    expect(prodResponse.statusCode).toBe(200);
    const prodList = listIssuesResponseSchema.parse(
      prodResponse.json<unknown>()
    );
    expect(prodList.issues).toHaveLength(1);
    expect(prodList.issues[0]?.id).toBe(prodResult.issueId);

    // Filter environment=staging → only staging issue
    const stagingResponse = await listIssues(project.id, owner, {
      environment: "staging"
    });
    expect(stagingResponse.statusCode).toBe(200);
    const stagingList = listIssuesResponseSchema.parse(
      stagingResponse.json<unknown>()
    );
    expect(stagingList.issues).toHaveLength(1);
    expect(stagingList.issues[0]?.id).toBe(stagingResult.issueId);
  });

  // -------------------------------------------------------------------------
  // release + environment combined filter (AND via same event)
  // -------------------------------------------------------------------------
  test("combined release+environment filter requires BOTH to be satisfied by the same event", async () => {
    const owner = await register("filter-combined@example.com");
    const { project } = await createProject(owner, "Combined Filter");

    // Issue A: has event with release=v1.0 AND environment=production (satisfies both)
    const bothResult = await processEvent(
      project.id,
      makePayload({
        message: "error A: both match on same event",
        release: "v1.0",
        environment: "production"
      })
    );

    // Issue B: has TWO events — one with release=v1.0 only, one with environment=production only
    // Because they are separate events, no single event satisfies both simultaneously.
    // We give this issue a distinct fingerprint by using exception-based payload.
    const onlyReleaseResult = await processEvent(
      project.id,
      makePayload({
        message: "error B first event: only release",
        release: "v1.0"
      })
    );
    // Second event on the SAME issue (same fingerprint = same message)
    await processEvent(
      project.id,
      makePayload({
        message: "error B first event: only release", // same fingerprint → same issue
        environment: "production"
        // no release on this event
      })
    );

    // Issue C: release=v1.0, environment=staging (release matches but env does not)
    const wrongEnvResult = await processEvent(
      project.id,
      makePayload({
        message: "error C: right release, wrong env",
        release: "v1.0",
        environment: "staging"
      })
    );

    // Filter release=v1.0 + environment=production
    // Expected: only Issue A (bothResult) — Issue B's events don't share both fields,
    // Issue C has wrong environment.
    const response = await listIssues(project.id, owner, {
      release: "v1.0",
      environment: "production"
    });
    expect(response.statusCode).toBe(200);
    const list = listIssuesResponseSchema.parse(response.json<unknown>());

    const ids = list.issues.map((i) => i.id);
    expect(ids).toContain(bothResult.issueId);
    expect(ids).not.toContain(onlyReleaseResult.issueId);
    expect(ids).not.toContain(wrongEnvResult.issueId);
    expect(list.issues).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // since / until range (lastSeen based)
  // -------------------------------------------------------------------------
  test("since/until filters issues by lastSeen inclusive range", async () => {
    const owner = await register("filter-since-until@example.com");
    const { project } = await createProject(owner, "Since Until Filter");

    // Create three issues, then manually set their lastSeen to distinct past times.
    const oldResult = await processEvent(
      project.id,
      makePayload({ message: "old issue" })
    );
    const midResult = await processEvent(
      project.id,
      makePayload({ message: "mid issue" })
    );
    const newResult = await processEvent(
      project.id,
      makePayload({ message: "new issue" })
    );

    // Pin lastSeen values deterministically via direct DB write.
    const oldTime = new Date("2024-01-01T00:00:00.000Z");
    const midTime = new Date("2024-06-01T00:00:00.000Z");
    const newTime = new Date("2024-12-31T00:00:00.000Z");

    await prisma.issue.update({
      where: { id: oldResult.issueId },
      data: { lastSeen: oldTime }
    });
    await prisma.issue.update({
      where: { id: midResult.issueId },
      data: { lastSeen: midTime }
    });
    await prisma.issue.update({
      where: { id: newResult.issueId },
      data: { lastSeen: newTime }
    });

    // since=mid, until=new → mid and new (inclusive both ends)
    const midToNew = await listIssues(project.id, owner, {
      since: midTime.toISOString(),
      until: newTime.toISOString()
    });
    expect(midToNew.statusCode).toBe(200);
    const midToNewList = listIssuesResponseSchema.parse(
      midToNew.json<unknown>()
    );
    const midToNewIds = midToNewList.issues.map((i) => i.id);
    expect(midToNewIds).toContain(midResult.issueId);
    expect(midToNewIds).toContain(newResult.issueId);
    expect(midToNewIds).not.toContain(oldResult.issueId);

    // since=newTime → only the newest (exact boundary inclusive)
    const sinceNew = await listIssues(project.id, owner, {
      since: newTime.toISOString()
    });
    expect(sinceNew.statusCode).toBe(200);
    const sinceNewList = listIssuesResponseSchema.parse(
      sinceNew.json<unknown>()
    );
    expect(sinceNewList.issues).toHaveLength(1);
    expect(sinceNewList.issues[0]?.id).toBe(newResult.issueId);

    // until=oldTime → only the oldest (exact boundary inclusive)
    const untilOld = await listIssues(project.id, owner, {
      until: oldTime.toISOString()
    });
    expect(untilOld.statusCode).toBe(200);
    const untilOldList = listIssuesResponseSchema.parse(
      untilOld.json<unknown>()
    );
    expect(untilOldList.issues).toHaveLength(1);
    expect(untilOldList.issues[0]?.id).toBe(oldResult.issueId);

    // since after all → empty
    const afterAll = await listIssues(project.id, owner, {
      since: "2025-01-01T00:00:00.000Z"
    });
    expect(afterAll.statusCode).toBe(200);
    const afterAllList = listIssuesResponseSchema.parse(
      afterAll.json<unknown>()
    );
    expect(afterAllList.issues).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // since > until → 400
  // -------------------------------------------------------------------------
  test("since after until returns 400", async () => {
    const owner = await register("filter-since-gt-until@example.com");
    const { project } = await createProject(owner, "Since GT Until");

    const response = await listIssues(project.id, owner, {
      since: "2024-12-31T00:00:00.000Z",
      until: "2024-01-01T00:00:00.000Z"
    });
    expect(response.statusCode).toBe(400);
  });
});
