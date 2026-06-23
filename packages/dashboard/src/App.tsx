import { useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";

import { ApiError } from "./api";
import { useAuth } from "./auth";
import { Spinner } from "./components";
import { ThemeToggle } from "./theme";
import { AlertsPage } from "./pages/AlertsPage";
import { IssueDetailPage } from "./pages/IssueDetailPage";
import { IssuesPage } from "./pages/IssuesPage";
import { LoginPage } from "./pages/LoginPage";
import { MembersPage } from "./pages/MembersPage";
import { ProjectsPage } from "./pages/ProjectsPage";

// Inline editor for the signed-in user's own display name (PATCH /api/auth/me).
const ProfileName = (): ReactNode => {
  const { user, updateProfile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return null;
  }

  if (!editing) {
    return (
      <span className="row muted">
        {user.name ?? user.email}
        <button
          type="button"
          className="ghost small"
          onClick={() => {
            setName(user.name ?? "");
            setError(null);
            setEditing(true);
          }}
        >
          이름 수정
        </button>
      </span>
    );
  }

  const save = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("이름을 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      await updateProfile(trimmed);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "이름 변경에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="row"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input
        type="text"
        aria-label="이름"
        value={name}
        maxLength={120}
        disabled={busy}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <button type="submit" className="ghost small" disabled={busy}>
        저장
      </button>
      <button
        type="button"
        className="ghost small"
        disabled={busy}
        onClick={() => {
          setEditing(false);
        }}
      >
        취소
      </button>
      {error && <span className="error small">{error}</span>}
    </form>
  );
};

const Layout = ({ children }: { children: ReactNode }): ReactNode => {
  const { logout } = useAuth();
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Mini-Sentry
        </Link>
        <div className="spacer" />
        <ProfileName />
        <ThemeToggle />
        <button
          type="button"
          className="ghost"
          onClick={() => {
            void logout();
          }}
        >
          로그아웃
        </button>
      </header>
      <main>{children}</main>
    </>
  );
};

export const App = (): ReactNode => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<IssuesPage />} />
        <Route
          path="/projects/:projectId/issues/:issueId"
          element={<IssueDetailPage />}
        />
        <Route path="/projects/:projectId/alerts" element={<AlertsPage />} />
        <Route path="/projects/:projectId/members" element={<MembersPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
};
