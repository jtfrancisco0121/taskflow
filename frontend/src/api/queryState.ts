/**
 * ClickUp 14yq6g334fe: how a screen reads a query's state. TanStack Query keeps the last good `data` when a background
 * refresh fails (after a write, a live event or a refocus) but still flips `isError`, and `isSuccess` goes false. A
 * screen that branches on those flags blanks data it still holds. Screens branch on these helpers instead (an ESLint
 * rule in eslint.config.js keeps it that way):
 * - `loadFailed`: nothing to show, the first load failed: the error screen.
 * - `refreshFailed`: the data stays on screen, with a RefreshNotice (stale data plus Retry).
 * - `hasData`: render the data, whether or not the last refresh failed.
 */
type QueryLike = { status: 'pending' | 'error' | 'success'; data: unknown }

/** The first load failed: there is no data, so show the error screen. */
export function loadFailed(query: QueryLike): boolean {
  return query.status === 'error' && query.data === undefined
}

/** A background refresh failed while the last good data is still held: keep it and show a RefreshNotice. */
export function refreshFailed(query: QueryLike): boolean {
  return query.status === 'error' && query.data !== undefined
}

/** The query holds data to render (a `null` result counts), whether or not the last refresh failed. */
export function hasData<T extends QueryLike>(
  query: T,
): query is T & { data: Exclude<T['data'], undefined> } {
  return query.data !== undefined
}
