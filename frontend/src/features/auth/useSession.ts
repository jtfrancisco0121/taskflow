import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../../api/client'
import {
  getAccessToken,
  getSessionUser,
  isBooted,
  subscribe,
  type SessionUser,
} from '../../api/session'

export type SessionState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: SessionUser | null }

/** FR-4: restores the session once with the refresh cookie before any protected route renders. */
export function useSession(): SessionState {
  const token = useSyncExternalStore(subscribe, getAccessToken)
  const user = useSyncExternalStore(subscribe, getSessionUser)
  const booted = useSyncExternalStore(subscribe, isBooted)

  useEffect(() => {
    // Concurrent calls share one request, so StrictMode's second effect run is harmless.
    if (!isBooted()) void api.refresh()
  }, [])

  if (token) return { status: 'authenticated', user }
  if (!booted) return { status: 'loading', user: null }
  return { status: 'anonymous', user: null }
}
