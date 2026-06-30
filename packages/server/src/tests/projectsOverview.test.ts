import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod/v4";

import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { refreshCookieName } from "../modules/auth/routes.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";
import { processEvent } from "../modules/events/process.js";
import type { EventPayload } from "../modules/events/schemas.js";
import {
  createProjectResponseSchema,
  projectsOverviewResponseSchema
} from "../modules/projects/schemas.js";

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

const makePayload = (message: string): EventPayload => ({
  timestamp: new Date().toISOString(),
  level: "error",
  message
});

const getOverview = (session: AuthSession, window = "24h") =>
  app.inject({
    method: "GET",
    url: `/api/projects/overview?window=${window}`,
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

describe("projects overview", () => {
  test("returns an empty project list when the user has no memberships", async () => {
    const owner = await register("overview-empty@example.com");

    const response = await getOverview(owner);

    expect(response.statusCode).toBe(200);
    expect(projectsOverviewResponseSchema.parse(response.json<unknown>())).toEqual({
      projects: []
    });
  });

  test("aggregates events, unresolved issues, buckets, and lastEventAt per member project", async () => {
    const owner = await register("overview-owner@example.com");
    const mine = await createProject(owner, "Overview Mine");
    const oldOnly = await createProject(owner, "Overview Old Only");

    await processEvent(mine.project.id, makePayload("overview unresolved"));
    const resolved = await processEvent(
      mine.project.id,
      makePayload("overview resolved")
    );
    const ignored = await processEvent(
      mine.project.id,
      makePayload("overview ignored")
    );
    await prisma.issue.update({
      where: { id: resolved.issueId },
      data: { status: "resolved" }
    });
    await prisma.issue.update({
      where: { id: ignored.issueId },
      data: { status: "ignored" }
    });

    const recent = new Date(Date.now() - 60 * 60_000);
    await prisma.event.updateMany({
      where: { projectId: mine.project.id },
      data: { receivedAt: recent }
    });

    const old = await processEvent(oldOnly.project.id, makePayload("old only"));
    const outsideWindow = new Date("2000-01-01T00:00:00.000Z");
    await prisma.event.update({
      where: { id: old.eventId },
      data: { receivedAt: outsideWindow }
    });

    const response = await getOverview(owner);
    expect(response.statusCode).toBe(200);
    const overview = projectsOverviewResponseSchema.parse(response.json<unknown>());

    const mineSummary = overview.projects.find(
      (project) => project.projectId === mine.project.id
    );
    expect(mineSummary).toBeDefined();
    expect(mineSummary?.events).toBe(3);
    expect(mineSummary?.openIssues).toBe(1);
    expect(mineSummary?.lastEventAt).toBe(recent.toISOString());
    expect(mineSummary?.buckets).toHaveLength(1);
    expect(mineSummary?.buckets[0]?.count).toBe(3);
    expect(mineSummary?.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(
      3
    );

    const oldSummary = overview.projects.find(
      (project) => project.projectId === oldOnly.project.id
    );
    expect(oldSummary).toMatchObject({
      events: 0,
      openIssues: 1,
      lastEventAt: outsideWindow.toISOString(),
      buckets: []
    });
  });

  test("excludes projects where the caller is not a member", async () => {
    const owner = await register("overview-isolated-owner@example.com");
    const other = await register("overview-isolated-other@example.com");
    const mine = await createProject(owner, "Visible");
    const theirs = await createProject(other, "Hidden");
    await processEvent(mine.project.id, makePayload("visible event"));
    await processEvent(theirs.project.id, makePayload("hidden event"));

    const response = await getOverview(owner);
    const overview = projectsOverviewResponseSchema.parse(response.json<unknown>());

    expect(overview.projects.map((project) => project.projectId)).toEqual([
      mine.project.id
    ]);
  });

  test("uses day buckets for the 7d window", async () => {
    const owner = await register("overview-7d@example.com");
    const created = await createProject(owner, "Seven Day");
    const first = await processEvent(created.project.id, makePayload("day one"));
    const second = await processEvent(created.project.id, makePayload("day two"));

    await prisma.event.update({
      where: { id: first.eventId },
      data: { receivedAt: new Date(Date.now() - 2 * 24 * 60 * 60_000) }
    });
    await prisma.event.update({
      where: { id: second.eventId },
      data: { receivedAt: new Date(Date.now() - 60 * 60_000) }
    });

    const response = await getOverview(owner, "7d");
    const overview = projectsOverviewResponseSchema.parse(response.json<unknown>());
    const summary = overview.projects.find(
      (project) => project.projectId === created.project.id
    );

    expect(summary?.events).toBe(2);
    expect(summary?.buckets).toHaveLength(2);
    expect(summary?.buckets.map((bucket) => bucket.count)).toEqual([1, 1]);
  });
});
