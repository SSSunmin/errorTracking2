import { UAParser } from "ua-parser-js";

/**
 * Server-side enrichment of an event from the ingest request's User-Agent.
 *
 * The browser sends the `User-Agent` header automatically on every request, so
 * the server is an authoritative, tamper-resistant source for browser/OS/device
 * — independent of whatever the SDK chooses to report. We parse it into
 * Sentry-style `contexts.{browser,os,device}` and keep the raw string too.
 */

export interface ClientContexts {
  browser?: { name: string; version?: string };
  os?: { name: string; version?: string };
  device?: { type?: string; model?: string; vendor?: string };
}

const MAX_USER_AGENT_LENGTH = 1_024;

export const truncateUserAgent = (userAgent: string): string =>
  userAgent.length > MAX_USER_AGENT_LENGTH
    ? userAgent.slice(0, MAX_USER_AGENT_LENGTH)
    : userAgent;

/** Parse a raw User-Agent into browser/os/device contexts, or undefined when
 *  nothing useful could be extracted (empty UA, or an unrecognised client). */
export const parseUserAgentContexts = (
  userAgent: string | undefined | null
): ClientContexts | undefined => {
  const ua = userAgent?.trim();
  if (!ua) {
    return undefined;
  }

  const result = UAParser(ua);
  const contexts: ClientContexts = {};

  if (result.browser.name) {
    contexts.browser = {
      name: result.browser.name,
      ...(result.browser.version ? { version: result.browser.version } : {})
    };
  }
  if (result.os.name) {
    contexts.os = {
      name: result.os.name,
      ...(result.os.version ? { version: result.os.version } : {})
    };
  }
  const hasDevice =
    (result.device.type ?? result.device.model ?? result.device.vendor) !== undefined;
  if (hasDevice) {
    contexts.device = {
      ...(result.device.type ? { type: result.device.type } : {}),
      ...(result.device.model ? { model: result.device.model } : {}),
      ...(result.device.vendor ? { vendor: result.device.vendor } : {})
    };
  }

  return Object.keys(contexts).length > 0 ? contexts : undefined;
};

/**
 * Combine SDK-provided contexts with server-derived UA contexts.
 *
 * The server's `browser`/`os`/`device` come from the real HTTP `User-Agent`
 * header, so they are authoritative for those three keys and overwrite anything
 * the SDK put there (which also defends against a client sending a non-object in
 * those slots). Any *other* keys the SDK set — e.g. custom `setContext` data —
 * are preserved. Returns undefined when neither side contributed anything.
 */
export const mergeEventContexts = (
  payloadContexts: Record<string, unknown> | undefined,
  userAgent: string | undefined
): Record<string, unknown> | undefined => {
  const derived = parseUserAgentContexts(userAgent);
  if (!derived && !payloadContexts) {
    return undefined;
  }

  return {
    ...(payloadContexts ?? {}),
    ...(derived ?? {})
  };
};
