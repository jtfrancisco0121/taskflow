/**
 * ClickUp 14yq6g334fe: how a screen reads a query's state. TanStack Query keeps the last good `data` when a background
 * refresh fails (after a write, a live event or a refocus) but still flips `isError`, and `isSuccess` goes false. A
 * screen that branches on those flags blanks data it still holds. Screens branch on these helpers instead (an ESLint
 * rule in eslint.config.js keeps it that way):
 * - `loadFailed`: the error screen: the first load failed, or a read failed with 401/403/404 (gone, no access, session).
 * - `refreshFailed`: any other refresh failure: the data stays on screen, with a RefreshNotice (stale data plus Retry).
 * - `hasData`: render the data, whether or not the last refresh failed (false after a 401/403/404).
 */
import { ApiError } from './errors'

type QueryLike = { status: 'pending' | 'error' | 'success'; data: unknown; error?: unknown }

/**
 * 401, 403 and 404 are not a passing blip: the item is gone, access was revoked, or the session layer (src/api/client.ts
 * refresh, then sign-out) owns it. Held data must not mask them behind a "couldn't refresh" notice.
 */
const TERMINAL = new Set([401, 403, 404])
function terminal(error: unknown): boolean {
  return error instanceof ApiError && TERMINAL.has(error.status)
}

/** Show the error screen: the first load failed (no data), or any read failed with 401, 403 or 404. */
export function loadFailed(query: QueryLike): boolean {
  return query.status === 'error' && (query.data === undefined || terminal(query.error))
}

/** A background refresh failed while the last good data is still held: keep it and show a RefreshNotice. */
export function refreshFailed(query: QueryLike): boolean {
  return query.status === 'error' && query.data !== undefined && !terminal(query.error)
}

/**
 * The query holds data to render (a `null` result counts), also after a failed refresh, but not after a 401, 403 or
 * 404: that data is gone or no longer visible, and the screen shows only its error (loadFailed).
 */
export function hasData<T extends QueryLike>(
  query: T,
): query is T & { data: Exclude<T['data'], undefined> } {
  return query.data !== undefined && !(query.status === 'error' && terminal(query.error))
}
