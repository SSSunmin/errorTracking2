import { Client, SDK_NAME, SDK_VERSION } from "./client.js";
import type { Breadcrumb, InitOptions, SeverityLevel } from "./types.js";

export type {
  Breadcrumb,
  EventException,
  InitOptions,
  SentryEvent,
  SeverityLevel,
  StackFrame
} from "./types.js";
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

export const close = (): void => {
  activeClient?.close();
  activeClient = null;
};

export const sdkInfo = { name: SDK_NAME, version: SDK_VERSION };
