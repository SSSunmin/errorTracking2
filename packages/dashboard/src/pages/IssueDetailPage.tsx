import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { createCache, Mirror, rebuildIntoSandboxedIframe } from "rrweb-snapshot";
import { EventType, Replayer, ReplayerEvents } from "rrweb";
import "rrweb/dist/style.css";

import { api, type EventSnapshot, type IssueStatus, type ReplayEvent } from "../api";
import { LevelBadge, relativeTime, Spinner, StatsChart, StatusBadge } from "../components";

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

type RebuildNode = Parameters<typeof rebuildIntoSandboxedIframe>[0];

/** Render a captured DOM snapshot into a sandboxed iframe (no allow-scripts, so
 *  any captured inline scripts cannot execute). rrweb-snapshot's rebuild() only
 *  accepts a document created by its own sandboxed-iframe helper, so we let the
 *  library build and register the iframe (sandbox = "allow-same-origin") into a
 *  container. Rebuild errors degrade to a muted line rather than breaking the
 *  page. */
const SnapshotFrame = ({
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
    setFailed(false);
    container.replaceChildren();
    try {
      const { iframe } = rebuildIntoSandboxedIframe(data as RebuildNode, {
        root: container,
        cache: createCache(),
        mirror: new Mirror()
      });
      // Lay the capture out at its original viewport size, then scale the whole
      // frame down to fit the card width so it reads like a page thumbnail.
      const captureW = width && width > 0 ? width : 1280;
      const captureH = height && height > 0 ? height : 800;
      iframe.setAttribute("scrolling", "no");
      iframe.style.border = "0";
      iframe.style.width = `${String(captureW)}px`;
      iframe.style.height = `${String(captureH)}px`;
      iframe.style.transformOrigin = "top left";
      iframe.style.pointerEvents = "none";

      const fit = (): void => {
        const scale = container.clientWidth / captureW;
        iframe.style.transform = `scale(${String(scale)})`;
        container.style.height = `${String(captureH * scale)}px`;
      };
      fit();
      const observer = new ResizeObserver(fit);
      observer.observe(container);
      return () => {
        observer.disconnect();
      };
    } catch {
      setFailed(true);
    }
  }, [data, width, height]);

  return (
    <>
      <div ref={containerRef} className="snapshot-frame" />
      {failed && <p className="muted small">스냅샷을 표시할 수 없습니다.</p>}
    </>
  );
};

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

/** Plays a recorded rrweb session with rrweb's Replayer, mounted imperatively
 *  into a container ref and CSS-scaled to fit the card. Playback does NOT start
 *  automatically: the Replayer renders the first frame on construction and waits
 *  for the user to press play; when playback finishes a "replay from start"
 *  control appears. Construction is try/catch wrapped so a malformed recording
 *  degrades to a muted line instead of breaking the page; teardown pauses the
 *  player and clears the container. */
type ReplayStatus = "idle" | "playing" | "paused" | "finished";

const ReplayPlayer = ({ events }: { events: ReplayEvent[] }): ReactNode => {
  const containerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<ReplayStatus>("idle");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    setFailed(false);
    setStatus("idle");
    container.replaceChildren();

    // Newer recordings include the real Meta event, which carries the recorded
    // viewport size rrweb uses to size/build the replay iframe. Older recordings
    // may still start at a full snapshot, so synthesize a placeholder only for
    // that backward-compat path.
    // After the SDK trim, the leading event is the Meta paired with the first
    // FullSnapshot, so the first Meta carries the correct recorded viewport.
    const meta = events.find((event) => event.type === (EventType.Meta as number));
    const metaData = asRecord(meta?.data);
    const metaWidth =
      typeof metaData.width === "number" && metaData.width > 0
        ? metaData.width
        : null;
    const metaHeight =
      typeof metaData.height === "number" && metaData.height > 0
        ? metaData.height
        : null;
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
      // execute — the DOM is rebuilt by the parent frame via DOM APIs. The
      // console may log a benign "Blocked script execution" per captured
      // <script>; that's the sandbox doing its job. Do NOT pass
      // UNSAFE_replayCanvas (it adds allow-scripts → captured DOM could run in
      // the dashboard origin → stored XSS); for untrusted recordings in
      // production, serve the replay view from a separate origin.
      // skipInactive fast-forwards through idle gaps. rrweb records nothing while
      // the page is idle, so a recording that spans a long pause (user loads the
      // page, walks away, comes back) stores a multi-minute gap between the first
      // snapshot and the next activity. Without this the player renders the first
      // frame and then sits in real time waiting out the gap, which looks frozen.
      replayer = new Replayer(
        playerEvents as unknown as ConstructorParameters<typeof Replayer>[0],
        { root: container, mouseTail: false, speed: 1, skipInactive: true }
      );
      replayerRef.current = replayer;
      // Don't auto-play: construction already paints the first frame, so we leave
      // the player paused at the start and let the user press play. Surface the
      // end of playback so the UI can offer a "replay from start" control.
      replayer.on(ReplayerEvents.Finish, () => {
        setStatus("finished");
      });
      // Fit the recorded viewport to the card width by CSS-scaling the wrapper.
      // The recorded viewport can change mid-replay (window resize, or a first
      // snapshot with no Meta that rrweb later resizes), and rrweb resizes the
      // iframe on each Meta/ViewportResize event. Scaling by a single fixed width
      // would then mismatch the live iframe size, so the replayed cursor — laid
      // out in current-viewport pixels inside the wrapper — drifts on the
      // segments whose size differs. Track the current dimensions from rrweb's
      // Resize event and re-fit, so the scale always matches the live iframe.
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
      // rrweb emits Resize for the initial Meta and every viewport change during
      // playback; mirror those dimensions so the scale stays aligned to the
      // cursor's coordinate space.
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
    } catch (err) {
      // Surface the real reason in the console while degrading gracefully in UI.
      console.error("rrweb Replayer failed to initialize", err);
      setFailed(true);
    }

    return () => {
      observer?.disconnect();
      try {
        // rrweb's Replayer has no destroy() in v2; pausing, dropping the ref and
        // clearing the DOM is the available teardown (listeners GC with it).
        replayer?.pause();
      } catch {
        /* ignore teardown failures */
      }
      replayerRef.current = null;
      container.replaceChildren();
    };
  }, [events]);

  const playFromStart = (): void => {
    try {
      replayerRef.current?.play(0);
      setStatus("playing");
    } catch {
      /* ignore */
    }
  };

  const pause = (): void => {
    try {
      replayerRef.current?.pause();
      setStatus("paused");
    } catch {
      /* ignore */
    }
  };

  const resume = (): void => {
    try {
      const replayer = replayerRef.current;
      if (replayer) {
        // Resume from where we paused rather than restarting at 0.
        replayer.play(replayer.getCurrentTime());
        setStatus("playing");
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <div ref={containerRef} className="replay-player" />
      {!failed && status === "idle" && (
        <button type="button" className="ghost small replay-restart" onClick={playFromStart}>
          ▶ 재생
        </button>
      )}
      {!failed && status === "playing" && (
        <button type="button" className="ghost small replay-restart" onClick={pause}>
          ⏸ 일시정지
        </button>
      )}
      {!failed && status === "paused" && (
        <button type="button" className="ghost small replay-restart" onClick={resume}>
          ▶ 이어보기
        </button>
      )}
      {!failed && status === "finished" && (
        <button type="button" className="ghost small replay-restart" onClick={playFromStart}>
          ↻ 처음부터 재생
        </button>
      )}
      {failed && <p className="muted small">리플레이를 재생할 수 없습니다.</p>}
    </>
  );
};

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
