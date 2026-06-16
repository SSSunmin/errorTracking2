import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { api, type IssueStatus } from "../api";
import { LevelBadge, relativeTime, Spinner, StatusBadge } from "../components";

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
        <h2>{project.data?.project.name ?? "Issues"}</h2>
        <Link className="ghost" to={`/projects/${projectId}/alerts`}>
          Alert rules
        </Link>
      </div>

      <div className="filters">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as IssueStatus | "");
          }}
        >
          <option value="">All statuses</option>
          <option value="unresolved">Unresolved</option>
          <option value="resolved">Resolved</option>
          <option value="ignored">Ignored</option>
        </select>
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
          }}
        >
          <option value="lastSeen">Last seen</option>
          <option value="firstSeen">First seen</option>
          <option value="timesSeen">Events</option>
        </select>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(text.trim());
          }}
        >
          <input
            placeholder="Search title…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <button type="submit" className="ghost">
            Search
          </button>
        </form>
      </div>

      {issues.isLoading && <Spinner />}
      {issues.data && issues.data.issues.length === 0 && (
        <p className="muted">No issues match.</p>
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
