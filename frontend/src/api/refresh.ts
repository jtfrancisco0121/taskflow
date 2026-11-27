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
 * The cheap form for a write that already patches the cache (an optimistic update): only queries still on their
 * first load are cancelled and refetched; queries holding data keep it, so no extra request for a loaded view.
 */
export async function restartFirstLoads(
  queryClient: QueryClient,
  ...filters: InvalidateQueryFilters[]
) {
  // Decided before cancelling: a cancelled first load is idle again and would no longer match.
  const hashes = new Set<string>()
  for (const filter of filters)
    for (const query of queryClient.getQueryCache().findAll(filter))
      if (query.state.data === undefined && query.state.fetchStatus === 'fetching')
        hashes.add(query.queryHash)
  if (hashes.size === 0) return
  await cancelThenInvalidate(queryClient, { predicate: (query) => hashes.has(query.queryHash) })
}
