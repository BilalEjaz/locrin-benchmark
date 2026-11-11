import { useMemo } from 'react'
import Board from './components/Board'
import ProjectHeader from './components/ProjectHeader'
import { BoardPlaceholder, Notice, StatusBanner } from './components/SyncStatus'
import TopBar from './components/TopBar'
import { getTeamMembers } from './state/boardReducer'
import { useBoardSync } from './state/useBoardSync'
import { exportBoard } from './utils/exportBoard'

function App() {
  // The server's board; see useBoardSync for loading, saving, rollback and the offline copy
  const { board, status, readOnly, loadError, notice, dismissNotice, retry, addTask, moveTask } = useBoardSync()
  const members = useMemo(() => (board ? getTeamMembers(board) : []), [board])

  if (!board) {
    return <BoardPlaceholder status={status} error={loadError} onRetry={retry} />
  }

  return (
    <>
      <TopBar projectTitle={board.title} members={members} />
      <main>
        <StatusBanner status={status} onRetry={retry} />
        <ProjectHeader title={board.title} onExport={() => exportBoard(board)} />
        <Board board={board} readOnly={readOnly} onAddTask={addTask} onMoveTask={moveTask} />
      </main>
      <Notice message={notice} onDismiss={dismissNotice} />
    </>
  )
}

export default App
