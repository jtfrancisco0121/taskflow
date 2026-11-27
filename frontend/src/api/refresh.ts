import type { InvalidateQueryFilters, QueryClient } from '@tanstack/react-query'

/**
 * After a write, refetch every query matching `filters`, including one whose first load is still in flight.
 * invalidateQueries does not restart a fetch that has no data yet, and the late response (read before the write)
 * would clear the invalidation and leave the write missing until a reload. Cancelling first (revert: true puts a
 * no-data query back to pending) lets the invalidation start a fresh fetch. Cancels all, then invalidates all.
 */
export async function cancelThenInvalidate(
  queryClient: QueryClient,
  ...filters: InvalidateQueryFilters[]
) {
  await Promise.all(filters.map((filter) => queryClient.cancelQueries(filter)))
  await Promise.all(filters.map((filter) => queryClient.invalidateQueries(filter)))
}

/**
 * The queries matching `filters` that are still on their first load: no data yet and a fetch in flight. Take this
 * before writing the response into the cache (a setQueryData gives such a query data, and it would no longer match).
 * A query that failed or is idle has nothing in flight that a write could have missed, so it is left alone.
 */
export function firstLoadsOf(queryClient: QueryClient, ...filters: InvalidateQueryFilters[]) {
  const hashes = new Set<string>()
  for (const filter of filters)
    for (const query of queryClient.getQueryCache().findAll(filter))
      if (query.state.data === undefined && query.state.fetchStatus === 'fetching')
        hashes.add(query.queryHash)
  return hashes
}

/** Cancels and refetches the queries of a `firstLoadsOf` snapshot. */
export async function restartQueries(queryClient: QueryClient, hashes: Set<string>) {
  if (hashes.size === 0) return
  await cancelThenInvalidate(queryClient, { predicate: (query) => hashes.has(query.queryHash) })
}

/**
 * The cheap form for a write that already patches the cache (an optimistic update): only queries still on their
 * first load are cancelled and refetched; queries holding data keep it, so no extra request for a loaded view.
 */
export function restartFirstLoads(queryClient: QueryClient, ...filters: InvalidateQueryFilters[]) {
  return restartQueries(queryClient, firstLoadsOf(queryClient, ...filters))
}

/**
 * Starts a refresh and returns at once: the UI (a toast, a queued write, a mutation's isPending) does not wait for
 * a refetch. The cancel runs synchronously inside the call; a cancelled or failed refetch is not an error here.
 */
export function inBackground(refresh: Promise<unknown>) {
  refresh.catch(() => undefined)
}
