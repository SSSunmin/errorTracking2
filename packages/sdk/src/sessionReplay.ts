import { EventType, record, type eventWithTime } from "rrweb";

/** Rolling-buffer window: keep roughly the last 30 seconds of activity. */
const REPLAY_WINDOW_MS = 30_000;
/** Force a fresh full snapshot at least this often so the buffer can always be
 *  trimmed back to a valid (snapshot-anchored) starting point. */
const CHECKOUT_EVERY_MS = 15_000;

export interface SessionReplayHandle {
  /** A copy of the current rolling buffer (always snapshot-anchored). */
  snapshot(): eventWithTime[];
  /** Stop recording and release the rrweb listener. */
  stop(): void;
}

const isFullSnapshotEvent = (event: eventWithTime): boolean =>
  event.type === EventType.FullSnapshot;

/**
 * Pure, unit-testable trim. Drops events older than `nowMs - windowMs`, but
 * never trims past the most recent full-snapshot boundary at or before the
 * cutoff — a replay must always begin with a full snapshot to rebuild the DOM.
 *
 * Strategy: find the latest full snapshot whose timestamp is <= the cutoff; keep
 * from there onward. If no snapshot is old enough (the only snapshot is newer
 * than the cutoff), keep from the earliest full snapshot so the buffer stays
 * playable. If there is no full snapshot at all, return the events unchanged.
 */
export const trimReplayBuffer = (
  events: eventWithTime[],
  nowMs: number,
  windowMs: number,
  isFullSnapshot: (event: eventWithTime) => boolean
): eventWithTime[] => {
  const cutoff = nowMs - windowMs;

  let anchorIndex = -1;
  let firstSnapshotIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined || !isFullSnapshot(event)) {
      continue;
    }
    if (firstSnapshotIndex === -1) {
      firstSnapshotIndex = index;
    }
    if (event.timestamp <= cutoff) {
      anchorIndex = index;
    }
  }

  // No full snapshot at or before the cutoff: fall back to the earliest one so
  // playback still starts from a valid snapshot (or keep all if none exist).
  const startIndex = anchorIndex !== -1 ? anchorIndex : firstSnapshotIndex;
  if (startIndex <= 0) {
    return events;
  }

  return events.slice(startIndex);
};

/**
 * Start a rolling rrweb recorder. Browser-guarded (no-op if `document` is
 * undefined) and fully try/catch wrapped: telemetry must never throw into the
 * host app, so any failure yields an inert handle whose `snapshot()` returns []
 * and whose `stop()` is a no-op.
 */
export const startSessionReplay = (
  options: { maskAllInputs?: boolean } = {}
): SessionReplayHandle => {
  const inert: SessionReplayHandle = {
    snapshot: () => [],
    stop: () => {
      /* nothing to tear down */
    }
  };

  if (typeof document === "undefined") {
    return inert;
  }

  try {
    let events: eventWithTime[] = [];

    const stopFn = record({
      emit(event) {
        try {
          events.push(event);
          events = trimReplayBuffer(
            events,
            Date.now(),
            REPLAY_WINDOW_MS,
            isFullSnapshotEvent
          );
        } catch {
          /* never let buffer maintenance throw into rrweb's emit */
        }
      },
      checkoutEveryNms: CHECKOUT_EVERY_MS,
      maskAllInputs: options.maskAllInputs ?? true,
      recordCanvas: false
    });

    return {
      snapshot: () => events.slice(),
      stop: () => {
        try {
          stopFn?.();
        } catch {
          /* swallow teardown errors */
        }
      }
    };
  } catch {
    return inert;
  }
};
