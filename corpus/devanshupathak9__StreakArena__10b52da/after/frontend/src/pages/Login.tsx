import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import GoogleButton from "../components/GoogleButton";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { authErrorMessage } from "../lib/authErrors";

export default function Login() {
  const { login } = useAuth();
  const [params] = useSearchParams();
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");
  // A failed Google round trip comes back as ?error=, so it seeds the same slot a
  // failed password login writes to.
  const [error, setError] = useState(authErrorMessage(params.get("error")));
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    api
      .authConfig()
      .then((config) => setGoogle(config.google))
      .catch(() => setGoogle(false));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login({ emailOrUsername, password });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Welcome back</h1>
      <p className="muted">Pick up your streak where you left off.</p>

      {google && (
        <>
          <GoogleButton label="Continue with Google" />
          <div className="auth-divider">
            <span>or</span>
          </div>
        </>
      )}

      <form className="stack" onSubmit={handleSubmit}>
        <label>
          Email or username
          <input
            value={emailOrUsername}
            onChange={(event) => setEmailOrUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" className="button" disabled={busy}>
          {busy ? "Signing in…" : "Log in"}
        </button>
      </form>

      <p className="muted">
        New here? <Link to="/register">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
