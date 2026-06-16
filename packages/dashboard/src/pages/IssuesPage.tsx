import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { api, type IssueStatus } from "../api";
import { LevelBadge, relativeTime, Spinner, StatusBadge } from "../components";
import { statusLabels } from "../labels";

export const IssuesPage = (): ReactNode => {
  const { projectId = "" } = useParams();
  const [status, setStatus] = useState<IssueStatus | "">("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("lastSeen");

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId)
  });
  const issues = useQuery({
    queryKey: ["issues", projectId, status, query, sort],
    queryFn: () =>
      api.listIssues(projectId, {
        status: status === "" ? undefined : status,
        query: query === "" ? undefined : query,
        sort
      })
  });

  return (
    <div className="page">
      <div className="page-head">
        <h2>{project.data?.project.name ?? "이슈"}</h2>
        <Link className="ghost" to={`/projects/${projectId}/alerts`}>
          알림 규칙
        </Link>
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
