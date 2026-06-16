import { type ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth";
import { Spinner } from "./components";
import { ThemeToggle } from "./theme";
import { AlertsPage } from "./pages/AlertsPage";
import { IssueDetailPage } from "./pages/IssueDetailPage";
import { IssuesPage } from "./pages/IssuesPage";
import { LoginPage } from "./pages/LoginPage";
import { ProjectsPage } from "./pages/ProjectsPage";

const Layout = ({ children }: { children: ReactNode }): ReactNode => {
  const { user, logout } = useAuth();
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Mini-Sentry
        </Link>
        <div className="spacer" />
        <span className="muted">{user?.email}</span>
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
};
