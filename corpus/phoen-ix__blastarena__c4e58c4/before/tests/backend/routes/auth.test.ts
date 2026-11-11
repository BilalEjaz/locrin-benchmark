import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// ---------------------------------------------------------------------------
// Mocks — declared before the router import so module‑level side effects
// in auth.ts see the fakes.
// ---------------------------------------------------------------------------

const mockRegister = jest.fn<AnyFn>();
const mockLogin = jest.fn<AnyFn>();
const mockLogout = jest.fn<AnyFn>();
const mockRefreshAccessToken = jest.fn<AnyFn>();
const mockVerifyEmail = jest.fn<AnyFn>();
const mockForgotPassword = jest.fn<AnyFn>();
const mockResetPassword = jest.fn<AnyFn>();
const mockVerifyCredentials = jest.fn<AnyFn>();
const mockGenerateLocalCoopToken = jest.fn<AnyFn>();
const mockGenerateLocalCoopTotpToken = jest.fn<AnyFn>();
const mockVerifyLocalCoopTotpToken = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/auth', () => ({
  register: mockRegister,
  login: mockLogin,
  logout: mockLogout,
  refreshAccessToken: mockRefreshAccessToken,
  verifyEmail: mockVerifyEmail,
  forgotPassword: mockForgotPassword,
  resetPassword: mockResetPassword,
  verifyCredentials: mockVerifyCredentials,
  generateLocalCoopToken: mockGenerateLocalCoopToken,
  generateLocalCoopTotpToken: mockGenerateLocalCoopTotpToken,
  verifyLocalCoopTotpToken: mockVerifyLocalCoopTotpToken,
}));

const mockVerifyCode = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/totp', () => ({
  verifyCode: mockVerifyCode,
}));

const mockQuery = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
}));

const mockGetPlayerCosmeticsForGame = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/cosmetics', () => ({
  getPlayerCosmeticsForGame: mockGetPlayerCosmeticsForGame,
}));

const mockIsRegistrationEnabled = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/settings', () => ({
  isRegistrationEnabled: mockIsRegistrationEnabled,
}));

const mockGetConfig = jest.fn<AnyFn>();

jest.mock('../../../backend/src/config', () => ({
  getConfig: mockGetConfig,
}));

// Middleware pass‑throughs — we test route handlers, not middleware.
const mockAuthMiddleware = jest.fn<AnyFn>((_req, _res, next) => next());

jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: mockAuthMiddleware,
  ACCESS_TOKEN_TYPE: 'access',
}));

const mockRateLimiter = jest.fn<AnyFn>(() => (_req: any, _res: any, next: any) => next());

jest.mock('../../../backend/src/middleware/rateLimiter', () => ({
  rateLimiter: mockRateLimiter,
}));

const mockValidate = jest.fn<AnyFn>(() => (_req: any, _res: any, next: any) => next());

jest.mock('../../../backend/src/middleware/validation', () => ({
  validate: mockValidate,
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Import the router under test (after all mocks are in place).
// ---------------------------------------------------------------------------

import authRouter from '../../../backend/src/routes/auth';
import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RouteLayer = {
  route: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: Function; name?: string }>;
  };
};

/**
 * Extract the final handler (the actual route logic, after middleware) from
 * an Express Router for a given method + path.
 */
function getHandler(method: string, path: string) {
  const stack = (authRouter as any).stack as RouteLayer[];
  const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  const routeStack = layer.route.stack;
  return routeStack[routeStack.length - 1].handle;
}

/** Return the full route stack (middleware + handler) for a method+path. */
function getRouteStack(method: string, path: string) {
  const stack = (authRouter as any).stack as RouteLayer[];
  const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  return layer.route.stack;
}

function mockRes() {
  const data: {
    _status: number;
    _json: unknown;
    _cookie: any;
    _clearCookie: any;
    _redirect: { status: number; url: string } | null;
  } = { _status: 200, _json: null, _cookie: null, _clearCookie: null, _redirect: null };

  const res: any = {
    get _status() {
      return data._status;
    },
    get _json() {
      return data._json;
    },
    get _cookie() {
      return data._cookie;
    },
    get _clearCookie() {
      return data._clearCookie;
    },
    get _redirect() {
      return data._redirect;
    },
    status(code: number) {
      data._status = code;
      return res;
    },
    json(body: unknown) {
      data._json = body;
      return res;
    },
    cookie(name: string, value: string, opts: any) {
      data._cookie = { name, value, opts };
      return res;
    },
    clearCookie(name: string, opts: any) {
      data._clearCookie = { name, opts };
      return res;
    },
    redirect(url: string) {
      data._redirect = { status: 302, url };
      return res;
    },
  };
  return res;
}

function mockReq(overrides: Record<string, unknown> = {}): any {
  return { body: {}, params: {}, cookies: {}, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockGetConfig.mockReturnValue({ APP_URL: 'http://localhost:8080' });
});

// ============================== POST /auth/register ========================

describe('POST /auth/register', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('post', '/auth/register');
  });

  it('returns 200 with a uniform registration result on success (no session)', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(true);
    const result = { emailVerificationRequired: true };
    mockRegister.mockResolvedValue(result);

    const req = mockReq({
      body: { username: 'testuser', email: 'test@example.com', password: 'password123' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    // Uniform 200 + no cookie set, so email existence can't be inferred from the response. (audit EMAIL-005)
    expect(res._status).toBe(200);
    expect(res._json).toEqual(result);
    expect(res._cookie).toBeNull();
  });

  it('returns 403 when registration is disabled', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(false);

    const req = mockReq({
      body: { username: 'testuser', email: 'test@example.com', password: 'password123' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(403);
    expect(res._json).toEqual({ error: 'Registration is currently disabled' });
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid username', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(true);

    const req = mockReq({
      body: { username: 'ab', email: 'test@example.com', password: 'password123' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(400);
    expect(res._json).toEqual(
      expect.objectContaining({ error: expect.stringContaining('Username') }),
    );
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid password', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(true);

    const req = mockReq({
      body: { username: 'testuser', email: 'test@example.com', password: 'short' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(400);
    expect(res._json).toEqual(
      expect.objectContaining({ error: expect.stringContaining('Password') }),
    );
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid email', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(true);

    const req = mockReq({
      body: { username: 'testuser', email: 'not-an-email', password: 'password123' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(400);
    expect(res._json).toEqual(expect.objectContaining({ error: expect.stringContaining('email') }));
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('calls authService.register with correct arguments', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(true);
    mockRegister.mockResolvedValue({ message: 'ok' });

    const req = mockReq({
      body: { username: 'alice', email: 'alice@example.com', password: 'securepass1' },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockRegister).toHaveBeenCalledWith('alice', 'alice@example.com', 'securepass1', 'en');
  });

  it('passes error to next() on service failure', async () => {
    mockIsRegistrationEnabled.mockResolvedValue(true);
    const err = new Error('DB error');
    mockRegister.mockRejectedValue(err);

    const req = mockReq({
      body: { username: 'testuser', email: 'test@example.com', password: 'password123' },
    });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================== POST /auth/login ===========================

describe('POST /auth/login', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('post', '/auth/login');
  });

  it('returns auth data and sets refresh token cookie on success', async () => {
    const authData = { accessToken: 'tok', user: { id: 1, username: 'u', role: 'user' } };
    mockLogin.mockResolvedValue({ auth: authData, refreshToken: 'rt_123' });

    const req = mockReq({ body: { username: 'u', password: 'p' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual(authData);
    expect(res._cookie).not.toBeNull();
    expect(res._cookie.name).toBe('refreshToken');
    expect(res._cookie.value).toBe('rt_123');
  });

  it('sets cookie with correct options (httpOnly, sameSite, path)', async () => {
    mockLogin.mockResolvedValue({ auth: {}, refreshToken: 'rt' });

    const req = mockReq({ body: { username: 'u', password: 'p' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    const opts = res._cookie.opts;
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('strict');
    expect(opts.path).toBe('/api/auth');
    expect(opts.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('sets secure flag based on APP_URL (http = false, https = true)', async () => {
    // HTTP
    mockGetConfig.mockReturnValue({ APP_URL: 'http://localhost:8080' });
    mockLogin.mockResolvedValue({ auth: {}, refreshToken: 'rt' });

    let req = mockReq({ body: { username: 'u', password: 'p' } });
    let res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._cookie.opts.secure).toBe(false);

    // HTTPS
    mockGetConfig.mockReturnValue({ APP_URL: 'https://blast.example.com' });
    req = mockReq({ body: { username: 'u', password: 'p' } });
    res = mockRes();
    await handler(req, res, jest.fn());
    expect(res._cookie.opts.secure).toBe(true);
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('invalid creds');
    mockLogin.mockRejectedValue(err);

    const req = mockReq({ body: { username: 'u', password: 'p' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================== POST /auth/logout ==========================

describe('POST /auth/logout', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('post', '/auth/logout');
  });

  it('clears refresh token cookie and returns message', async () => {
    mockLogout.mockResolvedValue(undefined);

    const req = mockReq({ cookies: { refreshToken: 'rt_abc' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual({ message: 'Logged out' });
    expect(res._clearCookie).toEqual({ name: 'refreshToken', opts: { path: '/api/auth' } });
  });

  it('calls authService.logout with the refresh token from cookie', async () => {
    mockLogout.mockResolvedValue(undefined);

    const req = mockReq({ cookies: { refreshToken: 'rt_xyz' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockLogout).toHaveBeenCalledWith('rt_xyz');
  });

  it('does not call authService.logout when no cookie present', async () => {
    const req = mockReq({ cookies: {} });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(mockLogout).not.toHaveBeenCalled();
    expect(res._json).toEqual({ message: 'Logged out' });
  });
});

// ============================== POST /auth/refresh =========================

describe('POST /auth/refresh', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('post', '/auth/refresh');
  });

  it('returns 401 when no refresh token cookie', async () => {
    const req = mockReq({ cookies: {} });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(401);
    expect(res._json).toEqual({ error: 'No refresh token', code: 'NO_REFRESH_TOKEN' });
  });

  it('returns new auth data and sets new cookie on success', async () => {
    const authData = { accessToken: 'new_tok', user: { id: 1 } };
    mockRefreshAccessToken.mockResolvedValue({ auth: authData, refreshToken: 'new_rt' });

    const req = mockReq({ cookies: { refreshToken: 'old_rt' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual(authData);
    expect(res._cookie.name).toBe('refreshToken');
    expect(res._cookie.value).toBe('new_rt');
    expect(res._cookie.opts.httpOnly).toBe(true);
    expect(res._cookie.opts.path).toBe('/api/auth');
  });

  it('passes error to next() on service failure', async () => {
    const err = new Error('token expired');
    mockRefreshAccessToken.mockRejectedValue(err);

    const req = mockReq({ cookies: { refreshToken: 'stale_rt' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================== GET /auth/verify-email/:token ==============

describe('GET /auth/verify-email/:token', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('get', '/auth/verify-email/:token');
  });

  it('redirects to APP_URL with emailVerified param on valid token', async () => {
    mockVerifyEmail.mockResolvedValue(undefined);

    const req = mockReq({ params: { token: 'valid_token' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._redirect).toEqual({ status: 302, url: 'http://localhost:8080?emailVerified=true' });
    expect(mockVerifyEmail).toHaveBeenCalledWith('valid_token');
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('invalid token');
    mockVerifyEmail.mockRejectedValue(err);

    const req = mockReq({ params: { token: 'bad' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================== POST /auth/forgot-password =================

describe('POST /auth/forgot-password', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('post', '/auth/forgot-password');
  });

  it('always returns the same message to prevent user enumeration', async () => {
    mockForgotPassword.mockResolvedValue(undefined);

    const req = mockReq({ body: { email: 'any@example.com' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual({ message: 'If the email exists, a reset link has been sent' });
    expect(mockForgotPassword).toHaveBeenCalledWith('any@example.com');
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('mail send failure');
    mockForgotPassword.mockRejectedValue(err);

    const req = mockReq({ body: { email: 'x@y.com' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================== POST /auth/reset-password ==================

describe('POST /auth/reset-password', () => {
  let handler: Function;
  beforeEach(() => {
    handler = getHandler('post', '/auth/reset-password');
  });

  it('returns success message on valid reset', async () => {
    mockResetPassword.mockResolvedValue(undefined);

    const req = mockReq({ body: { token: 'reset_tok', password: 'newpassword1' } });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._json).toEqual({ message: 'Password reset successfully' });
    expect(mockResetPassword).toHaveBeenCalledWith('reset_tok', 'newpassword1');
  });

  it('passes error to next() on failure', async () => {
    const err = new Error('expired token');
    mockResetPassword.mockRejectedValue(err);

    const req = mockReq({ body: { token: 't', password: 'p' } });
    const res = mockRes();
    const next = jest.fn();
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ============================== Middleware presence =========================

describe('Middleware presence', () => {
  it('rateLimiter is applied to register, login, verify-email, forgot-password, reset-password', () => {
    const rateLimitedRoutes = [
      { method: 'post', path: '/auth/register' },
      { method: 'post', path: '/auth/login' },
      { method: 'get', path: '/auth/verify-email/:token' },
      { method: 'post', path: '/auth/forgot-password' },
      { method: 'post', path: '/auth/reset-password' },
    ];

    for (const { method, path } of rateLimitedRoutes) {
      const stack = getRouteStack(method, path);
      // The rate limiter mock returns a middleware fn; that middleware fn is in the route stack
      // Route should have more than just the handler (at least rate limiter + handler)
      expect(stack.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('authMiddleware is NOT on the logout route (works with expired access token)', () => {
    // Logout must revoke the refresh token even when the access token has expired, so it acts
    // only on the httpOnly refresh-token cookie and does not require authMiddleware. (audit AUTH-1)
    const logoutStack = getRouteStack('post', '/auth/logout');
    const middlewareFns = logoutStack.map((entry) => entry.handle);
    expect(middlewareFns).not.toContain(mockAuthMiddleware);
    // Only the handler remains on the route.
    expect(logoutStack.length).toBe(1);
  });

  it('validate middleware is applied to register, login, forgot-password, reset-password', () => {
    const validatedRoutes = [
      { method: 'post', path: '/auth/register' },
      { method: 'post', path: '/auth/login' },
      { method: 'post', path: '/auth/forgot-password' },
      { method: 'post', path: '/auth/reset-password' },
    ];

    for (const { method, path } of validatedRoutes) {
      const stack = getRouteStack(method, path);
      // These routes have rateLimiter + validate + handler = at least 3
      expect(stack.length).toBeGreaterThanOrEqual(3);
    }

    // verify-email has rateLimiter but NOT validate — only 2 entries
    const verifyStack = getRouteStack('get', '/auth/verify-email/:token');
    expect(verifyStack.length).toBe(2);
  });
});

// ============================== local co-op P2 with 2FA =====================

describe('local co-op P2 with 2FA', () => {
  const p2 = {
    id: 2,
    username: 'p2',
    role: 'user',
    language: 'en',
    emailVerified: true,
    twoFactorEnabled: true,
  };

  beforeEach(() => {
    mockGetConfig.mockReturnValue({ APP_URL: 'http://localhost:8080' });
    mockGenerateLocalCoopToken.mockReturnValue('p2-token');
    mockGetPlayerCosmeticsForGame.mockResolvedValue(new Map());
  });

  it('asks for the code instead of signing P2 in', async () => {
    mockVerifyCredentials.mockResolvedValue(p2);
    mockGenerateLocalCoopTotpToken.mockReturnValue('pending');
    const res = mockRes();
    await getHandler('post', '/local-coop/login')(
      mockReq({ user: { userId: 1 }, body: { username: 'p2', password: 'pw', duration: 6 } }),
      res,
      jest.fn(),
    );
    expect(res._json).toEqual({ totpRequired: true, totpToken: 'pending' });
    expect(res._cookie).toBeNull();
    expect(mockGenerateLocalCoopTotpToken).toHaveBeenCalledWith(2, 1, 6);
  });

  it('rejects a wrong code', async () => {
    mockVerifyLocalCoopTotpToken.mockReturnValue({ userId: 2, duration: 6 });
    mockVerifyCode.mockResolvedValue(false);
    const res = mockRes();
    await getHandler('post', '/local-coop/verify-totp')(
      mockReq({ user: { userId: 1 }, body: { totpToken: 'pending', code: '000000' } }),
      res,
      jest.fn(),
    );
    expect(res._status).toBe(401);
    expect(res._cookie).toBeNull();
  });

  it('rejects a pending token from another host', async () => {
    mockVerifyLocalCoopTotpToken.mockReturnValue(null);
    const res = mockRes();
    await getHandler('post', '/local-coop/verify-totp')(
      mockReq({ user: { userId: 9 }, body: { totpToken: 'pending', code: '123456' } }),
      res,
      jest.fn(),
    );
    expect(res._status).toBe(401);
    expect(mockVerifyCode).not.toHaveBeenCalled();
  });

  it('signs P2 in after the right code', async () => {
    mockVerifyLocalCoopTotpToken.mockReturnValue({ userId: 2, duration: 6 });
    mockVerifyCode.mockResolvedValue(true);
    mockQuery.mockResolvedValue([{ id: 2, username: 'p2', is_deactivated: 0, email_verified: 1 }]);
    const res = mockRes();
    await getHandler('post', '/local-coop/verify-totp')(
      mockReq({ user: { userId: 1 }, body: { totpToken: 'pending', code: '123456' } }),
      res,
      jest.fn(),
    );
    expect(res._cookie).toMatchObject({ name: 'localCoopP2', value: 'p2-token' });
    expect(res._json).toEqual({ user: { id: 2, username: 'p2' }, cosmetics: {} });
  });
});

// ============================== POST /local-coop/login =====================

describe('POST /local-coop/login', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handler: any;

  beforeEach(() => {
    handler = getHandler('post', '/local-coop/login');
    mockGetConfig.mockReturnValue({ APP_URL: 'http://localhost:8080' });
    mockGenerateLocalCoopToken.mockReturnValue('p2-token');
    mockGetPlayerCosmeticsForGame.mockResolvedValue(new Map([[2, { colorHex: 0xff0000 }]]));
  });

  const p2 = {
    id: 2,
    username: 'p2',
    role: 'user',
    language: 'en',
    emailVerified: true,
    twoFactorEnabled: false,
  };

  it('logs a verified account in as P2 and sets the isolated cookie', async () => {
    mockVerifyCredentials.mockResolvedValue(p2);
    const req = mockReq({
      user: { userId: 1, username: 'p1', role: 'user' },
      body: { username: 'p2', password: 'pw', duration: 0 },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._cookie).toMatchObject({ name: 'localCoopP2', value: 'p2-token' });
    expect(res._json).toEqual({
      user: { id: 2, username: 'p2' },
      cosmetics: { colorHex: 0xff0000 },
    });
  });

  // (audit B8) — every other entry into a game requires a verified email; this one did not.
  it('refuses an unverified account with the same shape as emailVerifiedMiddleware', async () => {
    mockVerifyCredentials.mockResolvedValue({ ...p2, emailVerified: false });
    const req = mockReq({
      user: { userId: 1, username: 'p1', role: 'user' },
      body: { username: 'p2', password: 'pw', duration: 0 },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(403);
    expect(res._json).toEqual({ error: 'Email not verified', code: 'EMAIL_NOT_VERIFIED' });
    expect(res._cookie).toBeNull();
    expect(mockGenerateLocalCoopToken).not.toHaveBeenCalled();
  });

  it('refuses logging in as yourself', async () => {
    mockVerifyCredentials.mockResolvedValue({ ...p2, id: 1 });
    const req = mockReq({
      user: { userId: 1, username: 'p1', role: 'user' },
      body: { username: 'p1', password: 'pw', duration: 0 },
    });
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res._status).toBe(400);
    expect(res._cookie).toBeNull();
  });
});
