import createClient from 'openapi-fetch'
import type { components, paths } from './schema'

/**
 * AD-2: the access token lives only in this module's memory. It is never written to localStorage,
 * sessionStorage or a cookie. `refreshSession()` is the only caller of POST /auth/refresh and its
 * concurrent callers share one in-flight promise (the backend revokes the whole session family on
 * a reused refresh token).
 */
export type SessionUser = components['schemas']['UserResponse']
type Fetcher = (request: Request) => Promise<Response>

let accessToken: string | null = null
let user: SessionUser | null = null
let inflight: Promise<string | null> | null = null
let sessionEndHook: (() => void) | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

export function getAccessToken(): string | null {
  return accessToken
}

export function getSessionUser(): SessionUser | null {
  return user
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Registered once by providers: clears the query cache when a session ends or the user changes. */
export function onSessionEnd(hook: (() => void) | null) {
  sessionEndHook = hook
}

export function setSession(token: string, nextUser: SessionUser | null) {
  const changed = user?.id != null && nextUser?.id != null && user.id !== nextUser.id
  accessToken = token
  user = nextUser ?? user
  if (changed) sessionEndHook?.()
  notify()
}

export function clearSession() {
  const had = accessToken !== null || user !== null
  accessToken = null
  user = null
  if (had) sessionEndHook?.()
  notify()
}

type RefreshOptions = { fetch?: Fetcher; baseUrl?: string }

async function doRefresh(fetcher: Fetcher, baseUrl: string): Promise<string | null> {
  // A client without the auth middleware: no circular import and no 401 loop.
  const plain = createClient<paths>({ baseUrl, fetch: fetcher })
  try {
    const { data, response } = await plain.POST('/api/v1/auth/refresh')
    if (!response.ok || !data?.accessToken) {
      clearSession()
      return null
    }
    setSession(data.accessToken, data.user ?? null)
    return data.accessToken
  } catch {
    clearSession()
    return null
  }
}

export function refreshSession(options: RefreshOptions = {}): Promise<string | null> {
  if (inflight) return inflight
  const run = options.fetch ?? ((request: Request) => globalThis.fetch(request))
  const baseUrl = options.baseUrl ?? ''
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  const promise = (async (): Promise<string | null> =>
    locks
      ? ((await locks.request('taskflow-refresh', () => doRefresh(run, baseUrl))) as string | null)
      : doRefresh(run, baseUrl))()
  inflight = promise.finally(() => {
    inflight = null
  })
  return inflight
}
