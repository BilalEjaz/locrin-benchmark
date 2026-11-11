import { useCallback, useEffect, useState } from 'react'

/**
 * Minimal client-side routing: the current path, and navigate() to change it
 * without a page reload (browser back/forward work too). The app only has
 * three paths, so a router library would be overkill.
 */
export function usePath() {
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((to: string, { replace = false } = {}) => {
    if (to === window.location.pathname) return
    if (replace) window.history.replaceState(null, '', to)
    else window.history.pushState(null, '', to)
    setPath(to)
  }, [])

  return { path, navigate }
}
