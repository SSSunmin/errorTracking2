import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { api, type IssueLevel, type IssueStatus } from "../api";
import { LevelBadge, relativeTime, Spinner, StatusBadge } from "../components";
import { levelLabels, statusLabels } from "../labels";

// A date input gives the user's local YYYY-MM-DD; expand it to an inclusive
// day boundary as a UTC instant so the lastSeen window covers exactly the local
// day picked. `new Date("YYYY-MM-DDThh:mm:ss")` (no zone) parses as local time,
// then toISOString() converts to the matching UTC instant the server compares.
const dayStartIso = (day: string): string | undefined =>
  day === "" ? undefined : new Date(`${day}T00:00:00.000`).toISOString();
const dayEndIso = (day: string): string | undefined =>
  day === "" ? undefined : new Date(`${day}T23:59:59.999`).toISOString();

export const IssuesPage = (): ReactNode => {
  const { projectId = "" } = useParams();
  const [status, setStatus] = useState<IssueStatus | "">("");
  const [level, setLevel] = useState<IssueLevel | "">("");
  const [environment, setEnvironment] = useState("");
  const [release, setRelease] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("lastSeen");

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId)
  });
  const facets = useQuery({
    queryKey: ["issue-facets", projectId],
    queryFn: () => api.listIssueFacets(projectId)
  });
  const issues = useQuery({
    queryKey: [
      "issues",
      projectId,
      status,
      level,
      environment,
      release,
      since,
      until,
      query,
      sort
    ],
    queryFn: () =>
      api.listIssues(projectId, {
        status: status === "" ? undefined : status,
        level: level === "" ? undefined : level,
        environment: environment.trim() === "" ? undefined : environment.trim(),
        release: release.trim() === "" ? undefined : release.trim(),
        since: dayStartIso(since),
        until: dayEndIso(until),
        query: query === "" ? undefined : query,
        sort
      })
  });

  return (
    <div className="page">
      <div className="page-head">
        <h2>{project.data?.project.name ?? "이슈"}</h2>
        <div className="row">
          <Link className="ghost" to={`/projects/${projectId}/members`}>
            멤버
          </Link>
          <Link className="ghost" to={`/projects/${projectId}/alerts`}>
            알림 규칙
          </Link>
        </div>
      </div>

      <div className="filters">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as IssueStatus | "");
          }}
        >
          <option value="">전체 상태</option>
          <option value="unresolved">{statusLabels.unresolved}</option>
          <option value="resolved">{statusLabels.resolved}</option>
          <option value="ignored">{statusLabels.ignored}</option>
        </select>
        <select
          value={level}
          onChange={(e) => {
            setLevel(e.target.value as IssueLevel | "");
          }}
        >
          <option value="">전체 레벨</option>
          <option value="debug">{levelLabels.debug}</option>
          <option value="info">{levelLabels.info}</option>
          <option value="warning">{levelLabels.warning}</option>
          <option value="error">{levelLabels.error}</option>
          <option value="fatal">{levelLabels.fatal}</option>
        </select>
        <input
          placeholder="환경"
          list="env-facets"
          value={environment}
          onChange={(e) => {
            setEnvironment(e.target.value);
          }}
        />
        <datalist id="env-facets">
          {(facets.data?.environments ?? []).map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <input
          placeholder="릴리스"
          list="release-facets"
          value={release}
          onChange={(e) => {
            setRelease(e.target.value);
          }}
        />
        <datalist id="release-facets">
          {(facets.data?.releases ?? []).map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <input
          type="date"
          aria-label="시작일 (마지막 발생)"
          value={since}
          onChange={(e) => {
            setSince(e.target.value);
          }}
        />
        <input
          type="date"
          aria-label="종료일 (마지막 발생)"
          value={until}
          onChange={(e) => {
            setUntil(e.target.value);
          }}
        />
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
          }}
        >
          <option value="lastSeen">최근 발생순</option>
          <option value="firstSeen">최초 발생순</option>
          <option value="timesSeen">이벤트 수</option>
        </select>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(text.trim());
          }}
        >
          <input
            placeholder="제목 검색…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <button type="submit" className="ghost">
            검색
          </button>
        </form>
      </div>

      {issues.isLoading && <Spinner />}
      {issues.data && issues.data.issues.length === 0 && (
        <p className="muted">조건에 맞는 이슈가 없습니다.</p>
      )}

      <table className="issues">
        <tbody>
          {issues.data?.issues.map((issue) => (
            <tr key={issue.id}>
              <td>
                <Link
                  className="title"
                  to={`/projects/${projectId}/issues/${issue.id}`}
                >
                  {issue.title}
                </Link>
                {issue.culprit && <div className="muted small">{issue.culprit}</div>}
              </td>
              <td>
                <LevelBadge level={issue.level} />
              </td>
              <td>
                <StatusBadge status={issue.status} />
              </td>
              <td className="num">{issue.timesSeen}</td>
              <td className="muted small">{relativeTime(issue.lastSeen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
