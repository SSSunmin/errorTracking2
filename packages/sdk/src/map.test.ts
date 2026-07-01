import { describe, expect, test, vi } from "vitest";

import { wireMapErrors, type ErrorEmittingMap, type MapErrorEvent } from "./map.js";

// Minimal fake that records the wired listener so tests can fire events at it.
const fakeMap = (): ErrorEmittingMap & { fire: (event: MapErrorEvent) => void } => {
  let listener: ((event: MapErrorEvent) => void) | null = null;
  return {
    on: (_type, fn) => {
      listener = fn;
    },
    off: (_type, fn) => {
      if (listener === fn) {
        listener = null;
      }
    },
    fire: (event) => {
      listener?.(event);
    }
  };
};

describe("wireMapErrors", () => {
  test("forwards the event's Error to capture", () => {
    const map = fakeMap();
    const capture = vi.fn<(error: unknown) => void>();
    wireMapErrors(map, capture);

    const error = new Error("AJAXError: Failed to fetch tile");
    map.fire({ error });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(error);
  });

  test("synthesizes an Error when the event has no error object", () => {
    const map = fakeMap();
    const capture = vi.fn<(error: unknown) => void>();
    wireMapErrors(map, capture);

    map.fire({});

    expect(capture).toHaveBeenCalledTimes(1);
    const captured = capture.mock.calls[0]?.[0];
    expect(captured).toBeInstanceOf(Error);
  });

  test("rate-limits to maxPerWindow within a window, then resets", () => {
    const map = fakeMap();
    const capture = vi.fn<(error: unknown) => void>();
    let clock = 1_000;
    wireMapErrors(map, capture, {
      maxPerWindow: 2,
      windowMs: 10_000,
      now: () => clock
    });

    // Three failures in the same window: only the first two are forwarded.
    map.fire({ error: new Error("tile 1") });
    map.fire({ error: new Error("tile 2") });
    map.fire({ error: new Error("tile 3") });
    expect(capture).toHaveBeenCalledTimes(2);

    // Just under the window (9_999 < 10_000): still capped, no reset.
    clock = 1_000 + 9_999;
    map.fire({ error: new Error("tile 4") });
    expect(capture).toHaveBeenCalledTimes(2);

    // At the window boundary the counter resets and forwarding resumes.
    clock = 1_000 + 10_000;
    map.fire({ error: new Error("tile 5") });
    expect(capture).toHaveBeenCalledTimes(3);
  });

  test("swallows exceptions thrown by capture (never propagates to the map)", () => {
    const map = fakeMap();
    const capture = vi.fn<(error: unknown) => void>(() => {
      throw new Error("capture exploded");
    });
    wireMapErrors(map, capture);

    // The map library's event dispatcher (fakeMap.fire) must not see the throw,
    // or an uncaught error would break the host's map.
    expect(() => {
      map.fire({ error: new Error("tile") });
    }).not.toThrow();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  test("maxPerWindow <= 0 forwards every error", () => {
    const map = fakeMap();
    const capture = vi.fn<(error: unknown) => void>();
    wireMapErrors(map, capture, { maxPerWindow: 0 });

    for (let i = 0; i < 50; i += 1) {
      map.fire({ error: new Error(`tile ${String(i)}`) });
    }

    expect(capture).toHaveBeenCalledTimes(50);
  });

  test("the returned unsubscribe stops further captures", () => {
    const map = fakeMap();
    const capture = vi.fn<(error: unknown) => void>();
    const unsubscribe = wireMapErrors(map, capture);

    map.fire({ error: new Error("before") });
    unsubscribe();
    map.fire({ error: new Error("after") });

    expect(capture).toHaveBeenCalledTimes(1);
  });
});
