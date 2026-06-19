import { gzipSync, strToU8 } from "fflate";
import type { eventWithTime } from "rrweb";

import { BreadcrumbBuffer, instrumentBreadcrumbs } from "./breadcrumbs.js";
import { parseDsn, type DsnComponents } from "./dsn.js";
import { captureSnapshot } from "./replay.js";
import {
  startSessionReplay,
  type SessionReplayHandle
} from "./sessionReplay.js";
import { safeStringify, sanitizeRecord, truncate } from "./serialize.js";
import { parseStack } from "./stacktrace.js";
import type {
  Breadcrumb,
  EventException,
  InitOptions,
  SentryEvent,
  SeverityLevel
} from "./types.js";

export const SDK_NAME = "@mini-sentry/sdk";
export const SDK_VERSION = "0.1.0";

const DEFAULT_MAX_BREADCRUMBS = 50;

// rrweb records DOM mutations asynchronously (MutationObserver), so the changes
// that render the error state (e.g. an error boundary swapping in its fallback)
// aren't in the buffer yet the instant captureException runs. Defer the replay
// snapshot briefly so those final mutations are flushed in before we upload.
const REPLAY_FLUSH_DELAY_MS = 250;

interface Scope {
  user?: Record<string, unknown>;
  tags: Record<string, string>;
  contexts: Record<string, unknown>;
}

const randomEventId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback for very old runtimes.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const r = Math.floor(Math.random() * 16);
    const v = char === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const errorToException = (error: Error): EventException => ({
  type: error.name || "Error",
  value: truncate(error.message),
  stacktrace: { frames: parseStack(error.stack) }
});

const nonErrorToException = (value: unknown): EventException => {
  if (typeof value === "string") {
    return { type: "Error", value: truncate(value) };
  }
  const serialized = safeStringify(value);
  return {
    type: "Error",
    value: truncate(serialized ?? String(value))
  };
};

const safeUrl = (): string | undefined => {
  if (typeof location === "undefined") {
    return undefined;
  }
  // Drop query/hash to avoid capturing tokens/PII in URLs by default.
  return `${location.origin}${location.pathname}`;
};

export class Client {
  private readonly dsn: DsnComponents;

  private readonly breadcrumbs: BreadcrumbBuffer;

  private readonly scope: Scope = { tags: {}, contexts: {} };

  private teardownInstrumentation: (() => void) | null = null;

  private teardownGlobalHandlers: (() => void) | null = null;

  private sessionReplay: SessionReplayHandle | null = null;

  public constructor(private readonly options: InitOptions) {
    this.dsn = parseDsn(options.dsn);
    this.breadcrumbs = new BreadcrumbBuffer(
      options.maxBreadcrumbs ?? DEFAULT_MAX_BREADCRUMBS
    );

    if (options.autoInstrument !== false) {
      this.teardownInstrumentation = instrumentBreadcrumbs(
        (breadcrumb) => {
          this.breadcrumbs.add(breadcrumb);
        },
        { captureConsole: options.captureConsole ?? false }
      );
      this.installGlobalHandlers();
    }

    // Opt-in rolling rrweb recorder (heavier). startSessionReplay is itself
    // browser-guarded and never throws, but guard the browser check here too so
    // we don't even reference rrweb in non-DOM runtimes.
    if (options.sessionReplay === true && typeof document !== "undefined") {
      this.sessionReplay = startSessionReplay({ maskAllInputs: true });
    }
  }

  public setUser(user: Record<string, unknown> | null): void {
    if (user === null) {
      delete this.scope.user;
    } else {
      this.scope.user = sanitizeRecord(user);
    }
  }

  public setTag(key: string, value: string): void {
    this.scope.tags[truncate(key, 200)] = truncate(value, 200);
  }

  public setContext(key: string, context: Record<string, unknown>): void {
    this.scope.contexts[truncate(key, 200)] = sanitizeRecord(context);
  }

  public addBreadcrumb(
    breadcrumb: Omit<Breadcrumb, "timestamp"> & { timestamp?: string }
  ): void {
    this.breadcrumbs.add({
      ...breadcrumb,
      ...(breadcrumb.data ? { data: sanitizeRecord(breadcrumb.data) } : {}),
      timestamp: breadcrumb.timestamp ?? new Date().toISOString()
    });
  }

  public captureException(error: unknown): string {
    const exception =
      error instanceof Error ? errorToException(error) : nonErrorToException(error);
    const event = this.buildEvent("error", { exception });
    // Capture a masked DOM snapshot at the error moment (default on). A failed
    // or oversized snapshot simply yields no replay; the event still sends.
    if (this.options.captureReplay !== false) {
      const replay = captureSnapshot();
      if (replay !== undefined) {
        event.replay = replay;
      }
    }
    const eventId = this.send(event);
    // Fire-and-forget upload of the rolling rrweb session replay (feature C),
    // linked to this event by its client-generated eventId. Error path only.
    // Deferred by REPLAY_FLUSH_DELAY_MS so rrweb flushes the final error-state
    // mutations into the buffer first (see the constant's note). Best-effort:
    // captured in a local so a concurrent close() doesn't cancel an in-flight
    // upload; and on a hard navigation within the delay it may be lost (the main
    // event above already uses keepalive, so it survives regardless).
    const sessionReplay = this.sessionReplay;
    if (sessionReplay) {
      setTimeout(() => {
        try {
          const replayEvents = sessionReplay.snapshot();
          if (replayEvents.length > 0) {
            this.sendReplay(eventId, replayEvents);
          }
        } catch {
          /* telemetry must never break the host app */
        }
      }, REPLAY_FLUSH_DELAY_MS);
    }
    return eventId;
  }

  public captureMessage(message: string, level: SeverityLevel = "info"): string {
    return this.send(this.buildEvent(level, { message }));
  }

  public close(): void {
    this.teardownInstrumentation?.();
    this.teardownGlobalHandlers?.();
    this.sessionReplay?.stop();
    this.teardownInstrumentation = null;
    this.teardownGlobalHandlers = null;
    this.sessionReplay = null;
  }

  private buildEvent(
    level: SeverityLevel,
    detail: { message?: string; exception?: EventException }
  ): SentryEvent {
    const breadcrumbs = this.breadcrumbs.snapshot();
    const requestUrl = safeUrl();
    return {
      eventId: randomEventId(),
      timestamp: new Date().toISOString(),
      level,
      platform: "javascript",
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      ...(detail.message !== undefined ? { message: truncate(detail.message) } : {}),
      ...(detail.exception ? { exception: detail.exception } : {}),
      ...(breadcrumbs.length > 0 ? { breadcrumbs } : {}),
      ...(Object.keys(this.scope.tags).length > 0 ? { tags: this.scope.tags } : {}),
      ...(this.scope.user ? { user: this.scope.user } : {}),
      ...(Object.keys(this.scope.contexts).length > 0
        ? { contexts: this.scope.contexts }
        : {}),
      ...(this.options.release !== undefined ? { release: this.options.release } : {}),
      ...(this.options.environment !== undefined
        ? { environment: this.options.environment }
        : {}),
      ...(requestUrl !== undefined ? { request: { url: requestUrl } } : {})
    };
  }

  private send(event: SentryEvent): string {
    // Sanitize-at-write keeps scope/breadcrumbs serializable, but stringify the
    // whole event defensively so a residual circular ref can never throw.
    const body = safeStringify(event);
    if (body === null) {
      return event.eventId;
    }

    const url = `${this.dsn.ingestUrl}?key=${encodeURIComponent(this.dsn.publicKey)}`;
    try {
      void fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
        // Ingest is authenticated by the DSN key, not cookies.
        credentials: "omit"
      }).catch(() => {
        /* swallow transport errors — telemetry must never break the host app */
      });
    } catch {
      /* swallow synchronous failures (e.g. fetch unavailable) */
    }
    return event.eventId;
  }

  /**
   * Fire-and-forget upload of the rolling rrweb buffer for `eventId`. Gzips the
   * events with fflate and POSTs the raw bytes to the dedicated replay endpoint
   * (derived from the same DSN host as ingest). Fully swallowed: a replay must
   * never break the host app or the event flow.
   */
  private sendReplay(eventId: string, events: eventWithTime[]): void {
    try {
      const body = gzipSync(strToU8(JSON.stringify(events)));
      const url =
        `${this.dsn.replayUrl}?eventId=${encodeURIComponent(eventId)}` +
        `&count=${String(events.length)}`;
      void fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-mini-sentry-key": this.dsn.publicKey
        },
        body,
        keepalive: true,
        credentials: "omit"
      }).catch(() => {
        /* swallow transport errors — replay upload is best-effort */
      });
    } catch {
      /* swallow synchronous failures (gzip/fetch unavailable, oversized, etc.) */
    }
  }

  private installGlobalHandlers(): void {
    if (typeof window === "undefined") {
      return;
    }

    const onError = (event: ErrorEvent): void => {
      const error = event.error instanceof Error ? event.error : new Error(event.message);
      this.captureException(error);
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason: unknown = event.reason;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      this.captureException(error);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    this.teardownGlobalHandlers = () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }
}
