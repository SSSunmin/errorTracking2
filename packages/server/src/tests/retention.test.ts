/**
 * Integration tests for retention / pruning (P0).
 *
 * Covers:
 *  - cutoff boundary: rows older than the cutoff are deleted, newer rows kept
 *  - days = 0 disables a target (no-op, NOT "delete everything")
 *  - differential retention across targets (replay/snapshot/event)
 *  - batch boundary: more rows than batchSize are fully drained across batches
 *  - orphan EventReplay (no FK to Event) is pruned independently of its Event
 *  - Event prune cascades remaining EventSnapshot rows (FK onDelete: Cascade)
 *
 * DB setup follows replay.test.ts (real prisma + TEST_DATABASE_URL,
 * TRUNCATE handled by setup.ts beforeEach).
 */

import { describe, expect, test } from "vitest";

import { prisma } from "../lib/prisma.js";
import {
  pruneRetention,
  type RetentionConfig
} from "../modules/retention/prune.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * MS_PER_DAY);

/** Config with every target disabled by default; override only what a test needs. */
const cfg = (over: Partial<RetentionConfig>): RetentionConfig => ({
  replayDays: 0,
  snapshotDays: 0,
  eventDays: 0,
  batchSize: 1_000,
  ...over
});

let seq = 0;

const seedProject = async (): Promise<{ projectId: string; issueId: string }> => {
  seq += 1;
  const id = String(seq);
  const user = await prisma.user.create({
    data: { email: `retention-${id}@example.com`, passwordHash: "x" }
  });
  const project = await prisma.project.create({
    data: { name: "Retention", slug: `retention-${id}`, ownerId: user.id }
  });
  const issue = await prisma.issue.create({
    data: {
      projectId: project.id,
      fingerprint: `fp-${id}`,
      title: "retention test issue",
      firstSeen: new Date(),
      lastSeen: new Date()
    }
  });
  return { projectId: project.id, issueId: issue.id };
};

const createEvent = (
  issueId: string,
  projectId: string,
  receivedAt: Date,
  clientEventId?: string
): Promise<{ id: string }> =>
  prisma.event.create({
    data: {
      issueId,
      projectId,
      level: "error",
      timestamp: receivedAt,
      receivedAt,
      ...(clientEventId !== undefined ? { clientEventId } : {})
    },
    select: { id: true }
  });

const createReplay = (
  clientEventId: string,
  projectId: string,
  createdAt: Date
): Promise<unknown> =>
  prisma.eventReplay.create({
    data: { clientEventId, projectId, data: Buffer.from([0x01, 0x02, 0x03]), createdAt }
  });

const createSnapshot = (
  eventId: string,
  projectId: string,
  createdAt: Date
): Promise<unknown> =>
  prisma.eventSnapshot.create({
    data: { eventId, projectId, data: {}, createdAt }
  });

// ── tests ───────────────────────────────────────────────────────────────────

describe("pruneRetention", () => {
  test("cutoff boundary: replay older than cutoff is deleted, newer is kept", async () => {
    const { projectId } = await seedProject();
    await createReplay("old-replay", projectId, daysAgo(20));
    await createReplay("new-replay", projectId, daysAgo(5));

    const result = await pruneRetention(cfg({ replayDays: 14 }));

    expect(result.replay).toBe(1);
    const remaining = await prisma.eventReplay.findMany({ select: { clientEventId: true } });
    expect(remaining.map((r) => r.clientEventId)).toEqual(["new-replay"]);
  });

  test("days = 0 disables the target: nothing is deleted", async () => {
    const { projectId } = await seedProject();
    await createReplay("ancient", projectId, daysAgo(100));

    const result = await pruneRetention(cfg({ replayDays: 0 }));

    expect(result.replay).toBe(0);
    expect(await prisma.eventReplay.count()).toBe(1);
  });

  test("differential retention: replay+snapshot pruned, event within eventDays survives", async () => {
    const { projectId, issueId } = await seedProject();
    const event = await createEvent(issueId, projectId, daysAgo(20), "evt-1");
    await createSnapshot(event.id, projectId, daysAgo(20));
    await createReplay("evt-1", projectId, daysAgo(20));

    const result = await pruneRetention(
      cfg({ replayDays: 14, snapshotDays: 14, eventDays: 90 })
    );

    expect(result.replay).toBe(1);
    expect(result.snapshot).toBe(1);
    expect(result.event).toBe(0);
    expect(await prisma.eventReplay.count()).toBe(0);
    expect(await prisma.eventSnapshot.count()).toBe(0);
    expect(await prisma.event.count()).toBe(1); // 20d < 90d → kept
  });

  test("batch boundary: drains more rows than batchSize across multiple batches", async () => {
    const { projectId } = await seedProject();
    for (let i = 0; i < 5; i += 1) {
      await createReplay(`r-${String(i)}`, projectId, daysAgo(30));
    }

    const result = await pruneRetention(cfg({ replayDays: 14, batchSize: 2 }));

    expect(result.replay).toBe(5);
    expect(await prisma.eventReplay.count()).toBe(0);
  });

  test("batch boundary: row count an exact multiple of batchSize still terminates", async () => {
    const { projectId } = await seedProject();
    // 4 rows / batchSize 2 → batches of 2, 2, then an empty terminal batch.
    for (let i = 0; i < 4; i += 1) {
      await createReplay(`m-${String(i)}`, projectId, daysAgo(30));
    }

    const result = await pruneRetention(cfg({ replayDays: 14, batchSize: 2 }));

    expect(result.replay).toBe(4);
    expect(await prisma.eventReplay.count()).toBe(0);
  });

  test("orphan replay is pruned independently while its matching Event survives", async () => {
    const { projectId, issueId } = await seedProject();
    // Event is recent; replay sharing the same clientEventId is old.
    await createEvent(issueId, projectId, daysAgo(1), "shared-id");
    await createReplay("shared-id", projectId, daysAgo(30));

    const result = await pruneRetention(cfg({ replayDays: 14, eventDays: 90 }));

    expect(result.replay).toBe(1);
    expect(result.event).toBe(0);
    expect(await prisma.eventReplay.count()).toBe(0); // pruned (no FK keeps it)
    expect(await prisma.event.count()).toBe(1); // untouched
  });

  test("Event prune cascades a remaining snapshot (FK onDelete: Cascade)", async () => {
    const { projectId, issueId } = await seedProject();
    const event = await createEvent(issueId, projectId, daysAgo(100));
    // Snapshot is recent, snapshot retention disabled → only the Event cascade removes it.
    await createSnapshot(event.id, projectId, daysAgo(1));

    const result = await pruneRetention(cfg({ snapshotDays: 0, eventDays: 90 }));

    expect(result.event).toBe(1);
    expect(result.snapshot).toBe(0); // not pruned directly…
    expect(await prisma.eventSnapshot.count()).toBe(0); // …removed via cascade
    expect(await prisma.event.count()).toBe(0);
  });
});
