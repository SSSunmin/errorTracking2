import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { api, type IssueListItem } from "../api";
import { LevelBadge, relativeTime, Spinner, StatusBadge } from "../components";

const IssueRows = ({
  projectId,
  issues
}: {
  projectId: string;
  issues: IssueListItem[];
}): ReactNode => (
  <table className="issues">
    <tbody>
      {issues.map((issue) => (
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
);

export const ReleasesPage = (): ReactNode => {
  const { projectId = "" } = useParams();
  const [text, setText] = useState("");
  const [release, setRelease] = useState("");

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId)
  });
  const data = useQuery({
    queryKey: ["release-issues", projectId, release],
    queryFn: () => api.getReleaseIssues(projectId, release),
    enabled: release !== ""
  });

  return (
    <div className="page">
      <div className="page-head">
        <h2>{project.data?.project.name ?? "릴리스"} · 릴리스 회귀</h2>
        <Link className="ghost" to={`/projects/${projectId}`}>
          이슈 목록
        </Link>
      </div>

      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setRelease(text.trim());
        }}
      >
        <input
          placeholder="릴리스 (예: v1.0.0)"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <button type="submit" className="ghost">
          조회
        </button>
      </form>

      {release === "" && (
        <p className="muted">릴리스를 입력하면 신규/재발 이슈를 보여줍니다.</p>
      )}
      {data.isLoading && <Spinner />}

      {data.data && (
        <>
          <h3>신규 이슈</h3>
          {data.data.newIssues.length === 0 ? (
            <p className="muted">이 릴리스에서 처음 등장한 이슈가 없습니다.</p>
          ) : (
            <IssueRows projectId={projectId} issues={data.data.newIssues} />
          )}

          <h3>재발 이슈</h3>
          {data.data.regressedIssues.length === 0 ? (
            <p className="muted">이 릴리스에서 재발한 이슈가 없습니다.</p>
          ) : (
            <IssueRows projectId={projectId} issues={data.data.regressedIssues} />
          )}
        </>
      )}
    </div>
  );
};
