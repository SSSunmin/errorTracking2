import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";

/**
 * Retention / pruning (P0).
 *
 * Deletes rows older than per-target cutoffs in bounded batches, so a single
 * run never holds a long transaction or a table-wide lock on the large
 * BYTEA/JSONB tables (EventReplay / EventSnapshot). Each batch is its own
 * implicit transaction; a partial run is safe and simply resumes next tick.
 *
 * Deletion order matters:
 *   1. EventReplay   — NO foreign key to Event (linked only by clientEventId),
 *                      so it must be pruned independently or it leaks forever.
 *   2. EventSnapshot — pruned on its own createdAt so a shorter snapshot
 *                      retention is honored even while the parent Event lives.
 *   3. Event         — its receivedAt cutoff; remaining snapshots cascade
 *                      (EventSnapshot.event onDelete: Cascade).
 *
 * A `days` value of 0 disables that target (it is NOT "delete everything").
 */

/** Pause between batches to spread DB load; skipped when a target finishes. */
const BATCH_DELAY_MS = 50;
const MS_PER_DAY = 86_400_000;

export interface RetentionConfig {
  /** Replay retention in days; 0 disables. */
  replayDays: number;
  /** Snapshot retention in days; 0 disables. */
  snapshotDays: number;
  /** Event retention in days; 0 disables. */
  eventDays: number;
  /** Max rows deleted per batch. */
  batchSize: number;
}

export interface PruneResult {
  replay: number;
  snapshot: number;
  event: number;
  durationMs: number;
}

/** Tables this module is allowed to prune (no user input ever reaches SQL). */
type PrunableTable = "EventReplay" | "EventSnapshot" | "Event";

export const buildRetentionConfig = (): RetentionConfig => ({
  replayDays: env.RETENTION_REPLAY_DAYS,
  snapshotDays: env.RETENTION_SNAPSHOT_DAYS,
  eventDays: env.RETENTION_EVENT_DAYS,
  batchSize: env.RETENTION_BATCH_SIZE
});

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Delete rows of `table` whose `timeColumn` predates `cutoff`, in batches of
 * `batchSize`, until a batch deletes fewer rows than the batch size.
 *
 * `table` and `timeColumn` are compile-time constants from this module — never
 * request-derived — so the inlined identifiers are not an injection surface.
 */
const pruneTable = async (
  table: PrunableTable,
  timeColumn: "createdAt" | "receivedAt",
  cutoff: Date,
  batchSize: number
): Promise<number> => {
  let total = 0;

  for (;;) {
    const deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE "id" IN (` +
        `SELECT "id" FROM "${table}" WHERE "${timeColumn}" < $1 ` +
        `ORDER BY "${timeColumn}" ASC LIMIT $2)`,
      cutoff,
      batchSize
    );
    total += deleted;

    // A short batch means the table is drained. When the final batch is exactly
    // `batchSize`, one extra (empty) query runs next iteration to confirm — a
    // negligible, intentional cost that keeps the termination check simple.
    if (deleted < batchSize) {
      break;
    }

    await delay(BATCH_DELAY_MS);
  }

  return total;
};

const cutoffFor = (days: number): Date => new Date(Date.now() - days * MS_PER_DAY);

/**
 * Run one retention pass. Targets with `days <= 0` are skipped entirely.
 * Returns per-target deleted counts and the elapsed time.
 */
export const pruneRetention = async (
  config: RetentionConfig = buildRetentionConfig()
): Promise<PruneResult> => {
  const startedAt = Date.now();
  const result: PruneResult = { replay: 0, snapshot: 0, event: 0, durationMs: 0 };

  if (config.replayDays > 0) {
    result.replay = await pruneTable(
      "EventReplay",
      "createdAt",
      cutoffFor(config.replayDays),
      config.batchSize
    );
  }

  if (config.snapshotDays > 0) {
    result.snapshot = await pruneTable(
      "EventSnapshot",
      "createdAt",
      cutoffFor(config.snapshotDays),
      config.batchSize
    );
  }

  if (config.eventDays > 0) {
    result.event = await pruneTable(
      "Event",
      "receivedAt",
      cutoffFor(config.eventDays),
      config.batchSize
    );
  }

  result.durationMs = Date.now() - startedAt;
  return result;
};
