// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { Client } from "./client.js";
import { parseDsn } from "./dsn.js";
import { close, init } from "./index.js";
import {
  buildDsnFromScriptOrigin,
  readInitOptionsFromScript
} from "./loader-options.js";
import { parseStack } from "./stacktrace.js";
import type { SentryEvent } from "./types.js";

const DSN = "http://abc123@localhost:4100/proj_1";

describe("parseDsn", () => {
  test("parses the components of a DSN", () => {
    const dsn = parseDsn(DSN);
    expect(dsn.publicKey).toBe("abc123");
    expect(dsn.projectId).toBe("proj_1");
    expect(dsn.ingestUrl).toBe("http://localhost:4100/api/proj_1/store");
  });

  test("rejects malformed DSNs", () => {
    expect(() => parseDsn("not a url")).toThrow();
    expect(() => parseDsn("http://localhost:4100/proj_1")).toThrow();
    expect(() => parseDsn("http://abc123@localhost:4100/")).toThrow();
  });
});

describe("script loader options", () => {
  test("builds a DSN from the script src origin", () => {
    expect(
      buildDsnFromScriptOrigin(
        "https://errors.example.com/sdk/mini-sentry.min.js",
        "public_123",
        "project_456"
      )
    ).toBe("https://public_123@errors.example.com/project_456");
  });

  test("prefers data-dsn and reads optional init fields", () => {
    const script = document.createElement("script");
    script.src = "https://ignored.example.com/sdk/mini-sentry.min.js";
    script.dataset.dsn = "https://key@example.com/project";
    script.dataset.environment = "production";
    script.dataset.release = "web@1.2.3";
    script.dataset.autoInstrument = "false";
    script.dataset.captureConsole = "true";

    expect(readInitOptionsFromScript(script)).toEqual({
      dsn: "https://key@example.com/project",
      environment: "production",
      release: "web@1.2.3",
      autoInstrument: false,
      captureConsole: true
    });
  });

  test("uses data-key and data-project with auto instrumentation on by default", () => {
    const script = document.createElement("script");
    script.src = "http://localhost:4100/sdk/mini-sentry.min.js";
    script.dataset.key = "abc123";
    script.dataset.project = "proj_1";

    expect(readInitOptionsFromScript(script)).toEqual({
      dsn: "http://abc123@localhost:4100/proj_1",
      autoInstrument: true,
      captureConsole: false
    });
  });

  test("returns null when the script has no usable DSN configuration", () => {
    const script = document.createElement("script");
    script.src = "https://errors.example.com/sdk/mini-sentry.min.js";

    expect(readInitOptionsFromScript(script)).toBeNull();
  });
});

describe("parseStack", () => {
  test("parses V8 frames with and without a function name", () => {
    const stack = [
      "TypeError: boom",
      "    at handleClick (http://localhost:5173/app.js:42:13)",
      "    at http://localhost:5173/main.js:1:1"
    ].join("\n");

    const frames = parseStack(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      function: "handleClick",
      filename: "http://localhost:5173/app.js",
      lineno: 42,
      colno: 13,
      in_app: true
    });
    expect(frames[1]).toMatchObject({
      filename: "http://localhost:5173/main.js",
      lineno: 1,
      colno: 1
    });
  });

  test("flags node_modules frames as not in_app", () => {
    const frames = parseStack("    at dep (http://h/node_modules/lib/index.js:1:2)");
    expect(frames[0]?.in_app).toBe(false);
  });
});

const okResponse = (): Response =>
  ({ ok: true, status: 202, text: () => Promise.resolve("") }) as unknown as Response;

describe("Client", () => {
  const fetchMock = vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >(() => Promise.resolve(okResponse()));

  const lastEvent = (): SentryEvent => {
    const call = fetchMock.mock.calls.at(-1);
    if (!call) {
      throw new Error("fetch was not called");
    }
    const body = call[1]?.body;
    if (typeof body !== "string") {
      throw new Error("expected a string request body");
    }
    return JSON.parse(body) as SentryEvent;
  };

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("captureException posts a well-formed event to the DSN ingest URL", () => {
    const client = new Client({
      dsn: DSN,
      release: "1.0.0",
      environment: "test",
      autoInstrument: false
    });

    const id = client.captureException(new TypeError("kapow"));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(
      "http://localhost:4100/api/proj_1/store?key=abc123"
    );

    const event = lastEvent();
    expect(event.level).toBe("error");
    expect(event.exception?.type).toBe("TypeError");
    expect(event.exception?.value).toBe("kapow");
    expect(event.release).toBe("1.0.0");
    expect(event.environment).toBe("test");
    expect(event.sdk.name).toBe("@mini-sentry/sdk");
  });

  test("captureMessage includes scope (user + tags)", () => {
    const client = new Client({ dsn: DSN, autoInstrument: false });
    client.setUser({ id: "u1" });
    client.setTag("page", "home");
    client.captureMessage("hello", "warning");

    const event = lastEvent();
    expect(event.message).toBe("hello");
    expect(event.level).toBe("warning");
    expect(event.user).toEqual({ id: "u1" });
    expect(event.tags).toEqual({ page: "home" });
  });

  test("auto-installed handler captures uncaught window errors", () => {
    const client = new Client({ dsn: DSN, autoInstrument: true });
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("global boom"),
        message: "global boom"
      })
    );

    expect(fetchMock).toHaveBeenCalled();
    expect(lastEvent().exception?.value).toBe("global boom");
    client.close();
  });

  test("click breadcrumbs are attached to subsequent events", () => {
    const client = new Client({ dsn: DSN, autoInstrument: true });
    const button = document.createElement("button");
    button.id = "go";
    document.body.appendChild(button);
    button.click();

    client.captureMessage("after click");
    const event = lastEvent();
    expect(event.breadcrumbs?.some((crumb) => crumb.category === "ui.click")).toBe(
      true
    );
    client.close();
  });

  test("console breadcrumbs are not captured by default", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const client = new Client({ dsn: DSN, autoInstrument: true });

    console.log("default off");
    client.captureMessage("after console");

    const event = lastEvent();
    expect(
      event.breadcrumbs?.some((crumb) => crumb.category === "console") ?? false
    ).toBe(false);

    client.close();
    consoleSpy.mockRestore();
  });

  test("console breadcrumbs are captured when captureConsole is true", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const client = new Client({
      dsn: DSN,
      autoInstrument: true,
      captureConsole: true
    });

    console.log("explicit on");
    client.captureMessage("after console");

    const event = lastEvent();
    expect(event.breadcrumbs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "console",
          level: "info",
          message: "explicit on"
        })
      ])
    );

    client.close();
    consoleSpy.mockRestore();
  });

  test("circular scope data never throws and the event is still sent", () => {
    const client = new Client({ dsn: DSN, autoInstrument: false });
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    expect(() => {
      client.setUser(circular);
      client.setContext("state", circular);
      client.captureMessage("with circular scope");
    }).not.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const event = lastEvent();
    expect(event.user).toBeDefined();
  });

  test("capturing a non-Error value produces a readable exception", () => {
    const client = new Client({ dsn: DSN, autoInstrument: false });
    client.captureException({ code: 42, reason: "nope" });
    const event = lastEvent();
    expect(event.exception?.value).toContain("42");
  });
});

describe("init", () => {
  afterEach(() => {
    close();
  });

  test("returns null on an invalid DSN instead of throwing", () => {
    vi.stubGlobal("fetch", vi.fn());
    let client: ReturnType<typeof init> = null;
    expect(() => {
      client = init({ dsn: "not a url" });
    }).not.toThrow();
    expect(client).toBeNull();
    vi.unstubAllGlobals();
  });
});
