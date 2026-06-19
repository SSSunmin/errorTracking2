/**
 * Tests for the `replay` field on eventPayloadSchema (schemas.ts).
 *
 * Covers:
 *  - Happy path: valid replay with all fields accepted
 *  - Deep data (depth > 8) bypasses boundedJson limits and is accepted
 *  - Wide data (> 100 keys) bypasses boundedJson limits and is accepted
 *  - Replay whose `data` serialises to > 1 MB is rejected
 *  - Payload without `replay` is still valid (back-compat)
 *  - Replay missing optional fields (href/width/height) is accepted
 */

import { describe, expect, test } from "vitest";

import { eventPayloadSchema } from "../modules/events/schemas.js";

const basePayload = {
  timestamp: new Date().toISOString(),
  level: "error" as const,
  message: "test error"
};

// Build a nested object to a given depth, e.g. depth=9 → { c: { c: { … "leaf" } } }
const deepObject = (depth: number): unknown => {
  let value: unknown = "leaf";
  for (let i = 0; i < depth; i++) {
    value = { c: value };
  }
  return value;
};

// Build an object with `count` top-level keys
const wideObject = (count: number): Record<string, string> =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${String(i)}`, "v"]));

describe("eventPayloadSchema — replay field", () => {
  test("accepts a valid replay with all optional fields present", () => {
    const result = eventPayloadSchema.safeParse({
      ...basePayload,
      replay: {
        data: { nodes: [{ type: "div", id: 1 }] },
        href: "https://example.com/page",
        width: 1280,
        height: 720
      }
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.replay?.href).toBe("https://example.com/page");
      expect(result.data.replay?.width).toBe(1280);
      expect(result.data.replay?.height).toBe(720);
    }
  });

  test("accepts replay.data nested deeper than maxJsonDepth=8", () => {
    // depth 9 would fail isBoundedJsonValue but replay.data uses only byte-size check
    const result = eventPayloadSchema.safeParse({
      ...basePayload,
      replay: {
        data: deepObject(12) // 12 levels deep — clearly > 8
      }
    });
    expect(result.success).toBe(true);
  });

  test("accepts replay.data wider than maxObjectKeys=100", () => {
    const result = eventPayloadSchema.safeParse({
      ...basePayload,
      replay: {
        data: wideObject(150) // 150 keys — clearly > 100
      }
    });
    expect(result.success).toBe(true);
  });

  test("rejects replay whose data serialises to more than 1 MB", () => {
    // A string just over 1 MB (1_048_576 bytes) when JSON-stringified.
    // JSON.stringify of a plain string adds 2 quote chars, so we need > 1_048_574 chars.
    const bigData = "x".repeat(1_048_577);
    const result = eventPayloadSchema.safeParse({
      ...basePayload,
      replay: {
        data: bigData
      }
    });
    expect(result.success).toBe(false);
  });

  test("payload without replay is still valid (back-compat)", () => {
    const result = eventPayloadSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.replay).toBeUndefined();
    }
  });

  test("accepts replay with only data (href/width/height optional)", () => {
    const result = eventPayloadSchema.safeParse({
      ...basePayload,
      replay: {
        data: { snapshot: true }
      }
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.replay?.href).toBeUndefined();
      expect(result.data.replay?.width).toBeUndefined();
      expect(result.data.replay?.height).toBeUndefined();
    }
  });

  test("rejects replay with negative width or height", () => {
    const negativeWidth = eventPayloadSchema.safeParse({
      ...basePayload,
      replay: { data: {}, width: -1 }
    });
    expect(negativeWidth.success).toBe(false);

    const negativeHeight = eventPayloadSchema.safeParse({
      ...basePayload,
      replay: { data: {}, height: -5 }
    });
    expect(negativeHeight.success).toBe(false);
  });
});
