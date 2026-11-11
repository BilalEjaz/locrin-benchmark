import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import { SignJWT } from 'jose'
import type { Board } from '../../shared/kanban.ts'
import { createSessions, SESSION_COOKIE } from '../src/auth/session.ts'
import { assertConsistent, lookup, startTestServer, TEST_JWT_SECRET } from './helpers.ts'

let t: Awaited<ReturnType<typeof startTestServer>>
let board: Board

before(async () => {
  t = await startTestServer()
})
after(async () => {
  await t?.stop()
})
beforeEach(async () => {
  board = await t.resetBoard()
  // Accounts from earlier tests, except the helper's signed-in user
  await t.pool.query("DELETE FROM users WHERE email <> 'tester@example.com'")
})

const PASSWORD = 'a perfectly fine password'
const sessionCookie = (setCookies: string[]) => setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))

describe('POST /api/auth/register', () => {
  it('creates the account, returns it without the password hash, and starts a session', async () => {
    const browser = t.client()
    const { status, body, setCookies } = await browser.api('POST', '/auth/register', {
      email: '  New.User@Example.COM ',
      password: PASSWORD,
    })
    assert.equal(status, 201)
    assert.deepEqual(Object.keys(body).sort(), ['email', 'id'])
    assert.equal(body.email, 'new.user@example.com', 'email is trimmed and lowercased')

    const cookie = sessionCookie(setCookies)
    assert.ok(cookie, 'sets the session cookie')
    assert.match(cookie, /HttpOnly/i)
    assert.match(cookie, /SameSite=Lax/i)
    assert.match(cookie, /Path=\//i)
    assert.match(cookie, /Max-Age=604800/i, 'lasts 7 days')
    assert.doesNotMatch(cookie, /Secure/i, 'not HTTPS-only outside production')

    // The password is stored as a bcrypt hash, never as given
    const { rows: [row] } = await t.pool.query('SELECT password_hash FROM users WHERE id = $1', [body.id])
    assert.match(row.password_hash, /^\$2[aby]\$/)
    assert.ok(!row.password_hash.includes(PASSWORD))

    // The new session works straight away
    assert.equal((await browser.api('GET', '/auth/me')).body.email, 'new.user@example.com')
  })

  it('rejects an email that is already registered, in any letter case', async () => {
    await t.client().api('POST', '/auth/register', { email: 'taken@example.com', password: PASSWORD })
    const again = await t.client().api('POST', '/auth/register', { email: 'TAKEN@example.com', password: PASSWORD })
    assert.equal(again.status, 409)
    assert.equal(sessionCookie(again.setCookies), undefined)
  })

  it('marks the cookie Secure (HTTPS-only) in production', async () => {
    const production = createSessions({ jwtSecret: TEST_JWT_SECRET, secureCookies: true })
    let options: Record<string, unknown> = {}
    const res = { cookie: (_name: string, _value: string, opts: Record<string, unknown>) => (options = opts) }
    await production.start(res as never, randomUUID())
    assert.equal(options.secure, true)
    assert.equal(options.httpOnly, true)
  })

  it('validates the email and password', async () => {
    const register = (body: unknown) => t.client().api('POST', '/auth/register', body)
    assert.equal((await register({ email: 'not-an-email', password: PASSWORD })).status, 400)
    assert.equal((await register({ email: 'ok@example.com', password: 'short' })).status, 400)
    assert.equal((await register({ email: 'ok@example.com', password: 'é'.repeat(37) })).status, 400, 'over 72 bytes')
    assert.equal((await register({ email: 'ok@example.com' })).status, 400)
    const { rows } = await t.pool.query("SELECT 1 FROM users WHERE email = 'ok@example.com'")
    assert.equal(rows.length, 0)
  })
})

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await t.client().api('POST', '/auth/register', { email: 'login@example.com', password: PASSWORD })
  })

  it('signs in with the right password (email in any case) and sets the session cookie', async () => {
    const browser = t.client()
    const { status, body, setCookies } = await browser.api('POST', '/auth/login', {
      email: 'Login@Example.com',
      password: PASSWORD,
    })
    assert.equal(status, 200)
    assert.deepEqual(Object.keys(body).sort(), ['email', 'id'])
    assert.ok(sessionCookie(setCookies))
    assert.equal((await browser.api('GET', '/auth/me')).status, 200)
  })

  it('gives the same generic 401 for a wrong password and an unknown email', async () => {
    const wrongPassword = await t.client().api('POST', '/auth/login', { email: 'login@example.com', password: 'nope nope nope' })
    const unknownEmail = await t.client().api('POST', '/auth/login', { email: 'nobody@example.com', password: PASSWORD })
    for (const res of [wrongPassword, unknownEmail]) {
      assert.equal(res.status, 401)
      assert.deepEqual(res.body, { error: 'Invalid email or password' })
      assert.equal(sessionCookie(res.setCookies), undefined)
    }
  })

  it('400s when fields are missing', async () => {
    assert.equal((await t.client().api('POST', '/auth/login', { email: 'login@example.com' })).status, 400)
  })
})

describe('GET /api/auth/me and POST /api/auth/logout', () => {
  it('returns the signed-in user, and 401 without a session', async () => {
    const me = await t.api('GET', '/auth/me')
    assert.equal(me.status, 200)
    assert.equal(me.body.email, 'tester@example.com')
    assert.equal((await t.client().api('GET', '/auth/me')).status, 401)
  })

  it('logout clears the cookie, after which the session is gone', async () => {
    const browser = t.client()
    await browser.api('POST', '/auth/register', { email: 'bye@example.com', password: PASSWORD })
    const out = await browser.api('POST', '/auth/logout')
    assert.equal(out.status, 204)
    const cleared = sessionCookie(out.setCookies)
    assert.ok(cleared && /Expires=Thu, 01 Jan 1970/i.test(cleared), 'expires the cookie')
    assert.equal(browser.cookies.size, 0)
    assert.equal((await browser.api('GET', '/auth/me')).status, 401)
  })

  it('rejects tampered, expired, and wrongly-signed tokens', async () => {
    const browser = t.client()
    const sign = (secret: string, exp: number | string) =>
      new SignJWT().setProtectedHeader({ alg: 'HS256' }).setSubject(randomUUID()).setExpirationTime(exp)
        .sign(new TextEncoder().encode(secret))

    const tokens = {
      garbage: 'not-a-jwt',
      expired: await sign(TEST_JWT_SECRET, Math.floor(Date.now() / 1000) - 60),
      'wrong key': await sign('some-other-secret-that-is-at-least-32-chars', '1h'),
      tampered: `${(await sign(TEST_JWT_SECRET, '1h')).slice(0, -3)}abc`,
    }
    for (const [label, token] of Object.entries(tokens)) {
      browser.cookies.set(SESSION_COOKIE, token)
      assert.equal((await browser.api('GET', '/auth/me')).status, 401, label)
      assert.equal((await browser.api('GET', `/boards/${board.id}`)).status, 401, label)
    }
  })

  it('treats a valid token for a deleted account as signed out', async () => {
    const browser = t.client()
    const { body } = await browser.api('POST', '/auth/register', { email: 'gone@example.com', password: PASSWORD })
    await t.pool.query('DELETE FROM users WHERE id = $1', [body.id])
    assert.equal((await browser.api('GET', '/auth/me')).status, 401)
  })
})

describe('protected board and task routes', () => {
  it('401 without a session, without touching the data', async () => {
    const anon = t.client()
    const ids = lookup(board)
    const requests = [
      anon.api('GET', '/boards'),
      anon.api('GET', `/boards/${board.id}`),
      anon.api('GET', '/boards/not-even-a-uuid'),
      anon.api('POST', `/boards/${board.id}/tasks`, { id: randomUUID(), columnId: ids.column('To Do'), title: 'Sneaky' }),
      anon.api('PATCH', `/tasks/${ids.task('UI/UX')}/move`, { toColumnId: ids.column('Completed'), toIndex: 0 }),
    ]
    for (const res of await Promise.all(requests)) {
      assert.equal(res.status, 401)
      assert.deepEqual(res.body, { error: 'Not signed in' })
    }
    // Nothing was added or moved
    await assertConsistent(t.pool, 11)
    const { rows } = await t.pool.query("SELECT 1 FROM tasks WHERE title = 'Sneaky'")
    assert.equal(rows.length, 0)
  })

  it('work once signed in', async () => {
    const browser = t.client()
    await browser.api('POST', '/auth/register', { email: 'worker@example.com', password: PASSWORD })
    const ids = lookup(board)
    assert.equal((await browser.api('GET', `/boards/${board.id}`)).status, 200)
    const added = await browser.api('POST', `/boards/${board.id}/tasks`, {
      id: randomUUID(),
      columnId: ids.column('To Do'),
      title: 'Signed-in task',
    })
    assert.equal(added.status, 201)
    const moved = await browser.api('PATCH', `/tasks/${added.body.id}/move`, { toColumnId: ids.column('Completed'), toIndex: 0 })
    assert.equal(moved.status, 200)
    assert.equal(moved.body.task.progress, 100)
  })
})
