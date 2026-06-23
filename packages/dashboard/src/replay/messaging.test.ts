import { describe, expect, test } from "vitest";

import {
  isAllowedOrigin,
  parseViewerInbound,
  parseViewerOutbound
} from "./messaging.js";

describe("isAllowedOrigin", () => {
  test("matches an exact non-empty origin", () => {
    expect(isAllowedOrigin("https://replay.example.com", "https://replay.example.com")).toBe(true);
  });

  test("rejects a mismatched origin", () => {
    expect(isAllowedOrigin("https://evil.example.com", "https://replay.example.com")).toBe(false);
  });

  test("fails closed when the allowlist is empty", () => {
    // An unconfigured origin must never match — including an empty event.origin.
    expect(isAllowedOrigin("https://replay.example.com", "")).toBe(false);
    expect(isAllowedOrigin("", "")).toBe(false);
  });

  test("rejects the sandboxed null origin", () => {
    expect(isAllowedOrigin("null", "https://replay.example.com")).toBe(false);
  });
});

describe("parseViewerInbound", () => {
  test("parses a snapshot message and coerces non-number sizes to null", () => {
    expect(
      parseViewerInbound({ kind: "snapshot", data: { n: 1 }, width: 1024, height: 768 })
    ).toEqual({ kind: "snapshot", data: { n: 1 }, width: 1024, height: 768 });

    expect(
      parseViewerInbound({ kind: "snapshot", data: null, width: undefined, height: "x" })
    ).toEqual({ kind: "snapshot", data: null, width: null, height: null });
  });

  test("parses a replay message with an events array", () => {
    const events = [{ type: 4, data: {}, timestamp: 1 }];
    expect(parseViewerInbound({ kind: "replay", events })).toEqual({
      kind: "replay",
      events
    });
  });

  test("rejects a replay message whose events is not an array", () => {
    expect(parseViewerInbound({ kind: "replay", events: "nope" })).toBeNull();
    expect(parseViewerInbound({ kind: "replay" })).toBeNull();
  });

  test("rejects unknown kinds and non-objects", () => {
    expect(parseViewerInbound({ kind: "command", command: "play" })).toBeNull();
    expect(parseViewerInbound({})).toBeNull();
    expect(parseViewerInbound(null)).toBeNull();
    expect(parseViewerInbound("snapshot")).toBeNull();
  });
});

describe("parseViewerOutbound", () => {
  test("parses ready", () => {
    expect(parseViewerOutbound({ kind: "ready" })).toEqual({ kind: "ready" });
  });

  test("parses resize with a numeric height", () => {
    expect(parseViewerOutbound({ kind: "resize", height: 420 })).toEqual({
      kind: "resize",
      height: 420
    });
  });

  test("rejects resize without a numeric height", () => {
    expect(parseViewerOutbound({ kind: "resize" })).toBeNull();
    expect(parseViewerOutbound({ kind: "resize", height: "420" })).toBeNull();
  });

  test("rejects unknown kinds and non-objects", () => {
    expect(parseViewerOutbound({ kind: "boom" })).toBeNull();
    expect(parseViewerOutbound(undefined)).toBeNull();
  });
});
