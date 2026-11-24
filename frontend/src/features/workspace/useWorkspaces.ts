import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'

/** AD-6: GET /workspaces through useInfiniteQuery with the server's cursor. */
export function useWorkspaces() {
  return useInfiniteQuery({
    queryKey: queryKeys.workspaces(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/v1/workspaces', { params: { query: { cursor: pageParam, limit: 50 } } }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

/** Loads every page (a user has few Workspaces) and returns the flat list. */
export function useAllWorkspaces() {
  const query = useWorkspaces()
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  const workspaces = query.data?.pages.flatMap((page) => page.items ?? []) ?? []
  return { ...query, workspaces, done: query.isSuccess && !hasNextPage }
}
