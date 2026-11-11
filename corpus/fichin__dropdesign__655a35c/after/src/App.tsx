import { useEffect } from 'react'
import AuthPage from './components/AuthPage'
import BoardScreen from './components/BoardScreen'
import { usePath } from './routing'
import { useAuth } from './state/useAuth'

const AUTH_PATHS = { '/login': 'login', '/register': 'register' } as const

function App() {
  const { auth, login, register, logout, sessionEnded } = useAuth()
  const { path, navigate } = usePath()
  const authMode = AUTH_PATHS[path as keyof typeof AUTH_PATHS]

  // Signed out → the login page; signed in → away from login/register; anything else → the board
  useEffect(() => {
    if (auth.status === 'signedOut' && !authMode) navigate('/login', { replace: true })
    else if (auth.status === 'signedIn' && authMode) navigate('/', { replace: true })
    else if (!authMode && path !== '/') navigate('/', { replace: true })
  }, [auth.status, authMode, path, navigate])

  if (authMode) {
    if (auth.status === 'signedIn') return null // redirecting to the board
    return (
      <AuthPage
        key={authMode}
        mode={authMode}
        notice={auth.status === 'signedOut' ? auth.reason : undefined}
        onSubmit={authMode === 'login' ? login : register}
        onSwitchMode={(mode) => navigate(`/${mode}`)}
      />
    )
  }

  if (auth.status === 'signedOut') return null // redirecting to login

  // While the session is still being checked (or the server is unreachable) the board
  // screen loads in parallel: it shows the cached copy at once, and a 401 from it
  // means the session has ended
  return (
    <BoardScreen
      userEmail={auth.status === 'signedIn' ? auth.user.email : undefined}
      onLogout={logout}
      onUnauthorized={sessionEnded}
    />
  )
}

export default App
