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

const formatJoinDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ko-KR");

// Account modal: shows the signed-in user's id/email/join date (read-only) and
// lets them edit their own display name (PATCH /api/auth/me).
const ProfileModal = ({ onClose }: { onClose: () => void }): ReactNode => {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!user) {
    return null;
  }

  const save = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("이름을 입력하세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateProfile(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "이름 변경에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const copyId = (): void => {
    void navigator.clipboard?.writeText(user.id).then(() => {
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    });
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="계정 정보">
        <div className="card-head">
          <h3>계정 정보</h3>
          <button type="button" className="ghost small" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="modal-field">
          <span className="muted small">ID</span>
          <div className="row">
            <code>{user.id}</code>
            <button type="button" className="ghost small" onClick={copyId}>
              {copied ? "복사됨" : "복사"}
            </button>
          </div>
        </div>
        <div className="modal-field">
          <span className="muted small">이메일</span>
          <span>{user.email}</span>
        </div>
        <div className="modal-field">
          <span className="muted small">가입일</span>
          <span>{formatJoinDate(user.createdAt)}</span>
        </div>

        <form
          className="modal-field"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="muted small" htmlFor="profile-name">
            이름
          </label>
          <input
            id="profile-name"
            type="text"
            value={name}
            maxLength={120}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          {error && <span className="error small">{error}</span>}
          <div className="modal-actions">
            <button type="submit" className="primary" disabled={busy}>
              저장
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ProfileMenu = (): ReactNode => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        {user.name ?? user.email} ▾
      </button>
      {open && <ProfileModal onClose={() => { setOpen(false); }} />}
    </>
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
        <ProfileMenu />
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
