// postMessage protocol between the dashboard (parent) and the isolated replay
// viewer (cross-origin iframe). The dashboard fetches replay/snapshot blobs with
// its Bearer token and forwards them here; the viewer never has API access, so
// even a compromised recording cannot reach the dashboard's token or DOM.
//
// These parse/validate helpers are the trust boundary and are intentionally
// framework- and DOM-free so they can be unit tested without a real second
// origin. ALWAYS validate event.origin with isAllowedOrigin before trusting a
// payload, and ALWAYS post with an explicit target origin — never "*".

import type { ReplayEvent } from "../api";

/** Parent → viewer: the data to render. */
export type ViewerInbound =
  | { kind: "snapshot"; data: unknown; width: number | null; height: number | null }
  | { kind: "replay"; events: ReplayEvent[] };

/** Viewer → parent: lifecycle + sizing (the viewer owns its own playback UI). */
export type ViewerOutbound =
  | { kind: "ready" }
  | { kind: "resize"; height: number };

/** True only when `origin` exactly matches a non-empty allowed origin. An empty
 *  allowlist never matches, so a missing/misconfigured origin fails closed. */
export const isAllowedOrigin = (origin: string, allowed: string): boolean =>
  allowed !== "" && origin === allowed;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

export const parseViewerInbound = (raw: unknown): ViewerInbound | null => {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.kind === "snapshot") {
    return {
      kind: "snapshot",
      data: raw.data,
      width: numberOrNull(raw.width),
      height: numberOrNull(raw.height)
    };
  }
  if (raw.kind === "replay") {
    if (!Array.isArray(raw.events)) {
      return null;
    }
    return { kind: "replay", events: raw.events as ReplayEvent[] };
  }
  return null;
};

export const parseViewerOutbound = (raw: unknown): ViewerOutbound | null => {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.kind === "ready") {
    return { kind: "ready" };
  }
  if (raw.kind === "resize" && typeof raw.height === "number") {
    return { kind: "resize", height: raw.height };
  }
  return null;
};
