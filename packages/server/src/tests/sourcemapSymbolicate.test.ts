/**
 * Unit tests for the source-map symbolication core (no DB).
 *
 * Covers:
 *  frameBasename
 *   - strips query/hash and directory prefix from a URL
 *   - returns null for undefined/empty/trailing-slash inputs
 *
 *  symbolicateFrames
 *   - maps a frame to its original location (file/line/col/function/context)
 *   - leaves frames unchanged when: no maps, no basename match, lineno missing,
 *     or the map JSON is corrupt
 *   - works without sourcesContent (no contextLine, but original* still set)
 *   - sets changed=false when nothing was symbolicated
 *
 * The source maps below are hand-built but real: a single "AAAAA" segment is the
 * VLQ encoding of [0,0,0,0,0] — generated (line1,col0) → source[0] (line1,col0)
 * with names[0] — so originalPositionFor resolves deterministically.
 */

import { describe, expect, test } from "vitest";

import {
  frameBasename,
  symbolicateFrames,
  type RawFrame
} from "../modules/sourcemaps/symbolicate.js";

interface MapOptions {
  withName?: boolean;
  withContent?: boolean;
}

// Build a minimal v3 source map whose only mapping sends generated (1,0) to the
// first line of the original source.
const makeSourceMap = (options: MapOptions = {}): string => {
  const { withName = true, withContent = true } = options;
  const map: Record<string, unknown> = {
    version: 3,
    file: "app.js",
    sources: ["src/app.ts"],
    names: withName ? ["handleClick"] : [],
    // 5 fields when a name is present ("AAAAA"), 4 otherwise ("AAAA").
    mappings: withName ? "AAAAA" : "AAAA"
  };
  if (withContent) {
    map.sourcesContent = ["function handleClick() {\n  doThing();\n}\n"];
  }
  return JSON.stringify(map);
};

const frame = (overrides: Partial<RawFrame> = {}): RawFrame => ({
  function: "a",
  filename: "https://app.com/assets/app.js",
  lineno: 1,
  colno: 1,
  in_app: true,
  ...overrides
});

describe("frameBasename", () => {
  test("strips query string and directory prefix", () => {
    expect(frameBasename("https://app.com/assets/index-4f2a.js?v=1")).toBe(
      "index-4f2a.js"
    );
  });

  test("strips hash fragment", () => {
    expect(frameBasename("https://app.com/a/b/app.js#frag")).toBe("app.js");
  });

  test("returns the bare name unchanged", () => {
    expect(frameBasename("app.js")).toBe("app.js");
  });

  test("returns null for undefined, empty, and trailing-slash inputs", () => {
    expect(frameBasename(undefined)).toBeNull();
    expect(frameBasename("")).toBeNull();
    expect(frameBasename("https://app.com/")).toBeNull();
  });
});

describe("symbolicateFrames", () => {
  test("maps a frame to its original location with context line", () => {
    const maps = new Map([["app.js", makeSourceMap()]]);
    const result = symbolicateFrames([frame()], maps);

    expect(result.changed).toBe(true);
    const [out] = result.frames;
    expect(out?.originalFilename).toBe("src/app.ts");
    expect(out?.originalLineno).toBe(1);
    expect(out?.originalColno).toBe(0);
    expect(out?.originalFunction).toBe("handleClick");
    expect(out?.contextLine).toBe("function handleClick() {");
    // Raw fields are preserved alongside the original ones.
    expect(out?.filename).toBe("https://app.com/assets/app.js");
    expect(out?.lineno).toBe(1);
  });

  test("works without sourcesContent (no contextLine, original* still set)", () => {
    const maps = new Map([["app.js", makeSourceMap({ withContent: false })]]);
    const result = symbolicateFrames([frame()], maps);

    expect(result.changed).toBe(true);
    const [out] = result.frames;
    expect(out?.originalFilename).toBe("src/app.ts");
    expect(out?.contextLine).toBeUndefined();
  });

  test("maps without a name leave originalFunction unset", () => {
    const maps = new Map([["app.js", makeSourceMap({ withName: false })]]);
    const result = symbolicateFrames([frame()], maps);

    expect(result.changed).toBe(true);
    expect(result.frames[0]?.originalFilename).toBe("src/app.ts");
    expect(result.frames[0]?.originalFunction).toBeUndefined();
  });

  test("no maps → unchanged, changed=false", () => {
    const result = symbolicateFrames([frame()], new Map());
    expect(result.changed).toBe(false);
    expect(result.frames[0]?.originalFilename).toBeUndefined();
  });

  test("basename with no matching map → unchanged", () => {
    const maps = new Map([["other.js", makeSourceMap()]]);
    const result = symbolicateFrames([frame()], maps);
    expect(result.changed).toBe(false);
    expect(result.frames[0]?.originalFilename).toBeUndefined();
  });

  test("frame without lineno is skipped", () => {
    const maps = new Map([["app.js", makeSourceMap()]]);
    const noLineno: RawFrame = {
      function: "a",
      filename: "https://app.com/assets/app.js",
      colno: 1,
      in_app: true
    };
    const result = symbolicateFrames([noLineno], maps);
    expect(result.changed).toBe(false);
    expect(result.frames[0]?.originalFilename).toBeUndefined();
  });

  test("corrupt source map JSON is tolerated (treated as no map)", () => {
    const maps = new Map([["app.js", "{not valid json"]]);
    const result = symbolicateFrames([frame()], maps);
    expect(result.changed).toBe(false);
    expect(result.frames[0]?.originalFilename).toBeUndefined();
  });

  test("empty frame list → changed=false", () => {
    const maps = new Map([["app.js", makeSourceMap()]]);
    const result = symbolicateFrames([], maps);
    expect(result.changed).toBe(false);
    expect(result.frames).toEqual([]);
  });
});
