import type { Board, Task } from '../../shared/kanban.ts'

// Empty in development (Vite proxies /api to the backend); the API's URL in production
const API_URL = import.meta.env.VITE_API_URL ?? ''

/** The server answered with an error (`status`), or couldn't be reached at all (`status` 0) */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }

  /**
   * No connection, or a gateway saying the API is down/starting (Vite's dev proxy
   * answers 502 when the backend isn't running; hosts like Render use 502–504)
   */
  get unreachable() {
    return this.status === 0 || (this.status >= 502 && this.status <= 504)
  }
}

const UNREACHABLE_MESSAGE = 'Could not reach the server'

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, UNREACHABLE_MESSAGE)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const error = new ApiError(res.status, data?.error ?? `Request failed (${res.status})`)
    throw error.unreachable ? new ApiError(res.status, UNREACHABLE_MESSAGE) : error
  }
  return data as T
}

export const api = {
  listBoards: () => request<{ id: string; title: string }[]>('GET', '/boards'),
  getBoard: (boardId: string) => request<Board>('GET', `/boards/${boardId}`),
  addTask: (boardId: string, task: { id: string; columnId: string; title: string }) =>
    request<Task>('POST', `/boards/${boardId}/tasks`, task),
  moveTask: (taskId: string, move: { toColumnId: string; toIndex: number }) =>
    request<{ task: Task; columns: Record<string, string[]> }>('PATCH', `/tasks/${taskId}/move`, move),
}
