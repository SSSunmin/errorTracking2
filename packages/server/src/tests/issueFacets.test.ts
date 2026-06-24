import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod/v4";

import { buildApp } from "../app.js";
import { processEvent } from "../modules/events/process.js";
import type { EventPayload } from "../modules/events/schemas.js";
import { issueFacetsResponseSchema } from "../modules/issues/schemas.js";
import { createProjectResponseSchema } from "../modules/projects/schemas.js";
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

const getFacets = async (projectId: string, session: AuthSession) => {
  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/issues/facets`,
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

describe("issue facets", () => {
  test("returns distinct release/environment values sorted ascending without duplicates", async () => {
    const owner = await register("facets-distinct@example.com");
    const { project } = await createProject(owner, "Facets Distinct");

    // Two events share release v1.0 / environment production → must dedupe.
    await processEvent(
      project.id,
      makePayload({ message: "a", release: "v2.0", environment: "staging" })
    );
    await processEvent(
      project.id,
      makePayload({ message: "b", release: "v1.0", environment: "production" })
    );
    await processEvent(
      project.id,
      makePayload({ message: "c", release: "v1.0", environment: "production" })
    );

    const response = await getFacets(project.id, owner);
    expect(response.statusCode).toBe(200);
    const facets = issueFacetsResponseSchema.parse(response.json<unknown>());

    expect(facets.releases).toEqual(["v1.0", "v2.0"]);
    expect(facets.environments).toEqual(["production", "staging"]);
  });

  test("excludes events with null release/environment", async () => {
    const owner = await register("facets-null@example.com");
    const { project } = await createProject(owner, "Facets Null");

    // Release only, environment only, and neither.
    await processEvent(
      project.id,
      makePayload({ message: "rel only", release: "v9.9" })
    );
    await processEvent(
      project.id,
      makePayload({ message: "env only", environment: "qa" })
    );
    await processEvent(project.id, makePayload({ message: "neither" }));

    const response = await getFacets(project.id, owner);
    expect(response.statusCode).toBe(200);
    const facets = issueFacetsResponseSchema.parse(response.json<unknown>());

    expect(facets.releases).toEqual(["v9.9"]);
    expect(facets.environments).toEqual(["qa"]);
  });

  test("does not mix in events from another project", async () => {
    const owner = await register("facets-scope@example.com");
    const { project: projectA } = await createProject(owner, "Facets A");
    const { project: projectB } = await createProject(owner, "Facets B");

    await processEvent(
      projectA.id,
      makePayload({ message: "a", release: "a-rel", environment: "a-env" })
    );
    await processEvent(
      projectB.id,
      makePayload({ message: "b", release: "b-rel", environment: "b-env" })
    );

    const response = await getFacets(projectA.id, owner);
    expect(response.statusCode).toBe(200);
    const facets = issueFacetsResponseSchema.parse(response.json<unknown>());

    expect(facets.releases).toEqual(["a-rel"]);
    expect(facets.environments).toEqual(["a-env"]);
  });

  test("returns empty arrays when the project has no events", async () => {
    const owner = await register("facets-empty@example.com");
    const { project } = await createProject(owner, "Facets Empty");

    const response = await getFacets(project.id, owner);
    expect(response.statusCode).toBe(200);
    const facets = issueFacetsResponseSchema.parse(response.json<unknown>());

    expect(facets.releases).toEqual([]);
    expect(facets.environments).toEqual([]);
  });

  test("rejects a project not owned by the caller", async () => {
    const owner = await register("facets-owner@example.com");
    const stranger = await register("facets-stranger@example.com");
    const { project } = await createProject(owner, "Facets Owned");

    const response = await getFacets(project.id, stranger);
    expect(response.statusCode).toBe(404);
  });
});
