import { describe, expect, test } from "vitest";

import {
  mergeEventContexts,
  parseUserAgentContexts,
  truncateUserAgent
} from "../modules/events/enrich.js";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

describe("parseUserAgentContexts", () => {
  test("parses desktop Chrome on Windows", () => {
    const contexts = parseUserAgentContexts(CHROME_WINDOWS);
    expect(contexts?.browser?.name).toBe("Chrome");
    expect(contexts?.os?.name).toBe("Windows");
  });

  test("parses mobile Safari on iPhone including device type", () => {
    const contexts = parseUserAgentContexts(SAFARI_IPHONE);
    expect(contexts?.os?.name).toBe("iOS");
    expect(contexts?.device?.type).toBe("mobile");
  });

  test("returns undefined for empty or missing User-Agent", () => {
    expect(parseUserAgentContexts(undefined)).toBeUndefined();
    expect(parseUserAgentContexts("   ")).toBeUndefined();
  });

  test("yields no device context for a bot User-Agent", () => {
    const contexts = parseUserAgentContexts(
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
    );
    expect(contexts?.device).toBeUndefined();
  });
});

describe("mergeEventContexts", () => {
  test("server-derived browser/os override the SDK but keep other SDK keys", () => {
    const merged = mergeEventContexts(
      { browser: { name: "CustomBrowser" }, cart: { items: 3 } },
      CHROME_WINDOWS
    );
    const browser = (merged?.browser ?? {}) as { name?: string };
    const os = (merged?.os ?? {}) as { name?: string };
    expect(browser.name).toBe("Chrome"); // real HTTP UA is authoritative
    expect(os.name).toBe("Windows");
    expect(merged?.cart).toEqual({ items: 3 }); // unrelated SDK context preserved
  });

  test("keeps SDK-provided contexts when there is no User-Agent", () => {
    const merged = mergeEventContexts({ browser: { name: "Firefox" } }, undefined);
    const browser = (merged?.browser ?? {}) as { name?: string };
    expect(browser.name).toBe("Firefox");
  });

  test("a non-object SDK slot is overridden by the derived context", () => {
    const merged = mergeEventContexts({ browser: "oops" }, CHROME_WINDOWS);
    const browser = (merged?.browser ?? {}) as { name?: string };
    expect(browser.name).toBe("Chrome");
  });

  test("returns undefined when neither side contributes", () => {
    expect(mergeEventContexts(undefined, undefined)).toBeUndefined();
  });
});

describe("truncateUserAgent", () => {
  test("caps overly long User-Agent strings", () => {
    expect(truncateUserAgent("a".repeat(2_000))).toHaveLength(1_024);
  });
});
