import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import "rrweb/dist/style.css";

import { api, type EventSnapshot, type IssueStatus, type ReplayEvent } from "../api";
import { LevelBadge, relativeTime, Spinner, StatsChart, StatusBadge } from "../components";
import { replayOrigin } from "../replay/config";
import {
  isAllowedOrigin,
  parseViewerOutbound,
  type ViewerInbound
} from "../replay/messaging";
import {
  mountReplay,
  mountSnapshot,
  type ReplayController,
  type ReplayUiStatus
} from "../replay/render";

interface Frame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  originalFunction?: string;
  originalFilename?: string;
  originalLineno?: number;
  originalColno?: number;
  contextLine?: string;
}

const formatLocation = (
  filename: string | undefined,
  lineno: number | undefined
): string =>
  `${filename ?? "?"}${lineno !== undefined ? `:${String(lineno)}` : ""}`;

const getFrames = (stacktrace: unknown): Frame[] => {
  if (
    stacktrace !== null &&
    typeof stacktrace === "object" &&
    "frames" in stacktrace
  ) {
    const frames = (stacktrace as { frames: unknown }).frames;
    if (Array.isArray(frames)) {
      return frames as Frame[];
    }
  }
  return [];
};

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

const renderValue = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "");

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const joinParts = (...parts: string[]): string =>
  parts.filter((part) => part !== "").join(" ");

const formatAbsoluteTime = (value: string): string =>
  new Date(value).toLocaleString("ko-KR");

const eventOptionLabel = (event: {
  receivedAt: string;
  environment: string | null;
  exceptionType: string | null;
  level: string;
}): string =>
  [
    relativeTime(event.receivedAt),
    event.environment ?? "",
    event.exceptionType ?? event.level
  ]
    .filter((part) => part !== "")
    .join(" · ");

/** Flatten event.contexts (browser/os/device) + raw User-Agent into a simple
 *  label→value record for display. Empty when nothing was captured. */
const buildEnvironment = (
  contexts: unknown,
  userAgent: string | null
): Record<string, unknown> => {
  const ctx = asRecord(contexts);
  const browser = asRecord(ctx.browser);
  const os = asRecord(ctx.os);
  const device = asRecord(ctx.device);
  const deviceType = str(device.type);

  const pairs: [string, string][] = [
    ["브라우저", joinParts(str(browser.name), str(browser.version))],
    ["OS", joinParts(str(os.name), str(os.version))],
    [
      "디바이스",
      joinParts(str(device.vendor), str(device.model), deviceType ? `(${deviceType})` : "")
    ],
    ["User-Agent", userAgent ?? ""]
  ];

  const env: Record<string, unknown> = {};
  for (const [label, value] of pairs) {
    if (value !== "") {
      env[label] = value;
    }
  }
  return env;
};

const KeyValues = ({ data }: { data: Record<string, unknown> }): ReactNode => {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;
  return (
    <dl className="kv">
      {entries.map(([key, value]) => (
        <Fragment key={key}>
          <dt>{key}</dt>
          <dd>{renderValue(value)}</dd>
        </Fragment>
      ))}
    </dl>
  );
};

// ── Replay / snapshot rendering ───────────────────────────────────────────────
// Two modes chosen by replayOrigin (VITE_REPLAY_ORIGIN). Empty (default, incl.
// local dev): recordings render in-page on the dashboard origin behind rrweb's
// no-allow-scripts sandbox via the shared mountSnapshot/mountReplay core. Set:
// they render in a cross-origin iframe served from that origin and receive their
// data over a postMessage bridge, isolating untrusted recordings from the
// dashboard's token, DOM and /api. Both modes share render.ts so playback and
// scaling behave identically.

/** Embeds the isolated viewer and bridges one payload to it: waits for the
 *  viewer's "ready", forwards the data to the viewer origin, and resizes the
 *  iframe to the rendered height. The payload is read through a ref so a new
 *  render doesn't re-run the bridge (each section remounts by event id). */
const ViewerFrame = ({
  origin,
  payload,
  className,
  title
}: {
  origin: string;
  payload: ViewerInbound;
  className: string;
  title: string;
}): ReactNode => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframe.contentWindow) {
        return;
      }
      if (!isAllowedOrigin(event.origin, origin)) {
        return;
      }
      const message = parseViewerOutbound(event.data);
      if (!message) {
        return;
      }
      if (message.kind === "ready") {
        iframe.contentWindow?.postMessage(payloadRef.current, origin);
      } else {
        iframe.style.height = `${String(message.height)}px`;
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [origin]);

  const src = `${origin}/replay-viewer.html?parent=${encodeURIComponent(window.location.origin)}`;
  return (
    <iframe
      ref={iframeRef}
      src={src}
      className={className}
      title={title}
      style={{ width: "100%", border: 0 }}
    />
  );
};

/** In-page snapshot render (dashboard origin) behind rrweb's sandbox. */
const SnapshotFrameInline = ({
  data,
  width,
  height
}: {
  data: unknown;
  width: number | null;
  height: number | null;
}): ReactNode => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const mounted = mountSnapshot(container, { data, width, height });
    setFailed(mounted.failed);
    return mounted.destroy;
  }, [data, width, height]);

  return (
    <>
      <div ref={containerRef} className="snapshot-frame" />
      {failed && <p className="muted small">스냅샷을 표시할 수 없습니다.</p>}
    </>
  );
};

const SnapshotFrame = ({
  data,
  width,
  height
}: {
  data: unknown;
  width: number | null;
  height: number | null;
}): ReactNode =>
  replayOrigin ? (
    <ViewerFrame
      origin={replayOrigin}
      payload={{ kind: "snapshot", data, width, height }}
      className="snapshot-frame"
      title="스냅샷"
    />
  ) : (
    <SnapshotFrameInline data={data} width={width} height={height} />
  );

const SnapshotSection = ({
  projectId,
  issueId,
  eventId
}: {
  projectId: string;
  issueId: string;
  eventId: string;
}): ReactNode => {
  const snapshot = useQuery({
    queryKey: ["snapshot", projectId, issueId, eventId],
    queryFn: () => api.getEventSnapshot(projectId, issueId, eventId),
    // Snapshots are immutable; avoid refetching the ~1MB blob on window focus.
    staleTime: Infinity
  });

  const data: EventSnapshot | null | undefined = snapshot.data?.snapshot;

  return (
    <section className="card">
      <h3>스냅샷</h3>
      {snapshot.isLoading && <Spinner />}
      {snapshot.isError && (
        <p className="error">스냅샷을 불러오지 못했습니다.</p>
      )}
      {!snapshot.isLoading && !snapshot.isError && !data && (
        <p className="muted">스냅샷 없음</p>
      )}
      {data && (
        <SnapshotFrame data={data.data} width={data.width} height={data.height} />
      )}
    </section>
  );
};

/** In-page replay player (dashboard origin). Mounts the shared rrweb core, which
 *  paints the first frame paused and waits for the user to drive playback; the
 *  controller pushes status changes so the controls below stay in sync. */
const ReplayPlayerInline = ({ events }: { events: ReplayEvent[] }): ReactNode => {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ReplayController | null>(null);
  const [status, setStatus] = useState<ReplayUiStatus>("idle");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const controller = mountReplay(container, events, setStatus);
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [events]);

  return (
    <>
      <div ref={containerRef} className="replay-player" />
      {status === "idle" && (
        <button
          type="button"
          className="ghost small replay-restart"
          onClick={() => controllerRef.current?.play()}
        >
          ▶ 재생
        </button>
      )}
      {status === "playing" && (
        <button
          type="button"
          className="ghost small replay-restart"
          onClick={() => controllerRef.current?.pause()}
        >
          ⏸ 일시정지
        </button>
      )}
      {status === "paused" && (
        <button
          type="button"
          className="ghost small replay-restart"
          onClick={() => controllerRef.current?.resume()}
        >
          ▶ 이어보기
        </button>
      )}
      {status === "finished" && (
        <button
          type="button"
          className="ghost small replay-restart"
          onClick={() => controllerRef.current?.play()}
        >
          ↻ 처음부터 재생
        </button>
      )}
      {status === "failed" && (
        <p className="muted small">리플레이를 재생할 수 없습니다.</p>
      )}
    </>
  );
};

const ReplayPlayer = ({ events }: { events: ReplayEvent[] }): ReactNode =>
  replayOrigin ? (
    <ViewerFrame
      origin={replayOrigin}
      payload={{ kind: "replay", events }}
      className="replay-player"
      title="리플레이"
    />
  ) : (
    <ReplayPlayerInline events={events} />
  );

const ReplaySection = ({
  projectId,
  issueId,
  eventId
}: {
  projectId: string;
  issueId: string;
  eventId: string;
}): ReactNode => {
  const replay = useQuery({
    queryKey: ["replay", projectId, issueId, eventId],
    queryFn: () => api.getEventReplay(projectId, issueId, eventId),
    // Recordings are immutable; avoid refetching the blob on window focus.
    staleTime: Infinity
  });

  const events = replay.data ?? null;

  return (
    <section className="card">
      <h3>리플레이</h3>
      {replay.isLoading && <Spinner />}
      {replay.isError && <p className="error">리플레이를 불러오지 못했습니다.</p>}
      {!replay.isLoading && !replay.isError && (!events || events.length === 0) && (
        <p className="muted">리플레이 없음</p>
      )}
      {events && events.length > 0 && <ReplayPlayer events={events} />}
    </section>
  );
};

export const IssueDetailPage = (): ReactNode => {
  const { projectId = "", issueId = "" } = useParams();
  const queryClient = useQueryClient();
  const [window, setWindow] = useState<"24h" | "7d">("24h");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const issue = useQuery({
    queryKey: ["issue", projectId, issueId],
    queryFn: () => api.getIssue(projectId, issueId)
  });
  const stats = useQuery({
    queryKey: ["stats", projectId, issueId, window],
    queryFn: () => api.getStats(projectId, issueId, window)
  });
  const events = useQuery({
    queryKey: ["events", projectId, issueId],
    queryFn: () => api.listEvents(projectId, issueId)
  });

  const setStatus = useMutation({
    mutationFn: (status: IssueStatus) =>
      api.setIssueStatus(projectId, issueId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["issue", projectId, issueId] });
      void queryClient.invalidateQueries({ queryKey: ["issues", projectId] });
    }
  });

  if (issue.isLoading) return <Spinner />;
  if (!issue.data) return <p className="error">이슈를 찾을 수 없습니다.</p>;

  const detail = issue.data.issue;
  const eventList = events.data?.events ?? [];
  const selected =
    eventList.find((event) => event.id === selectedEventId) ?? eventList[0];
  const selectedIndex = selected
    ? eventList.findIndex((event) => event.id === selected.id)
    : -1;
  const frames = getFrames(selected?.stacktrace);
  const breadcrumbs = asArray(selected?.breadcrumbs);
  const environment = buildEnvironment(selected?.contexts, selected?.userAgent ?? null);
  const hasMultipleEvents = eventList.length > 1;
  const canSelectNewer = selectedIndex > 0;
  const canSelectOlder = selectedIndex >= 0 && selectedIndex < eventList.length - 1;

  return (
    <div className="page">
      <Link className="muted" to={`/projects/${projectId}`}>
        ← 이슈
      </Link>

      <div className="page-head">
        <h2>{detail.title}</h2>
        <div className="actions">
          {detail.status !== "resolved" && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setStatus.mutate("resolved");
              }}
            >
              해결
            </button>
          )}
          {detail.status !== "ignored" && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setStatus.mutate("ignored");
              }}
            >
              무시
            </button>
          )}
          {detail.status !== "unresolved" && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setStatus.mutate("unresolved");
              }}
            >
              미해결로
            </button>
          )}
        </div>
      </div>

      <div className="meta-row">
        <LevelBadge level={detail.level} />
        <StatusBadge status={detail.status} />
        <span className="muted">이벤트 {detail.timesSeen}건</span>
        <span className="muted">최초 {relativeTime(detail.firstSeen)}</span>
        <span className="muted">최근 {relativeTime(detail.lastSeen)}</span>
      </div>
      {detail.culprit && <p className="culprit">{detail.culprit}</p>}

      <section className="card">
        <div className="card-head">
          <h3>이벤트 빈도</h3>
          <div className="tabs small">
            <button
              type="button"
              className={window === "24h" ? "active" : ""}
              onClick={() => {
                setWindow("24h");
              }}
            >
              24h
            </button>
            <button
              type="button"
              className={window === "7d" ? "active" : ""}
              onClick={() => {
                setWindow("7d");
              }}
            >
              7d
            </button>
          </div>
        </div>
        {stats.data ? <StatsChart buckets={stats.data.buckets} /> : <Spinner />}
      </section>

      {events.isLoading && (
        <section className="card">
          <Spinner />
        </section>
      )}
      {events.isError && (
        <section className="card">
          <p className="error">이벤트를 불러오지 못했습니다.</p>
        </section>
      )}
      {!events.isLoading && !events.isError && eventList.length === 0 && (
        <section className="card">
          <p className="muted">이벤트 없음</p>
        </section>
      )}

      {frames.length > 0 && (
        <section className="card">
          <h3>스택트레이스</h3>
          <ul className="frames">
            {frames.map((frame, index) => {
              const symbolicated = frame.originalFilename !== undefined;
              const fn =
                (symbolicated ? frame.originalFunction : undefined) ??
                frame.function ??
                "<anonymous>";
              return (
                <li key={index} className={frame.in_app ? "in-app" : "vendor"}>
                  <div className="frame-main">
                    <span className="fn">{fn}</span>
                    <span className="muted small">
                      {symbolicated
                        ? formatLocation(frame.originalFilename, frame.originalLineno)
                        : formatLocation(frame.filename, frame.lineno)}
                    </span>
                  </div>
                  {frame.contextLine !== undefined && frame.contextLine !== "" && (
                    <code className="frame-context small">{frame.contextLine}</code>
                  )}
                  {symbolicated && (
                    <span className="muted small frame-minified">
                      ↳ {formatLocation(frame.filename, frame.lineno)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {selected && (
        <section className="card">
          <div className="card-head event-nav-head">
            <h3>최근 이벤트</h3>
            <div className="event-nav" aria-label="이벤트 발생 선택">
              <span className="muted">
                발생 {selectedIndex + 1}/{eventList.length}
              </span>
              <span
                className="muted small"
                title={formatAbsoluteTime(selected.receivedAt)}
              >
                {relativeTime(selected.receivedAt)}
              </span>
              {selectedIndex === 0 && <span className="badge latest">최신</span>}
              {hasMultipleEvents && (
                <>
                  <button
                    type="button"
                    className="ghost"
                    disabled={!canSelectOlder}
                    onClick={() => {
                      const older = eventList[selectedIndex + 1];
                      if (older) setSelectedEventId(older.id);
                    }}
                  >
                    ← 이전
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={!canSelectNewer}
                    onClick={() => {
                      const newer = eventList[selectedIndex - 1];
                      if (newer) setSelectedEventId(newer.id);
                    }}
                  >
                    다음 →
                  </button>
                  <select
                    aria-label="이벤트 발생 선택"
                    value={selected.id}
                    onChange={(event) => {
                      setSelectedEventId(event.target.value);
                    }}
                  >
                    {eventList.map((event) => (
                      <option key={event.id} value={event.id}>
                        {eventOptionLabel(event)}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>
          {events.data?.nextCursor && (
            <p className="muted small event-nav-note">
              최근 {eventList.length}건만 표시됩니다.
            </p>
          )}
          {selected.exceptionType && (
            <p>
              <strong>{selected.exceptionType}</strong>: {selected.exceptionValue}
            </p>
          )}
          {selected.message && <p>{selected.message}</p>}
          {selected.requestUrl && <p className="muted small">{selected.requestUrl}</p>}
          {Object.keys(environment).length > 0 && (
            <>
              <h4>환경</h4>
              <KeyValues data={environment} />
            </>
          )}
          {Object.keys(asRecord(selected.tags)).length > 0 && (
            <>
              <h4>태그</h4>
              <KeyValues data={asRecord(selected.tags)} />
            </>
          )}
          {Object.keys(asRecord(selected.userContext)).length > 0 && (
            <>
              <h4>사용자</h4>
              <KeyValues data={asRecord(selected.userContext)} />
            </>
          )}
          {breadcrumbs.length > 0 && (
            <>
              <h4>브레드크럼</h4>
              <ul className="crumbs">
                {breadcrumbs.map((crumb, index) => (
                  <li key={index}>
                    <span className="cat">{renderValue(crumb.category)}</span>
                    <span>{renderValue(crumb.message)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {selected?.hasSnapshot && (
        <SnapshotSection
          key={`snapshot-${selected.id}`}
          projectId={projectId}
          issueId={issueId}
          eventId={selected.id}
        />
      )}

      {selected?.hasReplay && (
        <ReplaySection
          key={`replay-${selected.id}`}
          projectId={projectId}
          issueId={issueId}
          eventId={selected.id}
        />
      )}
    </div>
  );
};
