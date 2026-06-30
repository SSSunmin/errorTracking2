import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import {
  ApiError,
  api,
  type CreateProjectResponse,
  type ProjectOverview,
  type ProjectOverviewBucket,
  type StatsWindow
} from "../api";
import { relativeTime, Spinner } from "../components";

const CopyButton = ({ value }: { value: string }): ReactNode => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ghost"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 1500);
      }}
    >
      {copied ? "복사됨" : "복사"}
    </button>
  );
};

const DsnBlock = ({ dsn }: { dsn: string }): ReactNode => (
  <div className="dsn-block">
    <div className="dsn-row">
      <code>{dsn}</code>
      <CopyButton value={dsn} />
    </div>
    <pre className="snippet">{`import { init } from "@mini-sentry/sdk";

init({ dsn: "${dsn}" });`}</pre>
  </div>
);

const ProjectDsn = ({ projectId }: { projectId: string }): ReactNode => {
  const keys = useQuery({
    queryKey: ["keys", projectId],
    queryFn: () => api.listKeys(projectId)
  });
  if (keys.isLoading) return <Spinner />;
  const active = keys.data?.keys.find((key) => key.isActive) ?? keys.data?.keys[0];
  if (!active) return <p className="muted">키가 없습니다.</p>;
  return <DsnBlock dsn={active.dsn} />;
};

export const ProjectSparkline = ({
  buckets
}: {
  buckets: ProjectOverviewBucket[];
}): ReactNode => {
  if (buckets.length === 0) {
    return <p className="muted small">데이터 없음</p>;
  }

  const width = 120;
  const height = 34;
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const points = buckets.map((bucket, index) => {
    const x =
      buckets.length === 1 ? width / 2 : (index / (buckets.length - 1)) * width;
    const y = height - 4 - (bucket.count / max) * (height - 8);
    return { x, y, bucket };
  });
  const pointString = points
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      role="img"
      aria-label="프로젝트 이벤트 추세"
    >
      <polyline
        points={pointString}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {points.map((point) => (
        <circle
          key={point.bucket.bucket}
          cx={point.x}
          cy={point.y}
          r={2}
          fill="var(--accent)"
          vectorEffect="non-scaling-stroke"
        >
          <title>{`${point.bucket.bucket}: ${String(point.bucket.count)}건`}</title>
        </circle>
      ))}
    </svg>
  );
};

const ProjectHealth = ({
  summary,
  isLoading,
  isError
}: {
  summary: ProjectOverview | undefined;
  isLoading: boolean;
  isError: boolean;
}): ReactNode => {
  if (isError) {
    return <p className="muted small">헬스 지표를 불러오지 못했습니다.</p>;
  }
  if (isLoading) {
    return <Spinner />;
  }
  // Loaded but this project is absent from the overview response (e.g. a brief
  // race right after creating a project) — show a neutral placeholder rather
  // than spinning forever.
  if (!summary) {
    return <p className="muted small">헬스 지표 없음</p>;
  }

  return (
    <div className="project-health">
      <div className="metric">
        <span className="metric-label">이벤트</span>
        <strong className="metric-value">{summary.events.toLocaleString()}</strong>
      </div>
      <div className="metric">
        <span className="metric-label">열린 이슈</span>
        <strong className="metric-value">{summary.openIssues.toLocaleString()}</strong>
      </div>
      <div className="metric">
        <span className="metric-label">마지막 이벤트</span>
        <strong className="metric-value">
          {summary.lastEventAt ? relativeTime(summary.lastEventAt) : "없음"}
        </strong>
      </div>
      <div className="sparkline-wrap">
        <ProjectSparkline buckets={summary.buckets} />
      </div>
    </div>
  );
};

export const ProjectsPage = (): ReactNode => {
  const queryClient = useQueryClient();
  const [statsWindow, setStatsWindow] = useState<StatsWindow>("24h");
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects()
  });
  const overview = useQuery({
    queryKey: ["projectsOverview", statsWindow],
    queryFn: () => api.getProjectsOverview(statsWindow)
  });
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreateProjectResponse | null>(null);
  const [openDsn, setOpenDsn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const overviewByProject = useMemo(
    () =>
      new Map(
        (overview.data?.projects ?? []).map((summary) => [
          summary.projectId,
          summary
        ])
      ),
    [overview.data]
  );

  const create = useMutation({
    mutationFn: () => api.createProject(name.trim()),
    onSuccess: (result) => {
      setCreated(result);
      setName("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["projectsOverview"] });
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "프로젝트 생성에 실패했습니다."
      );
    }
  });

  return (
    <div className="page">
      <div className="page-head">
        <h2>프로젝트</h2>
        <div className="tabs small">
          <button
            type="button"
            className={statsWindow === "24h" ? "active" : ""}
            onClick={() => {
              setStatsWindow("24h");
            }}
          >
            24h
          </button>
          <button
            type="button"
            className={statsWindow === "7d" ? "active" : ""}
            onClick={() => {
              setStatsWindow("7d");
            }}
          >
            7d
          </button>
        </div>
      </div>

      <div className="create-project">
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) {
              setError("프로젝트 이름을 입력하세요.");
              return;
            }
            setError(null);
            create.mutate();
          }}
        >
          <input
            placeholder="새 프로젝트 이름"
            aria-invalid={error !== null}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) {
                setError(null);
              }
            }}
          />
          <button type="submit" className="primary" disabled={create.isPending}>
            프로젝트 생성
          </button>
        </form>
        {error && (
          <p className="error small form-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {created && (
        <div className="card success">
          <h3>“{created.project.name}” 생성됨</h3>
          <p className="muted">
            이 DSN을 앱에 설정하면 이벤트 전송이 시작됩니다:
          </p>
          <DsnBlock dsn={created.dsn} />
        </div>
      )}

      {projects.isLoading && <Spinner />}
      {projects.isError && (
        <p className="muted">프로젝트 목록을 불러오지 못했습니다.</p>
      )}
      {projects.data && projects.data.projects.length === 0 && (
        <p className="muted">
          아직 프로젝트가 없습니다. 위에서 먼저 만들어 보세요.
        </p>
      )}

      <div className="list">
        {projects.data?.projects.map((project) => (
          <div key={project.id} className="card">
            <div className="card-head">
              <div>
                <Link className="title" to={`/projects/${project.id}`}>
                  {project.name}
                </Link>
                <p className="muted">
                  {project.platform} · 키 {project.keyCount}개 · 업데이트{" "}
                  {relativeTime(project.updatedAt)}
                </p>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setOpenDsn(openDsn === project.id ? null : project.id);
                }}
              >
                {openDsn === project.id ? "DSN 숨기기" : "DSN 보기"}
              </button>
            </div>
            <ProjectHealth
              summary={overviewByProject.get(project.id)}
              isLoading={overview.isLoading}
              isError={overview.isError}
            />
            {openDsn === project.id && <ProjectDsn projectId={project.id} />}
          </div>
        ))}
      </div>
    </div>
  );
};
