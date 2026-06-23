// Framework-agnostic rrweb mount logic, shared by the in-page React components
// (IssueDetailPage) and the isolated cross-origin viewer (replay-viewer). Keeping
// a single source of truth ensures the separate-origin viewer renders and scales
// recordings identically to the in-page path — especially the regression-prone
// viewport scaling that keeps the replayed cursor aligned (see commits ca13901,
// 18e2c67).

import { EventType, Replayer, ReplayerEvents } from "rrweb";
import { createCache, Mirror, rebuildIntoSandboxedIframe } from "rrweb-snapshot";

import type { ReplayEvent } from "../api";

type RebuildNode = Parameters<typeof rebuildIntoSandboxedIframe>[0];

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

export interface SnapshotInput {
  data: unknown;
  width: number | null;
  height: number | null;
}

export interface MountedSnapshot {
  /** True when rrweb's rebuild threw; caller shows a muted fallback line. */
  failed: boolean;
  destroy: () => void;
}

/** Render a captured DOM snapshot into a sandboxed iframe (no allow-scripts, so
 *  any captured inline scripts cannot execute). Lays the capture out at its
 *  original viewport size, then CSS-scales the frame to fit the container width
 *  so it reads like a page thumbnail. */
export const mountSnapshot = (
  container: HTMLElement,
  input: SnapshotInput
): MountedSnapshot => {
  container.replaceChildren();
  try {
    const { iframe } = rebuildIntoSandboxedIframe(input.data as RebuildNode, {
      root: container,
      cache: createCache(),
      mirror: new Mirror()
    });
    const captureW = input.width && input.width > 0 ? input.width : 1280;
    const captureH = input.height && input.height > 0 ? input.height : 800;
    iframe.setAttribute("scrolling", "no");
    iframe.style.border = "0";
    iframe.style.width = `${String(captureW)}px`;
    iframe.style.height = `${String(captureH)}px`;
    iframe.style.transformOrigin = "top left";
    iframe.style.pointerEvents = "none";

    const fit = (): void => {
      if (container.clientWidth === 0) {
        return;
      }
      const scale = container.clientWidth / captureW;
      iframe.style.transform = `scale(${String(scale)})`;
      container.style.height = `${String(captureH * scale)}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return {
      failed: false,
      destroy: () => {
        observer.disconnect();
        container.replaceChildren();
      }
    };
  } catch {
    return {
      failed: true,
      destroy: () => {
        container.replaceChildren();
      }
    };
  }
};

export type ReplayUiStatus = "idle" | "playing" | "paused" | "finished" | "failed";

export interface ReplayController {
  /** Play from the start (time 0). */
  play: () => void;
  pause: () => void;
  /** Resume from the paused position rather than restarting. */
  resume: () => void;
  destroy: () => void;
}

/** Mount an rrweb Replayer that paints the first frame paused and waits for the
 *  caller to drive playback. Status transitions (idle/playing/paused/finished/
 *  failed) are pushed through `onStatus` so any UI — React state or a vanilla
 *  control bar — can mirror them. */
export const mountReplay = (
  container: HTMLElement,
  events: ReplayEvent[],
  onStatus: (status: ReplayUiStatus) => void
): ReplayController => {
  container.replaceChildren();

  // Newer recordings include the real Meta event, which carries the recorded
  // viewport size rrweb uses to size/build the replay iframe. Older recordings
  // may still start at a full snapshot, so synthesize a placeholder Meta only
  // for that backward-compat path.
  const meta = events.find((event) => event.type === (EventType.Meta as number));
  const metaData = asRecord(meta?.data);
  const metaWidth =
    typeof metaData.width === "number" && metaData.width > 0 ? metaData.width : null;
  const metaHeight =
    typeof metaData.height === "number" && metaData.height > 0 ? metaData.height : null;
  const viewportWidth = metaWidth ?? 1280;
  const viewportHeight = metaHeight ?? 720;

  const first = events[0];
  const playerEvents: ReplayEvent[] =
    meta === undefined && first?.type === EventType.FullSnapshot
      ? [
          {
            type: EventType.Meta,
            data: { href: "", width: viewportWidth, height: viewportHeight },
            timestamp: first.timestamp
          },
          ...events
        ]
      : events;

  let replayer: Replayer | null = null;
  let observer: ResizeObserver | null = null;
  try {
    // SECURITY: rrweb replays into an `allow-same-origin`-only sandboxed iframe
    // (no allow-scripts), so scripts captured from the recorded page do NOT
    // execute — the DOM is rebuilt via DOM APIs. The console may log a benign
    // "Blocked script execution" per captured <script>; that's the sandbox doing
    // its job. Do NOT pass UNSAFE_replayCanvas (it adds allow-scripts → captured
    // DOM could run in this origin → stored XSS). When VITE_REPLAY_ORIGIN is set
    // this code runs in the isolated viewer origin, so even a regression here
    // cannot reach the dashboard origin (tokens, DOM, /api).
    // skipInactive fast-forwards through idle gaps so a recording spanning a long
    // pause does not look frozen.
    replayer = new Replayer(
      playerEvents as unknown as ConstructorParameters<typeof Replayer>[0],
      { root: container, mouseTail: false, speed: 1, skipInactive: true }
    );
    replayer.on(ReplayerEvents.Finish, () => {
      onStatus("finished");
    });

    // Fit the recorded viewport to the container width by CSS-scaling the wrapper.
    // The recorded viewport can change mid-replay, and rrweb resizes its iframe on
    // each Meta/ViewportResize event; track the current dimensions from rrweb's
    // Resize event and re-fit so the scale always matches the live iframe (keeps
    // the replayed cursor aligned).
    let viewW = viewportWidth;
    let viewH = viewportHeight;
    const fit = (): void => {
      const wrapper = container.querySelector<HTMLElement>(".replayer-wrapper");
      if (!wrapper || container.clientWidth === 0) {
        return;
      }
      const scale = container.clientWidth / viewW;
      wrapper.style.transformOrigin = "top left";
      wrapper.style.transform = `scale(${String(scale)})`;
      container.style.height = `${String(Math.round(viewH * scale))}px`;
    };
    replayer.on(ReplayerEvents.Resize, (payload: unknown) => {
      const dimension = asRecord(payload);
      if (typeof dimension.width === "number" && dimension.width > 0) {
        viewW = dimension.width;
      }
      if (typeof dimension.height === "number" && dimension.height > 0) {
        viewH = dimension.height;
      }
      fit();
    });
    fit();
    observer = new ResizeObserver(fit);
    observer.observe(container);
    onStatus("idle");
  } catch (err) {
    console.error("rrweb Replayer failed to initialize", err);
    onStatus("failed");
  }

  return {
    play: () => {
      if (!replayer) {
        return;
      }
      try {
        replayer.play(0);
        onStatus("playing");
      } catch {
        /* ignore */
      }
    },
    pause: () => {
      if (!replayer) {
        return;
      }
      try {
        replayer.pause();
        onStatus("paused");
      } catch {
        /* ignore */
      }
    },
    resume: () => {
      try {
        if (replayer) {
          replayer.play(replayer.getCurrentTime());
          onStatus("playing");
        }
      } catch {
        /* ignore */
      }
    },
    destroy: () => {
      observer?.disconnect();
      try {
        // destroy() pauses the timer, resets state, removes the wrapper and
        // detaches rrweb's listeners — the proper teardown so a stale handler
        // from a replaced recording can't fire into the next mount.
        replayer?.destroy();
      } catch {
        /* ignore teardown failures */
      }
      container.replaceChildren();
    }
  };
};
