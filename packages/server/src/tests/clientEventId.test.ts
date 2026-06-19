/**
 * Tests for clientEventId persistence in processEvent (process.ts).
 *
 * Covers:
 *  - payload with eventId → Event row has clientEventId set to it
 *  - payload without eventId → Event row has clientEventId null
 *
 * DB setup mirrors processEvent.test.ts (real prisma + TEST_DATABASE_URL,
 * TRUNCATE handled by setup.ts beforeEach).
 */
import { describe, expect, test } from "vitest";

import { prisma } from "../lib/prisma.js";
import { processEvent } from "../modules/events/process.js";
import type { EventPayload } from "../modules/events/schemas.js";

const createProject = async (): Promise<string> => {
  const user = await prisma.user.create({
    data: { email: "clienteventid-test@example.com", passwordHash: "x" }
  });
  const project = await prisma.project.create({
    data: { name: "ClientEventId", slug: "client-event-id-proj", ownerId: user.id }
  });
  return project.id;
};

const basePayload = (): Omit<EventPayload, "eventId"> => ({
  timestamp: new Date().toISOString(),
  level: "error",
  message: "clientEventId test error"
});

describe("processEvent — clientEventId persistence", () => {
  test("payload with eventId → Event row has clientEventId set", async () => {
    const projectId = await createProject();
    const clientEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    const result = await processEvent(projectId, {
      ...basePayload(),
      eventId: clientEventId
    });

    const event = await prisma.event.findUniqueOrThrow({
      where: { id: result.eventId },
      select: { clientEventId: true }
    });

    expect(event.clientEventId).toBe(clientEventId);
  });

  test("payload without eventId → Event row has clientEventId null", async () => {
    const projectId = await createProject();

    const result = await processEvent(projectId, basePayload());

    const event = await prisma.event.findUniqueOrThrow({
      where: { id: result.eventId },
      select: { clientEventId: true }
    });

    expect(event.clientEventId).toBeNull();
  });

  test("two events in the same issue each store their own clientEventId", async () => {
    const projectId = await createProject();
    const id1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const id2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    const first = await processEvent(projectId, {
      ...basePayload(),
      eventId: id1
    });
    const second = await processEvent(projectId, {
      ...basePayload(),
      eventId: id2
    });

    // Same issue (same fingerprint)
    expect(second.issueId).toBe(first.issueId);
    expect(second.eventId).not.toBe(first.eventId);

    const e1 = await prisma.event.findUniqueOrThrow({
      where: { id: first.eventId },
      select: { clientEventId: true }
    });
    const e2 = await prisma.event.findUniqueOrThrow({
      where: { id: second.eventId },
      select: { clientEventId: true }
    });

    expect(e1.clientEventId).toBe(id1);
    expect(e2.clientEventId).toBe(id2);
  });
});
