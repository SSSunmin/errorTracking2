import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { api, ApiError, type AlertChannel, type AlertCondition } from "../api";
import { Spinner } from "../components";

export const AlertsPage = (): ReactNode => {
  const { projectId = "" } = useParams();
  const queryClient = useQueryClient();
  const rules = useQuery({
    queryKey: ["alert-rules", projectId],
    queryFn: () => api.listAlertRules(projectId)
  });

  const [name, setName] = useState("");
  const [channel, setChannel] = useState<AlertChannel>("slack");
  const [target, setTarget] = useState("");
  const [condition, setCondition] = useState<AlertCondition>("new_issue");
  const [threshold, setThreshold] = useState("5");
  const [windowMinutes, setWindowMinutes] = useState("60");
  const [error, setError] = useState<string | null>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["alert-rules", projectId] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.createAlertRule(projectId, {
        name: name.trim(),
        channel,
        target: target.trim(),
        condition,
        ...(condition === "event_threshold"
          ? { threshold: Number(threshold), windowMinutes: Number(windowMinutes) }
          : {})
      }),
    onSuccess: () => {
      setName("");
      setTarget("");
      setError(null);
      invalidate();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Failed to create rule");
    }
  });

  const remove = useMutation({
    mutationFn: (ruleId: string) => api.deleteAlertRule(projectId, ruleId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Failed to delete rule");
    }
  });

  return (
    <div className="page">
      <Link className="muted" to={`/projects/${projectId}`}>
        ← Issues
      </Link>
      <h2>Alert rules</h2>

      <form
        className="card form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && target.trim()) {
            create.mutate();
          }
        }}
      >
        <label>
          Name
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label>
          Channel
          <select
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value as AlertChannel);
            }}
          >
            <option value="slack">Slack</option>
            <option value="email">Email</option>
          </select>
        </label>
        <label>
          Target
          <input
            placeholder={
              channel === "slack"
                ? "https://hooks.slack.com/services/…"
                : "alerts@example.com"
            }
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
            }}
          />
        </label>
        <label>
          Condition
          <select
            value={condition}
            onChange={(e) => {
              setCondition(e.target.value as AlertCondition);
            }}
          >
            <option value="new_issue">New issue</option>
            <option value="regression">Regression</option>
            <option value="event_threshold">Event threshold</option>
          </select>
        </label>
        {condition === "event_threshold" && (
          <>
            <label>
              Threshold
              <input
                type="number"
                min={1}
                value={threshold}
                onChange={(e) => {
                  setThreshold(e.target.value);
                }}
              />
            </label>
            <label>
              Window (minutes)
              <input
                type="number"
                min={1}
                value={windowMinutes}
                onChange={(e) => {
                  setWindowMinutes(e.target.value);
                }}
              />
            </label>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={create.isPending}>
          Add rule
        </button>
      </form>

      {rules.isLoading && <Spinner />}
      {rules.data && rules.data.alertRules.length === 0 && (
        <p className="muted">No alert rules yet.</p>
      )}

      <div className="list">
        {rules.data?.alertRules.map((rule) => (
          <div key={rule.id} className="card row">
            <div>
              <strong>{rule.name}</strong>
              <p className="muted small">
                {rule.channel} → {rule.target} · {rule.condition}
                {rule.condition === "event_threshold"
                  ? ` (${String(rule.threshold)}/${String(rule.windowMinutes)}m)`
                  : ""}
              </p>
            </div>
            <button
              type="button"
              className="ghost danger"
              onClick={() => {
                remove.mutate(rule.id);
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
