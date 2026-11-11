import { useMemo } from 'react'
import { getTeamMembers } from '../state/boardReducer'
import { useBoardSync } from '../state/useBoardSync'
import { exportBoard } from '../utils/exportBoard'
import Board from './Board'
import ProjectHeader from './ProjectHeader'
import { BoardPlaceholder, Notice, StatusBanner } from './SyncStatus'
import TopBar from './TopBar'

interface BoardScreenProps {
  userEmail?: string
  onLogout: () => void
  /** The API answered 401: the session is missing or has expired */
  onUnauthorized: () => void
}

function BoardScreen({ userEmail, onLogout, onUnauthorized }: BoardScreenProps) {
  // The server's board; see useBoardSync for loading, saving, rollback and the offline copy
  const { board, status, readOnly, loadError, notice, dismissNotice, retry, addTask, moveTask } = useBoardSync({
    onUnauthorized,
  })
  const members = useMemo(() => (board ? getTeamMembers(board) : []), [board])

  if (!board) {
    return <BoardPlaceholder status={status} error={loadError} onRetry={retry} />
  }

  return (
    <>
      <TopBar projectTitle={board.title} members={members} userEmail={userEmail} onLogout={onLogout} />
      <main>
        <StatusBanner status={status} onRetry={retry} />
        <ProjectHeader title={board.title} onExport={() => exportBoard(board)} />
        <Board board={board} readOnly={readOnly} onAddTask={addTask} onMoveTask={moveTask} />
      </main>
      <Notice message={notice} onDismiss={dismissNotice} />
    </>
  )
}

export default BoardScreen
