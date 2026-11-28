import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import { shownData } from '../../api/queryState'
import type { ViewConfig } from '../../api/types'
import { scopeId, type ViewScope } from './scope'
import { configHash } from './urlState'

/**
 * AD-5: the one task read of every renderer. Pages by the server's keyset cursor, never an offset.
 * A Board column passes its `groupValue` and pages on its own.
 */
export function useViewTasks(
  scope: ViewScope,
  config: ViewConfig,
  options: { groupValue?: string; limit?: number; enabled?: boolean } = {},
) {
  const { groupValue, limit = 50, enabled = true } = options
  const query = useInfiniteQuery({
    queryKey: queryKeys.view(scope.workspaceId, scopeId(scope), configHash(config), groupValue),
    enabled,
    initialPageParam: undefined as string | undefined,
    // The signal aborts the request when the query is cancelled (14yq6g334tg: a restarted read sends no extra load).
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.POST('/api/v1/views/query', {
          signal,
          body: {
            scope: scope.locationId
              ? { locationId: scope.locationId }
              : { workspaceId: scope.workspaceId },
            config,
            groupValue,
            cursor: pageParam,
            limit,
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  // A task is shown once per group; across a page boundary the same (task, group) never repeats.
  // Memoized on the data, so consumers get a stable array between fetches. Read through shownData (14yq6g334bn): no
  // items after a 401/403/404 refresh, so no renderer draws stale cards under its error; a 500 keeps them.
  const shown = shownData(query)
  const pages = shown?.pages
  const items = useMemo(() => {
    const seen = new Set<string>()
    return (pages?.flatMap((page) => page.items ?? []) ?? []).filter((item) => {
      const key = `${item.group ?? ''}|${item.task?.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [pages])
  const groups = shown?.pages[0]?.groups
  const droppedFields = shown?.pages[0]?.droppedFields ?? []
  return { ...query, items, groups, droppedFields }
}
