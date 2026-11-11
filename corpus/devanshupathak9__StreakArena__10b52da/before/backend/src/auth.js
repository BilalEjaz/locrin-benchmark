import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./db.js";

const COOKIE_NAME = "sa_token";

// A `secure` cookie is dropped by the browser over plain HTTP, which would look
// like "login does nothing". Production defaults to secure; a deployment that is
// still on http:// sets COOKIE_SECURE=false explicitly.
const COOKIE_SECURE =
  process.env.COOKIE_SECURE === undefined
    ? process.env.NODE_ENV === "production"
    : process.env.COOKIE_SECURE === "true";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set — copy backend/.env.example to backend/.env");
}

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function setAuthCookie(res, userId) {
  const token = jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    maxAge: MAX_AGE_MS,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

/** Populates req.userId, or 401s. */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).sub;
    next();
  } catch {
    clearAuthCookie(res);
    res.status(401).json({ error: "Session expired" });
  }
}

/** Loads the signed-in user after requireAuth; 401s if the account is gone. */
export async function loadUser(req, res, next) {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    clearAuthCookie(res);
    return res.status(401).json({ error: "Account no longer exists" });
  }
  req.user = user;
  next();
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    timezone: user.timezone,
    createdAt: user.createdAt,
    displayName: user.displayName ?? null,
    bio: user.bio ?? null,
    location: user.location ?? null,
    avatarUrl: user.avatarUrl ?? null,
  };
}
