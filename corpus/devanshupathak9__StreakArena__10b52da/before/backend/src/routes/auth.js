import { Router } from "express";
import { prisma } from "../db.js";
import {
  clearAuthCookie,
  hashPassword,
  loadUser,
  publicUser,
  requireAuth,
  setAuthCookie,
  verifyPassword,
} from "../auth.js";
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
  // Same message either way, so this can't be used to probe which accounts exist.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
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
