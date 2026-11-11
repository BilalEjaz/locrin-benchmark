import jwt from "jsonwebtoken";
import { Router } from "express";
import { prisma } from "../db.js";
import {
  clearAuthCookie,
  hashPassword,
  loadUser,
  publicUser,
  requireAuth,
  setAuthCookie,
  setOAuthState,
  takeOAuthState,
  verifyPassword,
} from "../auth.js";
import {
  authUrl,
  claimsFrom,
  exchangeCode,
  googleEnabled,
  newNonce,
  usernameSeed,
} from "../google.js";
import { isValidTimezone } from "../streak.js";
import { openStored, removeStored, storeUpload, upload, uploadErrorMessage } from "../uploads.js";

export const authRouter = Router();
export const avatarRouter = Router();

/** An uploaded avatar is served back through this prefix, never as static files. */
const AVATAR_PREFIX = "/api/avatars/";

/** Only uploads we served ourselves can be deleted when one is replaced. */
function storedAvatarKey(avatarUrl) {
  if (!avatarUrl?.startsWith(AVATAR_PREFIX)) return null;
  const key = avatarUrl.slice(AVATAR_PREFIX.length);
  return /^[0-9a-f-]{36}$/i.test(key) ? key : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LIMITS = { displayName: 50, bio: 160, location: 60, avatarUrl: 300 };

/**
 * An avatar is rendered straight into an <img>, so the scheme is checked rather than
 * trusted — "javascript:" and "data:" have no business in a src we hand to everyone
 * who can see this profile.
 */
function avatarProblem(value) {
  if (value.length > LIMITS.avatarUrl) return `Keep the image URL under ${LIMITS.avatarUrl} characters`;
  let url;
  try {
    url = new URL(value);
  } catch {
    return "That doesn't look like a URL";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Use an http(s) image URL";
  return null;
}
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

authRouter.post("/register", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const timezone = String(req.body?.timezone ?? "UTC");

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: "Username must be 3-20 letters, numbers or underscores" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (!isValidTimezone(timezone)) return res.status(400).json({ error: "Unknown timezone" });

  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
  if (existing) {
    const field = existing.email === email ? "email" : "username";
    return res.status(409).json({ error: `That ${field} is already taken` });
  }

  const user = await prisma.user.create({
    data: { email, username, timezone, passwordHash: await hashPassword(password) },
  });
  setAuthCookie(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post("/login", async (req, res) => {
  const identifier = String(req.body?.emailOrUsername ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!identifier || !password) {
    return res.status(400).json({ error: "Enter your email/username and password" });
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier.toLowerCase() }, { username: identifier }] },
  });
  // Same message either way, so this can't be used to probe which accounts exist —
  // including for a Google-only account, which has no password to compare against.
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Incorrect email/username or password" });
  }

  setAuthCookie(res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, loadUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

authRouter.patch("/me", requireAuth, loadUser, async (req, res) => {
  const data = {};

  if (req.body?.username !== undefined) {
    const username = String(req.body.username).trim();
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: "Username must be 3-20 letters, numbers or underscores" });
    }
    if (username !== req.user.username) {
      const taken = await prisma.user.findUnique({ where: { username } });
      if (taken) return res.status(409).json({ error: "That username is already taken" });
      data.username = username;
    }
  }

  // Free-text profile fields: trimmed, length-capped, and blanked back to null.
  for (const field of ["displayName", "bio", "location"]) {
    if (req.body?.[field] === undefined) continue;
    const value = String(req.body[field]).trim();
    if (value.length > LIMITS[field]) {
      return res.status(400).json({ error: `Keep ${field === "displayName" ? "your name" : field} under ${LIMITS[field]} characters` });
    }
    data[field] = value || null;
  }

  if (req.body?.avatarUrl !== undefined) {
    const value = String(req.body.avatarUrl).trim();
    if (!value) {
      data.avatarUrl = null;
    } else {
      const problem = avatarProblem(value);
      if (problem) return res.status(400).json({ error: problem });
      data.avatarUrl = value;
    }
  }

  if (req.body?.timezone !== undefined) {
    const timezone = String(req.body.timezone);
    if (!isValidTimezone(timezone)) return res.status(400).json({ error: "Unknown timezone" });
    data.timezone = timezone;
  }

  const user = Object.keys(data).length
    ? await prisma.user.update({ where: { id: req.user.id }, data })
    : req.user;
  res.json({ user: publicUser(user) });
});

/**
 * Upload a picture instead of hunting for a URL. The bytes go through the same
 * store the chat attachments use, so S3 on ECS and a volume locally — and the old
 * one is deleted on replace, because nothing else will ever come looking for it.
 */
authRouter.post("/me/avatar", requireAuth, loadUser, (req, res) => {
  upload.single("avatar")(req, res, async (uploadError) => {
    if (uploadError) return res.status(400).json({ error: uploadErrorMessage(uploadError) });
    if (!req.file) return res.status(400).json({ error: "Choose an image first" });

    // The shared allow-list lets PDFs and text through; an avatar is an image.
    if (!req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ error: "That needs to be an image" });
    }

    const previous = storedAvatarKey(req.user.avatarUrl);
    const key = await storeUpload(req.file);
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl: `${AVATAR_PREFIX}${key}` },
    });

    if (previous) removeStored(previous);
    res.json({ user: publicUser(user) });
  });
});

/* ------------------------------------------------------------------------- *
 * Google sign-in
 *
 * The server-side authorization-code flow, not the Google Identity Services
 * button: the client secret stays on the server, the browser loads no Google
 * script, and because the whole app is one origin the session cookie it sets at
 * the end is the same first-party cookie password login uses.
 * ------------------------------------------------------------------------- */

/** Where to send the browser once the round trip is over. Relative in production. */
const APP_ORIGIN = (process.env.APP_ORIGIN ?? "").replace(/\/+$/, "");

function backToApp(res, path) {
  res.redirect(`${APP_ORIGIN}${path}`);
}

/**
 * Lets the signed-out frontend know whether to render the Google button at all,
 * so an unconfigured deployment simply doesn't offer it.
 */
authRouter.get("/config", (req, res) => {
  res.json({ google: googleEnabled });
});

/**
 * Google has no usernames, so one is derived from the email and then made unique.
 * Sequential suffixes first because they read like something a person chose; random
 * ones only once the obvious names are gone.
 */
async function uniqueUsername(seed) {
  const candidates = [seed];
  for (let n = 2; n <= 9; n++) candidates.push(`${seed.slice(0, 19)}${n}`);
  for (let i = 0; i < 12; i++) {
    const suffix = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
    candidates.push(`${seed.slice(0, 16)}${suffix}`);
  }

  for (const candidate of candidates) {
    const taken = await prisma.user.findUnique({ where: { username: candidate } });
    if (!taken) return candidate;
  }
  return null;
}

/**
 * Step one: stash a nonce in an httpOnly cookie, send its twin to Google in `state`.
 *
 * `tz` rides along because an OAuth redirect is a top-level navigation — there is no
 * other moment to learn the browser's timezone, and every streak boundary depends on
 * it. `intent=link` is the same flow for an already-signed-in user connecting Google
 * to the account they're in, rather than signing in.
 */
authRouter.get("/google/start", async (req, res) => {
  if (!googleEnabled) return res.status(404).json({ error: "Google sign-in isn't configured" });

  const nonce = newNonce();
  const tzParam = String(req.query.tz ?? "");
  const state = {
    n: nonce,
    tz: isValidTimezone(tzParam) ? tzParam : "UTC",
    link: null,
  };

  // Linking has to prove the session itself; requireAuth can't be used here because
  // a failure must redirect a browser rather than return 401 JSON.
  if (req.query.intent === "link") {
    const token = req.cookies?.sa_token;
    if (!token) return backToApp(res, "/login?error=google-session");
    try {
      state.link = jwt.verify(token, process.env.JWT_SECRET).sub;
    } catch {
      return backToApp(res, "/login?error=google-session");
    }
  }

  setOAuthState(res, state);
  // Account chooser on sign-in; on linking, make them pick deliberately too, so the
  // wrong Google account doesn't get attached by a silent single-session redirect.
  res.redirect(authUrl(nonce, { prompt: "select_account" }));
});

/**
 * Step two. Every failure here redirects with a short code rather than rendering an
 * error, because the user is mid-navigation in a browser, not awaiting JSON.
 */
authRouter.get("/google/callback", async (req, res) => {
  if (!googleEnabled) return res.status(404).json({ error: "Google sign-in isn't configured" });

  const state = takeOAuthState(req, res);
  if (req.query.error) return backToApp(res, "/login?error=google-cancelled");
  if (!state || !req.query.code || req.query.state !== state.n) {
    return backToApp(res, "/login?error=google-state");
  }

  let claims;
  try {
    claims = claimsFrom(await exchangeCode(String(req.query.code)));
  } catch (error) {
    console.error("Google sign-in failed:", error.message);
    return backToApp(res, "/login?error=google-failed");
  }

  // An unverified address proves nothing, and matching on one would be the whole
  // hole this flow is careful about.
  if (!claims.email || !claims.emailVerified) {
    return backToApp(res, "/login?error=google-email");
  }

  const byGoogleId = await prisma.user.findUnique({ where: { googleId: claims.sub } });

  // --- connecting Google to the account you're already signed into ---
  if (state.link) {
    if (byGoogleId && byGoogleId.id !== state.link) {
      return backToApp(res, "/profile?error=google-taken");
    }
    const user = await prisma.user.findUnique({ where: { id: state.link } });
    if (!user) return backToApp(res, "/login?error=google-session");

    await prisma.user.update({
      where: { id: user.id },
      data: {
        googleId: claims.sub,
        googleEmail: claims.email,
        // Only fill in what the account hasn't set for itself.
        displayName: user.displayName ?? claims.name ?? null,
        avatarUrl: user.avatarUrl ?? pictureUrl(claims.picture),
      },
    });
    return backToApp(res, "/profile?linked=google");
  }

  // --- signing in with a Google account we've seen before ---
  if (byGoogleId) {
    // Matching on `sub` means a changed Google address still signs in — but the one
    // shown on the profile would go stale, so it's refreshed here.
    if (byGoogleId.googleEmail !== claims.email) {
      await prisma.user.update({
        where: { id: byGoogleId.id },
        data: { googleEmail: claims.email },
      });
    }
    setAuthCookie(res, byGoogleId.id);
    return backToApp(res, "/");
  }

  /*
   * --- an account already owns this email address ---
   *
   * Deliberately NOT linked automatically. StreakArena doesn't verify email at
   * registration, so anyone can register someone else's address; auto-linking on a
   * match would hand the real owner an account the registrant still has the password
   * to. Linking has to start from inside a session that proved it owns the account.
   */
  const byEmail = await prisma.user.findUnique({ where: { email: claims.email } });
  if (byEmail) return backToApp(res, "/login?error=google-exists");

  // --- a new account ---
  const username = await uniqueUsername(usernameSeed(claims));
  if (!username) return backToApp(res, "/login?error=google-username");

  const user = await prisma.user.create({
    data: {
      email: claims.email,
      username,
      googleId: claims.sub,
      googleEmail: claims.email,
      timezone: state.tz,
      displayName: claims.name ?? null,
      avatarUrl: pictureUrl(claims.picture),
      // passwordHash stays null: this account signs in with Google until it chooses
      // to set one.
    },
  });

  setAuthCookie(res, user.id);
  backToApp(res, "/?welcome=google");
});

/** Google's `picture` is rendered into an <img>, so it goes through the same check. */
function pictureUrl(value) {
  if (!value) return null;
  return avatarProblem(value) ? null : value;
}

/**
 * Disconnecting is refused unless a password exists, because otherwise it removes
 * the account's only way back in.
 */
authRouter.delete("/google", requireAuth, loadUser, async (req, res) => {
  if (!req.user.googleId) return res.status(400).json({ error: "Google isn't connected" });
  if (!req.user.passwordHash) {
    return res.status(400).json({
      error: "Set a password first — Google is currently the only way into this account",
    });
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { googleId: null, googleEmail: null },
  });
  res.json({ user: publicUser(user) });
});

/**
 * Sets a password, or changes one. A Google-only account has none to confirm, and the
 * session cookie it arrived with is already proof enough — so `currentPassword` is
 * required exactly when there is one.
 */
authRouter.post("/me/password", requireAuth, loadUser, async (req, res) => {
  const password = String(req.body?.password ?? "");
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  if (req.user.passwordHash) {
    const current = String(req.body?.currentPassword ?? "");
    if (!(await verifyPassword(current, req.user.passwordHash))) {
      return res.status(401).json({ error: "That isn't your current password" });
    }
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash: await hashPassword(password) },
  });
  res.json({ user: publicUser(user) });
});

/**
 * Avatars appear on leaderboards and in chat, so any signed-in user can fetch one —
 * but they still stream through here rather than being served as static files, so the
 * store stays private and the key can't be walked.
 */
avatarRouter.get("/avatars/:key", requireAuth, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.key)) {
    return res.status(404).json({ error: "No such image" });
  }

  const stream = await openStored(req.params.key);
  if (!stream) return res.status(404).json({ error: "No such image" });

  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=300");
  stream.on("error", () => {
    if (!res.headersSent) res.status(404).json({ error: "No such image" });
    else res.end();
  });
  stream.pipe(res);
});
