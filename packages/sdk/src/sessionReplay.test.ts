/**
 * Unit tests for the pure `trimReplayBuffer` helper (sessionReplay.ts).
 *
 * EventType.FullSnapshot === 2 (from rrweb).
 *
 * Cases covered:
 *  - All events within the window → buffer unchanged
 *  - Events before the window but after the last full snapshot → kept (snapshot anchor)
 *  - A newer full snapshot exists inside the window → events before it (outside window) are dropped
 *  - Empty buffer → returns empty
 *  - No full snapshot present → returns events unchanged (per implementation)
 *  - anchorIndex === 0 → startIndex 0 → no slice (startIndex <= 0 guard)
 *  - startIndex > 0 with exactly the anchor as start
 */
import { describe, expect, test } from "vitest";
import { EventType } from "rrweb";
import type { eventWithTime } from "rrweb";

import { trimReplayBuffer } from "./sessionReplay.js";

// rrweb EventType.FullSnapshot === 2
const FULL_SNAPSHOT = EventType.FullSnapshot; // 2

const makeEvent = (
  timestamp: number,
  type: number = EventType.Meta // 4, a non-snapshot type
): eventWithTime =>
  ({
    type,
    timestamp,
    // data field not needed for trimReplayBuffer logic
    data: {}
  }) as unknown as eventWithTime;

const makeFullSnapshot = (timestamp: number): eventWithTime =>
  makeEvent(timestamp, FULL_SNAPSHOT);

// The real isFullSnapshot predicate (same as production code)
const isFullSnapshot = (event: eventWithTime): boolean =>
  event.type === FULL_SNAPSHOT;

describe("trimReplayBuffer", () => {
  test("empty buffer returns empty array", () => {
    const result = trimReplayBuffer([], 10_000, 30_000, isFullSnapshot);
    expect(result).toEqual([]);
  });

  test("all events within the window → buffer returned unchanged", () => {
    const now = 100_000;
    const windowMs = 30_000;
    // All timestamps within [now - windowMs, now]
    const events = [
      makeFullSnapshot(80_000),
      makeEvent(85_000),
      makeEvent(95_000)
    ];
    const result = trimReplayBuffer(events, now, windowMs, isFullSnapshot);
    expect(result).toHaveLength(3);
    expect(result).toBe(events); // same reference — startIndex <= 0 path
  });

  test("no full snapshot present → returns events unchanged", () => {
    const now = 100_000;
    const windowMs = 30_000;
    // Cutoff = 70_000; events before it but no full snapshot exists
    const events = [
      makeEvent(50_000),
      makeEvent(60_000),
      makeEvent(95_000)
    ];
    const result = trimReplayBuffer(events, now, windowMs, isFullSnapshot);
    // Per implementation: anchorIndex stays -1, firstSnapshotIndex stays -1 →
    // startIndex = -1, startIndex <= 0 → return events unchanged
    expect(result).toHaveLength(3);
    expect(result).toBe(events);
  });

  test("old events before window but only snapshot is before the window → snapshot anchor keeps them all", () => {
    const now = 100_000;
    const windowMs = 30_000;
    // cutoff = 70_000
    // Full snapshot at 40_000 (before cutoff) → anchorIndex = 0
    // startIndex = 0 → startIndex <= 0 guard → return unchanged
    const events = [
      makeFullSnapshot(40_000), // index 0, timestamp <= cutoff → anchorIndex = 0
      makeEvent(50_000),
      makeEvent(95_000)
    ];
    const result = trimReplayBuffer(events, now, windowMs, isFullSnapshot);
    // anchorIndex = 0 → startIndex = 0 → guard (startIndex <= 0) → return all
    expect(result).toHaveLength(3);
    expect(result).toBe(events);
  });

  test("snapshot anchor at index > 0: events before anchor are dropped", () => {
    const now = 100_000;
    const windowMs = 30_000;
    // cutoff = 70_000
    // First full snapshot at 30_000 (before cutoff) → firstSnapshotIndex = 0, anchorIndex = 0
    // Second full snapshot at 65_000 (before cutoff) → anchorIndex = 1
    // startIndex = 1 (> 0) → slice from 1
    const events = [
      makeFullSnapshot(30_000), // index 0
      makeFullSnapshot(65_000), // index 1, latest snapshot <= cutoff → anchorIndex = 1
      makeEvent(75_000),        // index 2, inside window
      makeEvent(95_000)         // index 3
    ];
    const result = trimReplayBuffer(events, now, windowMs, isFullSnapshot);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(events[1]); // starts at the newer snapshot anchor
    expect(result[1]).toBe(events[2]);
    expect(result[2]).toBe(events[3]);
  });

  test("newer full snapshot inside window: events before it (outside window) are dropped", () => {
    const now = 100_000;
    const windowMs = 30_000;
    // cutoff = 70_000
    // Old snapshot at 20_000 (before cutoff) → candidate for anchorIndex
    // Newer snapshot at 80_000 (inside window, AFTER cutoff) → does NOT update anchorIndex
    // anchorIndex ends at 0 (index of 20_000 snapshot), but then a second loop step:
    //   snapshot at 80_000: timestamp 80_000 > cutoff 70_000 → NOT <= cutoff → skip
    // So anchorIndex = 0 → startIndex = 0 → startIndex <= 0 → return unchanged
    //
    // To get the "newer snapshot causes trim" we need the anchor to be at index > 0,
    // meaning the latest snapshot <= cutoff must be at index > 0.
    // Setup: stale events, snapshot at index 2 (before cutoff), newer snapshot inside window
    const events = [
      makeEvent(10_000),        // index 0, stale non-snapshot
      makeEvent(15_000),        // index 1, stale non-snapshot
      makeFullSnapshot(60_000), // index 2, before cutoff → anchorIndex = 2
      makeEvent(72_000),        // index 3, inside window
      makeFullSnapshot(85_000), // index 4, inside window (after cutoff, doesn't affect anchorIndex)
      makeEvent(95_000)         // index 5
    ];
    const result = trimReplayBuffer(events, now, windowMs, isFullSnapshot);
    // anchorIndex = 2 → startIndex = 2 → slice(2) → drop indices 0 and 1
    expect(result).toHaveLength(4);
    expect(result[0]).toBe(events[2]); // the 60_000 full snapshot is the anchor
    expect(result[1]).toBe(events[3]);
    expect(result[2]).toBe(events[4]);
    expect(result[3]).toBe(events[5]);
  });

  test("only snapshot is newer than cutoff → fall back to earliest snapshot (firstSnapshotIndex)", () => {
    const now = 100_000;
    const windowMs = 30_000;
    // cutoff = 70_000
    // Only snapshot is at 80_000 (after cutoff) → anchorIndex stays -1
    // firstSnapshotIndex = 1 → startIndex = 1 (> 0) → slice from 1
    const events = [
      makeEvent(50_000),        // index 0, stale, no snapshot
      makeFullSnapshot(80_000), // index 1, after cutoff → firstSnapshotIndex = 1, anchorIndex stays -1
      makeEvent(90_000),        // index 2
      makeEvent(95_000)         // index 3
    ];
    const result = trimReplayBuffer(events, now, windowMs, isFullSnapshot);
    // startIndex = firstSnapshotIndex = 1 → slice(1) → drop index 0
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(events[1]);
    expect(result[1]).toBe(events[2]);
    expect(result[2]).toBe(events[3]);
  });

  test("single event that is a full snapshot within the window → unchanged", () => {
    const now = 100_000;
    const events = [makeFullSnapshot(90_000)];
    const result = trimReplayBuffer(events, now, 30_000, isFullSnapshot);
    expect(result).toHaveLength(1);
    expect(result).toBe(events);
  });

  test("custom isFullSnapshot predicate is respected", () => {
    // Use a predicate that treats type=99 as a full snapshot
    const customIsFullSnapshot = (e: eventWithTime): boolean =>
      (e.type as number) === 99;
    const now = 100_000;
    const windowMs = 30_000;
    const events = [
      makeEvent(10_000, 1),  // index 0, stale
      makeEvent(20_000, 99), // index 1, "full snapshot" per custom predicate, before cutoff
      makeEvent(30_000, 99), // index 2, "full snapshot", before cutoff → anchorIndex = 2
      makeEvent(80_000, 1),  // index 3, inside window
      makeEvent(95_000, 1)   // index 4
    ];
    const result = trimReplayBuffer(events, now, windowMs, customIsFullSnapshot);
    // anchorIndex = 2 → slice from 2
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(events[2]);
  });
});
