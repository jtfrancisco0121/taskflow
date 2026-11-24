import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'

/** Every member of a Workspace (all pages are fetched: pickers need the whole list). */
export function useMembers(workspaceId: string | undefined) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.members(workspaceId ?? ''),
    enabled: !!workspaceId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/v1/workspaces/{id}/members', {
          params: { path: { id: workspaceId! }, query: { cursor: pageParam, limit: 200 } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  const members = query.data?.pages.flatMap((page) => page.items ?? []) ?? []
  return { members, isLoading: query.isLoading || query.hasNextPage }
}
