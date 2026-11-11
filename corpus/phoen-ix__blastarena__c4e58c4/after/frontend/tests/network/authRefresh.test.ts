import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Refresh-token rotation treats a token presented twice as theft and revokes every session of the
 * account. Two refreshes at once — the socket reconnect and a REST 401 in one tab, or two tabs
 * after the machine wakes up — therefore logged the user out everywhere.
 */

vi.mock('../../src/i18n', () => ({
  i18n: { language: 'en', changeLanguage: vi.fn() },
  t: (key: string) => key,
}));

let AuthManager: typeof import('../../src/network/AuthManager').AuthManager;

const authResponse = {
  accessToken: 'new-access',
  user: { id: 1, username: 'me', role: 'user', language: 'en' },
};

beforeEach(async () => {
  vi.unstubAllGlobals();
  ({ AuthManager } = await import('../../src/network/AuthManager'));
});

/** fetch double: GET /auth/csrf hands out a token; every other call goes to `post`. */
function stubFetch(post: (url: string, init: RequestInit) => Promise<unknown>) {
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) =>
    url === '/api/auth/csrf'
      ? Promise.resolve({ ok: true, json: async () => ({ csrfToken: 'tok' }) })
      : post(url, init),
  );
  vi.stubGlobal('fetch', fetchMock);
  const posts = () => fetchMock.mock.calls.filter(([url]) => url !== '/api/auth/csrf');
  return { fetchMock, posts };
}

describe('AuthManager.refresh', () => {
  it('shares one request between concurrent callers', async () => {
    let resolveFetch!: (value: unknown) => void;
    const { posts } = stubFetch(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const auth = new AuthManager();

    const a = auth.refresh();
    const b = auth.refresh();
    await vi.waitFor(() => expect(posts()).toHaveLength(1));

    resolveFetch({ ok: true, json: async () => authResponse });
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(posts()).toHaveLength(1);
    expect(auth.getAccessToken()).toBe('new-access');
  });

  it('starts a new request once the previous one has finished', async () => {
    const { posts } = stubFetch(async () => ({ ok: true, json: async () => authResponse }));
    const auth = new AuthManager();

    await auth.refresh();
    await auth.refresh();
    expect(posts()).toHaveLength(2);
  });

  it('runs inside a Web Lock when the browser has them, so other tabs wait their turn', async () => {
    const request = vi.fn((_name: string, cb: () => Promise<boolean>) => cb());
    vi.stubGlobal('navigator', { locks: { request } });
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    const auth = new AuthManager();

    expect(await auth.refresh()).toBe(false);
    expect(request).toHaveBeenCalledWith('blast-arena-auth-refresh', expect.any(Function));
  });
});

describe('CSRF token on the cookie-authenticated routes', () => {
  it('refresh echoes the token from /auth/csrf in X-CSRF-Token', async () => {
    const { posts } = stubFetch(async () => ({ ok: true, json: async () => authResponse }));
    await new AuthManager().refresh();

    const [url, init] = posts()[0];
    expect(url).toBe('/api/auth/refresh');
    expect(init.headers).toEqual({ 'X-CSRF-Token': 'tok' });
  });

  it('logout echoes it too', async () => {
    const { posts } = stubFetch(async () => ({ ok: true, json: async () => ({}) }));
    await new AuthManager().logout();

    const [url, init] = posts()[0];
    expect(url).toBe('/api/auth/logout');
    expect(init.headers).toEqual({ 'X-CSRF-Token': 'tok' });
  });
});
