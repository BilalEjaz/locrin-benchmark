import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type pg from 'pg'
import type { Board } from '../../shared/kanban.ts'
import { createApp } from '../src/app.ts'
import { runMigrations } from '../src/db/migrations.ts'
import { createPool } from '../src/db/pool.ts'
import { insertSampleBoard } from '../src/db/sampleData.ts'

/** Signing key for test sessions only (tests can forge tokens with it, e.g. expired ones) */
export const TEST_JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters-long'

/**
 * Starts the API against a brand-new schema in the test database, so tests never
 * touch real data. Needs TEST_DATABASE_URL (Neon's direct host, see .env.example).
 */
export async function startTestServer() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see backend/.env.example)')

  const schema = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const admin = createPool(url)
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = createPool(url, { searchPath: schema })
  await runMigrations(pool)

  const app = createApp({
    pool,
    corsOrigin: 'http://localhost:5173',
    // A low bcrypt cost keeps tests fast; production uses 12
    auth: { jwtSecret: TEST_JWT_SECRET, secureCookies: false, bcryptRounds: 4 },
  })
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/api`

  /** A client with its own cookie jar, like a separate browser */
  function client() {
    const cookies = new Map<string, string>()
    async function api<T = any>(method: string, path: string, body?: unknown) {
      const headers: Record<string, string> = {}
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      if (cookies.size) headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
      const res = await fetch(baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      })
      const setCookies = res.headers.getSetCookie()
      for (const header of setCookies) {
        const [pair] = header.split(';')
        const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]
        const expired = !value || /expires=thu, 01 jan 1970/i.test(header) || /max-age=0\b/i.test(header)
        if (expired) cookies.delete(name)
        else cookies.set(name, value)
      }
      const text = await res.text()
      return { status: res.status, body: (text ? JSON.parse(text) : null) as T, setCookies }
    }
    return { api, cookies }
  }

  // The default client is signed in, so board/task tests run as a logged-in user
  const signedIn = client()
  const registered = await signedIn.api('POST', '/auth/register', { email: 'tester@example.com', password: 'correct horse battery' })
  assert.equal(registered.status, 201, 'could not create the test user')

  return {
    pool,
    client,
    api: signedIn.api,
    /** Empties the board tables and loads the sample board; returns it as the API serves it */
    async resetBoard() {
      await pool.query('TRUNCATE boards, people CASCADE')
      const boardId = await insertSampleBoard(pool)
      return (await signedIn.api<Board>('GET', `/boards/${boardId}`)).body
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve))
      await pool.end()
      await admin.query(`DROP SCHEMA ${schema} CASCADE`)
      await admin.end()
    },
  }
}

/** Ids by title, so tests can say "the To Do column" or "the Machine Learning task" */
export function lookup(board: Board) {
  const column = (title: string) => {
    const found = Object.values(board.columns).find((c) => c.title === title)
    assert.ok(found, `no column "${title}"`)
    return found.id
  }
  const task = (titleStart: string) => {
    const found = Object.values(board.tasks).find((t) => t.title.startsWith(titleStart))
    assert.ok(found, `no task starting "${titleStart}"`)
    return found.id
  }
  return { column, task }
}

/** Task titles per column, in order, e.g. { 'To Do': ['UI/UX…', …] } (first 12 characters) */
export function titlesByColumn(board: Board) {
  return Object.fromEntries(
    board.columnOrder.map((id) => [
      board.columns[id].title,
      board.columns[id].taskIds.map((taskId) => board.tasks[taskId].title.slice(0, 12)),
    ]),
  )
}

/** Every column's positions are exactly 0..n-1 and no task went missing */
export async function assertConsistent(pool: pg.Pool, expectedTaskCount: number) {
  const { rows } = await pool.query<{ positions: number[] }>(
    'SELECT array_agg(position ORDER BY position) AS positions FROM tasks GROUP BY column_id',
  )
  for (const { positions } of rows) {
    assert.deepEqual(positions, positions.map((_, i) => i), `positions not contiguous: ${positions}`)
  }
  const total = rows.reduce((sum, row) => sum + row.positions.length, 0)
  assert.equal(total, expectedTaskCount, 'task count changed')
}
