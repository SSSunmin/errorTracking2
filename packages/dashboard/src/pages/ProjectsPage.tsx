import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { ApiError, api, type CreateProjectResponse } from "../api";
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

export const ProjectsPage = (): ReactNode => {
  const queryClient = useQueryClient();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects()
  });
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreateProjectResponse | null>(null);
  const [openDsn, setOpenDsn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createProject(name.trim()),
    onSuccess: (result) => {
      setCreated(result);
      setName("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "프로젝트 생성에 실패했습니다.");
    }
  });

  return (
    <div className="page">
      <h2>프로젝트</h2>

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
          <p className="muted">이 DSN을 앱에 설정하면 이벤트 전송이 시작됩니다:</p>
          <DsnBlock dsn={created.dsn} />
        </div>
      )}

      {projects.isLoading && <Spinner />}
      {projects.data && projects.data.projects.length === 0 && (
        <p className="muted">아직 프로젝트가 없습니다. 위에서 만들어 보세요.</p>
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
            {openDsn === project.id && <ProjectDsn projectId={project.id} />}
          </div>
        ))}
      </div>
    </div>
  );
};
