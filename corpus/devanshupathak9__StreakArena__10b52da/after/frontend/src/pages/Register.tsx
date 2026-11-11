import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import GoogleButton from "../components/GoogleButton";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { authErrorMessage } from "../lib/authErrors";

const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export default function Register() {
  const { register } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      await register({ email, username, password, timezone: browserTimezone });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Start your streak</h1>
      <p className="muted">Track daily tasks and watch the tiles fill up.</p>

      {google && (
        <>
          <GoogleButton label="Sign up with Google" />
          <p className="muted small auth-google-note">
            We only ask for your name, email and picture — never a password.
          </p>
          <div className="auth-divider">
            <span>or</span>
          </div>
        </>
      )}

      <form className="stack" onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <label>
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="3-20 letters, numbers or _"
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            required
          />
        </label>

        {error && <p className="error">{error}</p>}

        <p className="muted small">
          Days roll over in <strong>{browserTimezone}</strong>. You can change this later in your
          profile.
        </p>

        <button type="submit" className="button" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>

      <p className="muted">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </AuthLayout>
  );
}
