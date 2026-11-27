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

const waitingOnFirstLoad = new WeakMap<QueryClient, Set<string>>()

/**
 * The form for refreshes nobody waits on that can come in bursts (Live events, a reconnect). Invalidates `filters`;
 * a query still on its first load (its response may have been read before the event) is not cancelled but refetched
 * once after that load lands. A burst during one first load waits on it once, so it ends with one extra read, and a
 * user's write that restarts the load (cancelThenInvalidate) is not fought: a cancelled load adds no read.
 */
export function invalidateAfterFirstLoads(
  queryClient: QueryClient,
  ...filters: InvalidateQueryFilters[]
) {
  let waiting = waitingOnFirstLoad.get(queryClient)
  if (!waiting) waitingOnFirstLoad.set(queryClient, (waiting = new Set()))
  const pending = waiting
  for (const filter of filters)
    for (const query of queryClient.getQueryCache().findAll(filter)) {
      const hash = query.queryHash
      const load = query.promise
      if (query.state.data !== undefined || query.state.fetchStatus !== 'fetching') continue
      if (!load || pending.has(hash)) continue
      pending.add(hash)
      load.then(
        () => {
          pending.delete(hash)
          void queryClient.invalidateQueries({ predicate: (q) => q === query })
        },
        () => pending.delete(hash),
      )
    }
  return Promise.all(filters.map((filter) => queryClient.invalidateQueries(filter)))
}

/**
 * Starts a refresh and returns at once: the UI (a toast, a queued write, a mutation's isPending) does not wait for
 * a refetch. The cancel runs synchronously inside the call; a cancelled or failed refetch is not an error here.
 */
export function inBackground(refresh: Promise<unknown>) {
  refresh.catch(() => undefined)
}
