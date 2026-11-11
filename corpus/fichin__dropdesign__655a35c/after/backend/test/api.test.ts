import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { Board, Task } from '../../shared/kanban.ts'
import { assertConsistent, lookup, startTestServer, titlesByColumn } from './helpers.ts'

const SAMPLE_TASKS = 11
let t: Awaited<ReturnType<typeof startTestServer>>
let board: Board
let ids: ReturnType<typeof lookup>

before(async () => {
  t = await startTestServer()
})
after(async () => {
  await t?.stop()
})
beforeEach(async () => {
  board = await t.resetBoard()
  ids = lookup(board)
})

const getBoard = async () => (await t.api<Board>('GET', `/boards/${board.id}`)).body
const move = (taskId: string, toColumnId: string, toIndex: number) =>
  t.api('PATCH', `/tasks/${taskId}/move`, { toColumnId, toIndex })

describe('GET /api/health', () => {
  it('reports the database as reachable, without needing to sign in', async () => {
    const { status, body } = await t.client().api('GET', '/health')
    assert.deepEqual({ status, body }, { status: 200, body: { status: 'ok', database: 'ok' } })
  })
})

describe('GET /api/boards', () => {
  it('lists the board', async () => {
    const { status, body } = await t.api('GET', '/boards')
    assert.equal(status, 200)
    assert.deepEqual(body, [{ id: board.id, title: 'Project PlanetX' }])
  })
})

describe('GET /api/boards/:boardId', () => {
  it('returns the whole board in the frontend shape', () => {
    assert.equal(board.title, 'Project PlanetX')
    assert.deepEqual(titlesByColumn(board), {
      'To Do': ['UI/UX Design', 'Responsive W', 'Blog Copywri', 'Landing page'],
      'In Progress': ['Machine Lear', 'Learn Comput'],
      Completed: ['User flow co', 'Do some usua', 'Write a few ', 'Transform in', 'Design 100 l'],
    })
    assert.deepEqual(
      board.columnOrder.map((id) => board.columns[id].status),
      ['todo', 'in-progress', 'completed'],
    )
    const ml = board.tasks[ids.task('Machine Learning')]
    assert.deepEqual(
      { priority: ml.priority, progress: ml.progress, comments: ml.commentCount, subtasks: ml.completedSubtaskCount },
      { priority: 'important', progress: 52, comments: 11, subtasks: 187 },
    )
    // Assignees come back in their display order
    assert.deepEqual(
      board.tasks[ids.task('Responsive')].assignees.map((a) => a.name.split(' ')[0]),
      ['Ana', 'Marko', 'Sara', 'David', 'Elena', 'Luka', 'Mia'],
    )
    assert.deepEqual(board.tasks[ids.task('Write a few')].assignees.length, 1)
  })

  it('404s for an unknown board and 400s for a malformed id', async () => {
    assert.equal((await t.api('GET', `/boards/${randomUUID()}`)).status, 404)
    assert.equal((await t.api('GET', '/boards/not-a-uuid')).status, 400)
  })
})

describe('POST /api/boards/:boardId/tasks', () => {
  it('adds the task at the top of the column with default values', async () => {
    const id = randomUUID()
    const { status, body } = await t.api<Task>('POST', `/boards/${board.id}/tasks`, {
      id,
      columnId: ids.column('In Progress'),
      title: '  New task  ',
    })
    assert.equal(status, 201)
    assert.deepEqual(body, {
      id,
      title: 'New task',
      priority: 'ok',
      progress: 0,
      assignees: [],
      commentCount: 0,
      completedSubtaskCount: 0,
    })
    assert.deepEqual(titlesByColumn(await getBoard())['In Progress'], ['New task', 'Machine Lear', 'Learn Comput'])
    await assertConsistent(t.pool, SAMPLE_TASKS + 1)
  })

  it('starts tasks added to Completed at 100%', async () => {
    const { body } = await t.api<Task>('POST', `/boards/${board.id}/tasks`, {
      id: randomUUID(),
      columnId: ids.column('Completed'),
      title: 'Already done',
    })
    assert.equal(body.progress, 100)
  })

  it('treats a retried request as the same task instead of a duplicate', async () => {
    const payload = { id: randomUUID(), columnId: ids.column('To Do'), title: 'Retry me' }
    assert.equal((await t.api('POST', `/boards/${board.id}/tasks`, payload)).status, 201)
    const retry = await t.api<Task>('POST', `/boards/${board.id}/tasks`, payload)
    assert.equal(retry.status, 200)
    assert.equal(retry.body.id, payload.id)
    await assertConsistent(t.pool, SAMPLE_TASKS + 1)

    const reused = await t.api('POST', `/boards/${board.id}/tasks`, { ...payload, title: 'Something else' })
    assert.equal(reused.status, 409)
  })

  it('rejects invalid input', async () => {
    const valid = { id: randomUUID(), columnId: ids.column('To Do'), title: 'x' }
    const post = (body: unknown, boardId = board.id) => t.api('POST', `/boards/${boardId}/tasks`, body)

    assert.equal((await post({ ...valid, title: '   ' })).status, 400)
    assert.equal((await post({ ...valid, title: 'x'.repeat(501) })).status, 400)
    assert.equal((await post({ ...valid, id: 'abc' })).status, 400)
    assert.equal((await post({ title: 'x' })).status, 400)
    assert.equal((await post('{not json')).status, 400)
    assert.equal((await post({ ...valid, columnId: randomUUID() })).status, 404)
    assert.equal((await post(valid, randomUUID())).status, 404)
    await assertConsistent(t.pool, SAMPLE_TASKS)
  })

  it("won't add a task to another board's column", async () => {
    const { rows: [other] } = await t.pool.query<{ id: string }>(
      "INSERT INTO boards (title) VALUES ('Other') RETURNING id",
    )
    const { status } = await t.api('POST', `/boards/${other.id}/tasks`, {
      id: randomUUID(),
      columnId: ids.column('To Do'),
      title: 'Sneaky',
    })
    assert.equal(status, 404)
  })
})

describe('PATCH /api/tasks/:taskId/move', () => {
  it('reorders within a column, down and up', async () => {
    const todo = ids.column('To Do')
    let res = await move(ids.task('UI/UX'), todo, 2)
    assert.equal(res.status, 200)
    assert.deepEqual(titlesByColumn(await getBoard())['To Do'], ['Responsive W', 'Blog Copywri', 'UI/UX Design', 'Landing page'])

    res = await move(ids.task('Landing page'), todo, 0)
    assert.deepEqual(titlesByColumn(await getBoard())['To Do'], ['Landing page', 'Responsive W', 'Blog Copywri', 'UI/UX Design'])
    await assertConsistent(t.pool, SAMPLE_TASKS)
  })

  it('moves between columns and renumbers both', async () => {
    const { status, body } = await move(ids.task('UI/UX'), ids.column('In Progress'), 1)
    assert.equal(status, 200)
    const after = titlesByColumn(await getBoard())
    assert.deepEqual(after['To Do'], ['Responsive W', 'Blog Copywri', 'Landing page'])
    assert.deepEqual(after['In Progress'], ['Machine Lear', 'UI/UX Design', 'Learn Comput'])
    // The response lists both changed columns in their new order
    assert.deepEqual(Object.keys(body.columns).sort(), [ids.column('To Do'), ids.column('In Progress')].sort())
    assert.equal(body.columns[ids.column('In Progress')][1], ids.task('UI/UX'))
    await assertConsistent(t.pool, SAMPLE_TASKS)
  })

  it('sets progress to 100% when a task arrives in Completed, and keeps it when it leaves', async () => {
    const ml = ids.task('Machine Learning')
    const { body } = await move(ml, ids.column('Completed'), 0)
    assert.equal(body.task.progress, 100)
    assert.equal((await getBoard()).tasks[ml].progress, 100)

    const back = await move(ml, ids.column('In Progress'), 0)
    assert.equal(back.body.task.progress, 100)
  })

  it("doesn't touch progress when reordering inside Completed or moving elsewhere", async () => {
    await t.pool.query('UPDATE tasks SET progress = 40 WHERE id = $1', [ids.task('User flow')])
    await move(ids.task('User flow'), ids.column('Completed'), 3)
    assert.equal((await getBoard()).tasks[ids.task('User flow')].progress, 40)

    await move(ids.task('Learn Computer'), ids.column('To Do'), 0)
    assert.equal((await getBoard()).tasks[ids.task('Learn Computer')].progress, 30)
  })

  it('moves into an empty column, clamps a too-large index, and treats the same spot as a no-op', async () => {
    await move(ids.task('Machine Learning'), ids.column('To Do'), 0)
    await move(ids.task('Learn Computer'), ids.column('To Do'), 0)
    assert.deepEqual(titlesByColumn(await getBoard())['In Progress'], [])

    await move(ids.task('UI/UX'), ids.column('In Progress'), 99)
    assert.deepEqual(titlesByColumn(await getBoard())['In Progress'], ['UI/UX Design'])

    const noop = await move(ids.task('UI/UX'), ids.column('In Progress'), 0)
    assert.equal(noop.status, 200)
    assert.deepEqual(noop.body.columns, {})
    await assertConsistent(t.pool, SAMPLE_TASKS)
  })

  it('rejects invalid moves', async () => {
    const task = ids.task('UI/UX')
    const todo = ids.column('To Do')
    assert.equal((await move(randomUUID(), todo, 0)).status, 404)
    assert.equal((await move(task, randomUUID(), 0)).status, 404)
    assert.equal((await t.api('PATCH', `/tasks/${task}/move`, { toColumnId: todo, toIndex: -1 })).status, 400)
    assert.equal((await t.api('PATCH', `/tasks/${task}/move`, { toColumnId: todo, toIndex: 1.5 })).status, 400)
    assert.equal((await t.api('PATCH', `/tasks/${task}/move`, { toIndex: 0 })).status, 400)
    assert.equal((await t.api('PATCH', '/tasks/nope/move', { toColumnId: todo, toIndex: 0 })).status, 400)

    const { rows: [other] } = await t.pool.query<{ id: string }>(
      `WITH b AS (INSERT INTO boards (title) VALUES ('Other') RETURNING id)
       INSERT INTO columns (board_id, title, status, position) SELECT id, 'Elsewhere', 'todo', 0 FROM b RETURNING id`,
    )
    assert.equal((await move(task, other.id, 0)).status, 404, "can't move into another board's column")
    await assertConsistent(t.pool, SAMPLE_TASKS)
  })

  it('stays consistent when many moves and adds arrive at once', async () => {
    const columnIds = board.columnOrder
    const taskIds = Object.keys(board.tasks)
    const requests = Array.from({ length: 20 }, (_, i) =>
      i % 5 === 4
        ? t.api('POST', `/boards/${board.id}/tasks`, { id: randomUUID(), columnId: columnIds[i % 3], title: `Burst ${i}` })
        : move(taskIds[(i * 7) % taskIds.length], columnIds[(i * 5) % 3], (i * 3) % 6),
    )
    const results = await Promise.all(requests)
    assert.ok(results.every((r) => r.status === 200 || r.status === 201), JSON.stringify(results.map((r) => r.status)))
    await assertConsistent(t.pool, SAMPLE_TASKS + 4)
  })
})

describe('unknown routes', () => {
  it('404 as JSON', async () => {
    const { status, body } = await t.api('GET', '/nope')
    assert.deepEqual({ status, body }, { status: 404, body: { error: 'Not found' } })
  })
})
