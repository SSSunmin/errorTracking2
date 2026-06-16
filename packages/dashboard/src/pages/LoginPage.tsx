import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "../api";
import { useAuth } from "../auth";

export const LoginPage = (): ReactNode => {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, name.trim() ? name.trim() : undefined);
      }
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-card">
      <h1>Mini-Sentry</h1>
      <div className="tabs">
        <button
          type="button"
          className={mode === "login" ? "active" : ""}
          onClick={() => {
            setMode("login");
            setError(null);
          }}
        >
          Log in
        </button>
        <button
          type="button"
          className={mode === "register" ? "active" : ""}
          onClick={() => {
            setMode("register");
            setError(null);
          }}
        >
          Sign up
        </button>
      </div>
      <form onSubmit={submit}>
        {mode === "register" && (
          <label>
            Name (optional)
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
    </div>
  );
};
