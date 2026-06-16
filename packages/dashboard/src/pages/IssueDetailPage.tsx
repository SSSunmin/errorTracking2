import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { api, type IssueStatus } from "../api";
import { LevelBadge, relativeTime, Spinner, StatsChart, StatusBadge } from "../components";

interface Frame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

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

const KeyValues = ({ data }: { data: Record<string, unknown> }): ReactNode => {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;
  return (
    <dl className="kv">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{renderValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
};

export const IssueDetailPage = (): ReactNode => {
  const { projectId = "", issueId = "" } = useParams();
  const queryClient = useQueryClient();
  const [window, setWindow] = useState<"24h" | "7d">("24h");

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
  const latest = events.data?.events[0];
  const frames = getFrames(latest?.stacktrace);
  const breadcrumbs = asArray(latest?.breadcrumbs);

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

      {frames.length > 0 && (
        <section className="card">
          <h3>스택트레이스</h3>
          <ul className="frames">
            {frames.map((frame, index) => (
              <li key={index} className={frame.in_app ? "in-app" : "vendor"}>
                <span className="fn">{frame.function ?? "<anonymous>"}</span>
                <span className="muted small">
                  {frame.filename ?? "?"}
                  {frame.lineno !== undefined ? `:${String(frame.lineno)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {latest && (
        <section className="card">
          <h3>최근 이벤트</h3>
          {latest.exceptionType && (
            <p>
              <strong>{latest.exceptionType}</strong>: {latest.exceptionValue}
            </p>
          )}
          {latest.message && <p>{latest.message}</p>}
          {latest.requestUrl && <p className="muted small">{latest.requestUrl}</p>}
          {Object.keys(asRecord(latest.tags)).length > 0 && (
            <>
              <h4>태그</h4>
              <KeyValues data={asRecord(latest.tags)} />
            </>
          )}
          {Object.keys(asRecord(latest.userContext)).length > 0 && (
            <>
              <h4>사용자</h4>
              <KeyValues data={asRecord(latest.userContext)} />
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
    </div>
  );
};
