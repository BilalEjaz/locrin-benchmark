import { PRIORITIES, TASK_STATUSES, type Board } from '../../shared/kanban.ts'

// A read-only copy of the last board the server confirmed. The server is the source
// of truth; this only lets the board appear instantly on load, and be viewed offline.
const STORAGE_KEY = 'kanban-board'
/**
 * Bump when the saved shape changes. v1 was the pre-backend local board (sample ids,
 * no board id), so it's ignored rather than shown as if it came from the server.
 */
const STORAGE_VERSION = 2

/** The cached board, or null when there isn't a usable one (missing, outdated, corrupted, or storage blocked) */
export function loadCachedBoard(): Board | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null

    const saved: unknown = JSON.parse(raw)
    if (!isRecord(saved) || saved.version !== STORAGE_VERSION || !isBoard(saved.board)) {
      console.warn('Ignoring cached board: unexpected format')
      return null
    }
    return saved.board
  } catch (error) {
    // Invalid JSON, or localStorage itself unavailable (e.g. blocked by browser settings)
    console.warn('Ignoring cached board:', error)
    return null
  }
}

export function saveCachedBoard(board: Board) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, board }))
  } catch (error) {
    // Storage full or blocked: everything still works, there's just no offline copy
    console.warn('Could not cache board:', error)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isString = (value: unknown) => typeof value === 'string'
const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value)

/**
 * Checks everything the UI relies on, so a board that parses but is broken
 * (e.g. a column pointing at a missing task) falls back instead of crashing a render.
 */
function isBoard(value: unknown): value is Board {
  if (!isRecord(value) || !isString(value.id) || !isString(value.title)) return false
  const { tasks, columns, columnOrder } = value
  if (!isRecord(tasks) || !isRecord(columns) || !Array.isArray(columnOrder)) return false

  const tasksValid = Object.entries(tasks).every(
    ([id, task]) =>
      isRecord(task) &&
      task.id === id &&
      isString(task.title) &&
      PRIORITIES.includes(task.priority as (typeof PRIORITIES)[number]) &&
      isNumber(task.progress) &&
      isNumber(task.commentCount) &&
      isNumber(task.completedSubtaskCount) &&
      Array.isArray(task.assignees) &&
      task.assignees.every(
        (person) =>
          isRecord(person) && isString(person.id) && isString(person.name) && isString(person.avatarUrl),
      ),
  )
  if (!tasksValid) return false

  const placedTaskIds = new Set<string>()
  const columnsValid = columnOrder.every((columnId) => {
    const column = isString(columnId) ? columns[columnId as string] : undefined
    return (
      isRecord(column) &&
      column.id === columnId &&
      isString(column.title) &&
      TASK_STATUSES.includes(column.status as (typeof TASK_STATUSES)[number]) &&
      Array.isArray(column.taskIds) &&
      column.taskIds.every((taskId) => {
        // Each task must exist and sit in exactly one column
        if (!isString(taskId) || !(taskId in tasks) || placedTaskIds.has(taskId)) return false
        placedTaskIds.add(taskId)
        return true
      })
    )
  })

  return columnsValid && Object.keys(columns).length === columnOrder.length
}
