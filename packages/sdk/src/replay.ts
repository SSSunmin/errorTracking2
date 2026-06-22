import { snapshot } from "rrweb-snapshot";

import type { SentryEvent } from "./types.js";

/**
 * Capture a single masked DOM snapshot of the current page at error time using
 * rrweb-snapshot. All input values are masked for privacy and stylesheets are
 * inlined so the rebuilt view renders faithfully. The entire body is wrapped in
 * try/catch: telemetry must never break the host app, so any throw (or an
 * unavailable DOM) yields `undefined` and the event is still sent without a
 * snapshot.
 */
export const captureSnapshot = (): SentryEvent["replay"] | undefined => {
  if (typeof document === "undefined") {
    return undefined;
  }

  try {
    // rrweb-snapshot's return type references @rrweb/types (not bundled), so it
    // resolves as `unknown` here; we only ever pass it through as opaque data.
    const data: unknown = snapshot(document, {
      maskAllInputs: true,
      inlineStylesheet: true
    });
    if (data === null) {
      return undefined;
    }

    return {
      data,
      ...(typeof location !== "undefined" ? { href: location.href } : {}),
      ...(typeof window !== "undefined"
        ? { width: window.innerWidth, height: window.innerHeight }
        : {})
    };
  } catch {
    return undefined;
  }
};
