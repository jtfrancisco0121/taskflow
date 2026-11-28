import createClient from 'openapi-fetch'
import type { components, paths } from './schema'
import { DEFAULT_RETRY_WAIT_MS, MAX_RETRY_WAIT_MS, retryWaitMs } from './retryAfter'

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
/** Refreshes in a row that ended on a transient failure; any token, sign-in or clear resets it. */
let transientFailures = 0
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
  transientFailures = 0
  if (changed) sessionEndHook?.()
  notify()
}

export function clearSession() {
  const had = accessToken !== null || user !== null
  accessToken = null
  user = null
  transientFailures = 0
  if (had) sessionEndHook?.()
  notify()
}

type RefreshOptions = { fetch?: Fetcher; baseUrl?: string }

/** Longest wait honoured from a 503's Retry-After, and the wait when it is missing or unreadable. */
export const MAX_REFRESH_RETRY_WAIT_MS = MAX_RETRY_WAIT_MS
const DEFAULT_REFRESH_RETRY_WAIT_MS = DEFAULT_RETRY_WAIT_MS

/**
 * Refreshes in a row that may end on a transient failure before the session is cleared. Below it, a
 * blip (a busy or restarting server, a dropped connection) keeps the user signed in and the next
 * API call refreshes again; at it, the session is treated as dead and the app goes to sign-in.
 */
export const MAX_CONSECUTIVE_TRANSIENT_REFRESH_FAILURES = 3

type Attempt =
  | { kind: 'ok'; token: string; user: SessionUser | null }
  | { kind: 'definitive' }
  | { kind: 'transient'; waitMs: number }

/** A 5xx, 408 or 429 may succeed if asked again; any other non-2xx answer will not. */
function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429
}

async function attempt(plain: ReturnType<typeof createClient<paths>>): Promise<Attempt> {
  try {
    const { data, response } = await plain.POST('/api/v1/auth/refresh')
    if (response.ok) {
      // A 2xx without a token is not a session either: asking again will not make one.
      return data?.accessToken
        ? { kind: 'ok', token: data.accessToken, user: data.user ?? null }
        : { kind: 'definitive' }
    }
    if (isTransientStatus(response.status)) {
      return { kind: 'transient', waitMs: retryWaitMs(response) }
    }
    return { kind: 'definitive' }
  } catch {
    // The network, or a body that is not JSON: the server may answer next time.
    return { kind: 'transient', waitMs: DEFAULT_REFRESH_RETRY_WAIT_MS }
  }
}

/**
 * 14yq6g334r6 and PR #36: a definitive failure (401, any other 4xx but 408/429, a 2xx without a
 * token) clears the session at once, so the user is never left "signed in" with a token the server
 * rejected. A transient one (5xx, 408, 429, the network) is retried once after Retry-After
 * (capped); if the retry is transient too the session is kept, until
 * MAX_CONSECUTIVE_TRANSIENT_REFRESH_FAILURES refreshes in a row have ended that way.
 */
async function doRefresh(fetcher: Fetcher, baseUrl: string): Promise<string | null> {
  // A client without the auth middleware: no circular import and no 401 loop.
  const plain = createClient<paths>({ baseUrl, fetch: fetcher })
  let result = await attempt(plain)
  if (result.kind === 'transient') {
    const { waitMs } = result
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    result = await attempt(plain)
  }
  if (result.kind === 'ok') {
    setSession(result.token, result.user)
    return result.token
  }
  if (result.kind === 'transient') {
    transientFailures += 1
    if (transientFailures < MAX_CONSECUTIVE_TRANSIENT_REFRESH_FAILURES) return null
  }
  clearSession()
  return null
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
  transientFailures = 0
}
