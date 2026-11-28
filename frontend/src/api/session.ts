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
let booted = false
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

/** True once the first refresh settled (or a sign-in happened): the app knows whether it is signed in. */
export function isBooted(): boolean {
  return booted
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
  booted = true
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

/** Longest wait honoured from a 503's Retry-After, and the wait when it is missing or unreadable. */
export const MAX_REFRESH_RETRY_WAIT_MS = 5_000
const DEFAULT_REFRESH_RETRY_WAIT_MS = 1_000

function retryWaitMs(response: Response): number {
  const header = response.headers.get('Retry-After')
  const seconds = header === null || header.trim() === '' ? NaN : Number(header)
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_REFRESH_RETRY_WAIT_MS
  return Math.min(seconds * 1_000, MAX_REFRESH_RETRY_WAIT_MS)
}

/**
 * 14yq6g334r6: only a 401 (the refresh token is invalid, revoked or expired) ends the session. A 503
 * (the server is busy, e.g. the session family's lock) is retried once after Retry-After (capped);
 * that and any other failure (a 500, the network) keeps the session and returns null.
 */
async function doRefresh(fetcher: Fetcher, baseUrl: string): Promise<string | null> {
  // A client without the auth middleware: no circular import and no 401 loop.
  const plain = createClient<paths>({ baseUrl, fetch: fetcher })
  try {
    let result = await plain.POST('/api/v1/auth/refresh')
    if (result.response.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, retryWaitMs(result.response)))
      result = await plain.POST('/api/v1/auth/refresh')
    }
    const { data, response } = result
    if (response.status === 401) {
      clearSession()
      return null
    }
    if (!response.ok || !data?.accessToken) return null
    setSession(data.accessToken, data.user ?? null)
    return data.accessToken
  } catch {
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
    booted = true
    notify()
  })
  return inflight
}

/** Test helper: back to the state of a freshly loaded page. */
export function resetSessionForTests() {
  accessToken = null
  user = null
  booted = false
  inflight = null
  sessionEndHook = null
}
