import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type pg from 'pg'
import type { Board } from '../../shared/kanban.ts'
import { createApp } from '../src/app.ts'
import { runMigrations } from '../src/db/migrations.ts'
import { createPool } from '../src/db/pool.ts'
import { insertSampleBoard } from '../src/db/sampleData.ts'

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

  const server = createApp({ pool, corsOrigin: 'http://localhost:5173' }).listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/api`

  async function api<T = any>(method: string, path: string, body?: unknown) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as T }
  }

  return {
    pool,
    api,
    /** Empties the schema and loads the sample board; returns it as the API serves it */
    async resetBoard() {
      await pool.query('TRUNCATE boards, people CASCADE')
      const boardId = await insertSampleBoard(pool)
      return (await api<Board>('GET', `/boards/${boardId}`)).body
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
