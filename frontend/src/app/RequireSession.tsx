import { useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useSession } from '../features/auth'

/** FR-4, FR-5: protected routes wait for the session boot, then redirect to sign-in keeping the path. */
export function RequireSession() {
  const session = useSession()
  const location = useLocation()
  const [wasAuthenticated, setWasAuthenticated] = useState(false)
  if (session.status === 'authenticated' && !wasAuthenticated) setWasAuthenticated(true)

  if (session.status === 'loading') {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center text-slate-600">
        Loading Taskflow…
      </div>
    )
  }
  if (session.status === 'anonymous') {
    return <Navigate to="/signin" replace state={{ from: location, ended: wasAuthenticated }} />
  }
  return <Outlet />
}
