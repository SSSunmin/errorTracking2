// MapLibre GL and Mapbox GL surface tile / style / source failures through their
// own `map.on('error')` event. Those errors are NOT thrown and never reach
// window.onerror or unhandledrejection, so the SDK's global handlers miss them
// entirely. (Verified empirically against MapLibre: broken tiles and broken
// styles fire ONLY map.on('error'); only genuinely thrown exceptions inside map
// callbacks reach window.) Wire this up once per map to forward them.

/** The `error` event object emitted by MapLibre GL / Mapbox GL. */
export interface MapErrorEvent {
  error?: Error;
  sourceId?: string;
}

/** Structural type satisfied by both maplibre-gl and mapbox-gl `Map` instances. */
export interface ErrorEmittingMap {
  on(type: "error", listener: (event: MapErrorEvent) => void): unknown;
  off(type: "error", listener: (event: MapErrorEvent) => void): unknown;
}

export interface MapErrorCaptureOptions {
  /**
   * Cap on how many map errors are forwarded per rolling `windowMs`. A single
   * broken tile source fires one error per failed tile — dozens on load, more
   * while panning — so forwarding every one would flood your own ingest. Excess
   * errors within a window are dropped. Set to 0 (or negative) to forward all.
   * Default 20.
   */
  maxPerWindow?: number;
  /** Window length in ms for `maxPerWindow`. Default 10000. */
  windowMs?: number;
  /** Clock injection point for tests. Default `Date.now`. */
  now?: () => number;
}

/**
 * Forward a map's `error` events to `capture`. Returns an unsubscribe function.
 * Pure (no SDK imports) so it can be unit-tested with a fake map and clock;
 * `captureMapErrors` in the public API binds it to the active client.
 *
 * ponytail: the rate cap is a fixed (tumbling) window, not a sliding one — a
 * burst straddling a boundary can pass up to ~2×maxPerWindow. That's fine for
 * flood protection; upgrade to a sliding window only if precise limiting is ever
 * required.
 */
export const wireMapErrors = (
  map: ErrorEmittingMap,
  capture: (error: unknown) => void,
  options: MapErrorCaptureOptions = {}
): (() => void) => {
  const maxPerWindow = options.maxPerWindow ?? 20;
  const windowMs = options.windowMs ?? 10_000;
  const now = options.now ?? Date.now;

  let windowStart = now();
  let countInWindow = 0;

  const listener = (event: MapErrorEvent): void => {
    // A telemetry hook must never throw back into the map library's event
    // dispatcher — that could break the host's map. Mirror the defensive
    // swallow the rest of the SDK uses (e.g. Client.captureException's timer).
    try {
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(
              event.sourceId !== undefined
                ? `Map error event without an error object (sourceId: ${event.sourceId})`
                : "Map error event without an error object"
            );

      if (maxPerWindow > 0) {
        const at = now();
        if (at - windowStart >= windowMs) {
          windowStart = at;
          countInWindow = 0;
        }
        if (countInWindow >= maxPerWindow) {
          return;
        }
        countInWindow += 1;
      }

      capture(error);
    } catch {
      /* swallow — telemetry must never propagate into the map library */
    }
  };

  map.on("error", listener);
  return () => {
    map.off("error", listener);
  };
};
