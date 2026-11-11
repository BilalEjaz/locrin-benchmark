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

describe('AuthManager.refresh', () => {
  it('shares one request between concurrent callers', async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const auth = new AuthManager();

    const a = auth.refresh();
    const b = auth.refresh();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true, json: async () => authResponse });
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(auth.getAccessToken()).toBe('new-access');
  });

  it('starts a new request once the previous one has finished', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => authResponse }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new AuthManager();

    await auth.refresh();
    await auth.refresh();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('runs inside a Web Lock when the browser has them, so other tabs wait their turn', async () => {
    const request = vi.fn((_name: string, cb: () => Promise<boolean>) => cb());
    vi.stubGlobal('navigator', { locks: { request } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    const auth = new AuthManager();

    expect(await auth.refresh()).toBe(false);
    expect(request).toHaveBeenCalledWith('blast-arena-auth-refresh', expect.any(Function));
  });
});
