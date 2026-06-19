/**
 * Integration tests for the replay upload endpoint and replay-related read logic.
 *
 * Covers:
 *  POST /api/:projectId/replay
 *   - valid DSN key + eventId + octet-stream body → 202, EventReplay row stored
 *   - missing eventId → 400
 *   - missing/invalid key → 401
 *   - idempotent upsert: posting the same eventId twice → still 202, data updated
 *
 *  hasReplay flag in events list
 *   - after ingesting an event with an eventId AND uploading a replay with that
 *     same eventId → events list shows hasReplay:true for that event
 *   - event without a matching replay upload → hasReplay:false
 *
 *  GET …/events/:eventId/replay
 *   - returns 200 + stored bytes when a replay exists
 *   - returns 404 when no replay exists for that event
 *   - returns 404 when the event has no clientEventId
 *
 * DB setup follows snapshot.test.ts (real prisma + TEST_DATABASE_URL,
 * TRUNCATE handled by setup.ts beforeEach, buildApp helper).
 *
 * Note: the read route sets content-encoding: gzip and sends raw bytes.
 * Fastify's inject() does NOT automatically decompress gzip (it is a raw
 * HTTP-level simulation), so we assert on the raw Buffer payload and the
 * status/content-encoding headers rather than parsing JSON.
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { processEvent } from "../modules/events/process.js";
import { tokenResponseSchema } from "../modules/auth/schemas.js";
import { createProjectResponseSchema } from "../modules/projects/schemas.js";
import { issueEventsResponseSchema } from "../modules/issues/schemas.js";
import type { EventPayload } from "../modules/events/schemas.js";

// ── app lifecycle ─────────────────────────────────────────────────────────────

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

// ── helpers ───────────────────────────────────────────────────────────────────

interface AuthSession {
  accessToken: string;
  userId: string;
}

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
): Promise<{ projectId: string; keyPublic: string; keyId: string }> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { authorization: `Bearer ${session.accessToken}` },
    payload: { name: "Replay Project", platform: "javascript-browser" }
  });
  expect(response.statusCode).toBe(201);
  const body = createProjectResponseSchema.parse(response.json<unknown>());
  return {
    projectId: body.project.id,
    keyPublic: body.key.publicKey,
    keyId: body.key.id
  };
};

const uploadReplay = (
  projectId: string,
  key: string,
  eventId: string,
  body: Buffer
) =>
  app.inject({
    method: "POST",
    url: `/api/${projectId}/replay?eventId=${encodeURIComponent(eventId)}&key=${encodeURIComponent(key)}`,
    headers: { "content-type": "application/octet-stream" },
    payload: body
  });

// Arbitrary bytes — the server stores them opaque (no real gzip needed).
const fakeReplayBytes = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad, 0xbe, 0xef]);

// ── POST /api/:projectId/replay ───────────────────────────────────────────────

describe("POST /api/:projectId/replay", () => {
  test("valid key + eventId + octet-stream body → 202, EventReplay row stored", async () => {
    const session = await registerViaApi("replay-upload@example.com");
    const { projectId, keyPublic } = await createProjectViaApi(session);
    const clientEventId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    const response = await uploadReplay(projectId, keyPublic, clientEventId, fakeReplayBytes);

    expect(response.statusCode).toBe(202);
    expect(response.json<unknown>()).toEqual({ id: clientEventId });

    const row = await prisma.eventReplay.findUnique({
      where: { clientEventId },
      select: { clientEventId: true, projectId: true, data: true, sizeBytes: true }
    });
    expect(row).not.toBeNull();
    expect(row?.clientEventId).toBe(clientEventId);
    expect(row?.projectId).toBe(projectId);
    expect(row?.sizeBytes).toBe(fakeReplayBytes.length);
    // Round-trip: stored bytes match what we sent
    if (row === null) throw new Error("expected replay row");
    expect(Buffer.from(row.data)).toEqual(fakeReplayBytes);
  });

  test("missing eventId query param → 400", async () => {
    const session = await registerViaApi("replay-no-eventid@example.com");
    const { projectId, keyPublic } = await createProjectViaApi(session);

    const response = await app.inject({
      method: "POST",
      url: `/api/${projectId}/replay?key=${keyPublic}`,
      headers: { "content-type": "application/octet-stream" },
      payload: fakeReplayBytes
    });

    expect(response.statusCode).toBe(400);
  });

  test("missing key → 401", async () => {
    const session = await registerViaApi("replay-no-key@example.com");
    const { projectId } = await createProjectViaApi(session);
    const clientEventId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

    const response = await app.inject({
      method: "POST",
      url: `/api/${projectId}/replay?eventId=${clientEventId}`,
      headers: { "content-type": "application/octet-stream" },
      payload: fakeReplayBytes
    });

    expect(response.statusCode).toBe(401);
  });

  test("invalid (unknown) key → 401", async () => {
    const session = await registerViaApi("replay-bad-key@example.com");
    const { projectId } = await createProjectViaApi(session);
    const clientEventId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    const response = await app.inject({
      method: "POST",
      url: `/api/${projectId}/replay?eventId=${clientEventId}&key=not-a-real-key`,
      headers: { "content-type": "application/octet-stream" },
      payload: fakeReplayBytes
    });

    expect(response.statusCode).toBe(401);
  });

  test("idempotent: posting same eventId twice keeps most-recent data and returns 202", async () => {
    const session = await registerViaApi("replay-upsert@example.com");
    const { projectId, keyPublic } = await createProjectViaApi(session);
    const clientEventId = "11111111-1111-4111-8111-111111111111";

    const firstBytes = Buffer.from([0x01, 0x02, 0x03]);
    const secondBytes = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);

    const first = await uploadReplay(projectId, keyPublic, clientEventId, firstBytes);
    expect(first.statusCode).toBe(202);

    const second = await uploadReplay(projectId, keyPublic, clientEventId, secondBytes);
    expect(second.statusCode).toBe(202);

    const row = await prisma.eventReplay.findUnique({
      where: { clientEventId },
      select: { data: true, sizeBytes: true }
    });
    // Upsert should leave exactly one row with the updated bytes
    if (row === null) throw new Error("expected replay row");
    expect(Buffer.from(row.data)).toEqual(secondBytes);
    expect(row.sizeBytes).toBe(secondBytes.length);
  });

  test("optional count and durMs metadata is stored", async () => {
    const session = await registerViaApi("replay-meta@example.com");
    const { projectId, keyPublic } = await createProjectViaApi(session);
    const clientEventId = "22222222-2222-4222-8222-222222222222";

    const response = await app.inject({
      method: "POST",
      url: `/api/${projectId}/replay?eventId=${clientEventId}&key=${keyPublic}&count=42&durMs=15000`,
      headers: { "content-type": "application/octet-stream" },
      payload: fakeReplayBytes
    });
    expect(response.statusCode).toBe(202);

    const row = await prisma.eventReplay.findUnique({
      where: { clientEventId },
      select: { eventCount: true, durationMs: true }
    });
    expect(row?.eventCount).toBe(42);
    expect(row?.durationMs).toBe(15000);
  });
});

// ── hasReplay in events list ──────────────────────────────────────────────────

describe("hasReplay flag in events list", () => {
  const eventWithClientId = (clientEventId: string): EventPayload => ({
    timestamp: new Date().toISOString(),
    level: "error",
    message: "replay-flag test error",
    eventId: clientEventId
  });

  const eventWithoutClientId = (): EventPayload => ({
    timestamp: new Date().toISOString(),
    level: "error",
    message: "replay-flag test error"
  });

  test("event with matching replay upload shows hasReplay:true; event without shows hasReplay:false", async () => {
    const session = await registerViaApi("hasreplay-flag@example.com");
    const { projectId, keyPublic } = await createProjectViaApi(session);
    const clientEventId = "33333333-3333-4333-8333-333333333333";

    // Ingest two events into the same issue (same fingerprint via same message):
    // first has a clientEventId; second does not.
    await processEvent(projectId, eventWithClientId(clientEventId));
    await processEvent(projectId, eventWithoutClientId());

    // Upload a replay for the first event's clientEventId
    const upload = await uploadReplay(projectId, keyPublic, clientEventId, fakeReplayBytes);
    expect(upload.statusCode).toBe(202);

    // Get the issue id
    const issuesResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });
    expect(issuesResponse.statusCode).toBe(200);
    const issueList = issuesResponse.json<{ issues: { id: string }[] }>();
    const issueId = issueList.issues[0]?.id;
    if (!issueId) throw new Error("expected an issue");

    // Fetch events for the issue
    const eventsResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues/${issueId}/events`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });
    expect(eventsResponse.statusCode).toBe(200);
    const eventsBody = issueEventsResponseSchema.parse(eventsResponse.json<unknown>());

    const withReplay = eventsBody.events.find((e) => e.hasReplay);
    const withoutReplay = eventsBody.events.find((e) => !e.hasReplay);
    expect(withReplay).toBeDefined();
    expect(withoutReplay).toBeDefined();
  });

  test("no replay uploaded → all events show hasReplay:false", async () => {
    const session = await registerViaApi("hasreplay-none@example.com");
    const { projectId } = await createProjectViaApi(session);
    const clientEventId = "44444444-4444-4444-8444-444444444444";

    await processEvent(projectId, eventWithClientId(clientEventId));

    const issuesResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });
    const issueId = issuesResponse.json<{ issues: { id: string }[] }>().issues[0]?.id;
    if (!issueId) throw new Error("expected an issue");

    const eventsResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues/${issueId}/events`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });
    const eventsBody = issueEventsResponseSchema.parse(eventsResponse.json<unknown>());
    expect(eventsBody.events.every((e) => !e.hasReplay)).toBe(true);
  });
});

// ── GET …/events/:eventId/replay ─────────────────────────────────────────────

describe("GET …/events/:eventId/replay", () => {
  const makePayloadWithId = (clientEventId: string): EventPayload => ({
    timestamp: new Date().toISOString(),
    level: "error",
    message: "replay read test error",
    eventId: clientEventId
  });

  const makePayloadNoId = (): EventPayload => ({
    timestamp: new Date().toISOString(),
    level: "error",
    message: "replay read no-id error"
  });

  test("stored replay bytes are returned with 200 and content-encoding gzip", async () => {
    const session = await registerViaApi("replay-read@example.com");
    const { projectId, keyPublic } = await createProjectViaApi(session);
    const clientEventId = "55555555-5555-4555-8555-555555555555";

    const result = await processEvent(projectId, makePayloadWithId(clientEventId));

    const upload = await uploadReplay(projectId, keyPublic, clientEventId, fakeReplayBytes);
    expect(upload.statusCode).toBe(202);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues/${result.issueId}/events/${result.eventId}/replay`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    // The inject() layer does NOT auto-decompress; assert raw body bytes match
    expect(Buffer.from(response.rawPayload)).toEqual(fakeReplayBytes);
  });

  test("no replay uploaded → GET replay returns 404", async () => {
    const session = await registerViaApi("replay-missing@example.com");
    const { projectId } = await createProjectViaApi(session);
    const clientEventId = "66666666-6666-4666-8666-666666666666";

    const result = await processEvent(projectId, makePayloadWithId(clientEventId));

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues/${result.issueId}/events/${result.eventId}/replay`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });

    expect(response.statusCode).toBe(404);
  });

  test("event has no clientEventId → GET replay returns 404", async () => {
    const session = await registerViaApi("replay-noclientid@example.com");
    const { projectId } = await createProjectViaApi(session);

    const result = await processEvent(projectId, makePayloadNoId());

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/issues/${result.issueId}/events/${result.eventId}/replay`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });

    expect(response.statusCode).toBe(404);
  });
});
