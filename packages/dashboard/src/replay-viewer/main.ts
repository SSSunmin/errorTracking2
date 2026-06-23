// Isolated replay/snapshot viewer. Served from a SEPARATE origin
// (VITE_REPLAY_ORIGIN) and embedded by the dashboard as a cross-origin iframe.
// It has no API token and never calls the network: the dashboard fetches the
// blob and forwards it via postMessage. Rendering reuses the shared rrweb core
// so playback/scaling matches the in-page path exactly.

import {
  isAllowedOrigin,
  parseViewerInbound,
  type ViewerOutbound
} from "../replay/messaging.js";
import {
  mountReplay,
  mountSnapshot,
  type ReplayController,
  type ReplayUiStatus
} from "../replay/render.js";
import "rrweb/dist/style.css";

// The dashboard passes its own origin so we can validate inbound messages and
// target our replies precisely. Without it we cannot trust anyone — fail closed.
const parentOrigin = new URLSearchParams(window.location.search).get("parent") ?? "";

const post = (message: ViewerOutbound): void => {
  if (parentOrigin) {
    window.parent.postMessage(message, parentOrigin);
  }
};

const root = document.getElementById("viewer-root");
const stage = document.getElementById("viewer-stage");
const control = document.getElementById("viewer-control");
const fallback = document.getElementById("viewer-fallback");

if (
  root instanceof HTMLElement &&
  stage instanceof HTMLElement &&
  control instanceof HTMLButtonElement &&
  fallback instanceof HTMLElement
) {
  let controller: ReplayController | null = null;

  const labels: Partial<Record<ReplayUiStatus, string>> = {
    idle: "▶ 재생",
    playing: "⏸ 일시정지",
    paused: "▶ 이어보기",
    finished: "↻ 처음부터 재생"
  };

  const renderStatus = (status: ReplayUiStatus): void => {
    if (status === "failed") {
      control.hidden = true;
      fallback.hidden = false;
      fallback.textContent = "리플레이를 재생할 수 없습니다.";
      return;
    }
    fallback.hidden = true;
    control.hidden = false;
    control.textContent = labels[status] ?? "▶ 재생";
    control.dataset.status = status;
  };

  control.addEventListener("click", () => {
    const status = control.dataset.status as ReplayUiStatus | undefined;
    if (status === "playing") {
      controller?.pause();
    } else if (status === "paused") {
      controller?.resume();
    } else {
      controller?.play();
    }
  });

  // Mirror the rendered height back so the dashboard can size the iframe to fit.
  const postHeight = (): void => {
    post({ kind: "resize", height: document.documentElement.scrollHeight });
  };
  new ResizeObserver(postHeight).observe(document.body);

  window.addEventListener("message", (event: MessageEvent) => {
    if (!isAllowedOrigin(event.origin, parentOrigin)) {
      return;
    }
    const message = parseViewerInbound(event.data);
    if (!message) {
      return;
    }

    controller?.destroy();
    controller = null;
    control.hidden = true;
    fallback.hidden = true;

    if (message.kind === "snapshot") {
      const mounted = mountSnapshot(stage, {
        data: message.data,
        width: message.width,
        height: message.height
      });
      if (mounted.failed) {
        fallback.hidden = false;
        fallback.textContent = "스냅샷을 표시할 수 없습니다.";
      }
      controller = {
        play: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        destroy: mounted.destroy
      };
    } else {
      controller = mountReplay(stage, message.events, renderStatus);
    }
    postHeight();
  });

  // Announce readiness; the dashboard waits for this before forwarding data.
  post({ kind: "ready" });
}
