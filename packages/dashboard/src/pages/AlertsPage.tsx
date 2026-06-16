import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { api, ApiError, type AlertChannel, type AlertCondition } from "../api";
import { Spinner } from "../components";
import { channelLabels, conditionLabels } from "../labels";

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
      setError(err instanceof ApiError ? err.message : "알림 규칙 생성에 실패했습니다.");
    }
  });

  const remove = useMutation({
    mutationFn: (ruleId: string) => api.deleteAlertRule(projectId, ruleId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "알림 규칙 삭제에 실패했습니다.");
    }
  });

  return (
    <div className="page">
      <Link className="muted" to={`/projects/${projectId}`}>
        ← 이슈
      </Link>
      <h2>알림 규칙</h2>

      <form
        className="card form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || !target.trim()) {
            setError("이름과 대상을 입력하세요.");
            return;
          }
          setError(null);
          create.mutate();
        }}
      >
        <label>
          이름
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label>
          채널
          <select
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value as AlertChannel);
            }}
          >
            <option value="slack">{channelLabels.slack}</option>
            <option value="email">{channelLabels.email}</option>
          </select>
        </label>
        <label>
          대상
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
          조건
          <select
            value={condition}
            onChange={(e) => {
              setCondition(e.target.value as AlertCondition);
            }}
          >
            <option value="new_issue">{conditionLabels.new_issue}</option>
            <option value="regression">{conditionLabels.regression}</option>
            <option value="event_threshold">{conditionLabels.event_threshold}</option>
          </select>
        </label>
        {condition === "event_threshold" && (
          <>
            <label>
              임계값
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
              기간(분)
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
          규칙 추가
        </button>
      </form>

      {rules.isLoading && <Spinner />}
      {rules.data && rules.data.alertRules.length === 0 && (
        <p className="muted">아직 알림 규칙이 없습니다.</p>
      )}

      <div className="list">
        {rules.data?.alertRules.map((rule) => (
          <div key={rule.id} className="card row">
            <div>
              <strong>{rule.name}</strong>
              <p className="muted small">
                {channelLabels[rule.channel]} → {rule.target} ·{" "}
                {conditionLabels[rule.condition]}
                {rule.condition === "event_threshold"
                  ? ` (${String(rule.windowMinutes)}분 내 ${String(rule.threshold)}건)`
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
              삭제
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
