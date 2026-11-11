import { useCallback, useEffect, useRef, useState } from 'react'
import type { Board } from '../../shared/kanban.ts'
import { api, ApiError } from '../api/client'
import { boardReducer, type BoardAction } from './boardReducer'
import { loadCachedBoard, saveCachedBoard } from './storage'

/**
 * - loading: fetching from the server (the cached board, if any, is shown read-only)
 * - live:    showing the server's board; changes are saved
 * - offline: the server can't be reached; showing the last confirmed board, read-only
 * - error:   the server can't be reached and there's nothing cached to show
 */
export type SyncStatus = 'loading' | 'live' | 'offline' | 'error'

/** Loads the cached board's id if it still exists, otherwise the first board */
async function fetchCurrentBoard(preferredId: string | undefined): Promise<Board> {
  if (preferredId) {
    try {
      return await api.getBoard(preferredId)
    } catch (error) {
      // 404: the board was deleted or the database reseeded; fall back to the list
      if (!(error instanceof ApiError && error.status === 404)) throw error
    }
  }
  const [first] = await api.listBoards()
  if (!first) throw new ApiError(404, 'There are no boards yet (run "npm run seed" in backend/)')
  return api.getBoard(first.id)
}

/**
 * The board, kept in sync with the server. Changes show immediately (optimistic)
 * and are sent one at a time in order; if one is rejected, the board is reloaded
 * from the server, or rolled back to the last confirmed state if that fails too.
 */
export function useBoardSync({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [initialCache] = useState(loadCachedBoard)
  const [board, setBoard] = useState<Board | null>(initialCache)
  const [status, setStatus] = useState<SyncStatus>('loading')
  const [notice, setNotice] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // The last board the server confirmed: what a failed change rolls back to
  const confirmed = useRef<Board | null>(initialCache)
  // Changes waiting for the server, sent strictly one after another
  const queue = useRef<Promise<void>>(Promise.resolve())
  // Bumped on every reload/rollback; queued changes from before it are dropped
  const epoch = useRef(0)
  // Latest values for the callbacks below, which shouldn't change identity on every render
  const statusRef = useRef(status)
  const boardRef = useRef(board)
  const onUnauthorizedRef = useRef(onUnauthorized)
  useEffect(() => {
    statusRef.current = status
    boardRef.current = board
    onUnauthorizedRef.current = onUnauthorized
  }, [status, board, onUnauthorized])

  /** 401: the session is missing or expired. Hand over to sign-in instead of going offline */
  const isUnauthorized = useCallback((error: unknown) => {
    if (!(error instanceof ApiError && error.status === 401)) return false
    epoch.current++
    onUnauthorizedRef.current()
    return true
  }, [])

  const adopt = useCallback((fresh: Board) => {
    confirmed.current = fresh
    saveCachedBoard(fresh)
    boardRef.current = fresh
    setBoard(fresh)
    setStatus('live')
  }, [])

  // Status is already 'loading' on first render; retry() sets it for later attempts
  const load = useCallback(async () => {
    epoch.current++
    try {
      adopt(await fetchCurrentBoard(confirmed.current?.id))
      setLoadError(null)
    } catch (error) {
      if (isUnauthorized(error)) return
      console.warn('Could not load the board:', error)
      setLoadError(error instanceof ApiError ? error.message : 'Something went wrong')
      setStatus(confirmed.current ? 'offline' : 'error')
    }
  }, [adopt, isUnauthorized])

  const retry = useCallback(() => {
    setStatus('loading')
    void load()
  }, [load])

  useEffect(() => {
    void load()
    // Back online: try again. Gone offline: stop accepting changes until reconnected
    const onOnline = () => {
      if (statusRef.current !== 'live') retry()
    }
    const onOffline = () => {
      if (statusRef.current === 'live') setStatus('offline')
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [load, retry])

  /** Apply now, send in order, and recover if the server says no */
  const change = useCallback(
    (action: BoardAction, send: () => Promise<unknown>) => {
      const current = boardRef.current
      if (statusRef.current !== 'live' || !current) return
      const next = boardReducer(current, action)
      // e.g. a card dropped back where it started: nothing to save
      if (next === current) return
      boardRef.current = next
      setBoard(next)
      const changeEpoch = epoch.current

      queue.current = queue.current.then(async () => {
        // Made on top of a change that has since been rolled back: don't send it
        if (changeEpoch !== epoch.current) return
        try {
          await send()
          // The server applies the same rules as the reducer, so this matches its state
          if (confirmed.current) {
            confirmed.current = boardReducer(confirmed.current, action)
            saveCachedBoard(confirmed.current)
          }
        } catch (error) {
          if (isUnauthorized(error)) return
          epoch.current++
          const reason = error instanceof ApiError && !error.unreachable ? `: ${error.message}` : ''
          try {
            adopt(await fetchCurrentBoard(confirmed.current?.id))
            setNotice(`Your last change couldn't be saved${reason}. The board was reloaded.`)
          } catch (reloadError) {
            if (isUnauthorized(reloadError)) return
            boardRef.current = confirmed.current
            setBoard(confirmed.current)
            setStatus('offline')
            setNotice("Your last change couldn't be saved because the server can't be reached. It was undone.")
          }
        }
      })
    },
    [adopt, isUnauthorized],
  )

  const addTask = useCallback(
    (columnId: string, title: string) => {
      const boardId = confirmed.current?.id
      if (!boardId) return
      const taskId = crypto.randomUUID()
      change({ type: 'addTask', taskId, columnId, title }, () =>
        api.addTask(boardId, { id: taskId, columnId, title: title.trim() }),
      )
    },
    [change],
  )

  const moveTask = useCallback(
    (taskId: string, toColumnId: string, toIndex: number) => {
      change({ type: 'moveTask', taskId, toColumnId, toIndex }, () => api.moveTask(taskId, { toColumnId, toIndex }))
    },
    [change],
  )

  // Messages disappear on their own after a few seconds
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  return {
    board,
    status,
    readOnly: status !== 'live',
    loadError,
    notice,
    dismissNotice: () => setNotice(null),
    retry,
    addTask,
    moveTask,
  }
}
