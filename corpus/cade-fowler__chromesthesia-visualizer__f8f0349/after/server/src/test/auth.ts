import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { SESSION_COOKIE, signSession, type AuthConfig } from '../auth.js';

export const TEST_PASSWORD = 'correct horse battery staple';

// hashPassword(TEST_PASSWORD), precomputed so tests don't pay for scrypt at import time
export const TEST_AUTH: AuthConfig = {
    passwordHash:
        'scrypt:WbSl54J-Kz2AUhaa2tvUuQ:aCRyo2a59YCoe7QnzAwTQWu4ZXXZeeHNYP2hk00VsOzls3FzJZmHuzWm-s33q2beOJB3j5WTkAIqcfLPcIjIXw',
    sessionSecret: 'test-session-secret-that-is-long-enough',
    secureCookies: false,
};

/** A Cookie header for a valid owner session. */
export const ownerCookie = (expiresAt = Date.now() + 60_000) =>
    `${SESSION_COOKIE}=${signSession(TEST_AUTH.sessionSecret, expiresAt)}`;

/** An app with the test auth config, optionally changed. */
export const testApp = (overrides: Partial<AuthConfig> = {}) =>
    createApp({ ...TEST_AUTH, ...overrides });

/** A supertest agent that sends an owner session with every request. */
export const ownerAgent = (app: Express) => request.agent(app).set('Cookie', ownerCookie());
