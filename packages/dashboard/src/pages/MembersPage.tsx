import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { api, ApiError, type ProjectRole } from "../api";
import { useAuth } from "../auth";
import { relativeTime, Spinner } from "../components";

const roleLabels: Record<ProjectRole, string> = {
  owner: "소유자",
  member: "멤버"
};

export const MembersPage = (): ReactNode => {
  const { projectId = "" } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const members = useQuery({
    queryKey: ["members", projectId],
    queryFn: () => api.listMembers(projectId)
  });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>("member");
  const [error, setError] = useState<string | null>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["members", projectId] });
  };

  const add = useMutation({
    mutationFn: () => api.addMember(projectId, email.trim(), role),
    onSuccess: () => {
      setEmail("");
      setError(null);
      invalidate();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "멤버 추가에 실패했습니다.");
    }
  });

  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: ProjectRole }) =>
      api.updateMemberRole(projectId, input.userId, input.role),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "역할 변경에 실패했습니다.");
    }
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(projectId, userId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "멤버 삭제에 실패했습니다.");
    }
  });

  if (members.isLoading) {
    return <Spinner />;
  }

  const list = members.data?.members ?? [];
  // The current user is an owner when their own membership has the owner role.
  // Computed after load so the owner-only controls don't flash hidden first.
  const isOwner =
    list.find((member) => member.userId === user?.id)?.role === "owner";

  return (
    <div className="page">
      <Link className="muted" to={`/projects/${projectId}`}>
        ← 이슈
      </Link>
      <h2>멤버</h2>

      {isOwner && (
        <form
          className="card form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            if (!email.trim()) {
              setError("이메일을 입력하세요.");
              return;
            }
            setError(null);
            add.mutate();
          }}
        >
          <label>
            이메일
            <input
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          </label>
          <label>
            역할
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value as ProjectRole);
              }}
            >
              <option value="member">{roleLabels.member}</option>
              <option value="owner">{roleLabels.owner}</option>
            </select>
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary" disabled={add.isPending}>
            멤버 추가
          </button>
        </form>
      )}

      {members.isLoading && <Spinner />}

      <div className="list">
        {list.map((member) => (
          <div key={member.userId} className="card row">
            <div>
              <strong>{member.email}</strong>
              <p className="muted small">
                {member.name ? `${member.name} · ` : ""}
                {roleLabels[member.role]} · 추가 {relativeTime(member.createdAt)}
              </p>
            </div>
            {isOwner && member.userId !== user?.id && (
              <div className="row">
                <select
                  value={member.role}
                  onChange={(e) => {
                    changeRole.mutate({
                      userId: member.userId,
                      role: e.target.value as ProjectRole
                    });
                  }}
                >
                  <option value="member">{roleLabels.member}</option>
                  <option value="owner">{roleLabels.owner}</option>
                </select>
                <button
                  type="button"
                  className="ghost danger"
                  onClick={() => {
                    remove.mutate(member.userId);
                  }}
                >
                  삭제
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
