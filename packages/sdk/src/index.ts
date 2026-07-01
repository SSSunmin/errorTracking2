import { Client, SDK_NAME, SDK_VERSION } from "./client.js";
import {
  wireMapErrors,
  type ErrorEmittingMap,
  type MapErrorCaptureOptions
} from "./map.js";
import type { Breadcrumb, InitOptions, SeverityLevel } from "./types.js";

export type {
  Breadcrumb,
  EventException,
  InitOptions,
  SentryEvent,
  SeverityLevel,
  StackFrame
} from "./types.js";
export type {
  ErrorEmittingMap,
  MapErrorCaptureOptions,
  MapErrorEvent
} from "./map.js";
export { Client, SDK_NAME, SDK_VERSION } from "./client.js";
export { parseDsn } from "./dsn.js";
export { parseStack } from "./stacktrace.js";

let activeClient: Client | null = null;

/**
 * Initialise the SDK. A second call replaces the previous client. On an invalid
 * DSN (or any construction failure) this logs and returns null instead of
 * throwing, so a misconfiguration can never break the host application.
 */
export const init = (options: InitOptions): Client | null => {
  activeClient?.close();
  activeClient = null;
  try {
    activeClient = new Client(options);
  } catch (error) {
    if (typeof console !== "undefined") {
      console.error("[mini-sentry] init failed:", error);
    }
  }
  return activeClient;
};

export const getClient = (): Client | null => activeClient;

export const captureException = (error: unknown): string | undefined =>
  activeClient?.captureException(error);

export const captureMessage = (
  message: string,
  level?: SeverityLevel
): string | undefined => activeClient?.captureMessage(message, level);

export const setUser = (user: Record<string, unknown> | null): void => {
  activeClient?.setUser(user);
};

export const setTag = (key: string, value: string): void => {
  activeClient?.setTag(key, value);
};

export const setContext = (key: string, context: Record<string, unknown>): void => {
  activeClient?.setContext(key, context);
};

export const addBreadcrumb = (
  breadcrumb: Omit<Breadcrumb, "timestamp"> & { timestamp?: string }
): void => {
  activeClient?.addBreadcrumb(breadcrumb);
};

/**
 * Forward a MapLibre GL / Mapbox GL map's `error` events to captureException.
 * These errors (failed tiles, failed styles, source errors) are emitted only on
 * the map and never reach the global handlers, so they are otherwise invisible
 * to the SDK. Returns an unsubscribe function; excess errors are rate-limited
 * (see MapErrorCaptureOptions) so a broken tile source can't flood ingest.
 *
 * Call after `init()` — before init (or after `close()`) captured errors are
 * silently dropped, since they route through the active client. Call the
 * returned unsubscribe when the map is removed to detach the listener.
 */
export const captureMapErrors = (
  map: ErrorEmittingMap,
  options?: MapErrorCaptureOptions
): (() => void) =>
  wireMapErrors(
    map,
    (error) => {
      captureException(error);
    },
    options
  );

export const close = (): void => {
  activeClient?.close();
  activeClient = null;
};

export const sdkInfo = { name: SDK_NAME, version: SDK_VERSION };
