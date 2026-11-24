import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
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
    queryFn: ({ pageParam }) =>
      unwrap(
        api.POST('/api/v1/views/query', {
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
  // Memoized on the data, so consumers get a stable array between fetches.
  const pages = query.data?.pages
  const items = useMemo(() => {
    const seen = new Set<string>()
    return (pages?.flatMap((page) => page.items ?? []) ?? []).filter((item) => {
      const key = `${item.group ?? ''}|${item.task?.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [pages])
  const groups = query.data?.pages[0]?.groups
  const droppedFields = query.data?.pages[0]?.droppedFields ?? []
  return { ...query, items, groups, droppedFields }
}
