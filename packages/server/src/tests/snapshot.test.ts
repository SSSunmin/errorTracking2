/**
 * Tests for DOM-snapshot persistence and the snapshot read endpoint.
 *
 * Covers (processEvent):
 *  - When replay is present, an EventSnapshot row is created linked to the Event
 *  - The persisted snapshot stores data, href, width, height correctly
 *  - When replay is absent, no EventSnapshot row is created
 *
 * Covers (GET …/events/:eventId/snapshot route via buildApp):
 *  - Returns the stored snapshot body when one exists
 *  - Returns { snapshot: null } when no snapshot exists
 *  - hasSnapshot:true appears in the events-list for an event that has a snapshot
 *  - hasSnapshot:false for an event without a snapshot
 *
 * DB setup follows the same pattern as processEvent.test.ts:
 *  - Uses the real prisma instance (TEST_DATABASE_URL, migrated by globalSetup)
 *  - beforeEach TRUNCATE is handled by setup.ts
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { processEvent } from "../modules/events/process.js";
import {
  eventSnapshotResponseSchema,
  issueEventsResponseSchema
} from "../modules/issues/schemas.js";
import type { EventPayload } from "../modules/events/schemas.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";
import { createProjectResponseSchema } from "../modules/projects/schemas.js";

// ── helpers ──────────────────────────────────────────────────────────────────

const createProject = async (): Promise<string> => {
  const user = await prisma.user.create({
    data: { email: "snapshot-test@example.com", passwordHash: "x" }
  });
  const project = await prisma.project.create({
    data: { name: "Snapshot", slug: "snapshot-proj", ownerId: user.id }
  });
  return project.id;
};

const basePayload = (): EventPayload => ({
  timestamp: new Date().toISOString(),
  level: "error",
  message: "snapshot test error"
});

const payloadWithReplay = (): EventPayload => ({
  ...basePayload(),
  replay: {
    data: { nodes: [{ type: "div", id: 1, children: ["hello"] }] },
    href: "https://example.com/page",
    width: 1920,
    height: 1080
  }
});

// ── processEvent unit tests (DB) ──────────────────────────────────────────────

describe("processEvent — snapshot persistence", () => {
  test("creates an EventSnapshot row when replay is present", async () => {
    const projectId = await createProject();
    const result = await processEvent(projectId, payloadWithReplay());

    const snapshot = await prisma.eventSnapshot.findUnique({
      where: { eventId: result.eventId }
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.eventId).toBe(result.eventId);
    expect(snapshot?.projectId).toBe(projectId);
    expect(snapshot?.href).toBe("https://example.com/page");
    expect(snapshot?.width).toBe(1920);
    expect(snapshot?.height).toBe(1080);
    // data field should round-trip through Prisma JSON
    expect(snapshot?.data).toEqual({
      nodes: [{ type: "div", id: 1, children: ["hello"] }]
    });
  });

  test("does NOT create an EventSnapshot row when replay is absent", async () => {
    const projectId = await createProject();
    const result = await processEvent(projectId, basePayload());

    const snapshot = await prisma.eventSnapshot.findUnique({
      where: { eventId: result.eventId }
    });

    expect(snapshot).toBeNull();
  });

  test("snapshot is linked 1:1 to the event (second event in same issue has its own snapshot)", async () => {
    const projectId = await createProject();
    const first = await processEvent(projectId, payloadWithReplay());
    const second = await processEvent(projectId, payloadWithReplay());

    // second event should be grouped into same issue
    expect(second.issueId).toBe(first.issueId);
    expect(second.eventId).not.toBe(first.eventId);

    const firstSnap = await prisma.eventSnapshot.findUnique({
      where: { eventId: first.eventId }
    });
    const secondSnap = await prisma.eventSnapshot.findUnique({
      where: { eventId: second.eventId }
    });

    expect(firstSnap).not.toBeNull();
    expect(secondSnap).not.toBeNull();
    expect(firstSnap?.id).not.toBe(secondSnap?.id);
  });
});

// ── Route integration tests (buildApp) ───────────────────────────────────────

interface AuthSession {
  accessToken: string;
  userId: string;
}

let app: FastifyInstance;

beforeEach(async () => {
  app = buildApp({
    ingest: {
      enqueue: (data) => Promise.resolve(data.payload.eventId ?? "queued")
    }
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const registerViaApi = async (email: string): Promise<AuthSession> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", name: "Test" }
  });
  expect(response.statusCode).toBe(201);
  const body = tokenResponseSchema.parse(response.json<unknown>());
  return { accessToken: body.accessToken, userId: body.user.id };
};

const createProjectViaApi = async (
  session: AuthSession
): Promise<{ projectId: string; keyPublic: string }> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { authorization: `Bearer ${session.accessToken}` },
    payload: { name: "Snap Project", platform: "javascript-browser" }
  });
  expect(response.statusCode).toBe(201);
  const body = createProjectResponseSchema.parse(response.json<unknown>());
  return { projectId: body.project.id, keyPublic: body.key.publicKey };
};

describe("GET …/events/:eventId/snapshot — route", () => {
  test("returns stored snapshot data for an event that has one", async () => {
    const session = await registerViaApi("snap-read@example.com");
    const { projectId } = await createProjectViaApi(session);

    // Bypass the queue and persist directly so we have a real eventId
    const result = await processEvent(projectId, payloadWithReplay());

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues/${result.issueId}/events/${result.eventId}/snapshot`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });

    expect(response.statusCode).toBe(200);
    const body = eventSnapshotResponseSchema.parse(response.json<unknown>());
    expect(body.snapshot).not.toBeNull();
    expect(body.snapshot?.href).toBe("https://example.com/page");
    expect(body.snapshot?.width).toBe(1920);
    expect(body.snapshot?.height).toBe(1080);
    expect(body.snapshot?.data).toEqual({
      nodes: [{ type: "div", id: 1, children: ["hello"] }]
    });
  });

  test("returns { snapshot: null } for an event without a snapshot", async () => {
    const session = await registerViaApi("snap-null@example.com");
    const { projectId } = await createProjectViaApi(session);

    const result = await processEvent(projectId, basePayload());

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues/${result.issueId}/events/${result.eventId}/snapshot`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });

    expect(response.statusCode).toBe(200);
    const body = eventSnapshotResponseSchema.parse(response.json<unknown>());
    expect(body.snapshot).toBeNull();
  });

  test("hasSnapshot:true in events list for event with snapshot, false without", async () => {
    const session = await registerViaApi("snap-list@example.com");
    const { projectId } = await createProjectViaApi(session);

    // Two events: one with replay, one without (same issue due to same fingerprint/message)
    await processEvent(projectId, payloadWithReplay());
    await processEvent(projectId, basePayload());

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });
    expect(response.statusCode).toBe(200);
    const issueList = response.json<{ issues: { id: string }[] }>();
    const issueId = issueList.issues[0]?.id;
    if (issueId === undefined) throw new Error("expected an issue id");

    const eventsResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues/${issueId}/events`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });
    expect(eventsResponse.statusCode).toBe(200);
    const eventsBody = issueEventsResponseSchema.parse(eventsResponse.json<unknown>());

    // Events returned newest-first; first event has no replay (basePayload), second has replay
    const withSnapshot = eventsBody.events.find((e) => e.hasSnapshot);
    const withoutSnapshot = eventsBody.events.find((e) => !e.hasSnapshot);
    expect(withSnapshot).toBeDefined();
    expect(withoutSnapshot).toBeDefined();
  });
});
