import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { api, type CreateProjectResponse } from "../api";
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
      {copied ? "Copied" : "Copy"}
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
  if (!active) return <p className="muted">No keys.</p>;
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

  const create = useMutation({
    mutationFn: () => api.createProject(name.trim()),
    onSuccess: (result) => {
      setCreated(result);
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  });

  return (
    <div className="page">
      <h2>Projects</h2>

      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) {
            create.mutate();
          }
        }}
      >
        <input
          placeholder="New project name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <button type="submit" className="primary" disabled={create.isPending}>
          Create project
        </button>
      </form>

      {created && (
        <div className="card success">
          <h3>Created “{created.project.name}”</h3>
          <p className="muted">Point your app at this DSN to start sending events:</p>
          <DsnBlock dsn={created.dsn} />
        </div>
      )}

      {projects.isLoading && <Spinner />}
      {projects.data && projects.data.projects.length === 0 && (
        <p className="muted">No projects yet. Create one above.</p>
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
                  {project.platform} · {project.keyCount} key
                  {project.keyCount === 1 ? "" : "s"} · updated{" "}
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
                {openDsn === project.id ? "Hide DSN" : "Show DSN"}
              </button>
            </div>
            {openDsn === project.id && <ProjectDsn projectId={project.id} />}
          </div>
        ))}
      </div>
    </div>
  );
};
