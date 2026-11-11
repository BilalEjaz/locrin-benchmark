import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { KeyRound, Unlink } from "lucide-react";
import GoogleButton from "../GoogleButton";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { authErrorMessage } from "../../lib/authErrors";

/**
 * The two ways into an account, and the rule that keeps you out of neither: Google
 * can only be disconnected once a password exists, because otherwise disconnecting
 * removes the last door.
 */
export default function SignInMethods() {
  const { user, setUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(authErrorMessage(params.get("error")));
  const [done, setDone] = useState(params.get("linked") === "google" ? "Google connected." : "");

  if (!user) return null;
  const account = user;

  /** The redirect back from Google leaves a note in the URL; read it once. */
  function clearNotice() {
    if (params.has("error") || params.has("linked")) {
      const rest = new URLSearchParams(params);
      rest.delete("error");
      rest.delete("linked");
      setParams(rest, { replace: true });
    }
  }

  async function handlePassword(event: FormEvent) {
    event.preventDefault();
    setError("");
    setDone("");
    setBusy(true);
    try {
      setUser(
        await api.setPassword(
          account.hasPassword ? { password: next, currentPassword: current } : { password: next },
        ),
      );
      setDone(account.hasPassword ? "Password changed." : "Password set.");
      setCurrent("");
      setNext("");
      setOpen(false);
      clearNotice();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink() {
    if (!window.confirm("Disconnect Google? You'll sign in with your password instead.")) return;
    setError("");
    setDone("");
    setBusy(true);
    try {
      setUser(await api.unlinkGoogle());
      setDone("Google disconnected.");
      clearNotice();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Sign-in methods</h2>
          <p className="muted small">How you get into this account</p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {done && <p className="muted small signin-done">{done}</p>}

      <ul className="signin-list">
        <li className="signin-row">
          <KeyRound size={18} strokeWidth={1.9} aria-hidden="true" className="signin-icon" />
          <div className="signin-text">
            <span className="profile-label">Password</span>
            <span className="muted small">
              {account.hasPassword ? "Set" : "Not set — you sign in with Google"}
            </span>
          </div>
          <button
            type="button"
            className="button button-ghost button-sm"
            onClick={() => setOpen(!open)}
          >
            {account.hasPassword ? "Change" : "Set a password"}
          </button>
        </li>

        <li className="signin-row">
          <span className="signin-icon signin-google" aria-hidden="true">
            G
          </span>
          <div className="signin-text">
            <span className="profile-label">Google</span>
            <span className="muted small">
              {account.googleLinked ? (account.googleEmail ?? "Connected") : "Not connected"}
            </span>
          </div>

          {account.googleLinked ? (
            <button
              type="button"
              className="button button-ghost button-sm"
              onClick={handleUnlink}
              disabled={busy || !account.hasPassword}
              title={
                account.hasPassword
                  ? "Disconnect Google"
                  : "Set a password first — Google is the only way into this account"
              }
            >
              <Unlink size={14} strokeWidth={2.2} aria-hidden="true" />
              Disconnect
            </button>
          ) : (
            <div className="signin-connect">
              <GoogleButton label="Connect" intent="link" />
            </div>
          )}
        </li>
      </ul>

      {account.googleLinked && !account.hasPassword && (
        <p className="muted small">
          Set a password and you'll have two ways in. Until then Google is the only one, so it
          can't be disconnected.
        </p>
      )}

      {open && (
        <form className="stack signin-form" onSubmit={handlePassword}>
          {account.hasPassword && (
            <label>
              Current password
              <input
                type="password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
          )}

          <label>
            {account.hasPassword ? "New password" : "Password"}
            <input
              type="password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              required
            />
          </label>

          <div className="signin-actions">
            <button type="submit" className="button" disabled={busy || next.length < 8}>
              {busy ? "Saving…" : account.hasPassword ? "Change password" : "Set password"}
            </button>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                setOpen(false);
                setCurrent("");
                setNext("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
