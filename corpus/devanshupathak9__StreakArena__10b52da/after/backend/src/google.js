import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
const CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
const REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI ?? "").trim();

/**
 * Google sign-in is optional. With no credentials configured the routes answer 404
 * and the frontend hides the button — so a deployment that has never been near the
 * Google console still boots and still has working password login.
 */
export const googleEnabled = Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Identity only. All three are non-sensitive scopes, so no Google review is needed. */
const SCOPE = "openid email profile";

export function newNonce() {
  return crypto.randomUUID();
}

export function authUrl(state, { prompt = "select_account" } = {}) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    state,
    prompt,
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

/**
 * Swaps the one-time code for tokens. This runs server-side because it carries the
 * client secret — the browser never sees it.
 */
export async function exchangeCode(code) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    // Google puts the useful part in the body; the status alone is always 400.
    const detail = await response.text().catch(() => "");
    throw new Error(`Google token exchange failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const body = await response.json();
  if (!body.id_token) throw new Error("Google returned no id_token");
  return body.id_token;
}

/**
 * Reads the identity out of the ID token.
 *
 * The signature is not re-verified: this token came straight back from Google's own
 * token endpoint over TLS in the call above, which Google's documentation treats as
 * sufficient. `aud` and `iss` are still checked, because those are what catch a token
 * minted for a different application.
 */
export function claimsFrom(idToken) {
  const claims = jwt.decode(idToken);
  if (!claims || typeof claims !== "object") throw new Error("Google id_token was unreadable");

  if (claims.aud !== CLIENT_ID) throw new Error("Google id_token was issued for another app");
  if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") {
    throw new Error("Google id_token has an unexpected issuer");
  }
  if (!claims.sub) throw new Error("Google id_token carried no subject");

  return {
    sub: String(claims.sub),
    email: claims.email ? String(claims.email).toLowerCase() : null,
    // Google will hand over an unverified address; it must never be matched on.
    emailVerified: claims.email_verified === true,
    name: claims.name ? String(claims.name) : null,
    picture: claims.picture ? String(claims.picture) : null,
  };
}

/**
 * Google has no concept of a username, so one is derived from the email local part
 * and squeezed into the shape the rest of the app enforces: 3-20 of [A-Za-z0-9_].
 * The caller resolves collisions, because only it can see the database.
 */
export function usernameSeed(claims) {
  const base = (claims.email?.split("@")[0] ?? claims.name ?? "streaker")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  if (base.length >= 3) return base.slice(0, 20);
  return `${base}streaker`.slice(0, 20);
}
