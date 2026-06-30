/**
 * Integration tests for the per-client (browser/OS) rollup
 * (GET /api/projects/:id/clients). Browser/OS are derived from each event's
 * User-Agent at read time. Mirrors environmentStats.test.ts helpers.
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { processEvent } from "../modules/events/process.js";
import type { EventPayload } from "../modules/events/schemas.js";
import { projectClientStatsResponseSchema } from "../modules/projects/schemas.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";

interface AuthSession {
  accessToken: string;
}

const UA_CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UA_SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

let app: FastifyInstance;

const register = async (email: string): Promise<AuthSession> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", name: "Test User" }
  });
  expect(response.statusCode).toBe(201);
  const body = tokenResponseSchema.parse(response.json<unknown>());
  return { accessToken: body.accessToken };
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
  return response.json<{ project: { id: string } }>().project.id;
};

const makePayload = (overrides: Partial<EventPayload> = {}): EventPayload => ({
  timestamp: new Date().toISOString(),
  level: "error",
  message: `Unique error ${Math.random().toString(36).slice(2)}`,
  ...overrides
});

const getClients = (projectId: string, session: AuthSession, window = "24h") =>
  app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/clients?window=${window}`,
    headers: authHeaders(session)
  });

interface ClientStatRow {
  name: string;
  events: number;
  issues: number;
  affectedUsers: number;
}

const find = (rows: ClientStatRow[], name: string): ClientStatRow | undefined =>
  rows.find((r) => r.name === name);

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

describe("project client stats", () => {
  test("buckets events by browser and OS (busiest first) with per-bucket distinct users", async () => {
    const owner = await register("client-stats@example.com");
    const projectId = await createProject(owner, "Client Stats");

    // Chrome/Windows: two events of the SAME issue from two users → events 2,
    // issues 1, users 2. Safari/iOS: one event (user also seen on Chrome). One
    // untagged event with no UA and no user.
    await processEvent(projectId, makePayload({ message: "chrome boom", user: { id: "u1" } }), {
      userAgent: UA_CHROME_WIN
    });
    await processEvent(projectId, makePayload({ message: "chrome boom", user: { id: "u2" } }), {
      userAgent: UA_CHROME_WIN
    });
    await processEvent(projectId, makePayload({ message: "ios boom", user: { id: "u1" } }), {
      userAgent: UA_SAFARI_IOS
    });
    await processEvent(projectId, makePayload({ message: "no-ua boom" }));

    const response = await getClients(projectId, owner);
    expect(response.statusCode).toBe(200);
    const stats = projectClientStatsResponseSchema.parse(response.json<unknown>());

    // Busiest browser first. Names are ua-parser-js families stored at ingest
    // (so they match the event detail): desktop → "Chrome", iPhone → "Mobile Safari".
    // Chrome: 2 events but 1 distinct issue and 2 distinct users — each column independent.
    expect(stats.browsers[0]?.name).toBe("Chrome");
    expect(find(stats.browsers, "Chrome")).toMatchObject({ events: 2, issues: 1, affectedUsers: 2 });
    // Mobile Safari shares user u1 with Chrome but counts independently per bucket.
    expect(find(stats.browsers, "Mobile Safari")).toMatchObject({ events: 1, issues: 1, affectedUsers: 1 });
    // No UA → "알 수 없음", and no user → 0 affected.
    expect(find(stats.browsers, "알 수 없음")).toMatchObject({ events: 1, issues: 1, affectedUsers: 0 });

    expect(stats.os[0]?.name).toBe("Windows");
    expect(find(stats.os, "Windows")).toMatchObject({ events: 2, issues: 1, affectedUsers: 2 });
    expect(find(stats.os, "iOS")).toMatchObject({ events: 1, issues: 1, affectedUsers: 1 });
    expect(find(stats.os, "알 수 없음")).toMatchObject({ events: 1, issues: 1, affectedUsers: 0 });
  });

  test("affected-user count uses the id → email → username fallback key", async () => {
    const owner = await register("client-fallback@example.com");
    const projectId = await createProject(owner, "Client Fallback");
    // Same browser, three users identified by different keys → 3 distinct.
    await processEvent(projectId, makePayload({ user: { id: "u1" } }), {
      userAgent: UA_CHROME_WIN
    });
    await processEvent(projectId, makePayload({ user: { email: "only@x.com" } }), {
      userAgent: UA_CHROME_WIN
    });
    await processEvent(projectId, makePayload({ user: { username: "only-name" } }), {
      userAgent: UA_CHROME_WIN
    });

    const response = await getClients(projectId, owner);
    const stats = projectClientStatsResponseSchema.parse(response.json<unknown>());
    expect(find(stats.browsers, "Chrome")).toMatchObject({ events: 3, affectedUsers: 3 });
  });

  test("excludes events outside the window and 404s for non-members", async () => {
    const owner = await register("client-window@example.com");
    const projectId = await createProject(owner, "Client Window");
    await processEvent(projectId, makePayload({ user: { id: "u1" } }), {
      userAgent: UA_CHROME_WIN
    });
    await prisma.event.updateMany({
      where: { projectId },
      data: { receivedAt: new Date("2000-01-01T00:00:00.000Z") }
    });

    const mine = await getClients(projectId, owner);
    const stats = projectClientStatsResponseSchema.parse(mine.json<unknown>());
    expect(stats.browsers).toHaveLength(0);
    expect(stats.os).toHaveLength(0);

    const outsider = await register("client-outsider@example.com");
    const forbidden = await getClients(projectId, outsider);
    expect(forbidden.statusCode).toBe(404);
  });
});
