import { describe, expect, test } from "vitest";

import { buildFingerprint } from "../modules/events/fingerprint.js";
import type { EventPayload } from "../modules/events/schemas.js";

const basePayload = {
  timestamp: "2026-06-16T00:00:00.000Z",
  level: "error"
} satisfies Pick<EventPayload, "timestamp" | "level">;

describe("fingerprint", () => {
  test("same exception shape produces the same fingerprint", () => {
    const payload = {
      ...basePayload,
      exception: {
        type: "TypeError",
        value: "Cannot read properties",
        stacktrace: {
          frames: [
            {
              function: "render",
              filename: "app.js",
              in_app: true
            }
          ]
        }
      }
    } satisfies EventPayload;

    expect(buildFingerprint(payload)).toBe(buildFingerprint(payload));
  });

  test("different exception frames produce different fingerprints", () => {
    const first = {
      ...basePayload,
      exception: {
        type: "TypeError",
        stacktrace: {
          frames: [{ function: "render", filename: "app.js" }]
        }
      }
    } satisfies EventPayload;

    const second = {
      ...basePayload,
      exception: {
        type: "TypeError",
        stacktrace: {
          frames: [{ function: "submit", filename: "form.js" }]
        }
      }
    } satisfies EventPayload;

    expect(buildFingerprint(first)).not.toBe(buildFingerprint(second));
  });

  test("same message produces same fingerprint and different message differs", () => {
    const first = {
      ...basePayload,
      message: "Network failed"
    } satisfies EventPayload;
    const second = {
      ...basePayload,
      message: "Network failed"
    } satisfies EventPayload;
    const third = {
      ...basePayload,
      message: "Render failed"
    } satisfies EventPayload;

    expect(buildFingerprint(first)).toBe(buildFingerprint(second));
    expect(buildFingerprint(first)).not.toBe(buildFingerprint(third));
  });
});
